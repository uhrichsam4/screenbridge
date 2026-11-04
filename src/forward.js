// A local TCP forwarder: 127.0.0.1:<random port> -> <remote host>:<port>, so the viewer
// page loads from localhost (a secure context, where browsers allow WebCodecs). Plain
// Node (no Electron), so the test script can use it too.
'use strict';

const net = require('net');
const http = require('http');

const DEFAULT_PORT = 6901;

// "192.168.0.10", "192.168.0.10:6901" or a pasted "http://192.168.0.10:6901/..." ->
// { host, port }. Returns null if it doesn't look like an address.
function parseAddress(input, defaultPort = DEFAULT_PORT) {
  let s = String(input || '').trim();
  s = s.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  if (!s) return null;
  let host = s;
  let port = defaultPort;
  const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    if (v6[2]) port = Number(v6[2]);
  } else {
    const m = s.match(/^([^:\s]+)(?::(\d+))?$/);
    if (!m) return null;
    host = m[1];
    if (m[2]) port = Number(m[2]);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

// Resolves if a TCP connection to host:port opens within timeoutMs, rejects otherwise.
function probe(host, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const fail = (err) => {
      sock.destroy();
      reject(err);
    };
    sock.setTimeout(timeoutMs, () => fail(new Error('timeout')));
    sock.once('error', fail);
    sock.once('connect', () => {
      sock.end();
      sock.destroy();
      resolve();
    });
  });
}

// Starts forwarding; resolves to { port, close() }.
function startForwarder(host, port) {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect({ host, port });
    sockets.add(client);
    sockets.add(upstream);
    const cleanup = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const fwdPort = server.address().port;
      resolve({
        port: fwdPort,
        close() {
          for (const s of sockets) s.destroy();
          sockets.clear();
          return new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

// GETs http://localhost:<port><path> (connecting to 127.0.0.1) and resolves to the
// HTTP status code.
function httpStatus(port, path = '/', { host = '127.0.0.1', hostHeader, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host,
        port,
        path,
        headers: { Host: hostHeader || `localhost:${port}` },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

module.exports = { parseAddress, probe, startForwarder, httpStatus, DEFAULT_PORT };
