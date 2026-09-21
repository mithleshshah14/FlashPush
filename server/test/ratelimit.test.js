'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../src/ratelimit');
const { createClock } = require('./helpers/clock');

test('allows up to max attempts per window, then blocks with a retry hint', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 3, windowMs: 60_000, now: clock.now });
  for (let i = 0; i < 3; i++) assert.equal(limiter.attempt('a').allowed, true);
  clock.advance(10_000);
  const blocked = limiter.attempt('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 50_000);
});

test('the window slides: old attempts stop counting', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 2, windowMs: 1000, now: clock.now });
  limiter.attempt('a');
  clock.advance(600);
  limiter.attempt('a');
  clock.advance(500); // first attempt is now 1100 ms old
  assert.equal(limiter.attempt('a').allowed, true);
  assert.equal(limiter.attempt('a').allowed, false);
});

test('keys are independent', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 1, windowMs: 1000, now: clock.now });
  assert.equal(limiter.attempt('a').allowed, true);
  assert.equal(limiter.attempt('a').allowed, false);
  assert.equal(limiter.attempt('b').allowed, true);
});

test('isBlocked does not record; record does (used for failed-auth counting)', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 2, windowMs: 1000, now: clock.now });
  for (let i = 0; i < 10; i++) assert.equal(limiter.isBlocked('a').blocked, false);
  limiter.record('a');
  limiter.record('a');
  assert.equal(limiter.isBlocked('a').blocked, true);
});
