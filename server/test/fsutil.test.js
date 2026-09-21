'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../src/fsutil');
const { tmpDir } = require('./helpers/tmp');

test('readJson returns the fallback when the file is missing', (t) => {
  assert.deepEqual(readJson(path.join(tmpDir(t), 'nope.json'), { a: 1 }), { a: 1 });
});

test('writeJsonAtomic creates directories, round-trips, and leaves no temp files', (t) => {
  const file = path.join(tmpDir(t), 'nested', 'dir', 'data.json');
  writeJsonAtomic(file, { hello: 'world' });
  writeJsonAtomic(file, { hello: 'again' });
  assert.deepEqual(readJson(file, null), { hello: 'again' });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
});

test('readJson names the file when the JSON is invalid', (t) => {
  const file = path.join(tmpDir(t), 'bad.json');
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => readJson(file, null), /bad\.json/);
});
