'use strict';

const { EventEmitter } = require('node:events');
const c = require('./crypto');
const { apiError } = require('./errors');
const { isUuid, cleanName } = require('./validate');
const { createLimiter } = require('./ratelimit');

const isOpen = (rec) => rec.state === 'awaiting_reveal' || rec.state === 'pending';

/**
 * The pairing state machine (spec §3.2). A record goes:
 *   awaiting_reveal → pending → approved | denied        (or is removed on expiry / mismatch)
 * `expiresAt` is the single deadline for the record's current state:
 * reveal window (10 s) → request lifetime (2 min from creation) → secret re-fetch window (60 s from approval).
 */
class PairingManager extends EventEmitter {
  constructor({ devices, fingerprint, limits, now = Date.now }) {
    super();
    this.devices = devices;
    this.fingerprint = fingerprint;
    this.limits = limits;
    this.now = now;
    this.requests = new Map(); // requestId -> record
    this.limiter = createLimiter({ max: limits.maxPairRequestsPerMinutePerIp, windowMs: 60_000, now });
  }

  // ---- internals -----------------------------------------------------------

  _view(rec) {
    return {
      requestId: rec.requestId,
      deviceId: rec.deviceId,
      deviceName: rec.deviceName,
      sas: rec.sas,
      sasDisplay: c.formatSas(rec.sas),
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      remoteIp: rec.remoteIp,
      route: rec.route,
      isRepair: rec.isRepair,
    };
  }

  _isExpired(rec) {
    return this.now() >= rec.expiresAt;
  }

  _delete(rec) {
    if (rec.secret) rec.secret.fill(0);
    this.requests.delete(rec.requestId);
  }

  /** Looks a request up, treating an expired one as gone (throws PAIR_EXPIRED once, then it no longer exists). */
  _get(requestId) {
    const rec = typeof requestId === 'string' ? this.requests.get(requestId) : undefined;
    if (!rec) throw apiError('PAIR_NOT_FOUND');
    if (this._isExpired(rec)) {
      this._delete(rec);
      throw apiError('PAIR_EXPIRED');
    }
    return rec;
  }

  _openCount() {
    let n = 0;
    for (const rec of this.requests.values()) if (isOpen(rec)) n++;
    return n;
  }

  // ---- phone-facing --------------------------------------------------------

  request({ deviceId, deviceName, commit, remoteIp, route }) {
    if (!isUuid(deviceId)) throw apiError('BAD_REQUEST', 'deviceId must be a UUID.');
    const name = cleanName(deviceName);
    if (!name) throw apiError('BAD_REQUEST', 'deviceName is required.');
    let commitBuf;
    try {
      commitBuf = c.b64uDecode(commit, 32);
    } catch {
      throw apiError('BAD_REQUEST', 'commit must be 32 bytes, base64url.');
    }
    const gate = this.limiter.attempt(remoteIp || 'unknown');
    if (!gate.allowed) throw apiError('RATE_LIMITED', undefined, { retryAfterMs: gate.retryAfterMs });

    this.sweep();
    for (const rec of [...this.requests.values()]) {
      if (rec.deviceId === deviceId && isOpen(rec)) this._delete(rec); // a device's new request replaces its old one
    }
    if (this._openCount() >= this.limits.maxPendingPairings) throw apiError('PAIR_LIMIT');
    if (!this.devices.canAdd(deviceId)) throw apiError('PAIR_LIMIT');

    const t = this.now();
    const rec = {
      requestId: c.b64uEncode(c.random(c.SIZES.requestId)),
      deviceId,
      deviceName: name,
      commit: commitBuf,
      nl: c.random(c.SIZES.nonce),
      np: null,
      state: 'awaiting_reveal',
      sas: null,
      createdAt: t,
      expiresAt: t + this.limits.pairRevealWindowMs,
      remoteIp: remoteIp || 'unknown',
      route: route || 'other',
      isRepair: this.devices.has(deviceId),
      secret: null,
    };
    this.requests.set(rec.requestId, rec);
    return { requestId: rec.requestId, nl: c.b64uEncode(rec.nl) };
  }

  reveal({ requestId, np }) {
    const rec = this._get(requestId);
    if (rec.state !== 'awaiting_reveal') throw apiError('BAD_REQUEST', 'This request was already revealed.');
    let npBuf;
    try {
      npBuf = c.b64uDecode(np, c.SIZES.nonce);
    } catch {
      throw apiError('BAD_REQUEST', 'np must be 16 bytes, base64url.');
    }
    if (!c.safeEqualHex(c.commitOf(npBuf).toString('hex'), rec.commit.toString('hex'))) {
      this._delete(rec);
      throw apiError('COMMIT_MISMATCH');
    }
    rec.np = npBuf;
    rec.sas = c.sasCode(this.fingerprint, npBuf, rec.nl);
    rec.state = 'pending';
    rec.expiresAt = rec.createdAt + this.limits.pairExpiryMs;
    this.emit('pending', this._view(rec));
    return {};
  }

  /**
   * Result of a pairing request; the phone polls this every 1-2 s.
   * Every failure to prove knowledge of np is the same PAIR_NOT_FOUND.
   */
  status({ requestId, deviceId, proof }) {
    const rec = typeof requestId === 'string' ? this.requests.get(requestId) : undefined;
    if (!rec || !rec.np || deviceId !== rec.deviceId) throw apiError('PAIR_NOT_FOUND');
    let expected;
    try {
      expected = c.pairProof(rec.np, c.b64uDecode(requestId, c.SIZES.requestId), rec.deviceId);
    } catch {
      throw apiError('PAIR_NOT_FOUND');
    }
    if (!c.safeEqualHex(expected, proof)) throw apiError('PAIR_NOT_FOUND');

    if (this._isExpired(rec)) {
      const wasApproved = rec.state === 'approved';
      this._delete(rec);
      throw apiError(wasApproved ? 'PAIR_NOT_FOUND' : 'PAIR_EXPIRED');
    }
    if (rec.state === 'denied') {
      this._delete(rec);
      throw apiError('PAIR_DENIED');
    }
    if (rec.state === 'approved') return { state: 'approved', secret: c.b64uEncode(rec.secret) };
    return { state: 'pending' };
  }

  // ---- laptop-facing -------------------------------------------------------

  listPending() {
    this.sweep();
    return [...this.requests.values()]
      .filter((rec) => rec.state === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((rec) => this._view(rec));
  }

  approve(requestId) {
    const rec = this._get(requestId);
    if (rec.state !== 'pending') throw apiError('PAIR_NOT_FOUND');
    const secret = c.random(c.SIZES.secret);
    const { replaced } = this.devices.add({ deviceId: rec.deviceId, name: rec.deviceName, secret });
    rec.state = 'approved';
    rec.secret = secret;
    rec.expiresAt = this.now() + this.limits.pairSecretWindowMs;
    rec.isRepair = replaced;
    if (replaced) this.emit('device-replaced', { deviceId: rec.deviceId });
    this.emit('resolved', { requestId, deviceId: rec.deviceId, state: 'approved' });
    return { deviceId: rec.deviceId, replaced };
  }

  deny(requestId) {
    const rec = this._get(requestId);
    if (rec.state !== 'pending') throw apiError('PAIR_NOT_FOUND');
    rec.state = 'denied';
    this.emit('resolved', { requestId, deviceId: rec.deviceId, state: 'denied' });
  }

  sweep() {
    for (const rec of [...this.requests.values()]) if (this._isExpired(rec)) this._delete(rec);
  }
}

module.exports = { PairingManager };
