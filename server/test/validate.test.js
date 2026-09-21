'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isUuid, cleanName } = require('../src/validate');

test('isUuid accepts lowercase UUIDs only', () => {
  assert.equal(isUuid('11111111-2222-3333-4444-555555555555'), true);
  assert.equal(isUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), true);
  assert.equal(isUuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'), false);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid('11111111-2222-3333-4444-555555555555 '), false);
});

test('cleanName strips control characters, collapses whitespace and trims', () => {
  assert.equal(cleanName('  Pixel\t7\n Pro  '), 'Pixel 7 Pro');
  assert.equal(cleanName('a\u0000b'), 'a b');
  assert.equal(cleanName('a\u2028b'), 'a b'); // line separator, folded by the whitespace collapse
});

test('cleanName limits length and rejects non-strings', () => {
  assert.equal(cleanName('x'.repeat(100)).length, 64);
  assert.equal(cleanName('abcdef', 3), 'abc');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName(undefined), '');
});
