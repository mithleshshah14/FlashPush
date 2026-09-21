'use strict';

const TABLE = {
  BAD_REQUEST: [400, 'The request was malformed.'],
  UNAUTHORIZED: [401, 'Missing or invalid credentials.'],
  SESSION_EXPIRED: [401, 'Your session has ended. Connect again.'],
  DEVICE_NOT_PAIRED: [401, 'This device is not paired with this laptop.'],
  RATE_LIMITED: [429, 'Too many requests. Try again shortly.'],
  PAIR_NOT_FOUND: [404, 'Pairing request not found.'],
  PAIR_EXPIRED: [410, 'The pairing request has expired.'],
  PAIR_DENIED: [403, 'The pairing request was denied.'],
  PAIR_LIMIT: [429, 'Too many pairing requests or paired devices.'],
  COMMIT_MISMATCH: [400, 'Pairing verification failed.'],
  PAYLOAD_TOO_LARGE: [413, 'The payload is too large.'],
  INSUFFICIENT_STORAGE: [507, 'Not enough free disk space on the laptop.'],
  STORAGE_QUOTA: [507, 'The storage limit has been reached.'],
  ITEM_NOT_FOUND: [404, 'Item not found.'],
  INTERNAL: [500, 'Something went wrong on the laptop.'],
};

class ApiError extends Error {
  constructor(code, message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = TABLE[code][0];
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function apiError(code, message, options) {
  if (!TABLE[code]) throw new Error(`Unknown error code: ${code}`);
  return new ApiError(code, message || TABLE[code][1], options);
}

function envelope(err) {
  return { error: { code: err.code, message: err.message } };
}

module.exports = { ApiError, apiError, envelope };
