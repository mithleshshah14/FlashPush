'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const selfsigned = require('selfsigned');

const VALID_DAYS = 3650;

function fingerprintOfDer(der) {
  return crypto.createHash('sha256').update(der).digest();
}

function fingerprintOfPem(pem) {
  return fingerprintOfDer(new crypto.X509Certificate(pem).raw);
}

function tryLoad(paths) {
  try {
    const key = fs.readFileSync(paths.tlsKey, 'utf8');
    const cert = fs.readFileSync(paths.tlsCert, 'utf8');
    return { key, cert, fingerprint: fingerprintOfPem(cert), regenerated: false };
  } catch {
    return null;
  }
}

/**
 * Loads the laptop's self-signed EC P-256 certificate, or creates one (valid ~10 years).
 * A regenerated certificate changes the fingerprint, so paired phones will refuse it (CERT_CHANGED);
 * callers should log `regenerated`.
 */
async function loadOrCreateTls(paths) {
  const existing = tryLoad(paths);
  if (existing) return existing;

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + VALID_DAYS * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'FlashPush' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
  });
  fs.writeFileSync(paths.tlsKey, pems.private, { mode: 0o600 });
  fs.writeFileSync(paths.tlsCert, pems.cert, { mode: 0o644 });
  return { key: pems.private, cert: pems.cert, fingerprint: fingerprintOfPem(pems.cert), regenerated: true };
}

module.exports = { loadOrCreateTls, fingerprintOfPem, fingerprintOfDer };
