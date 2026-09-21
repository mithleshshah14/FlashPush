'use strict';

/**
 * True when a FlashPush admin API already answers on this laptop, so a second start can just open the
 * page instead of fighting over the ports. Only ever talks to 127.0.0.1; any failure means "not running".
 */
async function findRunningInstance(adminPort, { fetchFn = fetch, timeoutMs = 1000 } = {}) {
  try {
    const res = await fetchFn(`http://127.0.0.1:${adminPort}/admin/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json();
    return body !== null && typeof body === 'object' && body.app === 'flashpush-admin';
  } catch {
    return false;
  }
}

module.exports = { findRunningInstance };
