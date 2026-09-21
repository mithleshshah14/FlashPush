'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../src/crypto');
const { DeviceStore } = require('../src/devices');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');
const { throwsCode } = require('./helpers/assertions');

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function setup(t, limits = {}) {
  const dir = tmpDir(t);
  const file = path.join(dir, 'devices.json');
  const clock = createClock();
  const make = () => new DeviceStore({ file, now: clock.now, limits: { ...DEFAULT_LIMITS, ...limits } });
  return { file, clock, make, store: make() };
}

test('add then verify: ok with the right secret, bad_secret otherwise', (t) => {
  const { store } = setup(t);
  const secret = c.random(32);
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'Pixel 7', secret }), { replaced: false });
  const ok = store.verify(ID_A, c.b64uEncode(secret));
  assert.equal(ok.result, 'ok');
  assert.equal(ok.device.name, 'Pixel 7');
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(32))).result, 'bad_secret');
  assert.equal(store.verify(ID_A, 'not base64url!').result, 'bad_secret');
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(16))).result, 'bad_secret'); // wrong length
});

test('unknown devices are reported as unknown', (t) => {
  const { store } = setup(t);
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(32))).result, 'unknown');
});

test('only a hash of the secret is written to disk, and the file survives a restart', (t) => {
  const { store, file, make } = setup(t);
  const secret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes(c.b64uEncode(secret)), false);
  assert.equal(raw.includes(secret.toString('hex')), false);
  assert.equal(raw.includes(c.sha256Hex(secret)), true);
  assert.equal(make().verify(ID_A, c.b64uEncode(secret)).result, 'ok');
});

test('public views never contain the hash', (t) => {
  const { store } = setup(t);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret: c.random(32) });
  assert.deepEqual(Object.keys(store.list()[0]).sort(), ['deviceId', 'lastRoute', 'lastSeen', 'name', 'pairedAt']);
  assert.deepEqual(Object.keys(store.get(ID_A)).sort(), ['deviceId', 'lastRoute', 'lastSeen', 'name', 'pairedAt']);
  assert.equal(store.get(ID_B), null);
});

test('re-pairing the same deviceId replaces the secret; the old one stops working at once', (t) => {
  const { store } = setup(t);
  const oldSecret = c.random(32);
  const newSecret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret: oldSecret });
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'Pixel 7 (new)', secret: newSecret }), { replaced: true });
  assert.equal(store.verify(ID_A, c.b64uEncode(oldSecret)).result, 'bad_secret');
  assert.equal(store.verify(ID_A, c.b64uEncode(newSecret)).result, 'ok');
  assert.equal(store.count(), 1);
});

test('remove (revoke or forget) deletes the device, so its secret stops working', (t) => {
  const { store, make } = setup(t);
  const secret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  assert.equal(store.remove(ID_A), true);
  assert.equal(store.remove(ID_A), false);
  assert.equal(store.verify(ID_A, c.b64uEncode(secret)).result, 'unknown');
  assert.equal(make().count(), 0);
});

test('the device limit applies to new devices but not to re-pairs', (t) => {
  const { store } = setup(t, { maxDevices: 1 });
  store.add({ deviceId: ID_A, name: 'A', secret: c.random(32) });
  assert.equal(store.canAdd(ID_B), false);
  assert.equal(store.canAdd(ID_A), true);
  throwsCode(() => store.add({ deviceId: ID_B, name: 'B', secret: c.random(32) }), 'PAIR_LIMIT');
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'A2', secret: c.random(32) }), { replaced: true });
});

test('add rejects a secret that is not 32 bytes', (t) => {
  const { store } = setup(t);
  assert.throws(() => store.add({ deviceId: ID_A, name: 'A', secret: Buffer.alloc(8) }), TypeError);
});

test('touch records last seen and route (in memory)', (t) => {
  const { store, clock } = setup(t);
  store.add({ deviceId: ID_A, name: 'A', secret: c.random(32) });
  clock.advance(5000);
  store.touch(ID_A, 'tailscale');
  assert.equal(store.get(ID_A).lastRoute, 'tailscale');
  assert.equal(store.get(ID_A).lastSeen, clock.now());
  store.touch(ID_B, 'lan'); // unknown device: ignored
});
