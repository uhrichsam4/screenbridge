'use strict';

const api = window.screenbridge;
const $ = (id) => document.getElementById(id);

let state = null;
let busy = false;
// Set when voxl reported why sharing can't work (screen permission, port in use), so a
// later "listening" or exit message doesn't hide it.
let problem = false;

function render() {
  if (!state) return;
  const btn = $('shareBtn');
  btn.textContent = state.sharing ? 'Stop sharing' : 'Start sharing';
  btn.classList.toggle('stop', state.sharing);
  btn.classList.toggle('primary', !state.sharing);
  btn.disabled = busy;
  $('newPwBtn').disabled = busy;
  $('shareInfo').hidden = !state.sharing;
  $('password').textContent = state.password;
  const port = state.port === 6901 ? '' : `:${state.port}`;
  const box = $('addresses');
  box.replaceChildren();
  if (state.addresses.length === 0) {
    box.textContent = 'Not connected to a network';
  }
  for (const a of state.addresses) {
    const s = document.createElement('span');
    s.textContent = a + port;
    box.appendChild(s);
  }
}

function setShareStatus(text, error = false) {
  $('shareStatus').textContent = text;
  $('shareStatus').classList.toggle('error', error);
}

function errorText(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function refresh() {
  state = await api.getState();
  render();
}

// Runs one share action at a time with the buttons disabled.
async function action(fn) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    setShareStatus(errorText(err), true);
  } finally {
    busy = false;
    render();
  }
}

$('shareBtn').addEventListener('click', () =>
  action(async () => {
    if (state.sharing) {
      state = await api.stopShare();
      setShareStatus('Sharing stopped.');
    } else {
      problem = false;
      $('screenHelp').hidden = true;
      $('axHelp').hidden = true;
      $('exitHelp').hidden = true;
      setShareStatus('Starting...');
      state = await api.startShare();
    }
  })
);

$('newPwBtn').addEventListener('click', () =>
  action(async () => {
    state = await api.newPassword();
    setShareStatus(
      state.sharing
        ? 'New password made. Anyone watching has to connect again with it.'
        : 'New password made.'
    );
  })
);

for (const b of document.querySelectorAll('[data-settings]')) {
  b.addEventListener('click', () => api.openSettings(b.dataset.settings));
}

api.onShareEvent(async ({ event, data }) => {
  if (event === 'listening') {
    if (!problem) setShareStatus('Sharing. The other computer can connect now.');
  } else if (event === 'screen-permission') {
    problem = true;
    if (state.platform === 'darwin') $('screenHelp').hidden = false;
    setShareStatus('Not sharing: ScreenBridge needs permission to record the screen.', true);
  } else if (event === 'port-in-use') {
    problem = true;
    setShareStatus(
      `Port ${data.port} is already in use (is another copy of voxl or ScreenBridge running?). Close it and press Start sharing again.`,
      true
    );
  } else if (event === 'accessibility-permission') {
    if (state.platform === 'darwin') $('axHelp').hidden = false;
  } else if (event === 'exit') {
    if (!data.expected && !problem) {
      const why = data.error ? `could not start: ${data.error}` : `exit code ${data.code ?? data.signal}`;
      $('exitText').textContent = `Sharing stopped unexpectedly (${why}). Press Start sharing to try again.`;
      $('exitLog').textContent = (data.lastLines || []).join('\n');
      $('exitHelp').hidden = false;
      setShareStatus('Sharing stopped unexpectedly.', true);
    }
    await refresh();
  }
});

$('watchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('watchStatus');
  const btn = $('connectBtn');
  status.classList.remove('error');
  status.textContent = 'Connecting...';
  btn.disabled = true;
  try {
    const res = await api.connect($('address').value, $('watchPassword').value, $('gameMode').checked);
    if (res.ok) {
      status.textContent = 'Connected. The other screen opened in a new window.';
    } else {
      status.textContent = res.error;
      status.classList.add('error');
    }
  } catch (err) {
    status.textContent = String(err.message || err);
    status.classList.add('error');
  } finally {
    btn.disabled = false;
  }
});

refresh().then(() => {
  $('address').value = state.lastAddress;
  $('gameMode').checked = state.gameMode;
  if (!state.voxlFound) {
    setShareStatus('The screen sharing program (voxl) is missing from this app, so sharing is off. Watching still works.', true);
  }
});
