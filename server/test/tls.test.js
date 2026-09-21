'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const { loadConfig } = require('../src/config');
const { loadOrCreateTls, fingerprintOfPem, fingerprintOfDer } = require('../src/tls');
const { tmpDir } = require('./helpers/tmp');

test('creates an EC P-256 certificate valid for about 10 years, and reuses it', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = await loadOrCreateTls(paths);
  assert.equal(first.regenerated, true);
  assert.equal(first.fingerprint.length, 32);

  const x509 = new crypto.X509Certificate(first.cert);
  assert.equal(x509.publicKey.asymmetricKeyType, 'ec');
  assert.equal(x509.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  const years = (new Date(x509.validTo) - new Date(x509.validFrom)) / (365 * 24 * 3600 * 1000);
  assert.ok(years > 9.9 && years < 10.1, `validity was ${years} years`);
  assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(first.key)), true);

  const second = await loadOrCreateTls(paths);
  assert.equal(second.regenerated, false);
  assert.deepEqual(second.fingerprint, first.fingerprint);
});

test('the fingerprint is the SHA-256 of the DER certificate', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const tls = await loadOrCreateTls(paths);
  const der = new crypto.X509Certificate(tls.cert).raw;
  assert.deepEqual(tls.fingerprint, crypto.createHash('sha256').update(der).digest());
  assert.deepEqual(fingerprintOfPem(tls.cert), tls.fingerprint);
  assert.deepEqual(fingerprintOfDer(der), tls.fingerprint);
});

test('a damaged certificate is regenerated with a new fingerprint', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = await loadOrCreateTls(paths);
  fs.writeFileSync(paths.tlsCert, 'garbage');
  const second = await loadOrCreateTls(paths);
  assert.equal(second.regenerated, true);
  assert.notDeepEqual(second.fingerprint, first.fingerprint);
});

test('a real TLS handshake presents a certificate whose fingerprint matches (what the phone pins)', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const tls = await loadOrCreateTls(paths);
  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port: server.address().port, path: '/', rejectUnauthorized: false, agent: false },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
  const presented = fingerprintOfDer(res.socket.getPeerCertificate(true).raw);
  res.resume();
  assert.deepEqual(presented, tls.fingerprint);
});
