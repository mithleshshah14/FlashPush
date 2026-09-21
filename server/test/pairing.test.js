'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const c = require('../src/crypto');
const { DeviceStore } = require('../src/devices');
const { PairingManager } = require('../src/pairing');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');
const { throwsCode } = require('./helpers/assertions');

function setup(t, limits = {}) {
  const clock = createClock();
  const allLimits = { ...DEFAULT_LIMITS, ...limits };
  const devices = new DeviceStore({ file: path.join(tmpDir(t), 'devices.json'), now: clock.now, limits: allLimits });
  const fingerprint = Buffer.alloc(32, 7);
  const pairing = new PairingManager({ devices, fingerprint, limits: allLimits, now: clock.now });
  return { clock, devices, fingerprint, pairing };
}

/** The phone's side of the protocol, built only from the shared primitives. */
function newPhone(fingerprint, deviceId = crypto.randomUUID()) {
  const np = c.random(16);
  return {
    deviceId,
    np,
    npB64: c.b64uEncode(np),
    commit: c.b64uEncode(c.commitOf(np)),
    proof: (requestId) => c.pairProof(np, c.b64uDecode(requestId, 16), deviceId),
    sas: (nl) => c.sasCode(fingerprint, np, c.b64uDecode(nl, 16)),
  };
}

const begin = (pairing, phone, extra = {}) =>
  pairing.request({
    deviceId: phone.deviceId,
    deviceName: 'Pixel 7',
    commit: phone.commit,
    remoteIp: '192.168.1.20',
    route: 'lan',
    ...extra,
  });

function revealed(pairing, phone, extra) {
  const { requestId, nl } = begin(pairing, phone, extra);
  pairing.reveal({ requestId, np: phone.npB64 });
  return { requestId, nl };
}

const statusOf = (pairing, phone, requestId) =>
  pairing.status({ requestId, deviceId: phone.deviceId, proof: phone.proof(requestId) });

test('happy path: both sides compute the same code and approval releases the secret to the proven caller', (t) => {
  const { pairing, devices, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const seen = [];
  pairing.on('pending', (view) => seen.push(view));

  const { requestId, nl } = begin(pairing, phone);
  assert.equal(pairing.listPending().length, 0, 'not visible before the reveal');
  pairing.reveal({ requestId, np: phone.npB64 });

  const [view] = pairing.listPending();
  assert.equal(view.sas, phone.sas(nl));
  assert.equal(view.sasDisplay, c.formatSas(view.sas));
  assert.equal(view.deviceName, 'Pixel 7');
  assert.equal(view.route, 'lan');
  assert.equal(view.isRepair, false);
  assert.deepEqual(Object.keys(view).sort(), [
    'createdAt', 'deviceId', 'deviceName', 'expiresAt', 'isRepair', 'remoteIp', 'requestId', 'route', 'sas', 'sasDisplay',
  ]);
  assert.equal(seen.length, 1);
  assert.deepEqual(statusOf(pairing, phone, requestId), { state: 'pending' });

  const resolved = [];
  pairing.on('resolved', (e) => resolved.push(e));
  assert.deepEqual(pairing.approve(requestId), { deviceId: phone.deviceId, replaced: false });
  assert.deepEqual(resolved, [{ requestId, deviceId: phone.deviceId, state: 'approved' }]);

  const done = statusOf(pairing, phone, requestId);
  assert.equal(done.state, 'approved');
  assert.equal(devices.verify(phone.deviceId, done.secret).result, 'ok');
  assert.equal(pairing.listPending().length, 0);
});

test('a wrong np at reveal is COMMIT_MISMATCH and kills the request', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId, np: c.b64uEncode(c.random(16)) }), 'COMMIT_MISMATCH');
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'PAIR_NOT_FOUND');
});

test('a tampered commit makes the honest reveal fail', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone, { commit: c.b64uEncode(c.random(32)) });
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'COMMIT_MISMATCH');
});

test('the reveal cannot be done twice', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'BAD_REQUEST');
});

test('an unrevealed request expires after the 10 second reveal window, freeing its slot', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  clock.advance(10_001);
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'PAIR_EXPIRED');
});

test('a revealed request expires after 2 minutes', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  clock.advance(120_001);
  throwsCode(() => pairing.approve(requestId), 'PAIR_EXPIRED');
  assert.equal(pairing.listPending().length, 0);
});

test('approving before the reveal is not possible', (t) => {
  const { pairing, fingerprint } = setup(t);
  const { requestId } = begin(pairing, newPhone(fingerprint));
  throwsCode(() => pairing.approve(requestId), 'PAIR_NOT_FOUND');
});

test('input validation', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  throwsCode(() => begin(pairing, phone, { deviceId: 'nope' }), 'BAD_REQUEST');
  throwsCode(() => begin(pairing, phone, { deviceName: '   ' }), 'BAD_REQUEST');
  throwsCode(() => begin(pairing, phone, { commit: 'short' }), 'BAD_REQUEST');
  throwsCode(() => pairing.reveal({ requestId: 'unknown', np: phone.npB64 }), 'PAIR_NOT_FOUND');
});

test('pairing spam from one address is rate limited (5 per minute)', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  for (let i = 0; i < 5; i++) begin(pairing, phone); // same device: each replaces the previous request
  throwsCode(() => begin(pairing, phone), 'RATE_LIMITED');
});

test('at most 3 pairing requests can be open at once', (t) => {
  const { pairing, fingerprint } = setup(t);
  for (let i = 0; i < 3; i++) begin(pairing, newPhone(fingerprint), { remoteIp: `10.0.0.${i}` });
  throwsCode(() => begin(pairing, newPhone(fingerprint), { remoteIp: '10.0.0.9' }), 'PAIR_LIMIT');
});

test('a new request from the same device replaces its previous one', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const first = begin(pairing, phone);
  const second = begin(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId: first.requestId, np: phone.npB64 }), 'PAIR_NOT_FOUND');
  pairing.reveal({ requestId: second.requestId, np: phone.npB64 });
  assert.equal(pairing.listPending().length, 1);
});

test('status gives one indistinguishable answer for unknown id, wrong device, wrong or missing proof', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const other = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  const bogusId = c.b64uEncode(c.random(16));

  const attempts = [
    () => pairing.status({ requestId: bogusId, deviceId: phone.deviceId, proof: phone.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: other.deviceId, proof: phone.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId, proof: 'a'.repeat(64) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId, proof: other.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId }),
    () => pairing.status({ requestId: 42, deviceId: phone.deviceId, proof: 'x' }),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (err) => err.code === 'PAIR_NOT_FOUND' && err.message === 'Pairing request not found.');
  }
});

test('status before the reveal is PAIR_NOT_FOUND (the laptop does not know np yet)', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('deny: the phone learns PAIR_DENIED once, then the request is gone', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  pairing.deny(requestId);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_DENIED');
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('the secret can be re-fetched with the proof for 60 seconds, then it is gone', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  pairing.approve(requestId);
  const first = statusOf(pairing, phone, requestId);
  clock.advance(59_000);
  assert.equal(statusOf(pairing, phone, requestId).secret, first.secret);
  clock.advance(2_000);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('re-pair replaces the secret, flags the request, and announces the replacement', (t) => {
  const { pairing, devices, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const first = revealed(pairing, phone);
  pairing.approve(first.requestId);
  const oldSecret = statusOf(pairing, phone, first.requestId).secret;

  const replaced = [];
  pairing.on('device-replaced', (e) => replaced.push(e));
  const again = newPhone(fingerprint, phone.deviceId);
  const second = revealed(pairing, again);
  assert.equal(pairing.listPending()[0].isRepair, true);
  assert.deepEqual(pairing.approve(second.requestId), { deviceId: phone.deviceId, replaced: true });
  const newSecret = statusOf(pairing, again, second.requestId).secret;

  assert.deepEqual(replaced, [{ deviceId: phone.deviceId }]);
  assert.equal(devices.verify(phone.deviceId, oldSecret).result, 'bad_secret');
  assert.equal(devices.verify(phone.deviceId, newSecret).result, 'ok');
});

test('the device limit is enforced at request time for new devices', (t) => {
  const { pairing, fingerprint } = setup(t, { maxDevices: 1 });
  const first = newPhone(fingerprint);
  pairing.approve(revealed(pairing, first).requestId);
  throwsCode(() => begin(pairing, newPhone(fingerprint), { remoteIp: '10.0.0.5' }), 'PAIR_LIMIT');
  begin(pairing, newPhone(fingerprint, first.deviceId), { remoteIp: '10.0.0.6' }); // a re-pair is still allowed
});

test('sweep removes expired requests and wipes expired secrets', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const a = newPhone(fingerprint);
  const b = newPhone(fingerprint);
  revealed(pairing, a, { remoteIp: '10.0.0.1' });
  const bReq = revealed(pairing, b, { remoteIp: '10.0.0.2' });
  pairing.approve(bReq.requestId);
  clock.advance(121_000);
  pairing.sweep();
  assert.equal(pairing.listPending().length, 0);
  throwsCode(() => statusOf(pairing, b, bReq.requestId), 'PAIR_NOT_FOUND');
});
