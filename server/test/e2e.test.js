'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../src/crypto');
const { createApp } = require('../src/index');
const { tlsRequest, adminRequest } = require('./helpers/tls-client');
const { tmpDir } = require('./helpers/tmp');

const code = (r) => r.json && r.json.error && r.json.error.code;
const json = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function boot(t, { home = tmpDir(t), limits = {} } = {}) {
  const receiveDir = path.join(home, 'received');
  const app = await createApp({
    home,
    overrides: { bindHost: '127.0.0.1', ports: { device: 0, admin: 0, discovery: 0 }, receiveDir, limits: { minFreeDiskBytes: 0, ...limits } },
    log: () => {},
  });
  const ports = await app.start();
  t.after(() => app.stop());
  return {
    app, home, receiveDir, ports,
    phone: (method, p, opts) => tlsRequest(ports.device, method, p, opts),
    admin: (method, p, opts) => adminRequest(ports.admin, method, p, opts),
  };
}

/** The phone's whole pairing flow over TLS, with the user approving through the admin API. */
async function pair(env, name = 'Pixel 7') {
  const deviceId = crypto.randomUUID();
  const np = c.random(16);
  const first = await env.phone('POST', '/v1/pair/request', json({ deviceId, deviceName: name, commit: c.b64uEncode(c.commitOf(np)) }));
  const { requestId, nl } = first.json;
  assert.equal(first.fingerprint.equals(env.app.fingerprint), true, 'the phone sees the pinned certificate');
  await env.phone('POST', '/v1/pair/reveal', json({ requestId, np: c.b64uEncode(np) }));

  const state = (await env.admin('GET', '/admin/state')).json;
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].sas, c.sasCode(first.fingerprint, np, c.b64uDecode(nl, 16)), 'both screens show the same code');
  assert.equal((await env.admin('POST', `/admin/pair/${requestId}/approve`)).status, 200);

  const proof = c.pairProof(np, c.b64uDecode(requestId, 16), deviceId);
  const status = await env.phone('GET', `/v1/pair/status/${requestId}?deviceId=${deviceId}`, { headers: { 'x-pair-proof': proof } });
  const secret = status.json.secret;
  const session = await env.phone('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } });
  return { deviceId, secret, token: session.json.sessionToken };
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('a phone pairs, exchanges text and files with the laptop, disconnects, reconnects and is revoked', async (t) => {
  const env = await boot(t);
  const { deviceId, secret, token } = await pair(env);

  // phone -> laptop
  assert.equal((await env.phone('POST', '/v1/text', { ...json({ text: 'hello laptop' }), headers: { ...bearer(token), 'content-type': 'application/json' } })).status, 201);
  const upload = await env.phone('POST', '/v1/file', { headers: { ...bearer(token), 'x-filename': 'note.txt' }, body: Buffer.from('file body') });
  assert.equal(upload.status, 201);
  assert.equal(fs.readFileSync(path.join(env.receiveDir, 'note.txt'), 'utf8'), 'file body');
  assert.deepEqual((await env.admin('GET', '/admin/state')).json.items.map((i) => i.text || i.name), ['hello laptop', 'note.txt']);

  // laptop -> phone
  assert.equal((await env.admin('POST', '/admin/text', { json: { text: 'hello phone' } })).status, 201);
  const sent = await env.admin('POST', '/admin/file', { headers: { 'x-filename': 'to-phone.bin' }, body: Buffer.from([1, 2, 3]) });
  const items = (await env.phone('GET', '/v1/items', { headers: bearer(token) })).json.items;
  assert.deepEqual(items.map((i) => i.text || i.name), ['hello laptop', 'note.txt', 'hello phone', 'to-phone.bin']);
  const download = await env.phone('GET', `/v1/files/${sent.json.id}`, { headers: bearer(token) });
  assert.deepEqual(download.buffer, Buffer.from([1, 2, 3]));

  // disconnect, then reconnect with the stored secret
  assert.equal((await env.phone('DELETE', '/v1/session', { headers: bearer(token) })).status, 200);
  assert.equal(code(await env.phone('GET', '/v1/items', { headers: bearer(token) })), 'SESSION_EXPIRED');
  const again = await env.phone('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } });
  assert.equal(again.status, 200);

  // the laptop revokes the phone
  assert.equal((await env.admin('DELETE', `/admin/devices/${deviceId}`)).status, 200);
  assert.equal(code(await env.phone('GET', '/v1/items', { headers: bearer(again.json.sessionToken) })), 'SESSION_EXPIRED');
  assert.equal(code(await env.phone('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } })), 'DEVICE_NOT_PAIRED');
});

test('nothing but hello and pairing works without an approved device', async (t) => {
  const env = await boot(t);
  assert.equal((await env.phone('GET', '/v1/hello')).status, 200);
  for (const [method, p] of [['GET', '/v1/items'], ['POST', '/v1/text'], ['POST', '/v1/file'], ['GET', '/v1/events'], ['GET', '/v1/files/x']]) {
    assert.equal((await env.phone(method, p)).status, 401, `${method} ${p}`);
  }
});

test('the admin API refuses foreign hosts and cross-site requests over the real server', async (t) => {
  const env = await boot(t);
  assert.equal((await env.admin('GET', '/admin/ping')).status, 200);
  assert.equal(code(await env.admin('GET', '/admin/ping', { headers: { host: 'evil.example' } })), 'FORBIDDEN');
  assert.equal(code(await env.admin('POST', '/admin/history/clear', { headers: { origin: 'http://evil.example' }, json: {} })), 'FORBIDDEN');
  const page = await env.admin('GET', '/');
  assert.match(page.text, /<title>FlashPush<\/title>/);
});

test('two phones cannot see each other\'s items', async (t) => {
  const env = await boot(t);
  const a = await pair(env, 'Phone A');
  const b = await pair(env, 'Phone B');
  await env.phone('POST', '/v1/text', { headers: { ...bearer(a.token), 'content-type': 'application/json' }, body: JSON.stringify({ text: 'for A only' }) });
  assert.deepEqual((await env.phone('GET', '/v1/items', { headers: bearer(b.token) })).json.items, []);
  assert.equal(code(await env.admin('POST', '/admin/text', { json: { text: 'x' } })), 'BAD_REQUEST'); // two phones: target required
});

test('discovery answers over UDP with the real device port', async (t) => {
  const env = await boot(t);
  const reply = await new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); resolve(null); }, 1500);
    socket.on('message', (msg) => { clearTimeout(timer); socket.close(); resolve(JSON.parse(msg.toString())); });
    socket.send(Buffer.from(JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1 })), env.ports.discovery, '127.0.0.1');
  });
  assert.equal(reply.t, 'FLASHPUSH_HERE');
  assert.equal(reply.port, env.ports.device);
  assert.equal(reply.laptopId, env.app.identity.laptopId);
});

test('after a restart the phone still connects: same certificate, same paired device', async (t) => {
  const home = tmpDir(t);
  const first = await boot(t, { home });
  const { deviceId, secret } = await pair(first);
  const fingerprint = first.app.fingerprint;
  await first.app.stop();

  const second = await boot(t, { home });
  assert.equal(second.app.fingerprint.equals(fingerprint), true);
  const session = await second.phone('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } });
  assert.equal(session.status, 200);
  assert.equal(session.fingerprint.equals(fingerprint), true);
});

test('stop is idempotent, ends sessions and closes every port', async (t) => {
  const env = await boot(t);
  const { token } = await pair(env);
  await env.app.stop();
  await env.app.stop();
  await assert.rejects(env.phone('GET', '/v1/hello'), (e) => e.code === 'ECONNREFUSED');
  await assert.rejects(env.admin('GET', '/admin/ping'), (e) => e.code === 'ECONNREFUSED');
  assert.equal(env.app.sessions.verify(token), null);
});

test('a port that is already taken fails start with EADDRINUSE and leaves nothing running', async (t) => {
  const first = await boot(t);
  const app = await createApp({
    home: tmpDir(t),
    overrides: { bindHost: '127.0.0.1', ports: { device: first.ports.device, admin: 0, discovery: 0 }, receiveDir: path.join(tmpDir(t), 'r') },
    log: () => {},
  });
  await assert.rejects(app.start(), (e) => e.code === 'EADDRINUSE');
});
