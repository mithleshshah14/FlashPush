# Device API (Plan 1B-ii-a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the phone-facing `/v1` API as a plain Node request handler (pairing, sessions, history, text and file transfer, live events) on top of the Plan 1A/1B-i modules, fully tested over real HTTP.

**Architecture:** `http.js` holds tiny shared helpers (JSON in/out, error envelope, router, SSE). `deviceApi.js` exposes `createDeviceApi(deps) → { handler, closeAll }`; it does not open sockets itself, so tests mount it on a plain `http` server and Plan 1B-ii-b mounts it on the HTTPS server. Every error leaves through one place (`sendError`) as the documented JSON envelope.

**Tech Stack:** Node.js ≥ 22 (`node:http`, global `fetch` in tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §3.3–3.4 (sessions, blocking), §4 (errors, idempotency), §6.3 (events), §7 (files), §11 (routes)

## Global Constraints

- Builds on merged Plan 1A and Plan 1B-i (`errors`, `pairing`, `devices`, `sessions`, `store`, `transfers`, `idempotency`, `ratelimit`, `addresses`, `mime`).
- Routes exactly as spec §11, all under `/v1`. Unauthenticated: `GET /hello`, `POST /pair/request`, `POST /pair/reveal`, `GET /pair/status/:id` (needs `X-Pair-Proof`). Everything else needs `Authorization: Bearer <sessionToken>`; `POST /session` needs `Authorization: Device <deviceId>:<secret>`.
- Every non-2xx response is `{"error":{"code","message"}}` with the HTTP status from `errors.js`; `Retry-After` (seconds) when `retryAfterMs` is set.
- Auth failures (bad/missing token, bad device secret) count against `limits.maxFailedAuthPerMinutePerIp` per IP; when blocked → `429 RATE_LIMITED`.
- A missing bearer token is `UNAUTHORIZED`; an unknown/expired token is `SESSION_EXPIRED`; an unknown device on `POST /session` is `DEVICE_NOT_PAIRED`; a wrong secret is `UNAUTHORIZED`.
- Phones only ever see/download/delete their own items (`deviceId` match), and never see `deviceId` or disk paths.
- `X-Operation-Id` (8–64 chars of letters, digits, `-`, `_`) makes `POST /text` and `POST /file` idempotent: a repeat returns `200` with the original item; a repeat while the first is still running returns `429` with `Retry-After: 1`.
- Uploads require `Content-Length`; `X-Filename` is URL-encoded; files go to `receiveDir`. Downloads set `nosniff`; `?inline=1` is honoured only for images other than SVG.
- SSE (`GET /v1/events`): heartbeat every 25 s, no replay, max 2 streams per device (a third closes the oldest), an `expired` event (with the reason) before the stream closes when a session is replaced, revoked or expires.
- Branch `feature/server-api-transfers` (already checked out). Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Don't type ` `/` ` escapes in regex literals.

---

### Task 1: Two new error codes and a session `start` event

**Files:**
- Modify: `server/src/errors.js`, `server/test/errors.test.js`, `server/src/sessions.js`, `server/test/sessions.test.js`

**Interfaces:**
- Produces: error codes `NOT_FOUND` (404) and `FORBIDDEN` (403); `SessionStore` emits `'start'` with `{ deviceId }` from `create()`.

- [ ] **Step 1: Write the failing tests**

In `server/test/errors.test.js`, add these two lines to the `expected` map (after `INTERNAL: 500,`):

```js
    NOT_FOUND: 404,
    FORBIDDEN: 403,
```

Append to `server/test/sessions.test.js`:

```js
test('create emits a start event', () => {
  const { store } = make();
  const started = [];
  store.on('start', (e) => started.push(e));
  store.create('dev');
  assert.deepEqual(started, [{ deviceId: 'dev' }]);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd server && node --test test/errors.test.js test/sessions.test.js` → FAIL (`NOT_FOUND` is an unknown code; no start event).

- [ ] **Step 3: Implement**

In `server/src/errors.js`, add to `TABLE` after the `INTERNAL` line:

```js
  NOT_FOUND: [404, 'Not found.'],
  FORBIDDEN: [403, 'Forbidden.'],
```

In `server/src/sessions.js`, in `create()`, add one line before the `return`:

```js
    this.emit('start', { deviceId });
```

- [ ] **Step 4: Run to verify they pass** — `cd server && npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/errors.js server/src/sessions.js server/test/errors.test.js server/test/sessions.test.js
git commit -m "feat(server): NOT_FOUND/FORBIDDEN error codes and session start event" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: HTTP helpers

**Files:**
- Create: `server/src/http.js`
- Test: `server/test/http.test.js`

**Interfaces:**
- Produces:
  - `sendJson(res, status, body, headers?)`; `sendError(res, err, log?)` (ApiError → its status + envelope + `Retry-After`; anything else → logged, `INTERNAL`)
  - `readJson(req, maxBytes = 1 MiB) → Promise<object>` (throws `BAD_REQUEST` for non-object JSON, `PAYLOAD_TOO_LARGE`; always drains the body)
  - `remoteAddress(req)`, `headerValue(req, name)`, `bearerToken(req)`, `deviceCredentials(req) → { deviceId, secret } | null`
  - `createRouter(routes) → (method, pathname) → { handler, params } | null` where `routes = [[method, '/v1/items/:id', handler], …]`
  - `openSse(req, res, { heartbeatMs = 25000 }) → { send(event, data), close(), onClose(fn) }`

- [ ] **Step 1: Write the failing test** — `server/test/http.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/http.test.js` → FAIL `Cannot find module '../src/http'`.

- [ ] **Step 3: Implement** — `server/src/http.js`:

```js
'use strict';

const { apiError, envelope, ApiError } = require('./errors');

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

/** The one exit for every error: documented JSON envelope, nothing internal leaks. */
function sendError(res, err, log = console.error) {
  const known = err instanceof ApiError;
  if (!known) log(err);
  if (res.headersSent) return res.destroy();
  const e = known ? err : apiError('INTERNAL');
  const headers = e.retryAfterMs !== undefined ? { 'Retry-After': String(Math.max(1, Math.ceil(e.retryAfterMs / 1000))) } : {};
  sendJson(res, e.status, envelope(e), headers);
}

/** Reads a JSON object body. Always drains the request so the client still gets a response. */
function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > maxBytes) {
      req.resume();
      return reject(apiError('PAYLOAD_TOO_LARGE'));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > maxBytes) return reject(apiError('PAYLOAD_TOO_LARGE'));
      if (!size) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(apiError('BAD_REQUEST', 'The body must be a JSON object.'));
      }
    });
  });
}

const remoteAddress = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req) {
  const match = /^Bearer ([\w-]+)$/.exec(headerValue(req, 'authorization') || '');
  return match ? match[1] : null;
}

function deviceCredentials(req) {
  const match = /^Device ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([\w-]+)$/.exec(headerValue(req, 'authorization') || '');
  return match ? { deviceId: match[1], secret: match[2] } : null;
}

/** routes: [[method, '/v1/items/:id', handler], ...] → (method, pathname) => { handler, params } | null */
function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => ({
    method,
    handler,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`),
  }));
  return (method, pathname) => {
    for (const route of compiled) {
      const match = route.method === method && route.regex.exec(pathname);
      if (match) return { handler: route.handler, params: { ...match.groups } };
    }
    return null;
  };
}

/** Server-sent events: named events with JSON data and a comment heartbeat. */
function openSse(req, res, { heartbeatMs = 25_000 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const timer = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
  res.on('close', () => clearInterval(timer));
  return {
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      clearInterval(timer);
      if (!res.writableEnded) res.end();
    },
    onClose: (fn) => res.on('close', fn),
  };
}

module.exports = { sendJson, sendError, readJson, remoteAddress, headerValue, bearerToken, deviceCredentials, createRouter, openSse };
```

- [ ] **Step 4: Run to verify it passes** — `cd server && node --test test/http.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/http.js server/test/http.test.js
git commit -m "feat(server): HTTP helpers (JSON, error envelope, router, SSE)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Test harness for the API

**Files:**
- Create: `server/test/helpers/api.js`

**Interfaces:**
- Produces `startApi(t, limitOverrides?) → Promise<{ base, call, events, pairDevice, api, devices, sessions, pairing, store, ops, receiveDir, outboxDir, limits, fingerprint }>`:
  - `call(method, path, { token?, headers?, json?, body? }) → { status, headers, json, text, buffer }`
  - `events(token) → { status, next(timeoutMs = 2000) → { event, data } | null, close() }`
  - `pairDevice(name?, deviceId?) → { deviceId, secret, token }` (runs the whole pairing flow over HTTP, approving directly on the `PairingManager`)

- [ ] **Step 1: Write the harness** — `server/test/helpers/api.js`:

```js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const c = require('../../src/crypto');
const { DEFAULT_LIMITS } = require('../../src/config');
const { DeviceStore } = require('../../src/devices');
const { SessionStore } = require('../../src/sessions');
const { PairingManager } = require('../../src/pairing');
const { ItemStore } = require('../../src/store');
const { OperationCache } = require('../../src/idempotency');
const { createDeviceApi } = require('../../src/deviceApi');
const { tmpDir } = require('./tmp');

/** Mounts the real device API on a plain HTTP server (TLS is covered by the end-to-end test). */
async function startApi(t, limitOverrides = {}) {
  const dir = tmpDir(t);
  const receiveDir = path.join(dir, 'received');
  const outboxDir = path.join(dir, 'outbox');
  fs.mkdirSync(receiveDir);
  fs.mkdirSync(outboxDir);
  const limits = { ...DEFAULT_LIMITS, minFreeDiskBytes: 0, ...limitOverrides };
  const fingerprint = Buffer.alloc(32, 7);
  const devices = new DeviceStore({ file: path.join(dir, 'devices.json'), limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint, limits });
  const store = new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits });
  const ops = new OperationCache({ max: limits.idempotencyMaxEntries, ttlMs: limits.idempotencyTtlMs });
  const identity = { laptopId: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' };
  const api = createDeviceApi({
    identity,
    devices,
    sessions,
    pairing,
    store,
    ops,
    limits,
    receiveDir,
    addresses: () => [{ ip: '192.168.1.6', kind: 'lan' }],
    log: () => {},
  });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    api.closeAll();
    sessions.endAll('shutdown');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, urlPath, { token, headers = {}, json, body } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(base + urlPath, { method, headers: h, body: payload });
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, json: parsed, text, buffer };
  }

  async function events(token) {
    const res = await fetch(`${base}/v1/events`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) return { status: res.status, next: async () => null, close() {} };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function next(timeoutMs = 2000) {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith(':')) continue; // heartbeat / connected comment
          const event = /^event: (.*)$/m.exec(block);
          const data = /^data: (.*)$/m.exec(block);
          return { event: event && event[1], data: data && JSON.parse(data[1]) };
        }
        const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), timeoutMs))]);
        if (chunk.timeout || chunk.done) return null;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
    return { status: 200, next, close: () => reader.cancel().catch(() => {}) };
  }

  async function pairDevice(name = 'Pixel 7', deviceId = crypto.randomUUID()) {
    const np = c.random(16);
    const first = await call('POST', '/v1/pair/request', { json: { deviceId, deviceName: name, commit: c.b64uEncode(c.commitOf(np)) } });
    const { requestId } = first.json;
    await call('POST', '/v1/pair/reveal', { json: { requestId, np: c.b64uEncode(np) } });
    pairing.approve(requestId);
    const proof = c.pairProof(np, c.b64uDecode(requestId, 16), deviceId);
    const status = await call('GET', `/v1/pair/status/${requestId}?deviceId=${deviceId}`, { headers: { 'x-pair-proof': proof } });
    const secret = status.json.secret;
    const session = await call('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } });
    return { deviceId, secret, token: session.json.sessionToken };
  }

  return { base, call, events, pairDevice, api, devices, sessions, pairing, store, ops, receiveDir, outboxDir, limits, fingerprint };
}

module.exports = { startApi };
```

- [ ] **Step 2: Commit** (the harness is exercised by the next task's tests)

```bash
git add server/test/helpers/api.js
git commit -m "test(server): harness that mounts the device API on a local HTTP server" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The device API

**Files:**
- Create: `server/src/deviceApi.js`
- Test: `server/test/deviceApi.pairing.test.js`, `server/test/deviceApi.data.test.js`

**Interfaces:**
- Consumes: everything listed in the Global Constraints, plus the harness from Task 3.
- Produces: `createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir, addresses, notify = () => {}, now?, log? }) → { handler(req, res), closeAll() }`. `notify()` is called after the phone forgets itself so the admin UI can refresh (wired in Plan 1B-ii-b).

- [ ] **Step 1: Write the failing tests**

`server/test/deviceApi.pairing.test.js`:

```js
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
```

`server/test/deviceApi.data.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail** — `cd server && node --test test/deviceApi.pairing.test.js test/deviceApi.data.test.js` → FAIL `Cannot find module '../../src/deviceApi'`.

- [ ] **Step 3: Implement** — `server/src/deviceApi.js`:

```js
'use strict';

const fs = require('node:fs');
const { apiError } = require('./errors');
const { createLimiter } = require('./ratelimit');
const { classifyIp } = require('./addresses');
const { saveUpload } = require('./transfers');
const { isImage } = require('./mime');
const web = require('./http');

const OPERATION_ID = /^[\w-]{8,64}$/;
const MAX_STREAMS_PER_DEVICE = 2;

const withoutDevice = ({ deviceId: _deviceId, ...item }) => item;

function createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir, addresses, notify = () => {}, now = Date.now, log = console.error }) {
  const authFailures = createLimiter({ max: limits.maxFailedAuthPerMinutePerIp, windowMs: 60_000, now });
  const streams = new Map(); // deviceId -> Set<sse>
  const laptop = { id: identity.laptopId, name: identity.name };
  const routeOf = (req) => classifyIp(web.remoteAddress(req));

  // ---- authentication -------------------------------------------------------

  function assertNotBlocked(req) {
    const state = authFailures.isBlocked(web.remoteAddress(req));
    if (state.blocked) throw apiError('RATE_LIMITED', undefined, { retryAfterMs: state.retryAfterMs });
  }

  function fail(req, code) {
    authFailures.record(web.remoteAddress(req));
    return apiError(code);
  }

  function requireSession(req) {
    assertNotBlocked(req);
    const token = web.bearerToken(req);
    if (!token) throw fail(req, 'UNAUTHORIZED');
    const session = sessions.verify(token);
    if (!session) throw fail(req, 'SESSION_EXPIRED');
    devices.touch(session.deviceId, routeOf(req));
    return { deviceId: session.deviceId, token };
  }

  // ---- idempotency ----------------------------------------------------------

  async function withOperation(deviceId, req, res, work) {
    const opId = web.headerValue(req, 'x-operation-id');
    if (opId === undefined) return web.sendJson(res, 201, await work());
    if (!OPERATION_ID.test(opId)) throw apiError('BAD_REQUEST', 'X-Operation-Id must be 8-64 letters, digits, - or _.');
    const state = ops.begin(deviceId, opId);
    if (state.state === 'done') {
      req.resume();
      return web.sendJson(res, 200, state.result);
    }
    if (state.state === 'pending') {
      req.resume();
      throw apiError('RATE_LIMITED', 'This transfer is still in progress. Retry shortly.', { retryAfterMs: 1000 });
    }
    try {
      const result = await work();
      ops.complete(deviceId, opId, result);
      return web.sendJson(res, 201, result);
    } catch (err) {
      ops.fail(deviceId, opId);
      throw err;
    }
  }

  // ---- live events ----------------------------------------------------------

  function broadcast(deviceId, event, data) {
    for (const sse of streams.get(deviceId) || []) sse.send(event, data);
  }
  store.on('add', ({ item, deviceId }) => broadcast(deviceId, 'item-added', item));
  store.on('delete', ({ id, deviceId }) => broadcast(deviceId, 'item-deleted', { id }));
  sessions.on('end', ({ deviceId, reason }) => {
    const set = streams.get(deviceId);
    if (!set) return;
    for (const sse of [...set]) {
      if (reason !== 'disconnected' && reason !== 'shutdown') sse.send('expired', { reason });
      sse.close();
    }
    streams.delete(deviceId);
  });

  // ---- handlers -------------------------------------------------------------

  const hello = (req, res) => web.sendJson(res, 200, { app: 'flashpush', v: 1, laptopId: laptop.id, name: laptop.name });

  async function pairRequest(req, res) {
    const body = await web.readJson(req);
    const out = pairing.request({
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      commit: body.commit,
      remoteIp: web.remoteAddress(req),
      route: routeOf(req),
    });
    web.sendJson(res, 200, out);
  }

  async function pairReveal(req, res) {
    const body = await web.readJson(req);
    web.sendJson(res, 200, pairing.reveal({ requestId: body.requestId, np: body.np }));
  }

  function pairStatus(req, res, { params, url }) {
    const out = pairing.status({
      requestId: params.id,
      deviceId: url.searchParams.get('deviceId'),
      proof: web.headerValue(req, 'x-pair-proof'),
    });
    if (out.state === 'approved') Object.assign(out, { laptop, addresses: addresses() });
    web.sendJson(res, 200, out);
  }

  function connect(req, res) {
    assertNotBlocked(req);
    const credentials = web.deviceCredentials(req);
    if (!credentials) throw fail(req, 'UNAUTHORIZED');
    const { result } = devices.verify(credentials.deviceId, credentials.secret);
    if (result !== 'ok') throw fail(req, result === 'unknown' ? 'DEVICE_NOT_PAIRED' : 'UNAUTHORIZED');
    devices.touch(credentials.deviceId, routeOf(req));
    const session = sessions.create(credentials.deviceId);
    web.sendJson(res, 200, { sessionToken: session.token, expiresAt: session.expiresAt, laptop, addresses: addresses() });
  }

  function disconnect(req, res) {
    const { token } = requireSession(req);
    sessions.endByToken(token, 'disconnected');
    web.sendJson(res, 200, {});
  }

  function forgetSelf(req, res) {
    const { deviceId } = requireSession(req);
    devices.remove(deviceId);
    sessions.endForDevice(deviceId, 'disconnected');
    notify();
    web.sendJson(res, 200, {});
  }

  function listItems(req, res) {
    const { deviceId } = requireSession(req);
    web.sendJson(res, 200, { items: store.list(deviceId) });
  }

  function openEvents(req, res) {
    const { deviceId } = requireSession(req);
    const sse = web.openSse(req, res);
    let set = streams.get(deviceId);
    if (!set) streams.set(deviceId, (set = new Set()));
    while (set.size >= MAX_STREAMS_PER_DEVICE) {
      const oldest = set.values().next().value;
      set.delete(oldest);
      oldest.close();
    }
    set.add(sse);
    sse.onClose(() => set.delete(sse));
  }

  async function sendText(req, res) {
    const { deviceId } = requireSession(req);
    const body = await web.readJson(req, limits.maxTextBytes + 1024);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw apiError('BAD_REQUEST', 'text is required.');
    if (Buffer.byteLength(text) > limits.maxTextBytes) throw apiError('PAYLOAD_TOO_LARGE');
    await withOperation(deviceId, req, res, async () => withoutDevice(store.add({ deviceId, kind: 'text', from: 'phone', text })));
  }

  async function sendFile(req, res) {
    const { deviceId } = requireSession(req);
    let name;
    try {
      name = decodeURIComponent(web.headerValue(req, 'x-filename') || 'file');
    } catch {
      throw apiError('BAD_REQUEST', 'X-Filename is not valid URL-encoding.');
    }
    const length = Number(web.headerValue(req, 'content-length'));
    await withOperation(deviceId, req, res, async () => {
      const saved = await saveUpload({
        stream: req,
        dir: receiveDir,
        name,
        contentLength: Number.isInteger(length) ? length : undefined,
        limits,
      });
      return withoutDevice(store.add({ deviceId, kind: 'file', from: 'phone', name: saved.name, size: saved.size, path: saved.path }));
    });
  }

  function download(req, res, { params, url }) {
    const { deviceId } = requireSession(req);
    const item = store.get(params.id);
    if (!item || item.deviceId !== deviceId || item.kind !== 'file' || !fs.existsSync(item.path)) throw apiError('ITEM_NOT_FOUND');
    const inline = url.searchParams.get('inline') === '1' && isImage(item.mime) && item.mime !== 'image/svg+xml';
    res.writeHead(200, {
      'Content-Type': item.mime,
      'Content-Length': fs.statSync(item.path).size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(item.path).on('error', () => res.destroy()).pipe(res);
  }

  function deleteItem(req, res, { params }) {
    const { deviceId } = requireSession(req);
    const item = store.get(params.id);
    if (item && item.deviceId === deviceId) store.remove(params.id);
    web.sendJson(res, 200, {});
  }

  const route = web.createRouter([
    ['GET', '/v1/hello', hello],
    ['POST', '/v1/pair/request', pairRequest],
    ['POST', '/v1/pair/reveal', pairReveal],
    ['GET', '/v1/pair/status/:id', pairStatus],
    ['POST', '/v1/session', connect],
    ['DELETE', '/v1/session', disconnect],
    ['DELETE', '/v1/devices/self', forgetSelf],
    ['GET', '/v1/items', listItems],
    ['GET', '/v1/events', openEvents],
    ['POST', '/v1/text', sendText],
    ['POST', '/v1/file', sendFile],
    ['GET', '/v1/files/:id', download],
    ['DELETE', '/v1/items/:id', deleteItem],
  ]);

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const match = route(req.method, url.pathname);
      if (!match) throw apiError('NOT_FOUND');
      await match.handler(req, res, { params: match.params, url });
    } catch (err) {
      web.sendError(res, err, log);
    }
  }

  function closeAll() {
    for (const set of streams.values()) for (const sse of [...set]) sse.close();
    streams.clear();
  }

  return { handler, closeAll };
}

module.exports = { createDeviceApi };
```

- [ ] **Step 4: Run to verify they pass** — `cd server && node --test test/deviceApi.pairing.test.js test/deviceApi.data.test.js` → PASS. Then the whole suite: `npm test` → all green. If a test fails because of the plan's code, fix the code (not the assertion) unless the assertion contradicts the Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add server/src/deviceApi.js server/test/deviceApi.pairing.test.js server/test/deviceApi.data.test.js
git commit -m "feat(server): phone-facing /v1 API (pairing, sessions, history, text and file transfer, live events)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Protocol reference and docs

**Files:**
- Create: `docs/protocol.md`
- Modify: `docs/README.md`, `docs/decisions.md`, `CHANGELOG.md`, `docs/superpowers/plans/2026-09-21-v2-plan-index.md`

- [ ] **Step 1: Write `docs/protocol.md`** — the device API reference. For **every** route under `/v1` document: method and path, auth, request (headers/body), success response, error codes, idempotency, max body size. Include the error envelope and the full code table (`BAD_REQUEST 400`, `UNAUTHORIZED 401`, `SESSION_EXPIRED 401`, `DEVICE_NOT_PAIRED 401`, `RATE_LIMITED 429`, `PAIR_NOT_FOUND 404`, `PAIR_EXPIRED 410`, `PAIR_DENIED 403`, `PAIR_LIMIT 429`, `COMMIT_MISMATCH 400`, `PAYLOAD_TOO_LARGE 413`, `INSUFFICIENT_STORAGE 507`, `STORAGE_QUOTA 507`, `ITEM_NOT_FOUND 404`, `NOT_FOUND 404`, `FORBIDDEN 403`, `INTERNAL 500`), the auth schemes (`Device <id>:<secret>`, `Bearer <token>`, `X-Pair-Proof`), the failed-auth rate limit (10/min/IP), `X-Operation-Id` behaviour (`201` first, `200` repeat, `429 Retry-After: 1` while running), upload rules (`Content-Length` required, `X-Filename` URL-encoded), download headers (`nosniff`, inline only for non-SVG images), the SSE events (`item-added`, `item-deleted`, `expired`), the 25 s heartbeat, no replay, max 2 streams. Point to `docs/pairing.md` for the crypto and to `docs/transfers.md` for file rules. The admin API and UDP discovery are added in Plan 1B-ii-b.

- [ ] **Step 2: Update index, decisions, changelog**
  - `docs/README.md`: `[protocol.md](protocol.md) | HTTP API reference (device API; admin API and discovery follow) | written (Plan 1B-ii-a)`.
  - `docs/decisions.md`: a "Plan 1B-ii-a" table: the API is a plain handler so it is tested over plain HTTP and mounted on HTTPS later; `NOT_FOUND`/`FORBIDDEN` added to the error codes; `GET /v1/items` returns `{ "items": [...] }`; a wrong device secret is `UNAUTHORIZED` while an unknown device is `DEVICE_NOT_PAIRED`; SVG is never served inline; a duplicate in-flight operation is `429` + `Retry-After: 1`.
  - `CHANGELOG.md`: a "Built (Plan 1B-ii-a)" entry with the test count.
  - Plan index: split the 1B-ii row into **1B-ii-a** (this plan, done) and **1B-ii-b** (admin API, temporary admin page, `index.js` wiring, HTTPS end-to-end test, `architecture.md`, `security.md`).

- [ ] **Step 3: Verify and commit** — `cd server && npm test` (PASS).

```bash
git add docs CHANGELOG.md
git commit -m "docs: protocol reference for the device API, Plan 1B-ii-a decisions and changelog" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** §3.3 sessions (connect, one per device, disconnect, forget, expiry codes) → Task 4 (`connect`, `disconnect`, `forgetSelf`, `requireSession`); §3.4 blocking + failed-auth limit → `requireSession`/`connect`/`assertNotBlocked`; §4.1 envelope → `sendError`; §4.2 idempotency → `withOperation`; §6.3 SSE (heartbeat, no replay, max 2, expired event) → `openEvents` + `openSse`; §7 upload/download rules → `sendFile`/`download`; §11 route table → the router. Admin API, wiring, TLS and discovery mounting are Plan 1B-ii-b.

**Placeholder scan:** none; Task 5 lists exact doc contents.

**Type consistency:** `store.add` returns the public item with `deviceId`, stripped by `withoutDevice` before it reaches phones and before it is cached by `ops`; `store.list(deviceId)` already omits it; `sessions.on('end')` reasons used here (`disconnected`, `shutdown`, `replaced`, `revoked`, `expired`) match `SessionStore`; the harness passes exactly the dependencies `createDeviceApi` destructures (`notify` and `now` default).
