'use strict';

/**
 * Remembers client-generated operation ids (X-Operation-Id) per device so a retried
 * send (lost response on flaky Wi-Fi) returns the original result instead of duplicating it.
 * A duplicate that arrives while the first is still running is reported as 'pending'; the API
 * answers it with RATE_LIMITED + Retry-After and the phone simply retries.
 */
class OperationCache {
  constructor({ max, ttlMs, now = Date.now }) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.byDevice = new Map(); // deviceId -> Map(opId -> { state, result?, at })
  }

  _entries(deviceId) {
    let entries = this.byDevice.get(deviceId);
    if (!entries) {
      entries = new Map();
      this.byDevice.set(deviceId, entries);
    }
    const t = this.now();
    for (const [opId, entry] of entries) if (t - entry.at >= this.ttlMs) entries.delete(opId);
    return entries;
  }

  begin(deviceId, opId) {
    const entries = this._entries(deviceId);
    const entry = entries.get(opId);
    if (!entry) {
      entries.set(opId, { state: 'pending', at: this.now() });
      return { state: 'new' };
    }
    return entry.state === 'done' ? { state: 'done', result: entry.result } : { state: 'pending' };
  }

  complete(deviceId, opId, result) {
    const entries = this.byDevice.get(deviceId);
    const entry = entries && entries.get(opId);
    if (!entry) return;
    entry.state = 'done';
    entry.result = result;
    entry.at = this.now();
    // Keep only the newest `max` completed operations; never evict one still in flight.
    for (const [key, value] of entries) {
      if (entries.size <= this.max) break;
      if (value.state === 'done') entries.delete(key);
    }
  }

  fail(deviceId, opId) {
    const entries = this.byDevice.get(deviceId);
    if (entries) entries.delete(opId);
  }
}

module.exports = { OperationCache };
