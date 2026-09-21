'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { findRunningInstance } = require('../src/singleInstance');
const { startAdmin } = require('./helpers/admin');

/** A loopback-only HTTP server with a scripted answer, closed when the test ends. */
async function fakeServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return server.address().port;
}

test('true when a real FlashPush admin API answers on the port', async (t) => {
  const env = await startAdmin(t);
  assert.equal(await findRunningInstance(env.adminPort), true);
});

test('false when nothing listens on the port', async (t) => {
  const port = await fakeServer(t, () => {});
  await new Promise((r) => setTimeout(r, 10));
  // Use a port that was just closed rather than one we hold open.
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const freePort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  assert.notEqual(freePort, port);
  assert.equal(await findRunningInstance(freePort), false);
});

test('false when a different program answers, whatever it says', async (t) => {
  const other = await fakeServer(t, (req, res) => res.end(JSON.stringify({ app: 'something-else' })));
  const garbage = await fakeServer(t, (req, res) => res.end('<html>hello</html>'));
  const failing = await fakeServer(t, (req, res) => {
    res.writeHead(500);
    res.end(JSON.stringify({ app: 'flashpush-admin' }));
  });
  assert.equal(await findRunningInstance(other), false);
  assert.equal(await findRunningInstance(garbage), false);
  assert.equal(await findRunningInstance(failing), false);
});

test('false when the server accepts but never answers, after the timeout', async (t) => {
  const silent = await fakeServer(t, () => {});
  const started = Date.now();
  assert.equal(await findRunningInstance(silent, { timeoutMs: 100 }), false);
  assert.ok(Date.now() - started < 1500);
});

test('an injected fetch is used for the request and only ever asked for the loopback ping URL', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ app: 'flashpush-admin' }) };
  };
  assert.equal(await findRunningInstance(8760, { fetchFn }), true);
  assert.deepEqual(urls, ['http://127.0.0.1:8760/admin/ping']);
});
