'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { loadConfig } = require('./config');
const { loadIdentity } = require('./identity');
const { loadOrCreateTls } = require('./tls');
const { DeviceStore } = require('./devices');
const { SessionStore } = require('./sessions');
const { PairingManager } = require('./pairing');
const { ItemStore } = require('./store');
const { OperationCache } = require('./idempotency');
const { sweepPartFiles } = require('./transfers');
const { listAddresses } = require('./addresses');
const { createDiscovery } = require('./discovery');
const { createDeviceApi } = require('./deviceApi');
const { createAdminApi } = require('./adminApi');
const { loadPublicFiles } = require('./static');

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

const closeServer = (server) =>
  new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
    server.closeAllConnections();
  });

/** Builds every module, wires their events together, and returns start/stop. */
async function createApp({ home, overrides = {}, log = console.log } = {}) {
  const config = loadConfig({ home, overrides });
  for (const dir of [config.home, config.paths.outbox, config.receiveDir]) fs.mkdirSync(dir, { recursive: true });
  const stale = sweepPartFiles(config.receiveDir) + sweepPartFiles(config.paths.outbox);
  if (stale) log(`Removed ${stale} unfinished upload(s) left by a previous run.`);

  const identity = loadIdentity(config.paths);
  const tls = await loadOrCreateTls(config.paths);
  if (tls.regenerated) log('A new certificate was created. Phones paired before this must pair again.');

  const { limits } = config;
  const devices = new DeviceStore({ file: config.paths.devices, limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint: tls.fingerprint, limits });
  const store = new ItemStore({ file: config.paths.items, outboxDir: config.paths.outbox, limits });
  const ops = new OperationCache({ max: limits.idempotencyMaxEntries, ttlMs: limits.idempotencyTtlMs });

  // One 'changed' signal tells the admin UI to refresh; a re-pair also ends the device's old session.
  const bus = new EventEmitter();
  const changed = () => bus.emit('changed');
  pairing.on('device-replaced', ({ deviceId }) => sessions.endForDevice(deviceId, 'revoked'));
  for (const [emitter, names] of [[pairing, ['pending', 'resolved']], [sessions, ['start', 'end']], [store, ['add', 'delete']]]) {
    for (const name of names) emitter.on(name, changed);
  }

  const bound = { device: 0, admin: 0, discovery: 0 };
  const ports = () => ({ ...bound });
  const deviceApi = createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir: config.receiveDir, addresses: listAddresses, notify: changed });
  const files = loadPublicFiles(path.join(__dirname, '..', 'public'));
  const adminApi = createAdminApi({
    identity, devices, sessions, pairing, store, limits,
    receiveDir: config.receiveDir, outboxDir: config.paths.outbox,
    addresses: listAddresses, getPorts: ports, bus, notify: changed, files,
  });

  const deviceServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, deviceApi.handler);
  deviceServer.requestTimeout = 0; // large uploads over Wi-Fi can take a long time
  deviceServer.headersTimeout = 30_000;
  const adminServer = http.createServer(adminApi.handler);
  let discovery = null;
  const timers = [];
  let stopped = false;

  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    sessions.endAll('shutdown');
    deviceApi.closeAll();
    adminApi.closeAll();
    await Promise.all([closeServer(deviceServer), closeServer(adminServer), discovery ? discovery.stop() : null]);
  }

  async function start() {
    try {
      bound.device = await listen(deviceServer, config.ports.device, '0.0.0.0');
      bound.admin = await listen(adminServer, config.ports.admin, '127.0.0.1');
      discovery = createDiscovery({ identity, devicePort: bound.device });
      bound.discovery = await discovery.start({ port: config.ports.discovery });
    } catch (err) {
      await stop();
      throw err;
    }
    timers.push(setInterval(() => pairing.sweep(), 10_000).unref());
    return ports();
  }

  return { start, stop, ports, config, identity, fingerprint: tls.fingerprint, devices, sessions, pairing, store };
}

function explain(err, config) {
  if (err.code === 'EADDRINUSE') {
    return `Port ${err.port} is already in use by another program. Set another in ${config.paths.config} (for example {"ports":{"device":9000}}).`;
  }
  return err.message;
}

async function main() {
  const app = await createApp();
  try {
    await app.start();
  } catch (err) {
    console.error(`FlashPush could not start: ${explain(err, app.config)}`);
    process.exit(1);
  }
  const p = app.ports();
  console.log(`FlashPush is running.
  Admin page (this laptop only): http://127.0.0.1:${p.admin}
  Phones connect over HTTPS on port ${p.device}; discovery listens on UDP ${p.discovery}
  Received files are saved to: ${app.config.receiveDir}`);
  const shutdown = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };
