'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apiError, envelope, ApiError } = require('../src/errors');

test('every code maps to the HTTP status in the spec', () => {
  const expected = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    SESSION_EXPIRED: 401,
    DEVICE_NOT_PAIRED: 401,
    RATE_LIMITED: 429,
    PAIR_NOT_FOUND: 404,
    PAIR_EXPIRED: 410,
    PAIR_DENIED: 403,
    PAIR_LIMIT: 429,
    COMMIT_MISMATCH: 400,
    PAYLOAD_TOO_LARGE: 413,
    INSUFFICIENT_STORAGE: 507,
    STORAGE_QUOTA: 507,
    ITEM_NOT_FOUND: 404,
    INTERNAL: 500,
  };
  for (const [code, status] of Object.entries(expected)) assert.equal(apiError(code).status, status, code);
});

test('apiError is an Error with code, default message and optional retryAfterMs', () => {
  const err = apiError('RATE_LIMITED', undefined, { retryAfterMs: 1500 });
  assert.ok(err instanceof ApiError);
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.ok(err.message.length > 0);
  assert.equal(err.retryAfterMs, 1500);
});

test('a custom message replaces the default', () => {
  assert.equal(apiError('BAD_REQUEST', 'deviceId must be a UUID.').message, 'deviceId must be a UUID.');
});

test('unknown codes are a programming error', () => {
  assert.throws(() => apiError('NOPE'), /Unknown error code/);
});

test('envelope has exactly the documented shape', () => {
  assert.deepEqual(envelope(apiError('PAIR_DENIED')), {
    error: { code: 'PAIR_DENIED', message: 'The pairing request was denied.' },
  });
});
