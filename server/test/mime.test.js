'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mimeFromName, isImage } = require('../src/mime');

test('known extensions map to types, case-insensitively', () => {
  assert.equal(mimeFromName('photo.JPG'), 'image/jpeg');
  assert.equal(mimeFromName('a.png'), 'image/png');
  assert.equal(mimeFromName('doc.pdf'), 'application/pdf');
  assert.equal(mimeFromName('notes.txt'), 'text/plain; charset=utf-8');
});

test('unknown or missing extensions are octet-stream', () => {
  assert.equal(mimeFromName('archive.xyz'), 'application/octet-stream');
  assert.equal(mimeFromName('noext'), 'application/octet-stream');
});

test('isImage is true only for image/* types', () => {
  assert.equal(isImage('image/webp'), true);
  assert.equal(isImage('application/pdf'), false);
});
