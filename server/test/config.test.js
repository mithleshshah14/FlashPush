'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');

function withoutEnv(t, name) {
  const previous = process.env[name];
  delete process.env[name];
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test('defaults match the spec', (t) => {
  withoutEnv(t, 'RECEIVE_DIR');
  const home = tmpDir(t);
  const cfg = loadConfig({ home });
  assert.equal(cfg.home, home);
  assert.deepEqual(cfg.ports, { device: 8765, admin: 8760, discovery: 8766 });
  assert.equal(cfg.limits.maxFileBytes, 2 * 1024 ** 3);
  assert.equal(cfg.limits.pairExpiryMs, 120_000);
  assert.equal(cfg.limits.pairRevealWindowMs, 10_000);
  assert.equal(cfg.limits.pairSecretWindowMs, 60_000);
  assert.equal(cfg.limits.maxPendingPairings, 3);
  assert.equal(cfg.limits.maxDevices, 20);
  assert.equal(cfg.limits.sessionIdleMs, 24 * 3600 * 1000);
  assert.equal(cfg.limits.sessionMaxMs, 7 * 24 * 3600 * 1000);
  assert.equal(cfg.paths.devices, path.join(home, 'devices.json'));
  assert.equal(cfg.paths.tlsKey, path.join(home, 'key.pem'));
});

test('config.json sets ports and the receive folder, keeping the other defaults', (t) => {
  withoutEnv(t, 'RECEIVE_DIR');
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ports: { device: 9000 }, receiveDir: 'D:\\Inbox' }));
  const cfg = loadConfig({ home });
  assert.equal(cfg.ports.device, 9000);
  assert.equal(cfg.ports.admin, 8760);
  assert.equal(cfg.receiveDir, 'D:\\Inbox');
});

test('explicit overrides beat config.json, and limits are never read from it', (t) => {
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ports: { device: 9000 }, limits: { maxDevices: 5 } }));
  assert.equal(loadConfig({ home }).limits.maxDevices, 20);
  const cfg = loadConfig({ home, overrides: { ports: { device: 9100 }, limits: { maxDevices: 2 } } });
  assert.equal(cfg.ports.device, 9100);
  assert.equal(cfg.limits.maxDevices, 2);
});

test('an invalid config.json names the file in the error', (t) => {
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), '{ not json');
  assert.throws(() => loadConfig({ home }), /config\.json/);
});

test('FLASHPUSH_HOME selects the state directory', (t) => {
  const home = tmpDir(t);
  const previous = process.env.FLASHPUSH_HOME;
  process.env.FLASHPUSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.FLASHPUSH_HOME;
    else process.env.FLASHPUSH_HOME = previous;
  });
  assert.equal(loadConfig().home, home);
});
