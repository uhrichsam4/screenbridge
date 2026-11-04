// End-to-end check of the share and watch plumbing without the GUI: runs voxl through
// src/share.js on port 6911 (or SCREENBRIDGE_TEST_PORT), checks the password gate
// directly and through src/forward.js, then stops voxl and checks it is gone.
'use strict';

const { Share, voxlPath, lanAddresses } = require('../src/share');
const { startForwarder, probe, httpStatus, parseAddress } = require('../src/forward');

const PORT = Number(process.env.SCREENBRIDGE_TEST_PORT) || 6911;
const PASSWORD = 'test-pass-word';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}

async function main() {
  // Address parsing.
  const a = parseAddress('192.168.0.10');
  const b = parseAddress('192.168.0.10:6922');
  const c = parseAddress('http://192.168.0.10:6933/?token=x');
  check(
    'parseAddress',
    a.host === '192.168.0.10' && a.port === 6901 && b.port === 6922 && c.port === 6933 && !parseAddress('a b'),
    JSON.stringify([a, b, c])
  );

  // A missing or non-executable binary: 'exit' (unexpected) and not left "running".
  for (const [label, badBin] of [
    ['missing binary', require('path').join(__dirname, 'no-such-voxl')],
    ['non-executable binary', __filename],
  ]) {
    const bad = new Share();
    const ev = new Promise((r) => bad.once('exit', r));
    let threw = null;
    try {
      bad.start({ bin: badBin, port: PORT, password: PASSWORD });
    } catch (e) {
      threw = e;
    }
    const e = threw ? null : await Promise.race([ev, sleep(3000).then(() => null)]);
    check(
      `${label}: reports an unexpected exit and is not running`,
      !threw && e && !e.expected && !!e.error && !bad.running,
      threw ? `threw ${threw.message}` : e ? e.error : 'no exit event'
    );
  }

  const bin = voxlPath();
  if (!bin) {
    console.log('FAIL voxl not found in resources/bin (run scripts/prepare-voxl-mac.sh first)');
    process.exit(1);
  }
  const lan = lanAddresses()[0];
  check('LAN address found', !!lan, lan);

  const share = new Share();
  const logs = [];
  share.on('log', (l) => logs.push(l));
  let exited = null;
  share.on('exit', (e) => (exited = e));
  const pid = share.start({ bin, port: PORT, password: PASSWORD });
  check('voxl started', !!pid, `pid ${pid}`);

  const up = await waitFor(() => httpStatus(PORT, '/').then(() => true), 10000);
  check('voxl answers on 127.0.0.1', up);
  if (!up) console.log(logs.join('\n'));

  try {
    const noToken = await httpStatus(PORT, '/');
    check('no password is rejected', noToken === 401, `status ${noToken}`);
    const wrong = await httpStatus(PORT, '/?token=wrong');
    check('wrong password is rejected', wrong === 401, `status ${wrong}`);
    const ok = await httpStatus(PORT, `/?token=${encodeURIComponent(PASSWORD)}`);
    check('?token=<password> signs in', ok === 200, `status ${ok}`);

    if (lan) {
      await probe(lan, PORT, 2000).then(
        () => check('TCP probe of LAN address', true),
        (e) => check('TCP probe of LAN address', false, e.message)
      );
      const viaLan = await httpStatus(PORT, `/?token=${encodeURIComponent(PASSWORD)}`, {
        host: lan,
        hostHeader: `${lan}:${PORT}`,
      });
      check('signs in via the LAN address', viaLan === 200, `status ${viaLan} at ${lan}:${PORT}`);

      const fwd = await startForwarder(lan, PORT);
      const viaFwd = await httpStatus(fwd.port, `/?token=${encodeURIComponent(PASSWORD)}`);
      check('signs in through the forwarder (Host: localhost)', viaFwd === 200, `localhost:${fwd.port} -> ${lan}:${PORT}`);
      const viaIp = await httpStatus(fwd.port, `/?token=${encodeURIComponent(PASSWORD)}`, {
        hostHeader: `127.0.0.1:${fwd.port}`,
      });
      check('signs in through the forwarder (Host: 127.0.0.1)', viaIp === 200, `status ${viaIp}`);
      const fwdNoToken = await httpStatus(fwd.port, '/');
      check('forwarder: no password is rejected', fwdNoToken === 401, `status ${fwdNoToken}`);
      await fwd.close();
      const closed = await httpStatus(fwd.port, '/').then(
        () => false,
        () => true
      );
      check('forwarder closes', closed);
    }

    const unreachable = await probe('127.0.0.1', 1, 1000).then(
      () => false,
      () => true
    );
    check('probe fails for a closed port', unreachable);
  } finally {
    await share.stop();
  }

  await sleep(200);
  check('voxl exited after stop', exited && exited.expected, JSON.stringify(exited && { code: exited.code, signal: exited.signal }));
  check('voxl process is gone', !alive(pid), `pid ${pid}`);
  check('nothing listens on the port anymore', await httpStatus(PORT, '/').then(() => false, () => true));

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
