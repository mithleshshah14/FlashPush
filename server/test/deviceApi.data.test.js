'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('./helpers/api');

const code = (r) => r.json && r.json.error && r.json.error.code;
const OP1 = 'op-aaaaaaaa-1';
const upload = (call, token, name, body, headers = {}) =>
  call('POST', '/v1/file', { token, headers: { 'x-filename': encodeURIComponent(name), ...headers }, body });

test('text: send, list, and reject empty text', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const { token } = await pairDevice();
  const sent = await call('POST', '/v1/text', { token, json: { text: 'hello https://example.com' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.kind, 'text');
  assert.equal(sent.json.from, 'phone');
  assert.equal('deviceId' in sent.json, false);
  assert.deepEqual((await call('GET', '/v1/items', { token })).json.items.map((i) => i.text), ['hello https://example.com']);
  assert.equal(code(await call('POST', '/v1/text', { token, json: { text: '   ' } })), 'BAD_REQUEST');
  assert.equal(code(await call('POST', '/v1/text', { token, json: {} })), 'BAD_REQUEST');
});

test('text over the size limit is PAYLOAD_TOO_LARGE', async (t) => {
  const { call, pairDevice } = await startApi(t, { maxTextBytes: 10 });
  const { token } = await pairDevice();
  assert.equal((await call('POST', '/v1/text', { token, json: { text: 'x'.repeat(20) } })).status, 413);
});

test('a repeated X-Operation-Id returns the original item once', async (t) => {
  const { call, pairDevice, store } = await startApi(t);
  const { token } = await pairDevice();
  const first = await call('POST', '/v1/text', { token, json: { text: 'once' }, headers: { 'x-operation-id': OP1 } });
  const second = await call('POST', '/v1/text', { token, json: { text: 'once' }, headers: { 'x-operation-id': OP1 } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.id, first.json.id);
  assert.equal(store.list().length, 1);
  assert.equal(code(await call('POST', '/v1/text', { token, json: { text: 'x' }, headers: { 'x-operation-id': 'no' } })), 'BAD_REQUEST');
});

test('files: upload, list with mime, download the same bytes', async (t) => {
  const { call, pairDevice, receiveDir } = await startApi(t);
  const { token } = await pairDevice();
  const bytes = Buffer.from('PNGDATA');
  const sent = await upload(call, token, 'pic.png', bytes);
  assert.equal(sent.status, 201);
  assert.deepEqual([sent.json.name, sent.json.size, sent.json.mime], ['pic.png', 7, 'image/png']);
  assert.equal(fs.readFileSync(path.join(receiveDir, 'pic.png'), 'utf8'), 'PNGDATA');

  const download = await call('GET', `/v1/files/${sent.json.id}`, { token });
  assert.deepEqual(download.buffer, bytes);
  assert.match(download.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''pic\.png$/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  const inline = await call('GET', `/v1/files/${sent.json.id}?inline=1`, { token });
  assert.match(inline.headers.get('content-disposition'), /^inline/);
});

test('inline is never used for non-images or SVG', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const { token } = await pairDevice();
  for (const name of ['doc.pdf', 'logo.svg']) {
    const sent = await upload(call, token, name, Buffer.from('x'));
    const res = await call('GET', `/v1/files/${sent.json.id}?inline=1`, { token });
    assert.match(res.headers.get('content-disposition'), /^attachment/, name);
  }
});

test('hostile file names are made safe and stay inside the receive folder', async (t) => {
  const { call, pairDevice, receiveDir } = await startApi(t);
  const { token } = await pairDevice();
  const sent = await upload(call, token, '..\\..\\evil.txt', Buffer.from('x'));
  assert.equal(sent.json.name, 'evil.txt');
  assert.deepEqual(fs.readdirSync(receiveDir), ['evil.txt']);
});

test('file errors: no Content-Length is BAD_REQUEST, too large is PAYLOAD_TOO_LARGE', async (t) => {
  const { base, call, pairDevice } = await startApi(t, { maxFileBytes: 10 });
  const { token } = await pairDevice();
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const noLength = await fetch(`${base}/v1/file`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-filename': 'a.bin' },
    body: chunked,
    duplex: 'half',
  });
  assert.equal(noLength.status, 400);
  assert.equal((await noLength.json()).error.code, 'BAD_REQUEST');

  const big = await upload(call, token, 'big.bin', Buffer.alloc(20));
  assert.equal(big.status, 413);
  assert.equal(code(big), 'PAYLOAD_TOO_LARGE');
});

test('a repeated upload with the same X-Operation-Id stores one file', async (t) => {
  const { call, pairDevice, receiveDir } = await startApi(t);
  const { token } = await pairDevice();
  const a = await upload(call, token, 'a.txt', Buffer.from('hi'), { 'x-operation-id': OP1 });
  const b = await upload(call, token, 'a.txt', Buffer.from('hi'), { 'x-operation-id': OP1 });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.json.id, a.json.id);
  assert.deepEqual(fs.readdirSync(receiveDir), ['a.txt']);
});

test('phones are isolated: B cannot list, download or delete A\'s items', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const a = await pairDevice('Phone A');
  const b = await pairDevice('Phone B');
  const sent = await upload(call, a.token, 'secret.txt', Buffer.from('mine'));
  await call('POST', '/v1/text', { token: a.token, json: { text: 'private' } });
  assert.deepEqual((await call('GET', '/v1/items', { token: b.token })).json.items, []);
  assert.equal(code(await call('GET', `/v1/files/${sent.json.id}`, { token: b.token })), 'ITEM_NOT_FOUND');
  assert.equal((await call('DELETE', `/v1/items/${sent.json.id}`, { token: b.token })).status, 200);
  assert.equal((await call('GET', '/v1/items', { token: a.token })).json.items.length, 2);
});

test('delete removes an item; deleting it again is still a success', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const { token } = await pairDevice();
  const sent = await call('POST', '/v1/text', { token, json: { text: 'bye' } });
  assert.equal((await call('DELETE', `/v1/items/${sent.json.id}`, { token })).status, 200);
  assert.equal((await call('DELETE', `/v1/items/${sent.json.id}`, { token })).status, 200);
  assert.deepEqual((await call('GET', '/v1/items', { token })).json.items, []);
});

test('events: a new item for this phone arrives live, without deviceId', async (t) => {
  const { events, pairDevice, store } = await startApi(t);
  const { token, deviceId } = await pairDevice();
  const stream = await events(token);
  t.after(() => stream.close());
  store.add({ deviceId, kind: 'text', from: 'laptop', text: 'from laptop' });
  const event = await stream.next();
  assert.equal(event.event, 'item-added');
  assert.equal(event.data.text, 'from laptop');
  assert.equal('deviceId' in event.data, false);
});

test('events: another phone\'s items are not delivered', async (t) => {
  const { events, pairDevice, store } = await startApi(t);
  const a = await pairDevice('A');
  const b = await pairDevice('B');
  const stream = await events(a.token);
  t.after(() => stream.close());
  store.add({ deviceId: b.deviceId, kind: 'text', from: 'laptop', text: 'for B' });
  assert.equal(await stream.next(300), null);
});

test('events: a revoked session gets an expired event and the stream closes', async (t) => {
  const { events, pairDevice, sessions } = await startApi(t);
  const { token, deviceId } = await pairDevice();
  const stream = await events(token);
  t.after(() => stream.close());
  sessions.endForDevice(deviceId, 'revoked');
  assert.deepEqual(await stream.next(), { event: 'expired', data: { reason: 'revoked' } });
  assert.equal(await stream.next(), null);
});

test('events: at most two streams per device; a third closes the oldest', async (t) => {
  const { events, pairDevice } = await startApi(t);
  const { token } = await pairDevice();
  const first = await events(token);
  const second = await events(token);
  const third = await events(token);
  t.after(() => {
    second.close();
    third.close();
  });
  assert.equal(await first.next(), null);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
});
