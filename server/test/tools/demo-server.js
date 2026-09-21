'use strict';

// Sample-data server for looking at and screenshotting the admin UI:
//   node test/tools/demo-server.js [adminPort]      (default 8760; state lives in a temp folder)
// Only the admin API is mounted, bound to 127.0.0.1. There is no phone-facing HTTPS listener and no UDP
// discovery, so nothing is reachable from the network. Stop it (Ctrl+C) as soon as you are done.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const c = require('../../src/crypto');
const { DEFAULT_LIMITS } = require('../../src/config');
const { DeviceStore } = require('../../src/devices');
const { SessionStore } = require('../../src/sessions');
const { PairingManager } = require('../../src/pairing');
const { ItemStore } = require('../../src/store');
const { createAdminApi } = require('../../src/adminApi');
const { loadPublicFiles } = require('../../src/static');

const MINUTE = 60_000;
const PUBLIC = path.join(__dirname, '..', '..', 'public');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flashpush-demo-'));
  const receiveDir = path.join(home, 'received');
  const outboxDir = path.join(home, 'outbox');
  fs.mkdirSync(receiveDir);
  fs.mkdirSync(outboxDir);
  const limits = DEFAULT_LIMITS;
  const devices = new DeviceStore({ file: path.join(home, 'devices.json'), limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint: Buffer.alloc(32, 7), limits });
  const store = new ItemStore({ file: path.join(home, 'items.json'), outboxDir, limits });
  const bus = new EventEmitter();
  const changed = () => bus.emit('changed');
  for (const [emitter, names] of [[pairing, ['pending', 'resolved']], [sessions, ['start', 'end']], [store, ['add', 'delete']]]) {
    for (const name of names) emitter.on(name, changed);
  }

  const server = http.createServer();
  await new Promise((resolve) => server.listen(Number(process.argv[2]) || 8760, '127.0.0.1', resolve));
  const adminPort = server.address().port;
  const api = createAdminApi({
    identity: { laptopId: crypto.randomUUID(), name: 'MITHLESH-PC' },
    devices, sessions, pairing, store, limits, receiveDir, outboxDir,
    addresses: () => [{ ip: '192.168.1.6', kind: 'lan' }, { ip: '100.101.102.103', kind: 'tailscale' }],
    getPorts: () => ({ device: 8765, admin: adminPort, discovery: 8766 }),
    bus, notify: changed,
    files: loadPublicFiles(PUBLIC),
    log: () => {},
  });
  server.on('request', api.handler);

  const addPhone = (name, route, lastSeenAgo, connected) => {
    const deviceId = crypto.randomUUID();
    devices.add({ deviceId, name, secret: c.random(32) });
    devices.touch(deviceId, route);
    devices.devices.get(deviceId).lastSeen = Date.now() - lastSeenAgo;
    if (connected) sessions.create(deviceId);
    return deviceId;
  };
  const pixel = addPhone('Pixel 7', 'lan', 20_000, true);
  addPhone('Galaxy S23', 'tailscale', 27 * 60 * MINUTE, false);
  addPhone('Pixel 6a', 'lan', 10 * 24 * 60 * MINUTE, false);

  const write = (dir, name, content) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return { path: file, size: fs.statSync(file).size };
  };
  store.add({ deviceId: pixel, kind: 'text', from: 'phone', text: 'https://docs.example.com/q3-report' });
  store.add({ deviceId: pixel, kind: 'file', from: 'laptop', name: 'invoice-september.pdf', ...write(outboxDir, 'invoice-september.pdf', Buffer.alloc(2.4 * 1024 * 1024, 1)) });
  store.add({ deviceId: pixel, kind: 'file', from: 'phone', name: 'IMG_2043.png', ...write(receiveDir, 'IMG_2043.png', fs.readFileSync(path.join(PUBLIC, 'assets', 'favicon.png'))) });
  store.add({ deviceId: pixel, kind: 'text', from: 'laptop', text: 'Meeting moved to 15:30, see you there.' });

  const pend = (deviceId, name, ip, route) => {
    const np = c.random(16);
    const { requestId } = pairing.request({ deviceId, deviceName: name, commit: c.b64uEncode(c.commitOf(np)), remoteIp: ip, route });
    pairing.reveal({ requestId, np: c.b64uEncode(np) });
  };
  pend(crypto.randomUUID(), 'Pixel 8', '192.168.1.20', 'lan');
  pend(pixel, 'Pixel 7 (new)', '100.101.102.103', 'tailscale'); // same deviceId as a paired phone: a re-pair

  console.log(`Demo running on 127.0.0.1:${adminPort} only. Ctrl+C to stop (state in ${home}).`);
  const stop = () => {
    api.closeAll();
    server.closeAllConnections();
    server.close(() => {
      fs.rmSync(home, { recursive: true, force: true });
      process.exit(0);
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
