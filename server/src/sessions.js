'use strict';

const { EventEmitter } = require('node:events');
const c = require('./crypto');

/** In-memory session tokens, one active session per device. */
class SessionStore extends EventEmitter {
  constructor({ idleMs, maxMs, now = Date.now }) {
    super();
    this.idleMs = idleMs;
    this.maxMs = maxMs;
    this.now = now;
    this.byToken = new Map(); // token -> session
    this.byDevice = new Map(); // deviceId -> session
  }

  _expiry(session) {
    return Math.min(session.lastUsed + this.idleMs, session.createdAt + this.maxMs);
  }

  _end(session, reason) {
    this.byToken.delete(session.token);
    if (this.byDevice.get(session.deviceId) === session) this.byDevice.delete(session.deviceId);
    this.emit('end', { deviceId: session.deviceId, reason });
  }

  create(deviceId) {
    this.endForDevice(deviceId, 'replaced');
    const t = this.now();
    const session = { deviceId, token: c.b64uEncode(c.random(c.SIZES.token)), createdAt: t, lastUsed: t };
    this.byToken.set(session.token, session);
    this.byDevice.set(deviceId, session);
    return { token: session.token, expiresAt: this._expiry(session) };
  }

  verify(token) {
    const session = this.byToken.get(token);
    if (!session) return null;
    const t = this.now();
    if (t >= this._expiry(session)) {
      this._end(session, 'expired');
      return null;
    }
    session.lastUsed = t;
    return { deviceId: session.deviceId, expiresAt: this._expiry(session) };
  }

  endByToken(token, reason = 'disconnected') {
    const session = this.byToken.get(token);
    if (!session) return false;
    this._end(session, reason);
    return true;
  }

  endForDevice(deviceId, reason) {
    const session = this.byDevice.get(deviceId);
    if (!session) return false;
    this._end(session, reason);
    return true;
  }

  endAll(reason) {
    for (const session of [...this.byToken.values()]) this._end(session, reason);
  }

  isConnected(deviceId) {
    const session = this.byDevice.get(deviceId);
    if (!session) return false;
    if (this.now() >= this._expiry(session)) {
      this._end(session, 'expired');
      return false;
    }
    return true;
  }
}

module.exports = { SessionStore };
