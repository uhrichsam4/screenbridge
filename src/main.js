'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { Share, generatePassword, sharePort, voxlPath, lanAddresses } = require('./share');
const { parseAddress, probe, startForwarder, httpStatus } = require('./forward');

const SETTINGS_LINKS = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};

// One copy at a time: a second launch focuses the first one's window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let mainWindow = null;
const share = new Share();
const viewers = new Set(); // { win, fwd }

// Settings (password, last address) in userData/settings.json.
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  const s = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  return s;
}
function password() {
  let { password: pw } = loadSettings();
  if (!pw) pw = saveSettings({ password: generatePassword() }).password;
  return pw;
}

function send(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('share-event', { event, data });
}

function shareState() {
  return {
    sharing: share.running,
    password: password(),
    port: sharePort(),
    addresses: lanAddresses(),
    platform: process.platform,
    lastAddress: loadSettings().lastAddress || '',
    gameMode: loadSettings().gameMode !== false,
    voxlFound: !!voxlPath(process.resourcesPath),
  };
}

// Start, stop and new password run one after another, never at the same time.
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

function startShare() {
  if (share.running) return;
  const bin = voxlPath(process.resourcesPath);
  if (!bin) throw new Error('The screen sharing program (voxl) is missing from this app.');
  share.start({ bin, port: sharePort(), password: password() });
}

share.on('listening', () => send('listening'));
// Without Screen Recording permission voxl can't capture anything (it may still say it's
// listening), so this counts as not sharing: stop it and say why.
share.on('screen-permission', () => {
  send('screen-permission');
  serial(() => share.stop());
});
share.on('accessibility-permission', () => send('accessibility-permission'));
share.on('port-in-use', ({ port }) => send('port-in-use', { port }));
share.on('exit', (e) =>
  send('exit', { code: e.code, signal: e.signal, expected: e.expected, lastLines: e.lastLines, error: e.error })
);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    title: 'ScreenBridge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing the main window quits the app (all platforms): viewer windows close and
  // sharing stops in before-quit.
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

ipcMain.handle('get-state', () => shareState());

ipcMain.handle('start-share', () =>
  serial(() => {
    startShare();
    return shareState();
  })
);

ipcMain.handle('stop-share', () =>
  serial(async () => {
    await share.stop();
    return shareState();
  })
);

ipcMain.handle('new-password', () =>
  serial(async () => {
    const wasSharing = share.running;
    saveSettings({ password: generatePassword() });
    // A running share keeps its old password until it restarts, so restart it; a
    // stopped one stays stopped.
    if (wasSharing) {
      await share.stop();
      startShare();
    }
    return shareState();
  })
);

ipcMain.handle('open-settings', (_e, kind) => {
  const url = SETTINGS_LINKS[kind];
  if (url && process.platform === 'darwin') shell.openExternal(url);
});

ipcMain.handle('connect', async (_e, { address, password: pw, gameMode }) => {
  const target = parseAddress(address);
  if (!target) return { ok: false, error: 'That address doesn\'t look right. It should look like 192.168.0.10' };
  if (!pw || !String(pw).trim()) return { ok: false, error: 'Type the password shown on the other computer.' };
  pw = String(pw).trim();
  gameMode = gameMode !== false;
  saveSettings({ lastAddress: String(address).trim(), gameMode });

  try {
    await probe(target.host, target.port, 3000);
  } catch {
    return {
      ok: false,
      error: `Can't reach ${target.host}:${target.port}. Check that the other computer is sharing, that both are on the same Wi-Fi, and that the address is typed correctly.`,
    };
  }

  let fwd;
  try {
    fwd = await startForwarder(target.host, target.port);
    const status = await httpStatus(fwd.port, `/?token=${encodeURIComponent(pw)}`, {
      hostHeader: `127.0.0.1:${fwd.port}`,
    });
    if (status === 401) {
      await fwd.close();
      return { ok: false, error: 'Wrong password. Check the password shown on the other computer.' };
    }
    if (status === 403) {
      // voxl refuses a Host or Origin it doesn't serve; not a password problem.
      await fwd.close();
      return {
        ok: false,
        error: 'The other computer refused the connection (HTTP 403). Make sure it is running ScreenBridge and try again.',
      };
    }
    if (status !== 200) {
      await fwd.close();
      return { ok: false, error: `The other computer answered, but not as expected (HTTP ${status}). Is it running ScreenBridge?` };
    }
  } catch (err) {
    if (fwd) await fwd.close();
    return { ok: false, error: `Couldn't connect: ${err.message}` };
  }

  openViewer(fwd, target, pw, gameMode);
  return { ok: true };
});

function openViewer(fwd, target, pw, gameMode) {
  // 127.0.0.1, not localhost: the forwarder only listens on IPv4, and localhost could
  // resolve to ::1. 127.0.0.1 is a secure context too, so WebCodecs works.
  const origin = `http://127.0.0.1:${fwd.port}`;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: `ScreenBridge: watching ${target.host}`,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'viewer',
    },
  });
  win.removeMenu();
  win.maximize();
  win.show();
  const entry = { win, fwd };
  viewers.add(entry);
  const wc = win.webContents;
  // Only the forwarded voxl page: no other sites, no pop-ups.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin + '/')) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!url.startsWith(origin + '/')) e.preventDefault();
  });
  // F11 toggles fullscreen; every other key goes to the stream.
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  // Covers the X button and window.close() from the page (game mode's Leave).
  win.on('closed', () => {
    viewers.delete(entry);
    fwd.close();
  });
  const query = `?token=${encodeURIComponent(pw)}${gameMode ? '&game=1' : ''}`;
  win.loadURL(`${origin}/${query}`);
}

// What the viewer page (the forwarded voxl page on 127.0.0.1) may do; everything else,
// and anything for any other origin, is denied.
const VIEWER_PERMISSIONS = new Set([
  'pointerLock', // game mode: relative mouse for camera control
  'fullscreen', // the page's own fullscreen button (F11 also works)
  'keyboardLock', // lets games get keys like Esc and Alt+Tab while fullscreen
  'clipboard-read', // voxl syncs this computer's clipboard to the other one
  'clipboard-sanitized-write', // ...and the other computer's clipboard back here
]);
function isViewerOrigin(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

app.on('login', (e, _wc, _details, _auth, callback) => {
  // voxl asks for a password with HTTP Basic if the token is wrong; we check it before
  // opening the viewer, so just cancel the prompt.
  e.preventDefault();
  callback();
});

// macOS keeps an app menu; a minimal one, so the default View menu's reload (Cmd+R),
// zoom and developer tools (which would show the password) can't reach the viewer.
function setMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  setMenu();
  const viewerSession = session.fromPartition('viewer');
  viewerSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    cb(VIEWER_PERMISSIONS.has(perm) && isViewerOrigin(url));
  });
  viewerSession.setPermissionCheckHandler((_wc, perm, origin) => VIEWER_PERMISSIONS.has(perm) && isViewerOrigin(origin));
  // The main window needs no permissions at all.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  createMainWindow();
  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

// Closing the main window already quits; this covers the rest.
app.on('window-all-closed', () => app.quit());

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  if (share.running) {
    e.preventDefault();
    quitting = true;
    share.stop(2000).finally(() => app.quit());
  }
  for (const v of viewers) {
    v.fwd.close();
    if (!v.win.isDestroyed()) v.win.close();
  }
});

// Last resort: never leave voxl running behind.
process.on('exit', () => share.killNow());
