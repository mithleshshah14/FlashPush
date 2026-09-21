'use strict';

/** Sliding-window limiter keyed by string (an IP address in practice). */
function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map(); // key -> ascending timestamps

  function prune(key, t) {
    const list = hits.get(key);
    if (!list) return [];
    const cutoff = t - windowMs;
    let drop = 0;
    while (drop < list.length && list[drop] <= cutoff) drop++;
    if (drop) list.splice(0, drop);
    if (!list.length) hits.delete(key);
    return list;
  }

  function isBlocked(key) {
    const t = now();
    const list = prune(key, t);
    if (list.length < max) return { blocked: false, retryAfterMs: 0 };
    return { blocked: true, retryAfterMs: Math.max(0, list[0] + windowMs - t) };
  }

  function record(key) {
    const t = now();
    const list = prune(key, t);
    list.push(t);
    hits.set(key, list);
  }

  function attempt(key) {
    const state = isBlocked(key);
    if (state.blocked) return { allowed: false, retryAfterMs: state.retryAfterMs };
    record(key);
    return { allowed: true, retryAfterMs: 0 };
  }

  return { isBlocked, record, attempt };
}

module.exports = { createLimiter };
