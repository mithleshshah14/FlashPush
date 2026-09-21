'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { sanitizeFilename, saveUpload, sweepPartFiles } = require('../src/transfers');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { throwsCode } = require('./helpers/assertions');

const data = (text) => Readable.from([Buffer.from(text)]);
const opts = (dir, extra = {}) => ({ dir, limits: DEFAULT_LIMITS, freeBytes: async () => 10 * 1024 ** 3, ...extra });

test('sanitizeFilename reduces every hostile path to a plain basename', () => {
  const cases = {
    '../../evil.txt': 'evil.txt',
    '..\\..\\evil.txt': 'evil.txt',
    'C:\\Windows\\evil.txt': 'evil.txt',
    '\\\\host\\share\\f.txt': 'f.txt',
    '/etc/passwd': 'passwd',
    CON: '_CON',
    'nul.txt': '_nul.txt',
    '..': 'file',
    '': 'file',
    'dir/': 'file',
    'a<b>:c.txt': 'a_b__c.txt',
    'report.': 'report',
    '.hidden': 'hidden',
    'a\x00b': 'a_b',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(sanitizeFilename(input), expected, JSON.stringify(input));
  assert.equal(sanitizeFilename(undefined), 'file');
});

test('sanitizeFilename caps the length but keeps the extension', () => {
  const name = sanitizeFilename(`${'a'.repeat(300)}.pdf`);
  assert.ok(name.length <= 200);
  assert.ok(name.endsWith('.pdf'));
});

test('saves a file, returns its final name and size, and leaves no .part behind', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: data('hello'), name: 'a.txt', contentLength: 5, ...opts(dir) });
  assert.equal(result.name, 'a.txt');
  assert.equal(result.size, 5);
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'hello');
  assert.deepEqual(fs.readdirSync(dir), ['a.txt']);
});

test('a zero-byte file is fine', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: Readable.from([]), name: 'empty.bin', contentLength: 0, ...opts(dir) });
  assert.equal(result.size, 0);
});

test('duplicate names get (1), (2) suffixes', async (t) => {
  const dir = tmpDir(t);
  const names = [];
  for (let i = 0; i < 3; i++) names.push((await saveUpload({ stream: data('x'), name: 'a.txt', contentLength: 1, ...opts(dir) })).name);
  assert.deepEqual(names, ['a.txt', 'a (1).txt', 'a (2).txt']);
});

test('the file always lands directly inside the target folder', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: data('x'), name: '../../..\\escape.txt', contentLength: 1, ...opts(dir) });
  assert.equal(path.dirname(result.path), path.resolve(dir));
  assert.deepEqual(fs.readdirSync(dir), ['escape.txt']);
});

test('oversize is rejected before anything is written', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'big.bin', contentLength: 3 * 1024 ** 3, ...opts(dir) }),
    (e) => e.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the outbox quota is enforced when asked', async (t) => {
  const dir = tmpDir(t);
  const limits = { ...DEFAULT_LIMITS, maxOutboxBytes: 100 };
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'a', contentLength: 60, usedBytes: 50, checkQuota: true, ...opts(dir, { limits }) }),
    (e) => e.code === 'STORAGE_QUOTA',
  );
  await saveUpload({ stream: data('x'.repeat(10)), name: 'a', contentLength: 10, usedBytes: 50, checkQuota: true, ...opts(dir, { limits }) });
});

test('low disk space is rejected up front', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'a', contentLength: 1000, ...opts(dir, { freeBytes: async () => 100 * 1024 ** 2 }) }),
    (e) => e.code === 'INSUFFICIENT_STORAGE',
  );
});

test('a missing Content-Length is a bad request', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(saveUpload({ stream: data('x'), name: 'a', contentLength: undefined, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
});

test('an interrupted upload leaves no file and no .part', async (t) => {
  const dir = tmpDir(t);
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from('abc');
      throw new Error('network dropped');
    })(),
  );
  await assert.rejects(saveUpload({ stream: broken, name: 'a.bin', contentLength: 10, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('bytes that do not match Content-Length are rejected, short or long, and cleaned up', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(saveUpload({ stream: data('abc'), name: 'a', contentLength: 10, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(saveUpload({ stream: data('abcdefghij'), name: 'a', contentLength: 3, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('sweepPartFiles removes leftovers from a crash and nothing else', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'a.txt.1234.part'), 'x');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.equal(sweepPartFiles(dir), 1);
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  assert.equal(sweepPartFiles(path.join(dir, 'missing')), 0);
});
