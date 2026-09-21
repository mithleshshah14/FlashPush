'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/sessions');
const { createClock } = require('./helpers/clock');

const HOUR = 3600 * 1000;
const make = (opts = {}) => {
  const clock = createClock();
  const store = new SessionStore({ idleMs: 24 * HOUR, maxMs: 7 * 24 * HOUR, now: clock.now, ...opts });
  const ended = [];
  store.on('end', (e) => ended.push(e));
  return { clock, store, ended };
};

test('create then verify returns the device', () => {
  const { store, clock } = make();
  const { token, expiresAt } = store.create('dev');
  assert.equal(token.length, 43); // 32 bytes, base64url
  assert.equal(expiresAt, clock.now() + 24 * HOUR);
  assert.equal(store.verify(token).deviceId, 'dev');
  assert.equal(store.isConnected('dev'), true);
});

test('unknown, malformed and empty tokens verify to null', () => {
  const { store } = make();
  assert.equal(store.verify('nope'), null);
  assert.equal(store.verify(''), null);
  assert.equal(store.verify(undefined), null);
  assert.equal(store.verify('A'.repeat(43)), null);
});

test('a device has one active session: creating another ends the first', () => {
  const { store, ended } = make();
  const first = store.create('dev');
  const second = store.create('dev');
  assert.equal(store.verify(first.token), null);
  assert.equal(store.verify(second.token).deviceId, 'dev');
  assert.deepEqual(ended, [{ deviceId: 'dev', reason: 'replaced' }]);
});

test('activity extends the idle window', () => {
  const { store, clock } = make();
  const { token } = store.create('dev');
  clock.advance(20 * HOUR);
  assert.ok(store.verify(token));
  clock.advance(20 * HOUR); // 40 h since creation, 20 h since last use
  assert.ok(store.verify(token));
});

test('idle timeout ends the session', () => {
  const { store, clock, ended } = make();
  const { token } = store.create('dev');
  clock.advance(24 * HOUR);
  assert.equal(store.verify(token), null);
  assert.equal(store.isConnected('dev'), false);
  assert.deepEqual(ended, [{ deviceId: 'dev', reason: 'expired' }]);
});

test('the absolute lifetime cannot be extended by activity', () => {
  const { store, clock } = make();
  const { token } = store.create('dev');
  for (let visit = 1; visit <= 7; visit++) {
    clock.advance(23 * HOUR); // always inside the 24 h idle window
    assert.ok(store.verify(token), `still valid on visit ${visit} (${visit * 23} h)`);
  }
  clock.advance(23 * HOUR); // 184 h since creation, only 23 h idle: the 7 day (168 h) cap ends it
  assert.equal(store.verify(token), null);
});

test('endByToken, endForDevice and endAll', () => {
  const { store, ended } = make();
  const a = store.create('a');
  store.create('b');
  store.create('c');
  assert.equal(store.endByToken(a.token), true);
  assert.equal(store.endByToken(a.token), false);
  assert.equal(store.endForDevice('b', 'revoked'), true);
  store.endAll('shutdown');
  assert.deepEqual(ended, [
    { deviceId: 'a', reason: 'disconnected' },
    { deviceId: 'b', reason: 'revoked' },
    { deviceId: 'c', reason: 'shutdown' },
  ]);
  assert.equal(store.isConnected('c'), false);
});
