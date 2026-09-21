'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationCache } = require('../src/idempotency');
const { createClock } = require('./helpers/clock');

const make = (opts = {}) => {
  const clock = createClock();
  return { clock, cache: new OperationCache({ max: 200, ttlMs: 600_000, now: clock.now, ...opts }) };
};

test('a new operation starts, completes, and a duplicate returns the stored result', () => {
  const { cache } = make();
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
  cache.complete('dev', 'op1', { id: 'item-1' });
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'done', result: { id: 'item-1' } });
});

test('operation ids are scoped per device', () => {
  const { cache } = make();
  cache.begin('dev-a', 'op1');
  cache.complete('dev-a', 'op1', { id: 'a' });
  assert.deepEqual(cache.begin('dev-b', 'op1'), { state: 'new' });
});

test('a duplicate of an in-flight operation is reported as pending', () => {
  const { cache } = make();
  cache.begin('dev', 'op1');
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'pending' });
});

test('a failed operation can be retried', () => {
  const { cache } = make();
  cache.begin('dev', 'op1');
  cache.fail('dev', 'op1');
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
});

test('operations expire after the ttl', () => {
  const { cache, clock } = make({ ttlMs: 1000 });
  cache.begin('dev', 'op1');
  cache.complete('dev', 'op1', { id: 'x' });
  clock.advance(1001);
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
});

test('only the newest `max` completed operations are remembered per device', () => {
  const { cache } = make({ max: 2 });
  for (const id of ['a', 'b', 'c']) {
    cache.begin('dev', id);
    cache.complete('dev', id, { id });
  }
  assert.deepEqual(cache.begin('dev', 'a'), { state: 'new' }); // evicted
  assert.equal(cache.begin('dev', 'c').state, 'done');
});
