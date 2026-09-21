'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const web = require('../src/http');
const { apiError } = require('../src/errors');

const fakeReq = (body, headers = {}) => Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), { headers });
const fakeRes = () => {
  const res = { headersSent: false, status: null, headers: null, body: null };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
  };
  res.end = (body) => {
    res.body = body;
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  return res;
};

test('sendJson writes status, JSON body and length', () => {
  const res = fakeRes();
  web.sendJson(res, 201, { ok: true });
  assert.equal(res.status, 201);
  assert.equal(res.body, '{"ok":true}');
  assert.equal(res.headers['Content-Length'], 11);
});

test('sendError maps ApiError to its status, envelope and Retry-After', () => {
  const res = fakeRes();
  web.sendError(res, apiError('RATE_LIMITED', undefined, { retryAfterMs: 1500 }));
  assert.equal(res.status, 429);
  assert.equal(res.headers['Retry-After'], '2');
  assert.equal(JSON.parse(res.body).error.code, 'RATE_LIMITED');
});

test('sendError hides unexpected errors behind INTERNAL and logs them', () => {
  const res = fakeRes();
  const logged = [];
  web.sendError(res, new Error('secret detail'), (e) => logged.push(e));
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).error.code, 'INTERNAL');
  assert.equal(res.body.includes('secret detail'), false);
  assert.equal(logged.length, 1);
});

test('sendError destroys the response when headers were already sent', () => {
  const res = fakeRes();
  res.headersSent = true;
  web.sendError(res, apiError('INTERNAL'), () => {});
  assert.equal(res.destroyed, true);
});

test('readJson parses an object, treats an empty body as {}', async () => {
  assert.deepEqual(await web.readJson(fakeReq('{"a":1}')), { a: 1 });
  assert.deepEqual(await web.readJson(fakeReq(undefined)), {});
});

test('readJson rejects arrays, scalars and invalid JSON as BAD_REQUEST', async () => {
  for (const body of ['[1]', '5', 'null', '{nope']) {
    await assert.rejects(web.readJson(fakeReq(body)), (e) => e.code === 'BAD_REQUEST', body);
  }
});

test('readJson enforces the size limit, declared or actual', async () => {
  await assert.rejects(web.readJson(fakeReq('{}', { 'content-length': '999' }), 10), (e) => e.code === 'PAYLOAD_TOO_LARGE');
  await assert.rejects(web.readJson(fakeReq('{"a":"xxxxxxxxxxxxxxxx"}'), 10), (e) => e.code === 'PAYLOAD_TOO_LARGE');
});

test('remoteAddress unwraps IPv4-mapped addresses', () => {
  assert.equal(web.remoteAddress({ socket: { remoteAddress: '::ffff:192.168.1.5' } }), '192.168.1.5');
  assert.equal(web.remoteAddress({ socket: {} }), '');
});

test('bearerToken and deviceCredentials parse only well-formed headers', () => {
  assert.equal(web.bearerToken({ headers: { authorization: 'Bearer abc_DEF-123' } }), 'abc_DEF-123');
  assert.equal(web.bearerToken({ headers: { authorization: 'Basic abc' } }), null);
  assert.equal(web.bearerToken({ headers: {} }), null);
  const id = '11111111-2222-3333-4444-555555555555';
  assert.deepEqual(web.deviceCredentials({ headers: { authorization: `Device ${id}:sec_ret-1` } }), { deviceId: id, secret: 'sec_ret-1' });
  assert.equal(web.deviceCredentials({ headers: { authorization: 'Device nope:sec' } }), null);
  assert.equal(web.deviceCredentials({ headers: {} }), null);
});

test('the router matches method and path, fills params, and returns null otherwise', () => {
  const a = () => 'a';
  const b = () => 'b';
  const route = web.createRouter([
    ['GET', '/v1/items', a],
    ['DELETE', '/v1/items/:id', b],
  ]);
  assert.equal(route('GET', '/v1/items').handler, a);
  assert.equal(route('GET', '/v1/items/').handler, a);
  const hit = route('DELETE', '/v1/items/abc-123');
  assert.equal(hit.handler, b);
  assert.deepEqual(hit.params, { id: 'abc-123' });
  assert.equal(route('POST', '/v1/items'), null);
  assert.equal(route('GET', '/v1/nope'), null);
});
