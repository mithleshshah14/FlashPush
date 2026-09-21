'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const c = require('../src/crypto');
const { createApp } = require('../src/index');
const { adminRequest } = require('./helpers/tls-client');
const { tmpDir } = require('./helpers/tmp');

async function boot(t, ports = {}) {
  const home = tmpDir(t);
  const app = await createApp({
    home,
    overrides: {
      ports: { device: 0, admin: 0, discovery: 0, ...ports },
      receiveDir: path.join(home, 'received'),
      limits: { minFreeDiskBytes: 0 },
    },
    log: () => {},
  });
  t.after(() => app.stop({ graceMs: 50 }));
  return { app, home, outbox: path.join(home, 'outbox') };
}

/** Occupies a TCP port so the app cannot bind it. */
async function occupyPort(t) {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '0.0.0.0', resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  return blocker.address().port;
}

/** Starts a laptop -> phone upload of 10 bytes, sends the first 5 and lets the test finish or abandon it. */
function slowUpload(app, adminPort) {
  const deviceId = '11111111-2222-3333-4444-555555555555';
  app.devices.add({ deviceId, name: 'Pixel 7', secret: c.random(32) });
  const req = http.request({
    host: '127.0.0.1',
    port: adminPort,
    method: 'POST',
    path: '/admin/file',
    agent: false,
    headers: {
      host: `127.0.0.1:${adminPort}`,
      'x-flashpush-admin': '1',
      'x-filename': 'slow.bin',
      'x-device-id': deviceId,
      'content-length': '10',
    },
  });
  const outcome = new Promise((resolve) => {
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', (err) => resolve({ error: err.code }));
  });
  req.write('12345');
  return { req, outcome };
}

const waitFor = async (check, ms = 1500) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return check();
};

test('a normal start is running and the admin state says so', async (t) => {
  const { app } = await boot(t);
  assert.deepEqual(app.lifecycle.status(), { state: 'starting', reason: null });
  const ports = await app.start();
  assert.deepEqual(app.lifecycle.status(), { state: 'running', reason: null });
  const state = await adminRequest(ports.admin, 'GET', '/admin/state');
  assert.deepEqual(state.json.status, { state: 'running', reason: null });
});

test('a taken port makes a tolerant start degraded, with the reason, and the rest keeps working', async (t) => {
  const taken = await occupyPort(t);
  const { app } = await boot(t, { device: taken });
  const ports = await app.start({ tolerant: true });
  assert.deepEqual(app.lifecycle.status(), { state: 'degraded', reason: `Port ${taken} is used by another program.` });
  assert.equal(ports.device, 0);
  assert.equal(ports.discovery, 0, 'discovery is skipped without the device port');
  assert.equal((await adminRequest(ports.admin, 'GET', '/admin/ping')).status, 200);
  const state = await adminRequest(ports.admin, 'GET', '/admin/state');
  assert.equal(state.json.status.state, 'degraded');
  assert.match(state.json.status.reason, /is used by another program/);
});

test('a strict start still fails on a taken port and leaves nothing running', async (t) => {
  const taken = await occupyPort(t);
  const { app } = await boot(t, { device: taken });
  await assert.rejects(app.start(), (e) => e.code === 'EADDRINUSE');
  assert.equal(app.lifecycle.status().state, 'stopped');
});

test('lifecycle changes raise the changed signal for the admin page and tray', async (t) => {
  const { app } = await boot(t);
  let signals = 0;
  app.bus.on('changed', () => signals++);
  await app.start();
  assert.ok(signals >= 1);
});

test('a graceful stop lets an upload in progress finish', async (t) => {
  const { app, outbox } = await boot(t);
  const { admin } = await app.start();
  const { req, outcome } = slowUpload(app, admin);
  await new Promise((r) => setTimeout(r, 50));

  const stopping = app.stop({ graceMs: 3000 });
  await new Promise((r) => setTimeout(r, 100));
  assert.notEqual(app.lifecycle.status().state, 'stopped', 'still waiting for the upload');
  req.end('67890');

  assert.deepEqual(await outcome, { status: 201 });
  await stopping;
  assert.equal(fs.readFileSync(path.join(outbox, 'slow.bin'), 'utf8'), '1234567890');
  assert.equal(app.lifecycle.status().state, 'stopped');
});

test('a forced stop aborts the upload and leaves no partial file', async (t) => {
  const { app, outbox } = await boot(t);
  const { admin } = await app.start();
  const { outcome } = slowUpload(app, admin);
  await new Promise((r) => setTimeout(r, 50));

  await app.stop({ graceMs: 50 });
  assert.ok((await outcome).error, 'the connection was cut');
  assert.equal(await waitFor(() => fs.readdirSync(outbox).length === 0), true, 'no .part or file remains');
  assert.equal(app.lifecycle.status().state, 'stopped');
});

test('stop is idempotent and closes the ports', async (t) => {
  const { app } = await boot(t);
  const { admin } = await app.start();
  await app.stop();
  await app.stop();
  await assert.rejects(adminRequest(admin, 'GET', '/admin/ping'), (e) => e.code === 'ECONNREFUSED');
});
