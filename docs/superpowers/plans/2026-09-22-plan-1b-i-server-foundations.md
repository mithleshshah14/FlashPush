# Server Foundations (Plan 1B-i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four building blocks the HTTPS/admin API (Plan 1B-ii) needs: address classification, the per-phone history store, safe streamed file transfers, and the UDP discovery responder. No HTTP yet.

**Architecture:** Same style as Plan 1A: small CommonJS modules under `server/src/`, no HTTP dependency, injectable time/disk so every rule is testable. Nothing here touches the v1 `server.js`.

**Tech Stack:** Node.js ≥ 22 (`node:test`, `node:dgram`, `node:stream`, `fs.statfs`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §5.1–5.2 (discovery, addresses), §7 (files, storage, retention, items belong to one phone)

## Global Constraints

- Builds on Plan 1A (merged in `develop`): uses `errors.apiError`, `config.DEFAULT_LIMITS`, `ratelimit.createLimiter`, the test helpers in `server/test/helpers/`.
- Limits (constants in `config.js`): single file 2 GiB (`maxFileBytes`), history 500 (`maxHistory`), outbox 5 GiB (`maxOutboxBytes`), min free disk after write 512 MB (`minFreeDiskBytes`), file name ≤ 200 characters (`maxFilenameLength`).
- Never trust a client path: only a sanitized basename is ever used; the resolved path must stay inside the target folder; files are created exclusively (`wx`).
- Uploads are written to `<name>.<random>.part` in the target folder and renamed on completion; `.part` files never survive a failed upload.
- Received files (phone → laptop, in the user's Downloads folder) are **never deleted** by pruning or deleting a history entry; only outbox files (laptop → phone) are.
- Items belong to one phone (`deviceId`); public views never expose `deviceId` or the disk `path`.
- Discovery is a hint only: reply `{"t":"FLASHPUSH_HERE","v":1,"laptopId","name","port"}` to `{"t":"FLASHPUSH_DISCOVER","v":1}`; identity is decided later by TLS pinning and SAS.
- Branch: `feature/server-api-transfers` (already created from `develop`; the spec update is its first commit). Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Don't type `\u2028`/`\u2029` escapes in regex literals (Plan 1A found they break when decoded); use `\x00-\x1f` style classes.

---

### Task 1: Address classification

**Files:**
- Create: `server/src/addresses.js`
- Test: `server/test/addresses.test.js`

**Interfaces:**
- Produces: `classifyIp(ip, interfaceName = '') → 'lan' | 'tailscale' | 'other'`; `listAddresses(interfaces = os.networkInterfaces()) → [{ ip, kind }]` (IPv4 only, no loopback, no `169.254.x.x`, sorted lan → tailscale → other)

- [ ] **Step 1: Write the failing test** — `server/test/addresses.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIp, listAddresses } = require('../src/addresses');

test('private ranges are lan', () => {
  for (const ip of ['192.168.1.6', '10.1.2.3', '172.16.0.1', '172.31.255.255']) assert.equal(classifyIp(ip), 'lan', ip);
});

test('172.x outside 16-31 is not lan', () => {
  assert.equal(classifyIp('172.15.0.1'), 'other');
  assert.equal(classifyIp('172.32.0.1'), 'other');
});

test('100.64.0.0/10 is tailscale, its neighbours are not', () => {
  assert.equal(classifyIp('100.101.102.103'), 'tailscale');
  assert.equal(classifyIp('100.64.0.1'), 'tailscale');
  assert.equal(classifyIp('100.127.255.255'), 'tailscale');
  assert.equal(classifyIp('100.63.255.255'), 'other');
  assert.equal(classifyIp('100.128.0.0'), 'other');
});

test('an interface named like tailscale wins over the address range', () => {
  assert.equal(classifyIp('192.168.5.5', 'Tailscale'), 'tailscale');
});

test('IPv4-mapped IPv6 is unwrapped, garbage is other', () => {
  assert.equal(classifyIp('::ffff:192.168.1.6'), 'lan');
  assert.equal(classifyIp('8.8.8.8'), 'other');
  assert.equal(classifyIp('garbage'), 'other');
  assert.equal(classifyIp('1..2.3'), 'other');
  assert.equal(classifyIp('256.1.1.1'), 'other');
});

test('listAddresses drops loopback, link-local and IPv6, and sorts lan, tailscale, other', () => {
  const nic = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
  const result = listAddresses({
    Loopback: [nic('127.0.0.1', { internal: true })],
    Tailscale: [nic('100.101.102.103')],
    'Wi-Fi': [nic('192.168.1.6'), { address: 'fe80::1', family: 'IPv6', internal: false }],
    Ethernet: [nic('169.254.83.107'), nic('8.8.4.4')],
  });
  assert.deepEqual(result, [
    { ip: '192.168.1.6', kind: 'lan' },
    { ip: '100.101.102.103', kind: 'tailscale' },
    { ip: '8.8.4.4', kind: 'other' },
  ]);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/addresses.test.js` → FAIL `Cannot find module '../src/addresses'`.

- [ ] **Step 3: Implement** — `server/src/addresses.js`:

```js
'use strict';

const os = require('node:os');

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function ipv4ToInt(ip) {
  if (!IPV4.test(ip)) return null;
  const parts = ip.split('.').map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/** 'lan' (private ranges), 'tailscale' (100.64.0.0/10 or a tailscale-named interface), otherwise 'other'. */
function classifyIp(ip, interfaceName = '') {
  const n = ipv4ToInt(String(ip).replace(/^::ffff:/, ''));
  if (n === null) return 'other';
  if (inCidr(n, '100.64.0.0', 10) || /tailscale/i.test(interfaceName)) return 'tailscale';
  if (inCidr(n, '192.168.0.0', 16) || inCidr(n, '10.0.0.0', 8) || inCidr(n, '172.16.0.0', 12)) return 'lan';
  return 'other';
}

/** The laptop's usable IPv4 addresses, best first. */
function listAddresses(interfaces = os.networkInterfaces()) {
  const rank = { lan: 0, tailscale: 1, other: 2 };
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const nic of list || []) {
      if (nic.family !== 'IPv4' || nic.internal || nic.address.startsWith('169.254.')) continue;
      found.push({ ip: nic.address, kind: classifyIp(nic.address, name) });
    }
  }
  return found.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

module.exports = { classifyIp, listAddresses };
```

- [ ] **Step 4: Run to verify it passes** — `cd server && node --test test/addresses.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/addresses.js server/test/addresses.test.js
git commit -m "feat(server): classify laptop addresses (lan / tailscale / other)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: MIME types and the per-phone history store

**Files:**
- Create: `server/src/mime.js`, `server/src/store.js`
- Test: `server/test/mime.test.js`, `server/test/store.test.js`

**Interfaces:**
- Produces:
  - `mime.mimeFromName(name) → string` (`'application/octet-stream'` when unknown); `mime.isImage(mime) → boolean`
  - `class ItemStore extends EventEmitter ({ file, outboxDir, limits, now? })`:
    - `add({ deviceId, kind:'text'|'file', from:'phone'|'laptop', text?, name?, size?, path? }) → publicItemWithDevice` (assigns `id`, `time`, and `mime` for files; prunes past `maxHistory`)
    - `list(deviceId?) → publicItem[]` oldest first (`deviceId` omitted → all, each with `deviceId`)
    - `get(id) → fullItem | null` (includes `path`; for the API layer only)
    - `remove(id) → boolean`, `clear(deviceId?) → number`, `outboxBytes() → number`
    - `publicItem = { id, kind, from, time, text?, name?, size?, mime? }`
    - events: `'add'` (`{ item, deviceId }`), `'delete'` (`{ id, deviceId }`)

- [ ] **Step 1: Write the failing tests**

`server/test/mime.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mimeFromName, isImage } = require('../src/mime');

test('known extensions map to types, case-insensitively', () => {
  assert.equal(mimeFromName('photo.JPG'), 'image/jpeg');
  assert.equal(mimeFromName('a.png'), 'image/png');
  assert.equal(mimeFromName('doc.pdf'), 'application/pdf');
  assert.equal(mimeFromName('notes.txt'), 'text/plain; charset=utf-8');
});

test('unknown or missing extensions are octet-stream', () => {
  assert.equal(mimeFromName('archive.xyz'), 'application/octet-stream');
  assert.equal(mimeFromName('noext'), 'application/octet-stream');
});

test('isImage is true only for image/* types', () => {
  assert.equal(isImage('image/webp'), true);
  assert.equal(isImage('application/pdf'), false);
});
```

`server/test/store.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ItemStore } = require('../src/store');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function setup(t, limits = {}) {
  const dir = tmpDir(t);
  const outboxDir = path.join(dir, 'outbox');
  const receiveDir = path.join(dir, 'received');
  fs.mkdirSync(outboxDir);
  fs.mkdirSync(receiveDir);
  const clock = createClock();
  const make = () =>
    new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits: { ...DEFAULT_LIMITS, ...limits }, now: clock.now });
  const file = (folder, name, content = 'x') => {
    const p = path.join(folder, name);
    fs.writeFileSync(p, content);
    return p;
  };
  return { make, store: make(), clock, outboxDir, receiveDir, file, dir };
}

test('a phone only sees its own items, oldest first, without deviceId or path', (t) => {
  const { store, clock } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'one' });
  clock.advance(1000);
  store.add({ deviceId: B, kind: 'text', from: 'phone', text: 'other phone' });
  clock.advance(1000);
  store.add({ deviceId: A, kind: 'text', from: 'laptop', text: 'two' });
  const items = store.list(A);
  assert.deepEqual(items.map((i) => i.text), ['one', 'two']);
  for (const item of items) {
    assert.equal('deviceId' in item, false);
    assert.equal('path' in item, false);
  }
  assert.equal(store.list().length, 3);
  assert.equal(store.list()[1].deviceId, B); // the all-items view (admin) includes deviceId
});

test('file items get a mime type from the name', (t) => {
  const { store, receiveDir, file } = setup(t);
  const item = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'pic.png', size: 1, path: file(receiveDir, 'pic.png') });
  assert.equal(item.mime, 'image/png');
  assert.equal(store.list(A)[0].mime, 'image/png');
});

test('get returns the full record including the disk path', (t) => {
  const { store, receiveDir, file } = setup(t);
  const p = file(receiveDir, 'a.txt');
  const item = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'a.txt', size: 1, path: p });
  assert.equal(store.get(item.id).path, p);
  assert.equal(store.get('nope'), null);
});

test('remove deletes an outbox file but never a received file', (t) => {
  const { store, outboxDir, receiveDir, file } = setup(t);
  const out = file(outboxDir, 'to-phone.txt');
  const recv = file(receiveDir, 'from-phone.txt');
  const o = store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'to-phone.txt', size: 1, path: out });
  const r = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'from-phone.txt', size: 1, path: recv });
  assert.equal(store.remove(o.id), true);
  assert.equal(store.remove(r.id), true);
  assert.equal(store.remove(r.id), false);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(recv), true);
});

test('history is capped: the oldest entry is pruned with the same file rules', (t) => {
  const { store, outboxDir, file } = setup(t, { maxHistory: 2 });
  const p = file(outboxDir, 'old.txt');
  store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'old.txt', size: 1, path: p });
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'b' });
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'c' });
  assert.deepEqual(store.list(A).map((i) => i.text), ['b', 'c']);
  assert.equal(fs.existsSync(p), false);
});

test('clear removes one phone\'s history or everything', (t) => {
  const { store } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'a' });
  store.add({ deviceId: B, kind: 'text', from: 'phone', text: 'b' });
  assert.equal(store.clear(A), 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.clear(), 1);
  assert.equal(store.list().length, 0);
});

test('outboxBytes sums laptop-to-phone file sizes only', (t) => {
  const { store, outboxDir, receiveDir, file } = setup(t);
  store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'a', size: 100, path: file(outboxDir, 'a') });
  store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'b', size: 999, path: file(receiveDir, 'b') });
  store.add({ deviceId: A, kind: 'text', from: 'laptop', text: 'hi' });
  assert.equal(store.outboxBytes(), 100);
});

test('items persist across restarts; file entries whose file vanished are dropped', (t) => {
  const { store, make, receiveDir, file } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'kept' });
  const p = file(receiveDir, 'gone.txt');
  store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'gone.txt', size: 1, path: p });
  fs.rmSync(p);
  assert.deepEqual(make().list(A).map((i) => i.text), ['kept']);
});

test('add and delete emit events carrying the owning device', (t) => {
  const { store } = setup(t);
  const events = [];
  store.on('add', (e) => events.push(['add', e.deviceId, e.item.text]));
  store.on('delete', (e) => events.push(['delete', e.deviceId]));
  const item = store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'hi' });
  store.remove(item.id);
  assert.deepEqual(events, [['add', A, 'hi'], ['delete', A]]);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd server && node --test test/mime.test.js test/store.test.js` → FAIL `Cannot find module`.

- [ ] **Step 3: Implement**

`server/src/mime.js`:

```js
'use strict';

const path = require('node:path');

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

function mimeFromName(name) {
  return TYPES[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function isImage(mime) {
  return String(mime).startsWith('image/');
}

module.exports = { mimeFromName, isImage };
```

`server/src/store.js`:

```js
'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('./fsutil');
const { mimeFromName } = require('./mime');

function isInside(dir, target) {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function publicItem(item, withDevice) {
  const { id, kind, from, time, text, name, size, mime } = item;
  const view = { id, kind, from, time };
  if (kind === 'text') view.text = text;
  else Object.assign(view, { name, size, mime });
  if (withDevice) view.deviceId = item.deviceId;
  return view;
}

/** Shared history, but every entry belongs to one phone (`deviceId`). */
class ItemStore extends EventEmitter {
  constructor({ file, outboxDir, limits, now = Date.now }) {
    super();
    this.file = file;
    this.outboxDir = outboxDir;
    this.limits = limits;
    this.now = now;
    const saved = readJson(file, []);
    this.items = saved.filter((it) => it.kind === 'text' || (it.path && fs.existsSync(it.path)));
  }

  _save() {
    writeJsonAtomic(this.file, this.items);
  }

  /** Only laptop-to-phone files live in the outbox; received files stay in the user's folder. */
  _dispose(item) {
    if (item.kind === 'file' && item.path && isInside(this.outboxDir, item.path)) fs.rmSync(item.path, { force: true });
  }

  add({ deviceId, kind, from, text, name, size, path: filePath }) {
    const item = { id: crypto.randomUUID(), deviceId, kind, from, time: this.now() };
    if (kind === 'text') item.text = text;
    else Object.assign(item, { name, size, path: filePath, mime: mimeFromName(name) });
    this.items.push(item);
    while (this.items.length > this.limits.maxHistory) this._dispose(this.items.shift());
    this._save();
    this.emit('add', { item: publicItem(item), deviceId });
    return publicItem(item, true);
  }

  list(deviceId) {
    const mine = deviceId === undefined ? this.items : this.items.filter((it) => it.deviceId === deviceId);
    return mine.map((it) => publicItem(it, deviceId === undefined));
  }

  get(id) {
    return this.items.find((it) => it.id === id) || null;
  }

  remove(id) {
    const index = this.items.findIndex((it) => it.id === id);
    if (index === -1) return false;
    const [item] = this.items.splice(index, 1);
    this._dispose(item);
    this._save();
    this.emit('delete', { id, deviceId: item.deviceId });
    return true;
  }

  clear(deviceId) {
    const doomed = this.items.filter((it) => deviceId === undefined || it.deviceId === deviceId);
    for (const item of doomed) this.remove(item.id);
    return doomed.length;
  }

  outboxBytes() {
    return this.items.reduce((sum, it) => sum + (it.kind === 'file' && it.from === 'laptop' ? it.size || 0 : 0), 0);
  }
}

module.exports = { ItemStore, isInside };
```

- [ ] **Step 4: Run to verify they pass** — `cd server && node --test test/mime.test.js test/store.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/mime.js server/src/store.js server/test/mime.test.js server/test/store.test.js
git commit -m "feat(server): per-phone history store with retention and mime types" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Safe streamed uploads (`transfers.js`)

**Files:**
- Create: `server/src/transfers.js`
- Test: `server/test/transfers.test.js`

**Interfaces:**
- Consumes: `errors.apiError`, limits (`maxFileBytes`, `maxOutboxBytes`, `minFreeDiskBytes`, `maxFilenameLength`)
- Produces:
  - `sanitizeFilename(name, max = 200) → string` (always a non-empty basename)
  - `saveUpload({ stream, dir, name, contentLength, limits, usedBytes = 0, checkQuota = false, freeBytes? }) → Promise<{ path, name, size }>`; throws `BAD_REQUEST` (missing length, interrupted, size mismatch), `PAYLOAD_TOO_LARGE`, `STORAGE_QUOTA`, `INSUFFICIENT_STORAGE`
  - `sweepPartFiles(dir) → number`

- [ ] **Step 1: Write the failing test** — `server/test/transfers.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { sanitizeFilename, saveUpload, sweepPartFiles } = require('../src/transfers');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { throwsCode } = require('./helpers/assertions');

const data = (text) => Readable.from([Buffer.from(text)]);
const opts = (dir, extra = {}) => ({ dir, limits: DEFAULT_LIMITS, freeBytes: async () => 10 * 1024 ** 3, ...extra });

test('sanitizeFilename reduces every hostile path to a plain basename', () => {
  const cases = {
    '../../evil.txt': 'evil.txt',
    '..\\..\\evil.txt': 'evil.txt',
    'C:\\Windows\\evil.txt': 'evil.txt',
    '\\\\host\\share\\f.txt': 'f.txt',
    '/etc/passwd': 'passwd',
    CON: '_CON',
    'nul.txt': '_nul.txt',
    '..': 'file',
    '': 'file',
    'dir/': 'file',
    'a<b>:c.txt': 'a_b__c.txt',
    'report.': 'report',
    '.hidden': 'hidden',
    'a\x00b': 'a_b',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(sanitizeFilename(input), expected, JSON.stringify(input));
  assert.equal(sanitizeFilename(undefined), 'file');
});

test('sanitizeFilename caps the length but keeps the extension', () => {
  const name = sanitizeFilename(`${'a'.repeat(300)}.pdf`);
  assert.ok(name.length <= 200);
  assert.ok(name.endsWith('.pdf'));
});

test('saves a file, returns its final name and size, and leaves no .part behind', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: data('hello'), name: 'a.txt', contentLength: 5, ...opts(dir) });
  assert.equal(result.name, 'a.txt');
  assert.equal(result.size, 5);
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'hello');
  assert.deepEqual(fs.readdirSync(dir), ['a.txt']);
});

test('a zero-byte file is fine', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: Readable.from([]), name: 'empty.bin', contentLength: 0, ...opts(dir) });
  assert.equal(result.size, 0);
});

test('duplicate names get (1), (2) suffixes', async (t) => {
  const dir = tmpDir(t);
  const names = [];
  for (let i = 0; i < 3; i++) names.push((await saveUpload({ stream: data('x'), name: 'a.txt', contentLength: 1, ...opts(dir) })).name);
  assert.deepEqual(names, ['a.txt', 'a (1).txt', 'a (2).txt']);
});

test('the file always lands directly inside the target folder', async (t) => {
  const dir = tmpDir(t);
  const result = await saveUpload({ stream: data('x'), name: '../../..\\escape.txt', contentLength: 1, ...opts(dir) });
  assert.equal(path.dirname(result.path), path.resolve(dir));
  assert.deepEqual(fs.readdirSync(dir), ['escape.txt']);
});

test('oversize is rejected before anything is written', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'big.bin', contentLength: 3 * 1024 ** 3, ...opts(dir) }),
    (e) => e.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the outbox quota is enforced when asked', async (t) => {
  const dir = tmpDir(t);
  const limits = { ...DEFAULT_LIMITS, maxOutboxBytes: 100 };
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'a', contentLength: 60, usedBytes: 50, checkQuota: true, ...opts(dir, { limits }) }),
    (e) => e.code === 'STORAGE_QUOTA',
  );
  await saveUpload({ stream: data('x'.repeat(10)), name: 'a', contentLength: 10, usedBytes: 50, checkQuota: true, ...opts(dir, { limits }) });
});

test('low disk space is rejected up front', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(
    saveUpload({ stream: data('x'), name: 'a', contentLength: 1000, ...opts(dir, { freeBytes: async () => 100 * 1024 ** 2 }) }),
    (e) => e.code === 'INSUFFICIENT_STORAGE',
  );
});

test('a missing Content-Length is a bad request', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(saveUpload({ stream: data('x'), name: 'a', contentLength: undefined, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
});

test('an interrupted upload leaves no file and no .part', async (t) => {
  const dir = tmpDir(t);
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from('abc');
      throw new Error('network dropped');
    })(),
  );
  await assert.rejects(saveUpload({ stream: broken, name: 'a.bin', contentLength: 10, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('bytes that do not match Content-Length are rejected, short or long, and cleaned up', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(saveUpload({ stream: data('abc'), name: 'a', contentLength: 10, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(saveUpload({ stream: data('abcdefghij'), name: 'a', contentLength: 3, ...opts(dir) }), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('sweepPartFiles removes leftovers from a crash and nothing else', (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'a.txt.1234.part'), 'x');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.equal(sweepPartFiles(dir), 1);
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  assert.equal(sweepPartFiles(path.join(dir, 'missing')), 0);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/transfers.test.js` → FAIL `Cannot find module '../src/transfers'`.

- [ ] **Step 3: Implement** — `server/src/transfers.js`:

```js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { apiError } = require('./errors');
const { isInside } = require('./store');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Reduces anything a client sends to a safe, non-empty file name (never a path). */
function sanitizeFilename(name, max = 200) {
  const slashed = String(name ?? '').replace(/\\/g, '/');
  let base = slashed.slice(slashed.lastIndexOf('/') + 1); // basename: drops ../, absolute, drive and UNC prefixes
  base = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (RESERVED.test(base)) base = `_${base}`;
  if (base.length > max) {
    const ext = path.extname(base).slice(0, 20);
    base = base.slice(0, max - ext.length) + ext;
  }
  return base || 'file';
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

async function defaultFreeBytes(dir) {
  const s = await fs.promises.statfs(dir);
  return s.bavail * s.bsize;
}

/**
 * Streams an upload into `dir` as a .part file and renames it on success.
 * The final name is chosen synchronously right before the rename, so two uploads of the same name cannot collide.
 */
async function saveUpload({ stream, dir, name, contentLength, limits, usedBytes = 0, checkQuota = false, freeBytes = defaultFreeBytes }) {
  if (!Number.isInteger(contentLength) || contentLength < 0) throw apiError('BAD_REQUEST', 'Content-Length is required.');
  if (contentLength > limits.maxFileBytes) throw apiError('PAYLOAD_TOO_LARGE');
  if (checkQuota && usedBytes + contentLength > limits.maxOutboxBytes) throw apiError('STORAGE_QUOTA');
  fs.mkdirSync(dir, { recursive: true });
  if ((await freeBytes(dir)) - contentLength < limits.minFreeDiskBytes) throw apiError('INSUFFICIENT_STORAGE');

  const safeName = sanitizeFilename(name, limits.maxFilenameLength);
  const part = path.join(dir, `${safeName}.${crypto.randomBytes(4).toString('hex')}.part`);
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(received > contentLength ? new Error('more bytes than Content-Length') : null, chunk);
    },
  });

  try {
    await pipeline(stream, counter, fs.createWriteStream(part, { flags: 'wx' }));
    if (received !== contentLength) throw new Error('fewer bytes than Content-Length');
    const finalPath = uniquePath(dir, safeName);
    if (!isInside(dir, finalPath)) throw new Error('path escaped the target folder');
    fs.renameSync(part, finalPath);
    return { path: finalPath, name: path.basename(finalPath), size: received };
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err.code && err.status ? err : apiError('BAD_REQUEST', 'The upload was interrupted or its size did not match.');
  }
}

/** Removes .part files left behind by a crash. */
function sweepPartFiles(dir) {
  let removed = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.part')) {
        fs.rmSync(path.join(dir, file), { force: true });
        removed++;
      }
    }
  } catch {
    /* folder does not exist yet */
  }
  return removed;
}

module.exports = { sanitizeFilename, saveUpload, sweepPartFiles };
```

- [ ] **Step 4: Run to verify it passes** — `cd server && node --test test/transfers.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/transfers.js server/test/transfers.test.js
git commit -m "feat(server): safe streamed uploads (sanitizing, .part files, size, quota, disk checks)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: UDP discovery responder

**Files:**
- Create: `server/src/discovery.js`
- Test: `server/test/discovery.test.js`

**Interfaces:**
- Consumes: `ratelimit.createLimiter`
- Produces `createDiscovery({ identity, devicePort, probesPer10s = 20 })` → `{ start({ port, host = '0.0.0.0' }) → Promise<number>` (the bound port), `stop() → Promise<void>` }`. Replies only to `{"t":"FLASHPUSH_DISCOVER","v":1}` datagrams under 512 bytes, at most `probesPer10s` per source address per 10 s.

- [ ] **Step 1: Write the failing test** — `server/test/discovery.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { createDiscovery } = require('../src/discovery');

const identity = { laptopId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'MITHLESH-PC' };

async function boot(t, options = {}) {
  const discovery = createDiscovery({ identity, devicePort: 8765, ...options });
  const port = await discovery.start({ port: 0, host: '127.0.0.1' });
  t.after(() => discovery.stop());
  return port;
}

/** Sends one datagram and resolves with the reply text, or null if nothing arrives in `waitMs`. */
function probe(port, payload, waitMs = 150) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const finish = (value) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    socket.on('message', (msg) => finish(msg.toString()));
    socket.send(Buffer.from(payload), port, '127.0.0.1');
  });
}

test('answers a discover probe with the laptop identity and device port', async (t) => {
  const port = await boot(t);
  const reply = JSON.parse(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1 }), 1000));
  assert.deepEqual(reply, { t: 'FLASHPUSH_HERE', v: 1, laptopId: identity.laptopId, name: 'MITHLESH-PC', port: 8765 });
});

test('ignores garbage, other types, other versions and oversized datagrams', async (t) => {
  const port = await boot(t);
  assert.equal(await probe(port, 'not json'), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'SOMETHING_ELSE', v: 1 })), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 2 })), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1, pad: 'x'.repeat(600) })), null);
});

test('limits how many probes one address gets answered', async (t) => {
  const port = await boot(t, { probesPer10s: 2 });
  const discover = JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1 });
  assert.notEqual(await probe(port, discover, 1000), null);
  assert.notEqual(await probe(port, discover, 1000), null);
  assert.equal(await probe(port, discover), null);
});

test('stop closes the socket and start can run again on the same port', async () => {
  const discovery = createDiscovery({ identity, devicePort: 8765 });
  const port = await discovery.start({ port: 0, host: '127.0.0.1' });
  await discovery.stop();
  const again = await discovery.start({ port, host: '127.0.0.1' });
  assert.equal(again, port);
  await discovery.stop();
});

test('start rejects when the port is already taken', async (t) => {
  const first = await boot(t);
  const second = createDiscovery({ identity, devicePort: 8765 });
  await assert.rejects(second.start({ port: first, host: '127.0.0.1' }), (e) => e.code === 'EADDRINUSE');
});
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/discovery.test.js` → FAIL `Cannot find module '../src/discovery'`.

- [ ] **Step 3: Implement** — `server/src/discovery.js`:

```js
'use strict';

const dgram = require('node:dgram');
const { createLimiter } = require('./ratelimit');

const MAX_DATAGRAM = 512;

/** Answers "is there a FlashPush laptop here?" broadcasts. The reply is a hint; trust comes from TLS pinning. */
function createDiscovery({ identity, devicePort, probesPer10s = 20 }) {
  const limiter = createLimiter({ max: probesPer10s, windowMs: 10_000 });
  const reply = Buffer.from(
    JSON.stringify({ t: 'FLASHPUSH_HERE', v: 1, laptopId: identity.laptopId, name: identity.name, port: devicePort }),
  );
  let socket = null;

  function onMessage(msg, rinfo) {
    if (msg.length > MAX_DATAGRAM) return;
    let probe;
    try {
      probe = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!probe || probe.t !== 'FLASHPUSH_DISCOVER' || probe.v !== 1) return;
    if (!limiter.attempt(rinfo.address).allowed) return;
    socket.send(reply, rinfo.port, rinfo.address);
  }

  function start({ port, host = '0.0.0.0' }) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      s.once('error', reject);
      s.on('message', onMessage);
      s.bind(port, host, () => {
        s.off('error', reject);
        s.on('error', () => {}); // a stray send error must not crash the server
        socket = s;
        resolve(s.address().port);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!socket) return resolve();
      const s = socket;
      socket = null;
      s.close(resolve);
    });
  }

  return { start, stop };
}

module.exports = { createDiscovery };
```

- [ ] **Step 4: Run to verify it passes** — `cd server && node --test test/discovery.test.js` → PASS. Then the whole suite: `npm test` → all green (Plan 1A's 77 plus the new tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/discovery.js server/test/discovery.test.js
git commit -m "feat(server): UDP discovery responder" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs for the foundations

**Files:**
- Create: `docs/transfers.md`
- Modify: `docs/README.md`, `docs/decisions.md`, `CHANGELOG.md`, `docs/superpowers/plans/2026-09-21-v2-plan-index.md`

- [ ] **Step 1: Write `docs/transfers.md`** covering, in this order: (1) limits table (2 GiB file, 1 MB text, 500 history, 5 GiB outbox, 512 MB free disk, 200-char names); (2) upload lifecycle (`Content-Length` required → limit/quota/disk checks → `<name>.<random>.part` → rename to a unique final name → history entry; failure or size mismatch deletes the `.part`; stale `.part` files are swept at start-up); (3) name safety (basename only, replaced characters, reserved Windows names, length cap, exclusive create, resolved-path check); (4) retention (500 entries oldest first; received files in Downloads are never deleted; outbox files are); (5) items belong to one phone (`deviceId`, `mime`); (6) what is deferred (checksums, resumable transfers).

- [ ] **Step 2: Update the index, decisions, changelog**
  - `docs/README.md`: add `[transfers.md](transfers.md) | file lifecycle, limits, path safety, retention | written (Plan 1B-i)` and change the plans row to mention 1B-i.
  - `docs/decisions.md`: append a "Plan 1B-i" table: address classification lives in 1B (route is needed at pairing time; MagicDNS and the address race stay in Plan 6); `.part` name carries a random suffix and the final name is chosen synchronously just before the rename; discovery replies are rate limited per source (20 per 10 s); received files are never deleted by history pruning.
  - `CHANGELOG.md`: a "Built (Plan 1B-i)" entry listing the four modules and the test count.
  - `docs/superpowers/plans/2026-09-21-v2-plan-index.md`: split the 1B row into **1B-i** (this plan, done) and **1B-ii** (HTTPS `/v1` API, admin API, wiring, end-to-end test, `architecture.md`, `protocol.md`, `security.md`).

- [ ] **Step 3: Verify and commit**

Run: `cd server && npm test` (Expected: PASS).

```bash
git add docs CHANGELOG.md
git commit -m "docs: transfers guide, Plan 1B-i decisions and changelog" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** §5.1 discovery reply and rate limiting → Task 4; §5.2 address tagging (`lan`/`tailscale`/`other`, link-local dropped) → Task 1 (MagicDNS and the address race are Plan 6); §7.1 limits, §7.2 upload safety (basename, reserved names, `wx`, `.part`, `Content-Length`, quota, disk, interrupted, sweep) → Task 3; §7.3 retention and "items belong to one phone" with `mime` → Task 2. HTTP routes, idempotency wiring, SSE and the admin API are Plan 1B-ii.

**Placeholder scan:** none; Task 5 lists exact doc contents.

**Type consistency:** `isInside` is exported by `store.js` and used by `transfers.js`; `saveUpload` returns `{ path, name, size }`, which is what `ItemStore.add` takes as `path`, `name`, `size` in Plan 1B-ii; the store's public item fields (`id, kind, from, time, text, name, size, mime`) are the wire format for `GET /v1/items`.
