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
const { createAddressProvider } = require('./addresses');
const { createDiscovery } = require('./discovery');
const { createDeviceApi } = require('./deviceApi');
const { createAdminApi } = require('./adminApi');
const { Lifecycle, listenFailureReason, createTracker } = require('./lifecycle');
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

/** Stops accepting connections and drops idle keep-alive ones; requests already running continue. Resolves when the port is closed. */
function stopAccepting(server) {
  if (!server.listening) return Promise.resolve();
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections();
  return closed;
}

/** Builds every module, wires their events together, and returns start/stop. */
async function createApp({ home, overrides = {}, log = console.log, readTailscaleName } = {}) {
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

  // Phones connect from the network, so the device API and discovery listen on every interface.
  // Tests pass overrides.bindHost = '127.0.0.1' so they never open a socket to the network.
  const bindHost = overrides.bindHost || '0.0.0.0';
  const lifecycle = new Lifecycle();
  lifecycle.on('change', changed);
  const tracker = createTracker();

  const bound = { device: 0, admin: 0, discovery: 0 };
  const ports = () => ({ ...bound });
  const addressProvider = createAddressProvider({ readName: readTailscaleName });
  const addresses = addressProvider.list;
  const deviceApi = createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir: config.receiveDir, addresses, notify: changed });
  const files = loadPublicFiles(path.join(__dirname, '..', 'public'));
  const adminApi = createAdminApi({
    identity, devices, sessions, pairing, store, limits,
    receiveDir: config.receiveDir, outboxDir: config.paths.outbox,
    addresses, getPorts: ports, bus, notify: changed, files, getStatus: () => lifecycle.status(),
  });

  const deviceServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, deviceApi.handler);
  deviceServer.requestTimeout = 0; // large uploads over Wi-Fi can take a long time
  deviceServer.headersTimeout = 30_000;
  const adminServer = http.createServer(adminApi.handler);
  tracker.attach(deviceServer);
  tracker.attach(adminServer);
  let discovery = null;
  const timers = [];
  let stopping = null;

  /**
   * Graceful stop: stop accepting, give running transfers up to graceMs to finish, then close
   * event streams and cut whatever is left (an aborted upload deletes its .part file).
   */
  function stop({ graceMs = 5000 } = {}) {
    stopping ??= (async () => {
      for (const timer of timers) clearInterval(timer);
      const closing = [stopAccepting(deviceServer), stopAccepting(adminServer)];
      await tracker.whenIdle(graceMs);
      deviceApi.closeAll();
      adminApi.closeAll();
      sessions.endAll('shutdown');
      deviceServer.closeAllConnections();
      adminServer.closeAllConnections();
      await Promise.all([...closing, discovery ? discovery.stop() : null]);
      lifecycle.stopped();
    })();
    return stopping;
  }

  /** Binds one listener; a failure is recorded, not thrown, when `failures` is given (tolerant start). */
  async function bind(key, protocol, port, open, failures) {
    try {
      bound[key] = await open();
    } catch (err) {
      if (!failures) throw err;
      failures.push(listenFailureReason(err, port, protocol));
    }
  }

  /** Strict (default): any listen failure stops everything and rethrows. Tolerant: keep what works and report `degraded`. */
  async function start({ tolerant = false } = {}) {
    const failures = tolerant ? [] : null;
    try {
      await bind('device', 'TCP', config.ports.device, () => listen(deviceServer, config.ports.device, bindHost), failures);
      await bind('admin', 'TCP', config.ports.admin, () => listen(adminServer, config.ports.admin, '127.0.0.1'), failures);
      if (bound.device) {
        discovery = createDiscovery({ identity, devicePort: bound.device });
        await bind('discovery', 'UDP', config.ports.discovery, () => discovery.start({ port: config.ports.discovery, host: bindHost }), failures);
      }
    } catch (err) {
      await stop({ graceMs: 0 });
      throw err;
    }
    timers.push(setInterval(() => pairing.sweep(), 10_000).unref());
    if (readTailscaleName) {
      await addressProvider.refresh();
      timers.push(setInterval(() => addressProvider.refresh(), 60_000).unref());
    }
    if (failures && failures.length) lifecycle.degraded(failures.join(' '));
    else lifecycle.running();
    return ports();
  }

  return { start, stop, ports, config, identity, fingerprint: tls.fingerprint, devices, sessions, pairing, store, lifecycle, bus };
}

module.exports = { createApp };
