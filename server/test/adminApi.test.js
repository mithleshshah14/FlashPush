'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../src/crypto');
const { startAdmin } = require('./helpers/admin');

const code = (r) => r.json && r.json.error && r.json.error.code;

async function pendingRequest(env) {
  const deviceId = crypto.randomUUID();
  const np = c.random(16);
  const { requestId } = env.pairing.request({ deviceId, deviceName: 'Pixel 7', commit: c.b64uEncode(c.commitOf(np)), remoteIp: '192.168.1.20', route: 'lan' });
  env.pairing.reveal({ requestId, np: c.b64uEncode(np) });
  return { deviceId, requestId };
}

test('the guard rejects a foreign Host, a foreign Origin, cross-site fetches and a missing admin header', async (t) => {
  const env = await startAdmin(t);
  assert.equal((await env.call('GET', '/admin/ping')).status, 200);
  assert.equal(code(await env.call('GET', '/admin/ping', { host: 'evil.example:80' })), 'FORBIDDEN');
  assert.equal(code(await env.call('GET', '/admin/ping', { host: `attacker.test:${env.adminPort}` })), 'FORBIDDEN');
  assert.equal(code(await env.call('GET', '/admin/ping', { headers: { origin: 'http://evil.example' } })), 'FORBIDDEN');
  assert.equal(code(await env.call('GET', '/admin/ping', { headers: { 'sec-fetch-site': 'cross-site' } })), 'FORBIDDEN');
  assert.equal((await env.call('GET', '/admin/ping', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal(code(await env.call('POST', '/admin/history/clear', { headers: { 'x-flashpush-admin': '' }, json: {} })), 'FORBIDDEN');
  assert.equal((await env.call('GET', '/admin/ping', { host: `localhost:${env.adminPort}` })).status, 200);
});

test('state lists the laptop, addresses, pending requests, devices with connection status, and items', async (t) => {
  const env = await startAdmin(t);
  const phone = env.addPhone('Pixel 7');
  env.sessions.create(phone);
  const { requestId } = await pendingRequest(env);
  env.store.add({ deviceId: phone, kind: 'text', from: 'phone', text: 'hi' });
  const state = (await env.call('GET', '/admin/state')).json;
  assert.deepEqual(state.laptop, { id: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' });
  assert.deepEqual(state.addresses, [{ ip: '192.168.1.6', kind: 'lan' }]);
  assert.equal(state.ports.admin, env.adminPort);
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].requestId, requestId);
  assert.equal(state.devices[0].connected, true);
  assert.equal(state.items[0].deviceId, phone);
  assert.equal(JSON.stringify(state).includes('secretHash'), false);
});

test('approve and deny resolve a pending request', async (t) => {
  const env = await startAdmin(t);
  const a = await pendingRequest(env);
  const b = await pendingRequest(env);
  assert.equal((await env.call('POST', `/admin/pair/${a.requestId}/approve`)).status, 200);
  assert.equal(env.devices.has(a.deviceId), true);
  assert.equal((await env.call('POST', `/admin/pair/${b.requestId}/deny`)).status, 200);
  assert.equal(env.devices.has(b.deviceId), false);
  assert.equal(code(await env.call('POST', `/admin/pair/${a.requestId}/approve`)), 'PAIR_NOT_FOUND');
});

test('revoke removes the device and ends its session', async (t) => {
  const env = await startAdmin(t);
  const phone = env.addPhone();
  const { token } = env.sessions.create(phone);
  assert.equal((await env.call('DELETE', `/admin/devices/${phone}`)).status, 200);
  assert.equal(env.devices.has(phone), false);
  assert.equal(env.sessions.verify(token), null);
  assert.equal(code(await env.call('DELETE', `/admin/devices/${phone}`)), 'NOT_FOUND');
  assert.equal(code(await env.call('DELETE', '/admin/devices/not-a-uuid')), 'BAD_REQUEST');
});

test('sending text needs a target: implied for one phone, required for several, an error for none', async (t) => {
  const env = await startAdmin(t);
  assert.equal(code(await env.call('POST', '/admin/text', { json: { text: 'x' } })), 'BAD_REQUEST'); // none paired
  const a = env.addPhone('A');
  assert.equal((await env.call('POST', '/admin/text', { json: { text: 'to A' } })).json.deviceId, a);
  const b = env.addPhone('B');
  assert.equal(code(await env.call('POST', '/admin/text', { json: { text: 'x' } })), 'BAD_REQUEST'); // ambiguous
  assert.equal((await env.call('POST', '/admin/text', { json: { text: 'to B', deviceId: b } })).status, 201);
  assert.equal(code(await env.call('POST', '/admin/text', { json: { text: 'x', deviceId: crypto.randomUUID() } })), 'BAD_REQUEST');
  assert.equal(code(await env.call('POST', '/admin/text', { json: { text: '  ', deviceId: b } })), 'BAD_REQUEST');
  assert.equal(env.store.list(b)[0].from, 'laptop');
});

test('sending a file stores it in the outbox and the download and delete routes work', async (t) => {
  const env = await startAdmin(t);
  const phone = env.addPhone();
  const sent = await env.call('POST', '/admin/file', {
    headers: { 'x-filename': encodeURIComponent('report.pdf'), 'x-device-id': phone },
    body: Buffer.from('%PDF-1'),
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.from, 'laptop');
  assert.equal(fs.readFileSync(path.join(env.outboxDir, 'report.pdf'), 'utf8'), '%PDF-1');
  const download = await env.call('GET', `/admin/files/${sent.json.id}`);
  assert.equal(download.text, '%PDF-1');
  assert.match(download.headers['content-disposition'], /^attachment/);
  assert.equal((await env.call('DELETE', `/admin/items/${sent.json.id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(env.outboxDir, 'report.pdf')), false); // outbox files go with the entry
});

test('the outbox quota and file size limit apply to laptop uploads', async (t) => {
  const env = await startAdmin(t, { maxOutboxBytes: 10, maxFileBytes: 8 });
  const phone = env.addPhone();
  const put = (name, size) => env.call('POST', '/admin/file', { headers: { 'x-filename': name, 'x-device-id': phone }, body: Buffer.alloc(size) });
  assert.equal(code(await put('big.bin', 9)), 'PAYLOAD_TOO_LARGE');
  assert.equal((await put('a.bin', 6)).status, 201);
  assert.equal(code(await put('b.bin', 6)), 'STORAGE_QUOTA');
});

test('clear history removes one phone\'s items or all', async (t) => {
  const env = await startAdmin(t);
  const a = env.addPhone('A');
  const b = env.addPhone('B');
  env.store.add({ deviceId: a, kind: 'text', from: 'phone', text: '1' });
  env.store.add({ deviceId: b, kind: 'text', from: 'phone', text: '2' });
  assert.deepEqual((await env.call('POST', '/admin/history/clear', { json: { deviceId: a } })).json, { removed: 1 });
  assert.deepEqual((await env.call('POST', '/admin/history/clear', { json: {} })).json, { removed: 1 });
  assert.equal(code(await env.call('POST', '/admin/history/clear', { json: { deviceId: 'nope' } })), 'BAD_REQUEST');
});

test('unknown admin routes are NOT_FOUND', async (t) => {
  const env = await startAdmin(t);
  assert.equal(code(await env.call('GET', '/admin/nope')), 'NOT_FOUND');
});

test('the event stream announces changes', async (t) => {
  const env = await startAdmin(t);
  const stream = await env.events();
  t.after(() => stream.close());
  assert.equal(stream.status, 200);
  const next = stream.next();
  env.bus.emit('changed');
  assert.equal(await next, 'changed');
});

test('viewers counts the open admin pages (event streams)', async (t) => {
  const env = await startAdmin(t);
  assert.equal(env.api.viewers(), 0);
  const stream = await env.events();
  assert.equal(env.api.viewers(), 1);
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(env.api.viewers(), 0);
});
