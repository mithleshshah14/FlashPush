'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/crypto');

// Known-answer vectors. The Flutter app must reproduce these exactly (docs/pairing.md).
const seq = (start, n) => Buffer.from(Array.from({ length: n }, (_, i) => start + i));
const V = {
  fp: seq(0x00, 32),
  np: seq(0x10, 16),
  nl: seq(0x20, 16),
  requestId: seq(0x30, 16),
  deviceId: '11111111-2222-3333-4444-555555555555',
  npB64: 'EBESExQVFhcYGRobHB0eHw',
  requestIdB64: 'MDEyMzQ1Njc4OTo7PD0-Pw',
  commitHex: '148f8a90dd839457dc23e50843a84c96c73365433d7277efea17c04322b1e017',
  commitB64: 'FI-KkN2DlFfcI-UIQ6hMlsczZUM9cnfv6hfAQyKx4Bc',
  sas: '001004',
  proofHex: '01b5a81d7a92704f2e4bda8b6a8e86f78f88a470b7e0bca9b6b668d7b2a035f5',
};

test('commit vector', () => {
  const commit = c.commitOf(V.np);
  assert.equal(commit.toString('hex'), V.commitHex);
  assert.equal(c.b64uEncode(commit), V.commitB64);
});

test('SAS vector, including zero padding', () => {
  assert.equal(c.sasCode(V.fp, V.np, V.nl), V.sas);
  assert.equal(c.formatSas(V.sas), '001 004');
});

test('the SAS depends on the order of the nonces', () => {
  assert.notEqual(c.sasCode(V.fp, V.np, V.nl), c.sasCode(V.fp, V.nl, V.np));
});

test('status proof vector', () => {
  assert.equal(c.pairProof(V.np, V.requestId, V.deviceId), V.proofHex);
});

test('base64url encodes without padding and round-trips', () => {
  assert.equal(c.b64uEncode(V.np), V.npB64);
  assert.equal(c.b64uEncode(V.requestId), V.requestIdB64);
  assert.deepEqual(c.b64uDecode(V.npB64, 16), V.np);
});

test('base64url decoding is strict', () => {
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0eHx', 16), TypeError); // non-canonical trailing bits
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0eHw==', 16), TypeError); // padding
  assert.throws(() => c.b64uDecode('EBESExQV+hcYGRobHB0eHw', 16), TypeError); // standard-base64 alphabet
  assert.throws(() => c.b64uDecode('EBES ExQVFhcYGRobHB0eHw', 16), TypeError); // whitespace
  assert.throws(() => c.b64uDecode('', 16), TypeError);
  assert.throws(() => c.b64uDecode(42, 16), TypeError);
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0', 16), TypeError); // wrong length
});

test('primitives reject inputs of the wrong size', () => {
  assert.throws(() => c.commitOf(Buffer.alloc(15)), TypeError);
  assert.throws(() => c.sasCode(Buffer.alloc(31), V.np, V.nl), TypeError);
  assert.throws(() => c.sasCode(V.fp, V.np, Buffer.alloc(17)), TypeError);
  assert.throws(() => c.pairProof(V.np, Buffer.alloc(15), V.deviceId), TypeError);
});

test('sha256Hex matches the FIPS test vector for "abc"', () => {
  assert.equal(c.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('safeEqualHex compares in constant time without throwing on odd input', () => {
  assert.equal(c.safeEqualHex('abcd', 'abcd'), true);
  assert.equal(c.safeEqualHex('abcd', 'abce'), false);
  assert.equal(c.safeEqualHex('abcd', 'abc'), false);
  assert.equal(c.safeEqualHex('é', 'a'), false); // same string length, different byte length
  assert.equal(c.safeEqualHex(undefined, 'a'), false);
});

test('random helpers return fresh bytes of the requested size', () => {
  const a = c.random(c.SIZES.nonce);
  const b = c.random(c.SIZES.nonce);
  assert.equal(a.length, 16);
  assert.notDeepEqual(a, b);
});
