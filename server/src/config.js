'use strict';

const os = require('node:os');
const path = require('node:path');
const { readJson } = require('./fsutil');

const DEFAULT_PORTS = Object.freeze({ device: 8765, admin: 8760, discovery: 8766 });

// Constants, not settings: tests override them through `overrides.limits`.
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 ** 3,
  maxTextBytes: 1024 * 1024,
  maxHistory: 500,
  maxOutboxBytes: 5 * 1024 ** 3,
  minFreeDiskBytes: 512 * 1024 ** 2,
  maxFilenameLength: 200,
  sessionIdleMs: 24 * 3600 * 1000,
  sessionMaxMs: 7 * 24 * 3600 * 1000,
  pairExpiryMs: 2 * 60 * 1000,
  pairRevealWindowMs: 10 * 1000,
  pairSecretWindowMs: 60 * 1000,
  maxPendingPairings: 3,
  maxPairRequestsPerMinutePerIp: 5,
  maxDevices: 20,
  maxFailedAuthPerMinutePerIp: 10,
  idempotencyMaxEntries: 200,
  idempotencyTtlMs: 10 * 60 * 1000,
});

function defaultHome() {
  if (process.env.FLASHPUSH_HOME) return process.env.FLASHPUSH_HOME;
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'FlashPush');
}

/** `config.json` in the state folder may set only `ports` and `receiveDir` (e.g. when a port is taken). */
function loadConfig({ home = defaultHome(), overrides = {} } = {}) {
  const file = path.join(home, 'config.json');
  const fromFile = readJson(file, {}) || {};
  return {
    home,
    ports: { ...DEFAULT_PORTS, ...fromFile.ports, ...overrides.ports },
    limits: { ...DEFAULT_LIMITS, ...overrides.limits },
    receiveDir:
      overrides.receiveDir ||
      process.env.RECEIVE_DIR ||
      fromFile.receiveDir ||
      path.join(os.homedir(), 'Downloads', 'FlashPush'),
    paths: {
      config: file,
      identity: path.join(home, 'identity.json'),
      tlsKey: path.join(home, 'key.pem'),
      tlsCert: path.join(home, 'cert.pem'),
      devices: path.join(home, 'devices.json'),
      items: path.join(home, 'items.json'),
      outbox: path.join(home, 'outbox'),
    },
  };
}

module.exports = { loadConfig, DEFAULT_LIMITS, DEFAULT_PORTS };
