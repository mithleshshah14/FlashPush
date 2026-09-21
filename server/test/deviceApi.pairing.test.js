'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const c = require('../src/crypto');
const { startApi } = require('./helpers/api');

const code = (r) => r.json && r.json.error && r.json.error.code;

test('hello identifies a FlashPush laptop without credentials', async (t) => {
  const { call } = await startApi(t);
  const res = await call('GET', '/v1/hello');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { app: 'flashpush', v: 1, laptopId: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' });
});

test('unknown routes and wrong methods are NOT_FOUND in the standard envelope', async (t) => {
  const { call } = await startApi(t);
  assert.equal(code(await call('GET', '/v1/nope')), 'NOT_FOUND');
  assert.equal(code(await call('POST', '/v1/hello')), 'NOT_FOUND');
});

test('every data route rejects a missing token (UNAUTHORIZED) and an unknown token (SESSION_EXPIRED)', async (t) => {
  const { call } = await startApi(t, { maxFailedAuthPerMinutePerIp: 1000 }); // 16 deliberate failures below
  const routes = [
    ['GET', '/v1/items'],
    ['POST', '/v1/text'],
    ['POST', '/v1/file'],
    ['GET', '/v1/events'],
    ['GET', '/v1/files/abc'],
    ['DELETE', '/v1/items/abc'],
    ['DELETE', '/v1/session'],
    ['DELETE', '/v1/devices/self'],
  ];
  for (const [method, path] of routes) {
    assert.equal(code(await call(method, path)), 'UNAUTHORIZED', `${method} ${path}`);
    assert.equal(code(await call(method, path, { token: c.b64uEncode(c.random(32)) })), 'SESSION_EXPIRED', `${method} ${path}`);
  }
});

test('the full pairing flow over HTTP releases the secret, laptop and addresses', async (t) => {
  const { call, pairing, fingerprint } = await startApi(t);
  const deviceId = crypto.randomUUID();
  const np = c.random(16);
  const first = await call('POST', '/v1/pair/request', { json: { deviceId, deviceName: 'Pixel 7', commit: c.b64uEncode(c.commitOf(np)) } });
  assert.equal(first.status, 200);
  const { requestId, nl } = first.json;
  assert.equal((await call('POST', '/v1/pair/reveal', { json: { requestId, np: c.b64uEncode(np) } })).status, 200);

  const [view] = pairing.listPending();
  assert.equal(view.sas, c.sasCode(fingerprint, np, c.b64uDecode(nl, 16)));
  assert.equal(view.deviceName, 'Pixel 7');

  const proof = c.pairProof(np, c.b64uDecode(requestId, 16), deviceId);
  const statusUrl = `/v1/pair/status/${requestId}?deviceId=${deviceId}`;
  assert.deepEqual((await call('GET', statusUrl, { headers: { 'x-pair-proof': proof } })).json, { state: 'pending' });

  pairing.approve(requestId);
  const done = await call('GET', statusUrl, { headers: { 'x-pair-proof': proof } });
  assert.equal(done.json.state, 'approved');
  assert.equal(c.b64uDecode(done.json.secret, 32).length, 32);
  assert.deepEqual(done.json.laptop, { id: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' });
  assert.deepEqual(done.json.addresses, [{ ip: '192.168.1.6', kind: 'lan' }]);
});

test('pair status with a wrong proof is PAIR_NOT_FOUND', async (t) => {
  const { call } = await startApi(t);
  const deviceId = crypto.randomUUID();
  const np = c.random(16);
  const { json } = await call('POST', '/v1/pair/request', { json: { deviceId, deviceName: 'P', commit: c.b64uEncode(c.commitOf(np)) } });
  await call('POST', '/v1/pair/reveal', { json: { requestId: json.requestId, np: c.b64uEncode(np) } });
  const res = await call('GET', `/v1/pair/status/${json.requestId}?deviceId=${deviceId}`, { headers: { 'x-pair-proof': 'a'.repeat(64) } });
  assert.equal(res.status, 404);
  assert.equal(code(res), 'PAIR_NOT_FOUND');
});

test('a bad pairing request is BAD_REQUEST; a wrong reveal is COMMIT_MISMATCH', async (t) => {
  const { call } = await startApi(t);
  assert.equal(code(await call('POST', '/v1/pair/request', { json: { deviceId: 'nope' } })), 'BAD_REQUEST');
  const deviceId = crypto.randomUUID();
  const np = c.random(16);
  const { json } = await call('POST', '/v1/pair/request', { json: { deviceId, deviceName: 'P', commit: c.b64uEncode(c.commitOf(np)) } });
  const res = await call('POST', '/v1/pair/reveal', { json: { requestId: json.requestId, np: c.b64uEncode(c.random(16)) } });
  assert.equal(code(res), 'COMMIT_MISMATCH');
});

test('sessions: right secret connects, wrong secret is UNAUTHORIZED, unknown device is DEVICE_NOT_PAIRED', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const phone = await pairDevice();
  const ok = await call('POST', '/v1/session', { headers: { authorization: `Device ${phone.deviceId}:${phone.secret}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.sessionToken.length, 43);
  assert.ok(ok.json.expiresAt > Date.now());
  assert.equal(ok.json.laptop.name, 'TEST-PC');

  const wrong = await call('POST', '/v1/session', { headers: { authorization: `Device ${phone.deviceId}:${c.b64uEncode(c.random(32))}` } });
  assert.equal(code(wrong), 'UNAUTHORIZED');
  const stranger = await call('POST', '/v1/session', { headers: { authorization: `Device ${crypto.randomUUID()}:${c.b64uEncode(c.random(32))}` } });
  assert.equal(code(stranger), 'DEVICE_NOT_PAIRED');
  assert.equal(code(await call('POST', '/v1/session', { headers: { authorization: 'Device garbage' } })), 'UNAUTHORIZED');
  assert.equal(code(await call('POST', '/v1/session')), 'UNAUTHORIZED');
});

test('a new session replaces the previous one for the same device', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const phone = await pairDevice();
  const again = await call('POST', '/v1/session', { headers: { authorization: `Device ${phone.deviceId}:${phone.secret}` } });
  assert.equal(code(await call('GET', '/v1/items', { token: phone.token })), 'SESSION_EXPIRED');
  assert.equal((await call('GET', '/v1/items', { token: again.json.sessionToken })).status, 200);
});

test('disconnect ends the session; the same secret reconnects', async (t) => {
  const { call, pairDevice } = await startApi(t);
  const phone = await pairDevice();
  assert.equal((await call('DELETE', '/v1/session', { token: phone.token })).status, 200);
  assert.equal(code(await call('GET', '/v1/items', { token: phone.token })), 'SESSION_EXPIRED');
  const back = await call('POST', '/v1/session', { headers: { authorization: `Device ${phone.deviceId}:${phone.secret}` } });
  assert.equal(back.status, 200);
});

test('forgetting removes the device and ends its session; it is then DEVICE_NOT_PAIRED', async (t) => {
  const { call, pairDevice, devices } = await startApi(t);
  const phone = await pairDevice();
  assert.equal((await call('DELETE', '/v1/devices/self', { token: phone.token })).status, 200);
  assert.equal(devices.has(phone.deviceId), false);
  assert.equal(code(await call('GET', '/v1/items', { token: phone.token })), 'SESSION_EXPIRED');
  const retry = await call('POST', '/v1/session', { headers: { authorization: `Device ${phone.deviceId}:${phone.secret}` } });
  assert.equal(code(retry), 'DEVICE_NOT_PAIRED');
});

test('repeated failed authentication from one address is rate limited with Retry-After', async (t) => {
  const { call } = await startApi(t);
  const bad = { authorization: `Device ${crypto.randomUUID()}:${c.b64uEncode(c.random(32))}` };
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/v1/session', { headers: bad })).status, 401);
  const blocked = await call('POST', '/v1/session', { headers: bad });
  assert.equal(blocked.status, 429);
  assert.equal(code(blocked), 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});
