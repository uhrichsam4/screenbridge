// Runs the bundled voxl to share this computer's screen. Plain Node (no Electron), so the
// test script can use it too.
'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 6901;

// No i, l, o, 0 or 1: easy to read out and type.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function generatePassword() {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

function sharePort() {
  const p = Number(process.env.SCREENBRIDGE_PORT);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

// Where the voxl binary is: <resources>/bin in the packaged app, resources/bin in the
// project otherwise.
function voxlPath(resourcesDir) {
  const exe = process.platform === 'win32' ? 'voxl.exe' : 'voxl';
  const dirs = [];
  if (resourcesDir) dirs.push(path.join(resourcesDir, 'bin'));
  dirs.push(path.join(__dirname, '..', 'resources', 'bin'));
  for (const d of dirs) {
    const p = path.join(d, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// This computer's IPv4 addresses on the local network.
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

// Events: 'log' (line), 'listening', 'screen-permission', 'accessibility-permission',
// 'port-in-use', 'exit' ({ code, signal, expected, lastLines, error? }).
class Share extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.stopping = false;
  }

  get running() {
    return !!this.child;
  }

  get pid() {
    return this.child ? this.child.pid : null;
  }

  start({ bin, port = sharePort(), password }) {
    if (this.child) throw new Error('already sharing');
    if (!bin) throw new Error('voxl is missing from this app');
    if (!password) throw new Error('no password');
    this.stopping = false;
    const env = { ...process.env, VOXL_PASSWORD: password };
    if (!env.RUST_LOG) env.RUST_LOG = 'info';
    const child = spawn(bin, ['--addr=0.0.0.0', `--port=${port}`], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    const lastLines = [];
    const onLine = (line) => {
      if (!line.trim()) return;
      lastLines.push(line);
      if (lastLines.length > 20) lastLines.shift();
      this.emit('log', line);
      if (/listening on/i.test(line)) this.emit('listening', { port });
      if (/Screen Recording permission is missing/i.test(line)) this.emit('screen-permission');
      if (/Accessibility permission is missing/i.test(line)) this.emit('accessibility-permission');
      // voxl panics with "bind: ... AddrInUse ..." and exits when the port is taken.
      if (/AddrInUse|address already in use|os error 10048/i.test(line)) this.emit('port-in-use', { port });
    };
    const splitter = () => {
      let buf = '';
      return (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      };
    };
    child.stdout.on('data', splitter());
    child.stderr.on('data', splitter());
    child.on('error', (err) => {
      onLine(`could not start voxl: ${err.message}`);
      // A spawn that failed (ENOENT, EACCES) gets 'error' but never 'exit'.
      if (this.child === child && !child.pid) {
        this.child = null;
        this.emit('exit', { code: null, signal: null, expected: false, lastLines, error: err.message });
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.emit('exit', { code, signal, expected: this.stopping, lastLines });
    });
    return child.pid;
  }

  // Stops voxl and resolves once it has exited.
  stop(timeoutMs = 3000) {
    const child = this.child;
    if (!child || !child.pid) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', done);
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, timeoutMs);
      try {
        child.kill();
      } catch {}
    });
  }

  // For app quit: no waiting.
  killNow() {
    if (!this.child) return;
    this.stopping = true;
    try {
      this.child.kill('SIGKILL');
    } catch {}
  }
}

module.exports = { Share, generatePassword, sharePort, voxlPath, lanAddresses, DEFAULT_PORT };
