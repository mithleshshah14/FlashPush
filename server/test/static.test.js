'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPublicFiles } = require('../src/static');
const { startAdmin } = require('./helpers/admin');
const { makePublicDir } = require('./helpers/public-dir');
const { tmpDir } = require('./helpers/tmp');

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const code = (r) => r.json && r.json.error && r.json.error.code;

test('only index.html and allowed file types under assets/ are in the allowlist', (t) => {
  const files = loadPublicFiles(makePublicDir(tmpDir(t)));
  assert.deepEqual([...files.keys()].sort(), ['/', '/assets/app.css', '/assets/app.js', '/assets/logo.png', '/assets/views/x.js']);
  assert.equal(files.has('/index.html'), false);
  assert.equal(files.has('/secret.txt'), false);
  assert.equal(files.has('/assets/notes.txt'), false);
});

test('content types are exact', (t) => {
  const files = loadPublicFiles(makePublicDir(tmpDir(t)));
  assert.equal(files.get('/').type, 'text/html; charset=utf-8');
  assert.equal(files.get('/assets/app.js').type, 'text/javascript; charset=utf-8');
  assert.equal(files.get('/assets/app.css').type, 'text/css; charset=utf-8');
  assert.equal(files.get('/assets/logo.png').type, 'image/png');
});

test('a missing public folder gives an empty allowlist instead of a crash', (t) => {
  assert.equal(loadPublicFiles(path.join(tmpDir(t), 'nope')).size, 0);
});

test('the page is served with the strict CSP (no unsafe-inline) and anti-framing headers', async (t) => {
  const env = await startAdmin(t);
  const res = await env.call('GET', '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['content-security-policy'], CSP);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('assets are served with the right type and nosniff', async (t) => {
  const env = await startAdmin(t);
  const js = await env.call('GET', '/assets/app.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.headers['x-content-type-options'], 'nosniff');
  assert.equal(js.text, 'export const x = 1;');
  assert.equal((await env.call('GET', '/assets/views/x.js')).status, 200);
  assert.equal((await env.call('GET', '/assets/logo.png')).headers['content-type'], 'image/png');
});

test('anything outside the allowlist is NOT_FOUND, including traversal in every encoding', async (t) => {
  const env = await startAdmin(t);
  const paths = [
    '/assets/../../src/index.js',
    '/assets/%2e%2e/%2e%2e/src/index.js',
    '/assets/..%2f..%2fsrc%2findex.js',
    '/assets/..%5c..%5csrc%5cindex.js',
    '/assets/views/',
    '/assets/notes.txt',
    '/assets/%00app.js',
    '/index.html',
    '/secret.txt',
    '/package.json',
  ];
  for (const p of paths) {
    const res = await env.call('GET', p);
    assert.equal(res.status, 404, p);
    assert.equal(code(res), 'NOT_FOUND', p);
  }
});

test('assets are read-only and still behind the admin guard', async (t) => {
  const env = await startAdmin(t);
  assert.equal(code(await env.call('POST', '/assets/app.js', { json: {} })), 'NOT_FOUND');
  assert.equal(code(await env.call('GET', '/assets/app.js', { host: 'evil.example' })), 'FORBIDDEN');
  assert.equal(code(await env.call('GET', '/', { headers: { origin: 'http://evil.example' } })), 'FORBIDDEN');
});
