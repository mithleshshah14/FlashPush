'use strict';

const crypto = require('node:crypto');

const LABELS = Object.freeze({
  commit: 'FLASHPUSH-COMMIT-v1',
  sas: 'FLASHPUSH-SAS-v1',
  status: 'FLASHPUSH-STATUS-v1',
});

const SIZES = Object.freeze({ fingerprint: 32, nonce: 16, requestId: 16, secret: 32, token: 32 });

const label = (name) => Buffer.from(LABELS[name], 'ascii');

function sha256(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function sha256Hex(data) {
  return sha256(data).toString('hex');
}

function b64uEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Strict base64url: no padding, no other alphabet, canonical trailing bits, optional exact length. */
function b64uDecode(str, expectedLength) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new TypeError('Invalid base64url string');
  const buf = Buffer.from(str, 'base64url');
  if (buf.toString('base64url') !== str) throw new TypeError('Non-canonical base64url string');
  if (expectedLength !== undefined && buf.length !== expectedLength) {
    throw new TypeError(`Expected ${expectedLength} bytes, got ${buf.length}`);
  }
  return buf;
}

function requireLength(buf, length, name) {
  if (!Buffer.isBuffer(buf) || buf.length !== length) throw new TypeError(`${name} must be ${length} bytes`);
}

/** commit = SHA256("FLASHPUSH-COMMIT-v1" ‖ np) */
function commitOf(np) {
  requireLength(np, SIZES.nonce, 'np');
  return sha256(label('commit'), np);
}

/** 6-digit code: uint32_be(SHA256("FLASHPUSH-SAS-v1" ‖ fp ‖ np ‖ nl)[0..4]) mod 1,000,000, zero-padded. */
function sasCode(fingerprint, np, nl) {
  requireLength(fingerprint, SIZES.fingerprint, 'fingerprint');
  requireLength(np, SIZES.nonce, 'np');
  requireLength(nl, SIZES.nonce, 'nl');
  const hash = sha256(label('sas'), fingerprint, np, nl);
  return String(hash.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function formatSas(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** proof = HMAC-SHA256(key = np, "FLASHPUSH-STATUS-v1" ‖ requestId ‖ UTF-8(deviceId)), hex */
function pairProof(np, requestId, deviceId) {
  requireLength(np, SIZES.nonce, 'np');
  requireLength(requestId, SIZES.requestId, 'requestId');
  return crypto
    .createHmac('sha256', np)
    .update(label('status'))
    .update(requestId)
    .update(Buffer.from(deviceId, 'utf8'))
    .digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const random = (n) => crypto.randomBytes(n);

module.exports = {
  SIZES,
  b64uEncode,
  b64uDecode,
  sha256Hex,
  commitOf,
  sasCode,
  formatSas,
  pairProof,
  safeEqualHex,
  random,
};
