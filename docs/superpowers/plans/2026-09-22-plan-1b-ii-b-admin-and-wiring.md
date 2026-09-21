# Admin API and Wiring (Plan 1B-ii-b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the server: a loopback-only admin API (approve/deny pairings, manage devices and history, send to a phone), a small temporary admin page so the product is usable, `index.js` that starts everything (HTTPS device API, admin HTTP, UDP discovery), and an end-to-end test over real TLS.

**Architecture:** `adminApi.js` mirrors `deviceApi.js` (a plain handler with the same helpers) plus a guard that only lets same-machine browser traffic through. `index.js` exports `createApp()`, which builds every module, wires their events into one `changed` bus for the admin UI, and exposes `start()`/`stop()`; the CLI entry just calls it. The v1 `server.js`, its web page and the `qrcode` dependency are removed.

**Tech Stack:** Node.js ≥ 22. No new dependencies (`qrcode` is removed).

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §2 (architecture), §3.5 (admin surface), §5.1 (discovery), §11 (routes)

## Global Constraints

- Admin API = HTTP on `127.0.0.1` only. Every request must: come from a loopback address; carry `Host: 127.0.0.1:<adminPort>` or `localhost:<adminPort>` (blocks DNS rebinding); if it has an `Origin` header it must equal `http://<host>`; if it has `Sec-Fetch-Site` it must be `same-origin` or `none`; and every non-GET/HEAD request needs `X-FlashPush-Admin: 1`. Failures are `403 FORBIDDEN`. This is a **browser cross-site defence, not authentication**; malware running as the user can still call it (documented in `docs/security.md`).
- The admin page is served with a strict CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`. The temporary page builds the DOM with `textContent` only (never `innerHTML` with data) and is replaced by the Stitch-designed UI in a later plan.
- Admin routes: `GET /` (page), `GET /admin/ping`, `GET /admin/state`, `GET /admin/events` (SSE `changed`), `POST /admin/pair/:id/approve|deny`, `DELETE /admin/devices/:id`, `POST /admin/text`, `POST /admin/file`, `GET /admin/files/:id`, `DELETE /admin/items/:id`, `POST /admin/history/clear`.
- Sending from the laptop targets one phone: `deviceId` is required when several are paired, implied when exactly one, an error when none.
- Laptop → phone files go to the outbox with the outbox quota enforced; nothing else in the outbox is served except through the item's owner.
- Device API: HTTPS 0.0.0.0, TLS ≥ 1.2, `requestTimeout` disabled for large uploads, `headersTimeout` 30 s. Discovery on UDP. A failed listen stops everything already started and reports the cause (`EADDRINUSE` names the port).
- `stop()` must be idempotent, end all sessions and event streams, close every listener, and leave no timers.
- Branch `feature/server-api-transfers` (checked out). Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Share the file-streaming helper

**Files:**
- Modify: `server/src/http.js`, `server/src/deviceApi.js`
- Test: existing `deviceApi.data.test.js` covers the behaviour; add `server/test/http.test.js` cases.

**Interfaces:**
- Produces: `http.streamFile(res, { path, name, mime }, inline)` and `http.canInline(mime, wanted)` (true only when `wanted` and the type is an image other than SVG).

- [ ] **Step 1: Write the failing test** — append to `server/test/http.test.js`:

```js
test('canInline allows only wanted, non-SVG images', () => {
  assert.equal(web.canInline('image/png', true), true);
  assert.equal(web.canInline('image/png', false), false);
  assert.equal(web.canInline('image/svg+xml', true), false);
  assert.equal(web.canInline('application/pdf', true), false);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/http.test.js` → FAIL (`web.canInline is not a function`).

- [ ] **Step 3: Implement**

In `server/src/http.js` add at the top `const fs = require('node:fs');` and `const { isImage } = require('./mime');`, then add before `module.exports`:

```js
/** Inline display is allowed only for raster images: an SVG can carry script. */
const canInline = (mime, wanted) => Boolean(wanted) && isImage(mime) && mime !== 'image/svg+xml';

function streamFile(res, { path: filePath, name, mime }, inline) {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': fs.statSync(filePath).size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}
```

and add `canInline, streamFile` to the exports. In `server/src/deviceApi.js`, replace the body of `download` after the `ITEM_NOT_FOUND` check with:

```js
    web.streamFile(res, item, web.canInline(item.mime, url.searchParams.get('inline') === '1'));
```

and delete the now unused `isImage` import.

- [ ] **Step 4: Run to verify it passes** — `cd server && npm test` → PASS (the existing download tests still pass).

- [ ] **Step 5: Commit**

```bash
git add server/src/http.js server/src/deviceApi.js server/test/http.test.js
git commit -m "refactor(server): share file streaming and the inline rule between APIs" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Admin API

**Files:**
- Create: `server/src/adminApi.js`, `server/test/helpers/admin.js`
- Test: `server/test/adminApi.test.js`

**Interfaces:**
- Produces `createAdminApi({ identity, devices, sessions, pairing, store, limits, receiveDir, outboxDir, addresses, getPorts, bus, notify, pageHtml, log? }) → { handler, closeAll }`. `bus` is an `EventEmitter` that emits `'changed'`; `getPorts()` returns `{ device, admin, discovery }`.
- Harness `startAdmin(t, limitOverrides?) → { call, events, pairing, devices, sessions, store, bus, adminPort, receiveDir, outboxDir, addPhone(name?) → deviceId }` where `call(method, path, { headers?, json?, body?, host? })` sends the correct `Host` and `X-FlashPush-Admin` header by default.

- [ ] **Step 1: Write the harness** — `server/test/helpers/admin.js`:

```js
'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const c = require('../../src/crypto');
const { DEFAULT_LIMITS } = require('../../src/config');
const { DeviceStore } = require('../../src/devices');
const { SessionStore } = require('../../src/sessions');
const { PairingManager } = require('../../src/pairing');
const { ItemStore } = require('../../src/store');
const { createAdminApi } = require('../../src/adminApi');
const { tmpDir } = require('./tmp');

/** Mounts the real admin API on a loopback HTTP server. */
async function startAdmin(t, limitOverrides = {}) {
  const dir = tmpDir(t);
  const receiveDir = path.join(dir, 'received');
  const outboxDir = path.join(dir, 'outbox');
  fs.mkdirSync(receiveDir);
  fs.mkdirSync(outboxDir);
  const limits = { ...DEFAULT_LIMITS, minFreeDiskBytes: 0, ...limitOverrides };
  const devices = new DeviceStore({ file: path.join(dir, 'devices.json'), limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint: Buffer.alloc(32, 7), limits });
  const store = new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits });
  const bus = new EventEmitter();
  const ports = { device: 8765, admin: 0, discovery: 8766 };
  const api = createAdminApi({
    identity: { laptopId: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' },
    devices,
    sessions,
    pairing,
    store,
    limits,
    receiveDir,
    outboxDir,
    addresses: () => [{ ip: '192.168.1.6', kind: 'lan' }],
    getPorts: () => ({ ...ports }),
    bus,
    notify: () => bus.emit('changed'),
    pageHtml: '<!doctype html><title>test</title>',
    log: () => {},
  });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ports.admin = server.address().port;
  t.after(async () => {
    api.closeAll();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  async function call(method, urlPath, { headers = {}, json, body, host } = {}) {
    const h = { host: host || `127.0.0.1:${ports.admin}`, ...headers };
    if (method !== 'GET' && !('x-flashpush-admin' in h)) h['x-flashpush-admin'] = '1';
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    // node:http (not fetch) so the Host header can be forged in the guard tests; agent:false so no socket is reused after a stop
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ports.admin, method, path: urlPath, headers: h, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          let parsed = null;
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json: parsed, text: buffer.toString('utf8'), buffer });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  /** Opens the admin event stream and resolves the next named event (or null). */
  function events() {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ports.admin, path: '/admin/events', headers: { host: `127.0.0.1:${ports.admin}` }, agent: false }, (res) => {
        let buffer = '';
        const waiters = [];
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const match = /^event: (.*)$/m.exec(block);
            if (match && waiters.length) waiters.shift()(match[1]);
          }
        });
        resolve({
          status: res.statusCode,
          next: (ms = 1500) => new Promise((r) => {
            waiters.push(r);
            setTimeout(() => r(null), ms);
          }),
          close: () => req.destroy(),
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  /** Adds an approved phone directly (the pairing flow itself is covered elsewhere). */
  function addPhone(name = 'Pixel 7') {
    const deviceId = crypto.randomUUID();
    devices.add({ deviceId, name, secret: c.random(32) });
    return deviceId;
  }

  return { call, events, pairing, devices, sessions, store, bus, get adminPort() { return ports.admin; }, receiveDir, outboxDir, addPhone };
}

module.exports = { startAdmin };
```

- [ ] **Step 2: Write the failing test** — `server/test/adminApi.test.js`:

```js
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

test('the admin page is served with a strict CSP and anti-framing headers', async (t) => {
  const env = await startAdmin(t);
  const res = await env.call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
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
```

- [ ] **Step 3: Run to verify it fails** — `cd server && node --test test/adminApi.test.js` → FAIL `Cannot find module '../../src/adminApi'`.

- [ ] **Step 4: Implement** — `server/src/adminApi.js`:

```js
'use strict';

const fs = require('node:fs');
const { apiError } = require('./errors');
const { saveUpload } = require('./transfers');
const { isUuid } = require('./validate');
const web = require('./http');

const LOOPBACK = new Set(['127.0.0.1', '::1']);
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/**
 * The loopback admin API. The guard is a browser cross-site defence, not authentication:
 * anything running as the logged-in user on this laptop can still call it.
 */
function createAdminApi({ identity, devices, sessions, pairing, store, limits, receiveDir, outboxDir, addresses, getPorts, bus, notify, pageHtml, log = console.error }) {
  const streams = new Set();
  const laptop = { id: identity.laptopId, name: identity.name };

  function guard(req) {
    const host = web.headerValue(req, 'host');
    const { admin } = getPorts();
    if (!LOOPBACK.has(web.remoteAddress(req)) || (host !== `127.0.0.1:${admin}` && host !== `localhost:${admin}`)) {
      throw apiError('FORBIDDEN', 'Unexpected Host header.');
    }
    const origin = web.headerValue(req, 'origin');
    if (origin !== undefined && origin !== `http://${host}`) throw apiError('FORBIDDEN', 'Unexpected Origin.');
    const site = web.headerValue(req, 'sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') throw apiError('FORBIDDEN', 'Cross-site requests are not allowed.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && web.headerValue(req, 'x-flashpush-admin') !== '1') {
      throw apiError('FORBIDDEN', 'Missing X-FlashPush-Admin header.');
    }
  }

  /** Which phone a laptop-side send is for. */
  function targetDevice(deviceId) {
    if (deviceId !== undefined && deviceId !== null && deviceId !== '') {
      if (!isUuid(deviceId) || !devices.has(deviceId)) throw apiError('BAD_REQUEST', 'Unknown device.');
      return deviceId;
    }
    const all = devices.list();
    if (all.length === 1) return all[0].deviceId;
    throw apiError('BAD_REQUEST', all.length ? 'deviceId is required when several phones are paired.' : 'No phone is paired yet.');
  }

  const page = (req, res) => {
    res.writeHead(200, { ...PAGE_HEADERS, 'Content-Length': Buffer.byteLength(pageHtml) });
    res.end(pageHtml);
  };

  const ping = (req, res) => web.sendJson(res, 200, { app: 'flashpush-admin', v: 1 });

  const state = (req, res) =>
    web.sendJson(res, 200, {
      laptop,
      addresses: addresses(),
      ports: getPorts(),
      receiveDir,
      pending: pairing.listPending(),
      devices: devices.list().map((d) => ({ ...d, connected: sessions.isConnected(d.deviceId) })),
      items: store.list(),
    });

  function openEvents(req, res) {
    const sse = web.openSse(req, res);
    const onChange = () => sse.send('changed', {});
    bus.on('changed', onChange);
    streams.add(sse);
    sse.onClose(() => {
      bus.off('changed', onChange);
      streams.delete(sse);
    });
  }

  function resolvePairing(action) {
    return (req, res, { params }) => {
      pairing[action](params.id);
      web.sendJson(res, 200, {});
    };
  }

  function revoke(req, res, { params }) {
    if (!isUuid(params.id)) throw apiError('BAD_REQUEST', 'Invalid device id.');
    const existed = devices.remove(params.id);
    sessions.endForDevice(params.id, 'revoked');
    if (!existed) throw apiError('NOT_FOUND');
    notify();
    web.sendJson(res, 200, {});
  }

  async function sendText(req, res) {
    const body = await web.readJson(req, limits.maxTextBytes + 1024);
    const deviceId = targetDevice(body.deviceId);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw apiError('BAD_REQUEST', 'text is required.');
    if (Buffer.byteLength(text) > limits.maxTextBytes) throw apiError('PAYLOAD_TOO_LARGE');
    web.sendJson(res, 201, store.add({ deviceId, kind: 'text', from: 'laptop', text }));
  }

  async function sendFile(req, res) {
    const deviceId = targetDevice(web.headerValue(req, 'x-device-id'));
    let name;
    try {
      name = decodeURIComponent(web.headerValue(req, 'x-filename') || 'file');
    } catch {
      throw apiError('BAD_REQUEST', 'X-Filename is not valid URL-encoding.');
    }
    const length = Number(web.headerValue(req, 'content-length'));
    const saved = await saveUpload({
      stream: req,
      dir: outboxDir,
      name,
      contentLength: Number.isInteger(length) ? length : undefined,
      limits,
      usedBytes: store.outboxBytes(),
      checkQuota: true,
    });
    web.sendJson(res, 201, store.add({ deviceId, kind: 'file', from: 'laptop', name: saved.name, size: saved.size, path: saved.path }));
  }

  function download(req, res, { params, url }) {
    const item = store.get(params.id);
    if (!item || item.kind !== 'file' || !fs.existsSync(item.path)) throw apiError('ITEM_NOT_FOUND');
    web.streamFile(res, item, web.canInline(item.mime, url.searchParams.get('inline') === '1'));
  }

  function deleteItem(req, res, { params }) {
    store.remove(params.id);
    web.sendJson(res, 200, {});
  }

  async function clearHistory(req, res) {
    const body = await web.readJson(req);
    const deviceId = body.deviceId === undefined ? undefined : targetDevice(body.deviceId);
    web.sendJson(res, 200, { removed: store.clear(deviceId) });
  }

  const route = web.createRouter([
    ['GET', '/', page],
    ['GET', '/admin/ping', ping],
    ['GET', '/admin/state', state],
    ['GET', '/admin/events', openEvents],
    ['POST', '/admin/pair/:id/approve', resolvePairing('approve')],
    ['POST', '/admin/pair/:id/deny', resolvePairing('deny')],
    ['DELETE', '/admin/devices/:id', revoke],
    ['POST', '/admin/text', sendText],
    ['POST', '/admin/file', sendFile],
    ['GET', '/admin/files/:id', download],
    ['DELETE', '/admin/items/:id', deleteItem],
    ['POST', '/admin/history/clear', clearHistory],
  ]);

  async function handler(req, res) {
    try {
      guard(req);
      const url = new URL(req.url, 'http://localhost');
      const match = route(req.method, url.pathname);
      if (!match) throw apiError('NOT_FOUND');
      await match.handler(req, res, { params: match.params, url });
    } catch (err) {
      web.sendError(res, err, log);
    }
  }

  function closeAll() {
    for (const sse of [...streams]) sse.close();
  }

  return { handler, closeAll };
}

module.exports = { createAdminApi };
```

- [ ] **Step 5: Run to verify it passes** — `cd server && node --test test/adminApi.test.js` → PASS; then `npm test` → all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/adminApi.js server/test/adminApi.test.js server/test/helpers/admin.js
git commit -m "feat(server): loopback admin API with browser cross-site guard" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wiring (`index.js`) and the temporary admin page

**Files:**
- Create: `server/src/index.js`, `server/public/admin.html`
- Delete: `server/server.js`, `server/public/index.html`
- Modify: `server/package.json` (`main`/`start` → `src/index.js`, remove `qrcode`)

**Interfaces:**
- Produces `createApp({ home?, overrides?, log? }) → Promise<{ start(), stop(), ports(), config, identity, fingerprint, devices, sessions, pairing, store }>`. `start()` resolves to `{ device, admin, discovery }` (the bound ports) and, if anything fails to listen, stops what it started and rethrows. `stop()` is idempotent.

- [ ] **Step 1: Implement `server/src/index.js`**:

```js
'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { loadConfig } = require('./config');
const { loadIdentity } = require('./identity');
const { loadOrCreateTls } = require('./tls');
const { DeviceStore } = require('./devices');
const { SessionStore } = require('./sessions');
const { PairingManager } = require('./pairing');
const { ItemStore } = require('./store');
const { OperationCache } = require('./idempotency');
const { sweepPartFiles } = require('./transfers');
const { listAddresses } = require('./addresses');
const { createDiscovery } = require('./discovery');
const { createDeviceApi } = require('./deviceApi');
const { createAdminApi } = require('./adminApi');

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

const closeServer = (server) =>
  new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
    server.closeAllConnections();
  });

/** Builds every module, wires their events together, and returns start/stop. */
async function createApp({ home, overrides = {}, log = console.log } = {}) {
  const config = loadConfig({ home, overrides });
  for (const dir of [config.home, config.paths.outbox, config.receiveDir]) fs.mkdirSync(dir, { recursive: true });
  const stale = sweepPartFiles(config.receiveDir) + sweepPartFiles(config.paths.outbox);
  if (stale) log(`Removed ${stale} unfinished upload(s) left by a previous run.`);

  const identity = loadIdentity(config.paths);
  const tls = await loadOrCreateTls(config.paths);
  if (tls.regenerated) log('A new certificate was created. Phones paired before this must pair again.');

  const { limits } = config;
  const devices = new DeviceStore({ file: config.paths.devices, limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint: tls.fingerprint, limits });
  const store = new ItemStore({ file: config.paths.items, outboxDir: config.paths.outbox, limits });
  const ops = new OperationCache({ max: limits.idempotencyMaxEntries, ttlMs: limits.idempotencyTtlMs });

  // One 'changed' signal tells the admin UI to refresh; a re-pair also ends the device's old session.
  const bus = new EventEmitter();
  const changed = () => bus.emit('changed');
  pairing.on('device-replaced', ({ deviceId }) => sessions.endForDevice(deviceId, 'revoked'));
  for (const [emitter, names] of [[pairing, ['pending', 'resolved']], [sessions, ['start', 'end']], [store, ['add', 'delete']]]) {
    for (const name of names) emitter.on(name, changed);
  }

  const bound = { device: 0, admin: 0, discovery: 0 };
  const ports = () => ({ ...bound });
  const deviceApi = createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir: config.receiveDir, addresses: listAddresses, notify: changed });
  const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const adminApi = createAdminApi({
    identity, devices, sessions, pairing, store, limits,
    receiveDir: config.receiveDir, outboxDir: config.paths.outbox,
    addresses: listAddresses, getPorts: ports, bus, notify: changed, pageHtml,
  });

  const deviceServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, deviceApi.handler);
  deviceServer.requestTimeout = 0; // large uploads over Wi-Fi can take a long time
  deviceServer.headersTimeout = 30_000;
  const adminServer = http.createServer(adminApi.handler);
  let discovery = null;
  const timers = [];
  let stopped = false;

  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    sessions.endAll('shutdown');
    deviceApi.closeAll();
    adminApi.closeAll();
    await Promise.all([closeServer(deviceServer), closeServer(adminServer), discovery ? discovery.stop() : null]);
  }

  async function start() {
    try {
      bound.device = await listen(deviceServer, config.ports.device, '0.0.0.0');
      bound.admin = await listen(adminServer, config.ports.admin, '127.0.0.1');
      discovery = createDiscovery({ identity, devicePort: bound.device });
      bound.discovery = await discovery.start({ port: config.ports.discovery });
    } catch (err) {
      await stop();
      throw err;
    }
    timers.push(setInterval(() => pairing.sweep(), 10_000).unref());
    return ports();
  }

  return { start, stop, ports, config, identity, fingerprint: tls.fingerprint, devices, sessions, pairing, store };
}

function explain(err, config) {
  if (err.code === 'EADDRINUSE') {
    return `Port ${err.port} is already in use by another program. Set another in ${config.paths.config} (for example {"ports":{"device":9000}}).`;
  }
  return err.message;
}

async function main() {
  const app = await createApp();
  try {
    await app.start();
  } catch (err) {
    console.error(`FlashPush could not start: ${explain(err, app.config)}`);
    process.exit(1);
  }
  const p = app.ports();
  console.log(`FlashPush is running.
  Admin page (this laptop only): http://127.0.0.1:${p.admin}
  Phones connect over HTTPS on port ${p.device}; discovery listens on UDP ${p.discovery}
  Received files are saved to: ${app.config.receiveDir}`);
  const shutdown = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };
```

- [ ] **Step 2: Write the temporary admin page** — `server/public/admin.html` (replaced by the Stitch-designed UI in a later plan; DOM is built with `textContent` only):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlashPush</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #030c1e; color: #e6eefc; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 16px; }
  h1 { margin: 0 0 4px; font-size: 22px; } h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #8fb2e8; }
  section { background: #112b58; border-radius: 12px; padding: 16px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
  .grow { flex: 1; } .muted { color: #8fb2e8; font-size: 13px; } .code { font: 700 28px ui-monospace, monospace; letter-spacing: .12em; color: #47fce3; }
  button, input, select, textarea { font: inherit; border-radius: 8px; border: 1px solid #1ca2fd; background: #030c1e; color: inherit; padding: 6px 12px; }
  button { cursor: pointer; background: #0346f4; border-color: #0346f4; } button.danger { background: transparent; border-color: #ff6b6b; color: #ff6b6b; }
  textarea { width: 100%; box-sizing: border-box; }
</style>
</head>
<body>
<main>
  <div><h1 id="title">FlashPush</h1><div class="muted" id="sub"></div></div>
  <section><h2>Pairing requests</h2><div id="pending"></div></section>
  <section><h2>Paired phones</h2><div id="devices"></div></section>
  <section><h2>Send to a phone</h2>
    <div class="row"><select id="target"></select><input type="file" id="file"><button id="sendFile">Send file</button></div>
    <textarea id="text" rows="3" placeholder="Text or a link"></textarea>
    <div class="row"><button id="sendText">Send text</button></div>
  </section>
  <section><h2>History</h2><div id="items"></div><div class="row"><button class="danger" id="clear">Clear history</button></div></section>
</main>
<script>
const H = { 'X-FlashPush-Admin': '1' };
const $ = (id) => document.getElementById(id);
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  Object.assign(node, props || {});
  for (const kid of kids) node.append(kid);
  return node;
}
async function api(method, path, body, headers) {
  const opts = { method, headers: { ...H, ...(headers || {}) } };
  if (body !== undefined && !(body instanceof Blob)) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  else if (body instanceof Blob) opts.body = body;
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) alert((data.error && data.error.message) || 'Something went wrong');
  return data;
}
function button(label, onClick, cls) { const b = el('button', { textContent: label, className: cls || '' }); b.onclick = onClick; return b; }
function render(s) {
  $('sub').textContent = s.laptop.name + ' · ' + s.addresses.map((a) => a.ip + ' (' + a.kind + ')').join(', ') + ' · port ' + s.ports.device;
  const pending = $('pending'); pending.replaceChildren();
  if (!s.pending.length) pending.append(el('div', { className: 'muted', textContent: 'No phone is asking to connect.' }));
  for (const p of s.pending) {
    pending.append(el('div', { className: 'row' },
      el('span', { className: 'code', textContent: p.sasDisplay }),
      el('span', { className: 'grow', textContent: p.deviceName + (p.isRepair ? ' (re-pair)' : '') + ' · ' + p.remoteIp + ' · ' + p.route }),
      button('Approve', () => api('POST', '/admin/pair/' + p.requestId + '/approve')),
      button('Deny', () => api('POST', '/admin/pair/' + p.requestId + '/deny'), 'danger')));
  }
  const devices = $('devices'); devices.replaceChildren();
  const target = $('target'); target.replaceChildren();
  if (!s.devices.length) devices.append(el('div', { className: 'muted', textContent: 'No phones paired yet.' }));
  for (const d of s.devices) {
    devices.append(el('div', { className: 'row' },
      el('span', { className: 'grow', textContent: d.name + (d.connected ? ' · connected' : ' · not connected') + (d.lastRoute ? ' · ' + d.lastRoute : '') }),
      button('Revoke', () => { if (confirm('Revoke ' + d.name + '?')) api('DELETE', '/admin/devices/' + d.deviceId); }, 'danger')));
    target.append(el('option', { value: d.deviceId, textContent: d.name }));
  }
  const items = $('items'); items.replaceChildren();
  if (!s.items.length) items.append(el('div', { className: 'muted', textContent: 'Nothing yet.' }));
  for (const it of s.items.slice().reverse()) {
    const who = (s.devices.find((d) => d.deviceId === it.deviceId) || { name: 'phone' }).name;
    const row = el('div', { className: 'row' }, el('span', { className: 'muted', textContent: (it.from === 'phone' ? 'from ' : 'to ') + who }),
      el('span', { className: 'grow', textContent: it.kind === 'text' ? it.text : it.name + ' (' + it.size + ' bytes)' }));
    if (it.kind === 'file') row.append(el('a', { href: '/admin/files/' + it.id, textContent: 'Download' }));
    row.append(button('Delete', () => api('DELETE', '/admin/items/' + it.id), 'danger'));
    items.append(row);
  }
}
async function refresh() { render(await (await fetch('/admin/state')).json()); }
$('sendText').onclick = async () => { const text = $('text').value; if (!text.trim()) return; await api('POST', '/admin/text', { deviceId: $('target').value || undefined, text }); $('text').value = ''; };
$('sendFile').onclick = async () => { const f = $('file').files[0]; if (!f) return; await api('POST', '/admin/file', f, { 'X-Filename': encodeURIComponent(f.name), 'X-Device-Id': $('target').value }); $('file').value = ''; };
$('clear').onclick = () => { if (confirm('Clear all history?')) api('POST', '/admin/history/clear', {}); };
new EventSource('/admin/events').addEventListener('changed', refresh);
refresh();
</script>
</body>
</html>
```

- [ ] **Step 3: Remove v1 and repoint the scripts**

```bash
git rm server/server.js server/public/index.html
cd server && npm uninstall qrcode
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.main='src/index.js';p.scripts.start='node src/index.js';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
```

- [ ] **Step 4: Smoke-run it** — `cd server && FLASHPUSH_HOME=$TEMP/fp-smoke node src/index.js` prints the admin URL; `curl -s http://127.0.0.1:<adminPort>/admin/ping` returns `{"app":"flashpush-admin","v":1}`; Ctrl+C exits cleanly. (Fully covered by Task 4.)

- [ ] **Step 5: Commit**

```bash
git add server/src/index.js server/public/admin.html server/package.json server/package-lock.json
git commit -m "feat(server): wire HTTPS device API, admin API and discovery; temporary admin page; remove v1 server" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: End-to-end test over real TLS

**Files:**
- Create: `server/test/helpers/tls-client.js`
- Test: `server/test/e2e.test.js`

**Interfaces:**
- Produces: `tlsRequest(port, method, path, { headers?, body? }) → { status, headers, json, text, buffer, fingerprint }` (`fingerprint` = SHA-256 of the certificate the server presented) and `adminRequest(port, method, path, { headers?, body?, json? }) → { status, headers, json, text }` (correct Host and `X-FlashPush-Admin`).

- [ ] **Step 1: Write the helper** — `server/test/helpers/tls-client.js`:

```js
'use strict';

const http = require('node:http');
const https = require('node:https');
const { fingerprintOfDer } = require('../../src/tls');

function collect(res, resolve, extra = {}) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    let json = null;
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      /* not JSON */
    }
    resolve({ status: res.statusCode, headers: res.headers, json, text: buffer.toString('utf8'), buffer, ...extra });
  });
}

/** What the phone does: TLS to the laptop, remembering which certificate it was shown (to pin it). */
function tlsRequest(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method, path, headers, rejectUnauthorized: false, agent: false }, (res) => {
      const fingerprint = fingerprintOfDer(res.socket.getPeerCertificate(true).raw);
      collect(res, resolve, { fingerprint });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function adminRequest(port, method, path, { headers = {}, body, json } = {}) {
  const h = { host: `127.0.0.1:${port}`, ...headers };
  if (method !== 'GET') h['x-flashpush-admin'] = '1';
  let payload = body;
  if (json !== undefined) {
    payload = JSON.stringify(json);
    h['content-type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h, agent: false }, (res) => collect(res, resolve));
    req.on('error', reject);
    req.end(payload);
  });
}

module.exports = { tlsRequest, adminRequest };
```

- [ ] **Step 2: Write the test** — `server/test/e2e.test.js`:

```js
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
    overrides: { ports: { device: 0, admin: 0, discovery: 0 }, receiveDir, limits: { minFreeDiskBytes: 0, ...limits } },
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
    overrides: { ports: { device: first.ports.device, admin: 0, discovery: 0 }, receiveDir: path.join(tmpDir(t), 'r') },
    log: () => {},
  });
  await assert.rejects(app.start(), (e) => e.code === 'EADDRINUSE');
});
```

- [ ] **Step 3: Run** — `cd server && node --test test/e2e.test.js` → PASS; then `npm test` → all green with no hanging handles (the process exits by itself).

- [ ] **Step 4: Commit**

```bash
git add server/test/helpers/tls-client.js server/test/e2e.test.js
git commit -m "test(server): end-to-end over real TLS (pair, transfer, revoke, restart, discovery, stop)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Architecture and security documents, README

**Files:**
- Create: `docs/architecture.md`, `docs/security.md`
- Modify: `docs/protocol.md` (append the admin API and discovery), `README.md`, `docs/README.md`, `docs/decisions.md`, `CHANGELOG.md`, `docs/superpowers/plans/2026-09-21-v2-plan-index.md`, `server/README.md` (create)

- [ ] **Step 1: Write `docs/architecture.md`** — the three listeners (table from spec §2), the module map (one line per file in `server/src/`), the start-up sequence in `index.js` (`createApp` → sweep `.part` → identity → certificate → stores → wiring → `start()` listening order), the `changed` bus, where state lives (`%APPDATA%\FlashPush`: `identity.json`, `key.pem`, `cert.pem`, `devices.json`, `items.json`, `outbox\`, optional `config.json` for ports and receive folder), how a request flows (TLS → `deviceApi.handler` → router → `requireSession` → store), and the shutdown order.

- [ ] **Step 2: Write `docs/security.md`** — assets and trust boundaries; the threat table from spec §3.6 updated to what is built; TLS and certificate pinning; pairing (link to `pairing.md`); secret storage (hash only); sessions (one per device, 24 h idle / 7 d absolute); rate limits (10 failed auths/min/IP, 5 pair requests/min/IP, 3 open pairings, 20 devices, discovery 20/10 s); the admin guard and **its limits** (browser cross-site defence, not authentication; malware running as the user is out of scope; state files are readable by that user); path safety and upload rules (link to `transfers.md`); headers (`nosniff`, CSP, `X-Frame-Options`, no inline SVG); what is **not** protected (traffic metadata, a user who approves a wrong code, someone with local access to the laptop account); a review checklist for every new route (auth, error code, body limit, rate limit, ownership check, no path from client, no secrets in logs).

- [ ] **Step 3: Extend `docs/protocol.md`** with the admin API table (each route: method, path, body, response, errors) and the UDP discovery messages (`FLASHPUSH_DISCOVER` / `FLASHPUSH_HERE`, 512-byte limit, 20 probes per 10 s per source, hint only).

- [ ] **Step 4: `server/README.md` and root README** — `server/README.md`: requirements (Node ≥ 22), `npm install`, `npm start`, `npm test`, the state folder, ports, `config.json` example, firewall note (allow Node on private networks; Tailscale rule comes with the Windows shell plan). Root `README.md`: replace the "Try the v1 prototype" section with the v2 server instructions and mark the Android app as still v1 until its plan lands.

- [ ] **Step 5: Index, decisions, changelog, plan index** — `docs/README.md` rows for `architecture.md`, `security.md`; decisions table for this plan (guard = Host + Origin + Sec-Fetch-Site + header + loopback; strict CSP with `'unsafe-inline'` only because the temporary page is inline; `createApp` returns start/stop so tests use ephemeral ports; v1 removed; sending from the laptop needs a target phone); changelog "Built (Plan 1B-ii-b)" with the final test count; plan index row 1B-ii-b → done.

- [ ] **Step 6: Verify and commit** — `cd server && npm test` (PASS).

```bash
git add docs README.md server/README.md CHANGELOG.md
git commit -m "docs: architecture, security, admin API and discovery protocol, server README" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** §3.5 admin surface (loopback, Host, Origin, header, Sec-Fetch-Site, CSP; documented as not authentication) → Task 2 + Task 5; §2 three listeners + module wiring → Task 3; §5.1 discovery mounted on the real port → Task 3/4; §11 admin route list → Task 2; graceful stop and port-in-use reporting (lifecycle basics; the tray and degraded state are Plan 5) → Task 3/4; v1 removal (spec §16) → Task 3. Autostart, tray, notifications, the Stitch-based UI and the Android app are separate plans.

**Placeholder scan:** none; Task 5 lists exact contents for each document.

**Type consistency:** `createAdminApi` receives the same store/pairing/sessions/devices objects as the device API; `getPorts()` returns `{ device, admin, discovery }` everywhere (`createApp.ports`, harness, guard); `store.add` returns the public item **with** `deviceId` for admin responses and `state.items`; `bus` emits only `'changed'`; the admin harness and `createApp` use identical option names (`receiveDir`, `outboxDir`, `notify`, `pageHtml`).
