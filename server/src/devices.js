'use strict';

const c = require('./crypto');
const { apiError } = require('./errors');
const { readJson, writeJsonAtomic } = require('./fsutil');

const publicView = (rec) => ({
  deviceId: rec.deviceId,
  name: rec.name,
  pairedAt: rec.pairedAt,
  lastSeen: rec.lastSeen,
  lastRoute: rec.lastRoute,
});

/** Approved phones. Secrets are stored only as SHA-256 hashes. */
class DeviceStore {
  constructor({ file, now = Date.now, limits }) {
    this.file = file;
    this.now = now;
    this.limits = limits;
    const data = readJson(file, { devices: [] });
    this.devices = new Map((data.devices || []).map((d) => [d.deviceId, d]));
  }

  _save() {
    writeJsonAtomic(this.file, { devices: [...this.devices.values()] });
  }

  count() {
    return this.devices.size;
  }

  has(deviceId) {
    return this.devices.has(deviceId);
  }

  canAdd(deviceId) {
    return this.devices.has(deviceId) || this.devices.size < this.limits.maxDevices;
  }

  get(deviceId) {
    const rec = this.devices.get(deviceId);
    return rec ? publicView(rec) : null;
  }

  list() {
    return [...this.devices.values()].map(publicView);
  }

  /** Adds a device or, if the deviceId is already paired, replaces its secret (re-pair). */
  add({ deviceId, name, secret }) {
    if (!Buffer.isBuffer(secret) || secret.length !== c.SIZES.secret) throw new TypeError('secret must be 32 bytes');
    if (!this.canAdd(deviceId)) throw apiError('PAIR_LIMIT');
    const replaced = this.devices.has(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      name,
      secretHash: c.sha256Hex(secret),
      pairedAt: this.now(),
      lastSeen: null,
      lastRoute: null,
    });
    this._save();
    return { replaced };
  }

  verify(deviceId, secretB64u) {
    const rec = this.devices.get(deviceId);
    if (!rec) return { result: 'unknown' };
    let secret;
    try {
      secret = c.b64uDecode(secretB64u, c.SIZES.secret);
    } catch {
      return { result: 'bad_secret' };
    }
    if (!c.safeEqualHex(rec.secretHash, c.sha256Hex(secret))) return { result: 'bad_secret' };
    return { result: 'ok', device: publicView(rec) };
  }

  /** Last-seen bookkeeping lives in memory and is written along with the next add/remove. */
  touch(deviceId, route) {
    const rec = this.devices.get(deviceId);
    if (!rec) return;
    rec.lastSeen = this.now();
    rec.lastRoute = route || rec.lastRoute;
  }

  /** Revoke (laptop side) and forget (phone side) are the same thing: the device is gone. */
  remove(deviceId) {
    if (!this.devices.delete(deviceId)) return false;
    this._save();
    return true;
  }
}

module.exports = { DeviceStore };
