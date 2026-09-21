# Server Security Core (Plan 1A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test the security-critical building blocks of the v2 server: pairing crypto, laptop identity and TLS certificate, approved-device store, sessions, rate limiting, idempotency and the pairing state machine. No HTTP yet (that is Plan 1B).

**Architecture:** Small CommonJS modules under `server/src/`, each with one job and no HTTP dependency, wired together later by Plan 1B. Time and randomness are injectable so every behaviour is testable with a fake clock. The pairing primitives in `crypto.js` are the single source of truth for the byte-level protocol and are pinned by known-answer test vectors that the Flutter app will reuse.

**Tech Stack:** Node.js ≥ 22 (`node:test`, `node:assert`, `node:crypto`), `selfsigned` (certificate generation, the only new dependency).

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §2 (modules), §3 (security model), §4.1–4.2 (errors, idempotency)

## Global Constraints

- Node.js `>=22` (the `npm test` glob pattern needs it; the machine runs Node 24), CommonJS (`'use strict'; require(...)`), matching the existing `server/server.js` style. No TypeScript, no test framework other than `node:test`.
- The v1 files (`server/server.js`, `server/public/index.html`, `qrcode` dependency) stay untouched in this plan; Plan 1B replaces them.
- Byte-level protocol (exact, spec §3.2): labels are ASCII `FLASHPUSH-COMMIT-v1`, `FLASHPUSH-SAS-v1`, `FLASHPUSH-STATUS-v1`; concatenation is raw bytes with no separators or length prefixes.
- Sizes: fingerprint 32 bytes (SHA-256 of the DER leaf certificate), `np` and `nl` 16 bytes, `requestId` 16 bytes, device secret 32 bytes, session token 32 bytes; all base64url (no padding, canonical) on the wire.
- `SAS = uint32_big_endian(SHA256(label ‖ fp ‖ np ‖ nl)[0..4]) mod 1,000,000`, zero-padded to 6 digits, displayed `482 916`.
- Device secrets are stored only as `SHA-256(secret)` hex. Secrets, tokens and request IDs are never logged.
- Default limits (all overridable in `config.json`): pair request expiry 2 min; **unrevealed pair request expires after 10 s** (added in this plan, recorded in spec §3.2 on 2026-09-21); secret re-fetch window 60 s; max 3 pending pairings; 5 pair requests/min/IP; 20 devices; 10 failed auths/min/IP; 100 revoked tombstones; session idle 24 h, absolute 7 days; idempotency 200 operations or 10 min per device.
- Error codes and HTTP statuses exactly as in spec §4.1.
- State directory: `%APPDATA%\FlashPush` (override `FLASHPUSH_HOME`). Tests always use a temp directory.
- Branch: create `feature/server-security-core` from `develop` (see the plan index for the prerequisite merge). Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Scaffold, config, errors, file helpers, validation

**Files:**
- Modify: `server/package.json`
- Create: `server/src/config.js`, `server/src/errors.js`, `server/src/fsutil.js`, `server/src/validate.js`
- Create: `server/test/helpers/tmp.js`, `server/test/helpers/clock.js`, `server/test/helpers/assertions.js`
- Test: `server/test/config.test.js`, `server/test/errors.test.js`, `server/test/fsutil.test.js`, `server/test/validate.test.js`

**Interfaces:**
- Produces:
  - `config.loadConfig({ home?, overrides? }) → { home, ports:{device,admin,discovery}, limits, receiveDir, paths:{config,identity,tlsKey,tlsCert,devices,items,outbox} }`; `config.DEFAULT_LIMITS`
  - `errors.apiError(code, message?, { retryAfterMs? }) → ApiError{ code, status, message, retryAfterMs }`; `errors.ApiError`; `errors.envelope(err) → { error:{code,message} }`; `errors.CODES`
  - `fsutil.readJson(file, fallback)`; `fsutil.writeJsonAtomic(file, data, { mode? })`
  - `validate.isUuid(str)`; `validate.cleanName(value, max = 64)`
  - test helpers: `tmpDir(t)`, `createClock(start?) → { now(), advance(ms), set(ms) }`, `throwsCode(fn, code)`

- [ ] **Step 1: Create the branch and install the dependency**

```bash
git checkout develop
git checkout -b feature/server-security-core
cd server
npm install selfsigned@^5.5.0
```

Edit `server/package.json` so it reads:

```json
{
  "name": "flashpush-server",
  "version": "1.0.0",
  "description": "Send text, links and files between your phone and laptop over the same Wi-Fi",
  "main": "server.js",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server.js",
    "test": "node --test \"test/**/*.test.js\""
  },
  "license": "MIT",
  "dependencies": {
    "qrcode": "^1.5.4",
    "selfsigned": "^5.5.0"
  }
}
```

- [ ] **Step 2: Write the test helpers**

`server/test/helpers/tmp.js`:

```js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Creates a temp directory that is removed when the test finishes. */
function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashpush-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { tmpDir };
```

`server/test/helpers/clock.js`:

```js
'use strict';

/** A controllable clock for time-dependent tests. */
function createClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

module.exports = { createClock };
```

`server/test/helpers/assertions.js`:

```js
'use strict';

const assert = require('node:assert/strict');

/** Asserts fn throws an ApiError with the given code. */
function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `expected error code ${code}, got ${err.code} (${err.message})`);
    return true;
  });
}

module.exports = { throwsCode };
```

- [ ] **Step 3: Write the failing tests**

`server/test/config.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');

test('defaults match the spec', (t) => {
  const home = tmpDir(t);
  const cfg = loadConfig({ home });
  assert.equal(cfg.home, home);
  assert.deepEqual(cfg.ports, { device: 8765, admin: 8760, discovery: 8766 });
  assert.equal(cfg.limits.maxFileBytes, 2 * 1024 ** 3);
  assert.equal(cfg.limits.pairExpiryMs, 120_000);
  assert.equal(cfg.limits.pairRevealWindowMs, 10_000);
  assert.equal(cfg.limits.pairSecretWindowMs, 60_000);
  assert.equal(cfg.limits.maxPendingPairings, 3);
  assert.equal(cfg.limits.maxDevices, 20);
  assert.equal(cfg.limits.sessionIdleMs, 24 * 3600 * 1000);
  assert.equal(cfg.limits.sessionMaxMs, 7 * 24 * 3600 * 1000);
  assert.equal(cfg.paths.devices, path.join(home, 'devices.json'));
  assert.equal(cfg.paths.tlsKey, path.join(home, 'key.pem'));
});

test('config.json overrides limits and ports, keeping the other defaults', (t) => {
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ limits: { maxDevices: 5 }, ports: { device: 9000 } }));
  const cfg = loadConfig({ home });
  assert.equal(cfg.limits.maxDevices, 5);
  assert.equal(cfg.limits.maxPendingPairings, DEFAULT_LIMITS.maxPendingPairings);
  assert.equal(cfg.ports.device, 9000);
  assert.equal(cfg.ports.admin, 8760);
});

test('explicit overrides beat config.json', (t) => {
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ limits: { maxDevices: 5 } }));
  const cfg = loadConfig({ home, overrides: { limits: { maxDevices: 2 } } });
  assert.equal(cfg.limits.maxDevices, 2);
});

test('an invalid config.json names the file in the error', (t) => {
  const home = tmpDir(t);
  fs.writeFileSync(path.join(home, 'config.json'), '{ not json');
  assert.throws(() => loadConfig({ home }), /config\.json/);
});

test('FLASHPUSH_HOME selects the state directory', (t) => {
  const home = tmpDir(t);
  const previous = process.env.FLASHPUSH_HOME;
  process.env.FLASHPUSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.FLASHPUSH_HOME;
    else process.env.FLASHPUSH_HOME = previous;
  });
  assert.equal(loadConfig().home, home);
});
```

`server/test/errors.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apiError, envelope, ApiError, CODES } = require('../src/errors');

test('every code maps to the HTTP status in the spec', () => {
  const expected = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    SESSION_EXPIRED: 401,
    DEVICE_NOT_PAIRED: 401,
    DEVICE_REVOKED: 403,
    RATE_LIMITED: 429,
    PAIR_NOT_FOUND: 404,
    PAIR_EXPIRED: 410,
    PAIR_DENIED: 403,
    PAIR_LIMIT: 429,
    COMMIT_MISMATCH: 400,
    PAYLOAD_TOO_LARGE: 413,
    INSUFFICIENT_STORAGE: 507,
    STORAGE_QUOTA: 507,
    ITEM_NOT_FOUND: 404,
    INTERNAL: 500,
  };
  assert.deepEqual(Object.keys(CODES).sort(), Object.keys(expected).sort());
  for (const [code, status] of Object.entries(expected)) assert.equal(apiError(code).status, status, code);
});

test('apiError is an Error with code, default message and optional retryAfterMs', () => {
  const err = apiError('RATE_LIMITED', undefined, { retryAfterMs: 1500 });
  assert.ok(err instanceof ApiError);
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.ok(err.message.length > 0);
  assert.equal(err.retryAfterMs, 1500);
});

test('a custom message replaces the default', () => {
  assert.equal(apiError('BAD_REQUEST', 'deviceId must be a UUID.').message, 'deviceId must be a UUID.');
});

test('unknown codes are a programming error', () => {
  assert.throws(() => apiError('NOPE'), /Unknown error code/);
});

test('envelope has exactly the documented shape', () => {
  assert.deepEqual(envelope(apiError('DEVICE_REVOKED')), {
    error: { code: 'DEVICE_REVOKED', message: 'This device is no longer paired.' },
  });
});
```

`server/test/fsutil.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../src/fsutil');
const { tmpDir } = require('./helpers/tmp');

test('readJson returns the fallback when the file is missing', (t) => {
  assert.deepEqual(readJson(path.join(tmpDir(t), 'nope.json'), { a: 1 }), { a: 1 });
});

test('writeJsonAtomic creates directories, round-trips, and leaves no temp files', (t) => {
  const file = path.join(tmpDir(t), 'nested', 'dir', 'data.json');
  writeJsonAtomic(file, { hello: 'world' });
  writeJsonAtomic(file, { hello: 'again' });
  assert.deepEqual(readJson(file, null), { hello: 'again' });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
});

test('readJson names the file when the JSON is invalid', (t) => {
  const file = path.join(tmpDir(t), 'bad.json');
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => readJson(file, null), /bad\.json/);
});
```

`server/test/validate.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isUuid, cleanName } = require('../src/validate');

test('isUuid accepts lowercase UUIDs only', () => {
  assert.equal(isUuid('11111111-2222-3333-4444-555555555555'), true);
  assert.equal(isUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), true);
  assert.equal(isUuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'), false);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid('11111111-2222-3333-4444-555555555555 '), false);
});

test('cleanName strips control characters, collapses whitespace and trims', () => {
  assert.equal(cleanName('  Pixel\t7\n Pro  '), 'Pixel 7 Pro');
  assert.equal(cleanName('a\u0000b'), 'a b');
});

test('cleanName limits length and rejects non-strings', () => {
  assert.equal(cleanName('x'.repeat(100)).length, 64);
  assert.equal(cleanName('abcdef', 3), 'abc');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName(undefined), '');
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL with `Cannot find module '../src/config'` (and the other three modules).

- [ ] **Step 5: Write the implementations**

`server/src/fsutil.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** Reads a JSON file. Missing file → fallback. Invalid JSON → an Error that names the file. */
function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

/** Writes JSON via a temp file + rename so a crash never leaves a half-written file. */
function writeJsonAtomic(file, data, { mode = 0o600 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJsonAtomic };
```

`server/src/validate.js`:

```js
'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Display names come from other devices: strip control characters, collapse whitespace, cap length. */
function cleanName(value, max = 64) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

module.exports = { isUuid, cleanName };
```

`server/src/errors.js`:

```js
'use strict';

const TABLE = {
  BAD_REQUEST: [400, 'The request was malformed.'],
  UNAUTHORIZED: [401, 'Missing or invalid credentials.'],
  SESSION_EXPIRED: [401, 'Your session has ended. Connect again.'],
  DEVICE_NOT_PAIRED: [401, 'This device is not paired with this laptop.'],
  DEVICE_REVOKED: [403, 'This device is no longer paired.'],
  RATE_LIMITED: [429, 'Too many requests. Try again shortly.'],
  PAIR_NOT_FOUND: [404, 'Pairing request not found.'],
  PAIR_EXPIRED: [410, 'The pairing request has expired.'],
  PAIR_DENIED: [403, 'The pairing request was denied.'],
  PAIR_LIMIT: [429, 'Too many pairing requests or paired devices.'],
  COMMIT_MISMATCH: [400, 'Pairing verification failed.'],
  PAYLOAD_TOO_LARGE: [413, 'The payload is too large.'],
  INSUFFICIENT_STORAGE: [507, 'Not enough free disk space on the laptop.'],
  STORAGE_QUOTA: [507, 'The storage limit has been reached.'],
  ITEM_NOT_FOUND: [404, 'Item not found.'],
  INTERNAL: [500, 'Something went wrong on the laptop.'],
};

const CODES = Object.freeze(Object.fromEntries(Object.keys(TABLE).map((code) => [code, code])));

class ApiError extends Error {
  constructor(code, message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = TABLE[code][0];
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function apiError(code, message, options) {
  if (!TABLE[code]) throw new Error(`Unknown error code: ${code}`);
  return new ApiError(code, message || TABLE[code][1], options);
}

function envelope(err) {
  return { error: { code: err.code, message: err.message } };
}

module.exports = { ApiError, apiError, envelope, CODES };
```

`server/src/config.js`:

```js
'use strict';

const os = require('node:os');
const path = require('node:path');
const { readJson } = require('./fsutil');

const DEFAULT_PORTS = Object.freeze({ device: 8765, admin: 8760, discovery: 8766 });

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 ** 3,
  maxTextBytes: 1024 * 1024,
  maxHistory: 500,
  maxOutboxBytes: 5 * 1024 ** 3,
  minFreeDiskBytes: 512 * 1024 ** 2,
  maxFilenameLength: 200,
  sessionIdleMs: 24 * 3600 * 1000,
  sessionMaxMs: 7 * 24 * 3600 * 1000,
  pairExpiryMs: 2 * 60 * 1000,
  pairRevealWindowMs: 10 * 1000,
  pairSecretWindowMs: 60 * 1000,
  maxPendingPairings: 3,
  maxPairRequestsPerMinutePerIp: 5,
  maxDevices: 20,
  maxFailedAuthPerMinutePerIp: 10,
  maxRevokedTombstones: 100,
  idempotencyMaxEntries: 200,
  idempotencyTtlMs: 10 * 60 * 1000,
});

function defaultHome() {
  if (process.env.FLASHPUSH_HOME) return process.env.FLASHPUSH_HOME;
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'FlashPush');
}

function loadConfig({ home = defaultHome(), overrides = {} } = {}) {
  const file = path.join(home, 'config.json');
  const fromFile = readJson(file, {});
  if (fromFile === null || typeof fromFile !== 'object' || Array.isArray(fromFile)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  return {
    home,
    ports: { ...DEFAULT_PORTS, ...fromFile.ports, ...overrides.ports },
    limits: { ...DEFAULT_LIMITS, ...fromFile.limits, ...overrides.limits },
    receiveDir:
      overrides.receiveDir ||
      process.env.RECEIVE_DIR ||
      fromFile.receiveDir ||
      path.join(os.homedir(), 'Downloads', 'FlashPush'),
    paths: {
      config: file,
      identity: path.join(home, 'identity.json'),
      tlsKey: path.join(home, 'key.pem'),
      tlsCert: path.join(home, 'cert.pem'),
      devices: path.join(home, 'devices.json'),
      items: path.join(home, 'items.json'),
      outbox: path.join(home, 'outbox'),
    },
  };
}

module.exports = { loadConfig, DEFAULT_LIMITS, DEFAULT_PORTS };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS, all tests in the four files green.

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/src server/test
git commit -m "feat(server): scaffold v2 core (config, errors, file helpers, validation)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Pairing crypto primitives with known-answer vectors

**Files:**
- Create: `server/src/crypto.js`
- Test: `server/test/crypto.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all `Buffer` unless noted):
  - `SIZES = { fingerprint:32, nonce:16, requestId:16, secret:32, token:32 }`
  - `b64uEncode(buf) → string`; `b64uDecode(str, expectedLength?) → Buffer` (throws `TypeError` on non-canonical/invalid/wrong length)
  - `commitOf(np) → Buffer(32)`; `sasCode(fp, np, nl) → '001004'`; `formatSas('001004') → '001 004'`
  - `pairProof(np, requestId, deviceId) → hex string`
  - `sha256Hex(bufferOrString) → hex`; `safeEqualHex(a, b) → boolean`
  - `random(n) → Buffer`

- [ ] **Step 1: Write the failing test**

`server/test/crypto.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/crypto');

// Known-answer vectors. The Flutter app must reproduce these exactly (docs/pairing.md).
const seq = (start, n) => Buffer.from(Array.from({ length: n }, (_, i) => start + i));
const V = {
  fp: seq(0x00, 32),
  np: seq(0x10, 16),
  nl: seq(0x20, 16),
  requestId: seq(0x30, 16),
  deviceId: '11111111-2222-3333-4444-555555555555',
  npB64: 'EBESExQVFhcYGRobHB0eHw',
  requestIdB64: 'MDEyMzQ1Njc4OTo7PD0-Pw',
  commitHex: '148f8a90dd839457dc23e50843a84c96c73365433d7277efea17c04322b1e017',
  commitB64: 'FI-KkN2DlFfcI-UIQ6hMlsczZUM9cnfv6hfAQyKx4Bc',
  sas: '001004',
  proofHex: '01b5a81d7a92704f2e4bda8b6a8e86f78f88a470b7e0bca9b6b668d7b2a035f5',
};

test('commit vector', () => {
  const commit = c.commitOf(V.np);
  assert.equal(commit.toString('hex'), V.commitHex);
  assert.equal(c.b64uEncode(commit), V.commitB64);
});

test('SAS vector, including zero padding', () => {
  assert.equal(c.sasCode(V.fp, V.np, V.nl), V.sas);
  assert.equal(c.formatSas(V.sas), '001 004');
});

test('the SAS depends on the order of the nonces', () => {
  assert.notEqual(c.sasCode(V.fp, V.np, V.nl), c.sasCode(V.fp, V.nl, V.np));
});

test('status proof vector', () => {
  assert.equal(c.pairProof(V.np, V.requestId, V.deviceId), V.proofHex);
});

test('base64url encodes without padding and round-trips', () => {
  assert.equal(c.b64uEncode(V.np), V.npB64);
  assert.equal(c.b64uEncode(V.requestId), V.requestIdB64);
  assert.deepEqual(c.b64uDecode(V.npB64, 16), V.np);
});

test('base64url decoding is strict', () => {
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0eHx', 16), TypeError); // non-canonical trailing bits
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0eHw==', 16), TypeError); // padding
  assert.throws(() => c.b64uDecode('EBESExQV+hcYGRobHB0eHw', 16), TypeError); // standard-base64 alphabet
  assert.throws(() => c.b64uDecode('EBES ExQVFhcYGRobHB0eHw', 16), TypeError); // whitespace
  assert.throws(() => c.b64uDecode('', 16), TypeError);
  assert.throws(() => c.b64uDecode(42, 16), TypeError);
  assert.throws(() => c.b64uDecode('EBESExQVFhcYGRobHB0', 16), TypeError); // wrong length
});

test('primitives reject inputs of the wrong size', () => {
  assert.throws(() => c.commitOf(Buffer.alloc(15)), TypeError);
  assert.throws(() => c.sasCode(Buffer.alloc(31), V.np, V.nl), TypeError);
  assert.throws(() => c.sasCode(V.fp, V.np, Buffer.alloc(17)), TypeError);
  assert.throws(() => c.pairProof(V.np, Buffer.alloc(15), V.deviceId), TypeError);
});

test('sha256Hex matches the FIPS test vector for "abc"', () => {
  assert.equal(c.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('safeEqualHex compares in constant time without throwing on odd input', () => {
  assert.equal(c.safeEqualHex('abcd', 'abcd'), true);
  assert.equal(c.safeEqualHex('abcd', 'abce'), false);
  assert.equal(c.safeEqualHex('abcd', 'abc'), false);
  assert.equal(c.safeEqualHex('é', 'a'), false); // same string length, different byte length
  assert.equal(c.safeEqualHex(undefined, 'a'), false);
});

test('random helpers return fresh bytes of the requested size', () => {
  const a = c.random(c.SIZES.nonce);
  const b = c.random(c.SIZES.nonce);
  assert.equal(a.length, 16);
  assert.notDeepEqual(a, b);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/crypto.test.js`
Expected: FAIL with `Cannot find module '../src/crypto'`.

- [ ] **Step 3: Write the implementation**

`server/src/crypto.js`:

```js
'use strict';

const crypto = require('node:crypto');

const LABELS = Object.freeze({
  commit: 'FLASHPUSH-COMMIT-v1',
  sas: 'FLASHPUSH-SAS-v1',
  status: 'FLASHPUSH-STATUS-v1',
});

const SIZES = Object.freeze({ fingerprint: 32, nonce: 16, requestId: 16, secret: 32, token: 32 });

const label = (name) => Buffer.from(LABELS[name], 'ascii');

function sha256(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function sha256Hex(data) {
  return sha256(data).toString('hex');
}

function b64uEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Strict base64url: no padding, no other alphabet, canonical trailing bits, optional exact length. */
function b64uDecode(str, expectedLength) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new TypeError('Invalid base64url string');
  const buf = Buffer.from(str, 'base64url');
  if (buf.toString('base64url') !== str) throw new TypeError('Non-canonical base64url string');
  if (expectedLength !== undefined && buf.length !== expectedLength) {
    throw new TypeError(`Expected ${expectedLength} bytes, got ${buf.length}`);
  }
  return buf;
}

function requireLength(buf, length, name) {
  if (!Buffer.isBuffer(buf) || buf.length !== length) throw new TypeError(`${name} must be ${length} bytes`);
}

/** commit = SHA256("FLASHPUSH-COMMIT-v1" ‖ np) */
function commitOf(np) {
  requireLength(np, SIZES.nonce, 'np');
  return sha256(label('commit'), np);
}

/** 6-digit code: uint32_be(SHA256("FLASHPUSH-SAS-v1" ‖ fp ‖ np ‖ nl)[0..4]) mod 1,000,000, zero-padded. */
function sasCode(fingerprint, np, nl) {
  requireLength(fingerprint, SIZES.fingerprint, 'fingerprint');
  requireLength(np, SIZES.nonce, 'np');
  requireLength(nl, SIZES.nonce, 'nl');
  const hash = sha256(label('sas'), fingerprint, np, nl);
  return String(hash.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function formatSas(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** proof = HMAC-SHA256(key = np, "FLASHPUSH-STATUS-v1" ‖ requestId ‖ UTF-8(deviceId)), hex */
function pairProof(np, requestId, deviceId) {
  requireLength(np, SIZES.nonce, 'np');
  requireLength(requestId, SIZES.requestId, 'requestId');
  return crypto
    .createHmac('sha256', np)
    .update(label('status'))
    .update(requestId)
    .update(Buffer.from(deviceId, 'utf8'))
    .digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const random = (n) => crypto.randomBytes(n);

module.exports = {
  SIZES,
  b64uEncode,
  b64uDecode,
  sha256Hex,
  commitOf,
  sasCode,
  formatSas,
  pairProof,
  safeEqualHex,
  random,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/crypto.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/crypto.js server/test/crypto.test.js
git commit -m "feat(server): pairing crypto primitives with known-answer vectors" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Laptop identity and TLS certificate

**Files:**
- Create: `server/src/identity.js`, `server/src/tls.js`
- Test: `server/test/identity.test.js`, `server/test/tls.test.js`

**Interfaces:**
- Consumes: `config.loadConfig().paths`, `fsutil`, `validate`
- Produces:
  - `identity.loadIdentity(paths, { hostname? }) → { laptopId, name }` (creates `identity.json` on first run; throws if the file exists but is invalid)
  - `tls.loadOrCreateTls(paths, { now? }) → Promise<{ key, cert, fingerprint: Buffer(32), regenerated: boolean }>`
  - `tls.fingerprintOfPem(pem) → Buffer(32)`; `tls.fingerprintOfDer(der) → Buffer(32)`

- [ ] **Step 1: Write the failing tests**

`server/test/identity.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadConfig } = require('../src/config');
const { loadIdentity } = require('../src/identity');
const { isUuid } = require('../src/validate');
const { tmpDir } = require('./helpers/tmp');

test('creates a UUID identity named after the hostname, then reuses it', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = loadIdentity(paths, { hostname: 'MITHLESH-PC' });
  assert.equal(isUuid(first.laptopId), true);
  assert.equal(first.name, 'MITHLESH-PC');
  const second = loadIdentity(paths, { hostname: 'SOMETHING-ELSE' });
  assert.deepEqual(second, first);
});

test('a hostname with control characters is cleaned', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  assert.equal(loadIdentity(paths, { hostname: 'My\nPC' }).name, 'My PC');
});

test('an invalid identity file is an error, never silently replaced', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  fs.writeFileSync(paths.identity, JSON.stringify({ laptopId: 'nope' }));
  assert.throws(() => loadIdentity(paths, { hostname: 'x' }), /identity\.json/);
});
```

`server/test/tls.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const { loadConfig } = require('../src/config');
const { loadOrCreateTls, fingerprintOfPem, fingerprintOfDer } = require('../src/tls');
const { tmpDir } = require('./helpers/tmp');

test('creates an EC P-256 certificate valid for about 10 years, and reuses it', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = await loadOrCreateTls(paths);
  assert.equal(first.regenerated, true);
  assert.equal(first.fingerprint.length, 32);

  const x509 = new crypto.X509Certificate(first.cert);
  assert.equal(x509.publicKey.asymmetricKeyType, 'ec');
  assert.equal(x509.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  const years = (new Date(x509.validTo) - new Date(x509.validFrom)) / (365 * 24 * 3600 * 1000);
  assert.ok(years > 9.9 && years < 10.1, `validity was ${years} years`);
  assert.equal(x509.checkPrivateKey(crypto.createPrivateKey(first.key)), true);

  const second = await loadOrCreateTls(paths);
  assert.equal(second.regenerated, false);
  assert.deepEqual(second.fingerprint, first.fingerprint);
});

test('the fingerprint is the SHA-256 of the DER certificate', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const tls = await loadOrCreateTls(paths);
  const der = new crypto.X509Certificate(tls.cert).raw;
  assert.deepEqual(tls.fingerprint, crypto.createHash('sha256').update(der).digest());
  assert.deepEqual(fingerprintOfPem(tls.cert), tls.fingerprint);
  assert.deepEqual(fingerprintOfDer(der), tls.fingerprint);
});

test('a damaged certificate is regenerated with a new fingerprint', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = await loadOrCreateTls(paths);
  fs.writeFileSync(paths.tlsCert, 'garbage');
  const second = await loadOrCreateTls(paths);
  assert.equal(second.regenerated, true);
  assert.notDeepEqual(second.fingerprint, first.fingerprint);
});

test('a real TLS handshake presents a certificate whose fingerprint matches (what the phone pins)', async (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const tls = await loadOrCreateTls(paths);
  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port: server.address().port, path: '/', rejectUnauthorized: false, agent: false },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
  const presented = fingerprintOfDer(res.socket.getPeerCertificate(true).raw);
  res.resume();
  assert.deepEqual(presented, tls.fingerprint);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/identity.test.js test/tls.test.js`
Expected: FAIL with `Cannot find module '../src/identity'` / `'../src/tls'`.

- [ ] **Step 3: Write the implementations**

`server/src/identity.js`:

```js
'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('./fsutil');
const { isUuid, cleanName } = require('./validate');

/** The laptop's permanent identity: a UUID plus a display name (the hostname by default). */
function loadIdentity(paths, { hostname = os.hostname() } = {}) {
  const existing = readJson(paths.identity, null);
  if (existing !== null) {
    if (!existing || !isUuid(existing.laptopId)) {
      throw new Error(
        `${paths.identity} is invalid. Delete it to create a new laptop identity (paired phones will need to pair again).`,
      );
    }
    return { laptopId: existing.laptopId, name: cleanName(existing.name) || cleanName(hostname) || 'Laptop' };
  }
  const identity = { laptopId: crypto.randomUUID(), name: cleanName(hostname) || 'Laptop' };
  writeJsonAtomic(paths.identity, identity, { mode: 0o644 });
  return identity;
}

module.exports = { loadIdentity };
```

`server/src/tls.js`:

```js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const selfsigned = require('selfsigned');

const VALID_DAYS = 3650;

function fingerprintOfDer(der) {
  return crypto.createHash('sha256').update(der).digest();
}

function fingerprintOfPem(pem) {
  return fingerprintOfDer(new crypto.X509Certificate(pem).raw);
}

function tryLoad(paths) {
  try {
    const key = fs.readFileSync(paths.tlsKey, 'utf8');
    const cert = fs.readFileSync(paths.tlsCert, 'utf8');
    const x509 = new crypto.X509Certificate(cert);
    if (!x509.checkPrivateKey(crypto.createPrivateKey(key))) return null;
    return { key, cert, fingerprint: fingerprintOfDer(x509.raw), regenerated: false };
  } catch {
    return null;
  }
}

/**
 * Loads the laptop's self-signed EC P-256 certificate, or creates one (valid ~10 years).
 * A regenerated certificate changes the fingerprint, so paired phones will refuse it (CERT_CHANGED).
 */
async function loadOrCreateTls(paths, { now = () => new Date() } = {}) {
  const existing = tryLoad(paths);
  if (existing) return existing;

  const notBeforeDate = now();
  const notAfterDate = new Date(notBeforeDate.getTime() + VALID_DAYS * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'FlashPush' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
  });
  fs.writeFileSync(paths.tlsKey, pems.private, { mode: 0o600 });
  fs.writeFileSync(paths.tlsCert, pems.cert, { mode: 0o644 });
  return { key: pems.private, cert: pems.cert, fingerprint: fingerprintOfPem(pems.cert), regenerated: true };
}

module.exports = { loadOrCreateTls, fingerprintOfPem, fingerprintOfDer };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test test/identity.test.js test/tls.test.js`
Expected: PASS (7 tests). If `selfsigned` rejects an option name, check `node_modules/selfsigned/README.md` (options are `keyType`, `curve`, `notBeforeDate`, `notAfterDate`) and fix the call, not the test.

- [ ] **Step 5: Commit**

```bash
git add server/src/identity.js server/src/tls.js server/test/identity.test.js server/test/tls.test.js
git commit -m "feat(server): laptop identity and self-signed EC certificate with fingerprint" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Rate limiter and idempotency cache

**Files:**
- Create: `server/src/ratelimit.js`, `server/src/idempotency.js`
- Test: `server/test/ratelimit.test.js`, `server/test/idempotency.test.js`

**Interfaces:**
- Produces:
  - `ratelimit.createLimiter({ max, windowMs, now?, maxKeys? }) → { isBlocked(key) → {blocked, retryAfterMs}, record(key), attempt(key) → {allowed, retryAfterMs}, reset(key) }`
  - `idempotency.OperationCache({ max, ttlMs, now? })` with `begin(deviceId, opId) → {state:'new'} | {state:'done', result} | {state:'pending', wait: Promise<{ok:true,result}|{ok:false}>}`, `complete(deviceId, opId, result)`, `fail(deviceId, opId)`, `forgetDevice(deviceId)`

- [ ] **Step 1: Write the failing tests**

`server/test/ratelimit.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('../src/ratelimit');
const { createClock } = require('./helpers/clock');

test('allows up to max attempts per window, then blocks with a retry hint', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 3, windowMs: 60_000, now: clock.now });
  for (let i = 0; i < 3; i++) assert.equal(limiter.attempt('a').allowed, true);
  clock.advance(10_000);
  const blocked = limiter.attempt('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 50_000);
});

test('the window slides: old attempts stop counting', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 2, windowMs: 1000, now: clock.now });
  limiter.attempt('a');
  clock.advance(600);
  limiter.attempt('a');
  clock.advance(500); // first attempt is now 1100 ms old
  assert.equal(limiter.attempt('a').allowed, true);
  assert.equal(limiter.attempt('a').allowed, false);
});

test('keys are independent and reset clears one', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 1, windowMs: 1000, now: clock.now });
  assert.equal(limiter.attempt('a').allowed, true);
  assert.equal(limiter.attempt('a').allowed, false);
  assert.equal(limiter.attempt('b').allowed, true);
  limiter.reset('a');
  assert.equal(limiter.attempt('a').allowed, true);
});

test('isBlocked does not record; record does', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 2, windowMs: 1000, now: clock.now });
  for (let i = 0; i < 10; i++) assert.equal(limiter.isBlocked('a').blocked, false);
  limiter.record('a');
  limiter.record('a');
  assert.equal(limiter.isBlocked('a').blocked, true);
});

test('memory is bounded: the oldest key is evicted past maxKeys', () => {
  const clock = createClock();
  const limiter = createLimiter({ max: 1, windowMs: 60_000, now: clock.now, maxKeys: 2 });
  limiter.attempt('a');
  limiter.attempt('b');
  limiter.attempt('c'); // evicts 'a'
  assert.equal(limiter.attempt('a').allowed, true);
});
```

`server/test/idempotency.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationCache } = require('../src/idempotency');
const { createClock } = require('./helpers/clock');

const make = (opts = {}) => {
  const clock = createClock();
  return { clock, cache: new OperationCache({ max: 200, ttlMs: 600_000, now: clock.now, ...opts }) };
};

test('a new operation starts, completes, and a duplicate returns the stored result', () => {
  const { cache } = make();
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
  cache.complete('dev', 'op1', { id: 'item-1' });
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'done', result: { id: 'item-1' } });
});

test('operation ids are scoped per device', () => {
  const { cache } = make();
  cache.begin('dev-a', 'op1');
  cache.complete('dev-a', 'op1', { id: 'a' });
  assert.deepEqual(cache.begin('dev-b', 'op1'), { state: 'new' });
});

test('a duplicate of an in-flight operation waits for the first to finish', async () => {
  const { cache } = make();
  cache.begin('dev', 'op1');
  const dup = cache.begin('dev', 'op1');
  assert.equal(dup.state, 'pending');
  cache.complete('dev', 'op1', { id: 'x' });
  assert.deepEqual(await dup.wait, { ok: true, result: { id: 'x' } });
});

test('a failed operation can be retried and wakes its waiters with ok:false', async () => {
  const { cache } = make();
  cache.begin('dev', 'op1');
  const dup = cache.begin('dev', 'op1');
  cache.fail('dev', 'op1');
  assert.deepEqual(await dup.wait, { ok: false });
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
});

test('completed operations expire after the ttl', () => {
  const { cache, clock } = make({ ttlMs: 1000 });
  cache.begin('dev', 'op1');
  cache.complete('dev', 'op1', { id: 'x' });
  clock.advance(1001);
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
});

test('only the newest `max` completed operations are remembered per device', () => {
  const { cache } = make({ max: 2 });
  for (const id of ['a', 'b', 'c']) {
    cache.begin('dev', id);
    cache.complete('dev', id, { id });
  }
  assert.deepEqual(cache.begin('dev', 'a'), { state: 'new' }); // evicted
  assert.equal(cache.begin('dev', 'c').state, 'done');
});

test('forgetDevice drops everything for that device', () => {
  const { cache } = make();
  cache.begin('dev', 'op1');
  cache.complete('dev', 'op1', { id: 'x' });
  cache.forgetDevice('dev');
  assert.deepEqual(cache.begin('dev', 'op1'), { state: 'new' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/ratelimit.test.js test/idempotency.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the implementations**

`server/src/ratelimit.js`:

```js
'use strict';

/** Sliding-window limiter keyed by string (an IP address in practice). */
function createLimiter({ max, windowMs, now = Date.now, maxKeys = 10_000 }) {
  const hits = new Map(); // key -> ascending timestamps

  function prune(key, t) {
    const list = hits.get(key);
    if (!list) return [];
    const cutoff = t - windowMs;
    let drop = 0;
    while (drop < list.length && list[drop] <= cutoff) drop++;
    if (drop) list.splice(0, drop);
    if (!list.length) hits.delete(key);
    return list;
  }

  function isBlocked(key) {
    const t = now();
    const list = prune(key, t);
    if (list.length < max) return { blocked: false, retryAfterMs: 0 };
    return { blocked: true, retryAfterMs: Math.max(0, list[0] + windowMs - t) };
  }

  function record(key) {
    const t = now();
    const list = prune(key, t);
    list.push(t);
    hits.set(key, list);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
  }

  function attempt(key) {
    const state = isBlocked(key);
    if (state.blocked) return { allowed: false, retryAfterMs: state.retryAfterMs };
    record(key);
    return { allowed: true, retryAfterMs: 0 };
  }

  function reset(key) {
    hits.delete(key);
  }

  return { isBlocked, record, attempt, reset };
}

module.exports = { createLimiter };
```

`server/src/idempotency.js`:

```js
'use strict';

/**
 * Remembers client-generated operation ids (X-Operation-Id) per device so a retried
 * send (lost response on flaky Wi-Fi) returns the original result instead of duplicating it.
 */
class OperationCache {
  constructor({ max, ttlMs, now = Date.now }) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.byDevice = new Map(); // deviceId -> Map(opId -> entry)
  }

  _entries(deviceId) {
    let entries = this.byDevice.get(deviceId);
    if (!entries) {
      entries = new Map();
      this.byDevice.set(deviceId, entries);
    }
    const t = this.now();
    for (const [opId, entry] of entries) {
      if (t - entry.at >= this.ttlMs) {
        entries.delete(opId);
        if (entry.state === 'pending') entry.resolve({ ok: false });
      }
    }
    return entries;
  }

  begin(deviceId, opId) {
    const entries = this._entries(deviceId);
    const entry = entries.get(opId);
    if (!entry) {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      entries.set(opId, { state: 'pending', promise, resolve, at: this.now() });
      return { state: 'new' };
    }
    if (entry.state === 'done') return { state: 'done', result: entry.result };
    return { state: 'pending', wait: entry.promise };
  }

  complete(deviceId, opId, result) {
    const entries = this.byDevice.get(deviceId);
    const entry = entries && entries.get(opId);
    if (!entry || entry.state !== 'pending') return;
    entry.state = 'done';
    entry.result = result;
    entry.at = this.now();
    entry.resolve({ ok: true, result });
    // Keep only the newest `max` completed operations; never evict one still in flight.
    for (const [key, value] of entries) {
      if (entries.size <= this.max) break;
      if (value.state === 'done') entries.delete(key);
    }
  }

  fail(deviceId, opId) {
    const entries = this.byDevice.get(deviceId);
    const entry = entries && entries.get(opId);
    if (!entry) return;
    entries.delete(opId);
    if (entry.state === 'pending') entry.resolve({ ok: false });
  }

  forgetDevice(deviceId) {
    const entries = this.byDevice.get(deviceId);
    if (!entries) return;
    for (const entry of entries.values()) if (entry.state === 'pending') entry.resolve({ ok: false });
    this.byDevice.delete(deviceId);
  }
}

module.exports = { OperationCache };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test test/ratelimit.test.js test/idempotency.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/ratelimit.js server/src/idempotency.js server/test/ratelimit.test.js server/test/idempotency.test.js
git commit -m "feat(server): sliding-window rate limiter and operation-id idempotency cache" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Approved-device store

**Files:**
- Create: `server/src/devices.js`
- Test: `server/test/devices.test.js`

**Interfaces:**
- Consumes: `crypto.{sha256Hex, b64uDecode, b64uEncode, safeEqualHex, SIZES}`, `errors.apiError`, `fsutil`, config `limits.maxDevices`, `limits.maxRevokedTombstones`
- Produces `class DeviceStore({ file, now?, limits })`:
  - `count()`, `has(deviceId)`, `canAdd(deviceId)`, `get(deviceId) → publicDevice|null`, `list() → publicDevice[]`
  - `add({ deviceId, name, secret: Buffer(32) }) → { replaced: boolean }` (throws `PAIR_LIMIT` when full and not a re-pair; clears any tombstone)
  - `verify(deviceId, secretB64u) → { result: 'ok'|'bad_secret'|'revoked'|'unknown', device? }`
  - `touch(deviceId, route)`, `flush()`
  - `revoke(deviceId) → boolean` (adds tombstone), `remove(deviceId) → boolean` (forget: no tombstone)
  - `publicDevice = { deviceId, name, pairedAt, lastSeen, lastRoute }` (never the hash)

- [ ] **Step 1: Write the failing test**

`server/test/devices.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../src/crypto');
const { DeviceStore } = require('../src/devices');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');
const { throwsCode } = require('./helpers/assertions');

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function setup(t, limits = {}) {
  const dir = tmpDir(t);
  const file = path.join(dir, 'devices.json');
  const clock = createClock();
  const make = () => new DeviceStore({ file, now: clock.now, limits: { ...DEFAULT_LIMITS, ...limits } });
  return { file, clock, make, store: make() };
}

test('add then verify: ok with the right secret, bad_secret otherwise', (t) => {
  const { store } = setup(t);
  const secret = c.random(32);
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'Pixel 7', secret }), { replaced: false });
  const ok = store.verify(ID_A, c.b64uEncode(secret));
  assert.equal(ok.result, 'ok');
  assert.equal(ok.device.name, 'Pixel 7');
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(32))).result, 'bad_secret');
  assert.equal(store.verify(ID_A, 'not base64url!').result, 'bad_secret');
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(16))).result, 'bad_secret'); // wrong length
});

test('unknown devices are reported as unknown', (t) => {
  const { store } = setup(t);
  assert.equal(store.verify(ID_A, c.b64uEncode(c.random(32))).result, 'unknown');
});

test('only a hash of the secret is written to disk, and the file survives a restart', (t) => {
  const { store, file, make } = setup(t);
  const secret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes(c.b64uEncode(secret)), false);
  assert.equal(raw.includes(secret.toString('hex')), false);
  assert.equal(raw.includes(c.sha256Hex(secret)), true);
  assert.equal(make().verify(ID_A, c.b64uEncode(secret)).result, 'ok');
});

test('public views never contain the hash', (t) => {
  const { store } = setup(t);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret: c.random(32) });
  assert.deepEqual(Object.keys(store.list()[0]).sort(), ['deviceId', 'lastRoute', 'lastSeen', 'name', 'pairedAt']);
  assert.deepEqual(Object.keys(store.get(ID_A)).sort(), ['deviceId', 'lastRoute', 'lastSeen', 'name', 'pairedAt']);
  assert.equal(store.get(ID_B), null);
});

test('re-pairing the same deviceId replaces the secret; the old one stops working at once', (t) => {
  const { store } = setup(t);
  const oldSecret = c.random(32);
  const newSecret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret: oldSecret });
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'Pixel 7 (new)', secret: newSecret }), { replaced: true });
  assert.equal(store.verify(ID_A, c.b64uEncode(oldSecret)).result, 'bad_secret');
  assert.equal(store.verify(ID_A, c.b64uEncode(newSecret)).result, 'ok');
  assert.equal(store.count(), 1);
});

test('revoke removes the device and leaves a tombstone until it re-pairs', (t) => {
  const { store } = setup(t);
  const secret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  assert.equal(store.revoke(ID_A), true);
  assert.equal(store.revoke(ID_A), false);
  assert.equal(store.verify(ID_A, c.b64uEncode(secret)).result, 'revoked');
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  assert.equal(store.verify(ID_A, c.b64uEncode(secret)).result, 'ok');
});

test('remove (forget) leaves no tombstone', (t) => {
  const { store } = setup(t);
  const secret = c.random(32);
  store.add({ deviceId: ID_A, name: 'Pixel 7', secret });
  assert.equal(store.remove(ID_A), true);
  assert.equal(store.verify(ID_A, c.b64uEncode(secret)).result, 'unknown');
});

test('tombstones are capped and survive a restart', (t) => {
  const { store, make } = setup(t, { maxRevokedTombstones: 2 });
  const ids = ['1', '2', '3'].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);
  const secret = c.random(32);
  for (const id of ids) {
    store.add({ deviceId: id, name: 'x', secret });
    store.revoke(id);
  }
  const reloaded = make();
  assert.equal(reloaded.verify(ids[0], c.b64uEncode(secret)).result, 'unknown'); // oldest tombstone dropped
  assert.equal(reloaded.verify(ids[2], c.b64uEncode(secret)).result, 'revoked');
});

test('the device limit applies to new devices but not to re-pairs', (t) => {
  const { store } = setup(t, { maxDevices: 1 });
  store.add({ deviceId: ID_A, name: 'A', secret: c.random(32) });
  assert.equal(store.canAdd(ID_B), false);
  assert.equal(store.canAdd(ID_A), true);
  throwsCode(() => store.add({ deviceId: ID_B, name: 'B', secret: c.random(32) }), 'PAIR_LIMIT');
  assert.deepEqual(store.add({ deviceId: ID_A, name: 'A2', secret: c.random(32) }), { replaced: true });
});

test('add rejects a secret that is not 32 bytes', (t) => {
  const { store } = setup(t);
  assert.throws(() => store.add({ deviceId: ID_A, name: 'A', secret: Buffer.alloc(8) }), TypeError);
});

test('touch records last seen and route, persisted by flush', (t) => {
  const { store, clock, make } = setup(t);
  store.add({ deviceId: ID_A, name: 'A', secret: c.random(32) });
  clock.advance(5000);
  store.touch(ID_A, 'tailscale');
  assert.equal(store.get(ID_A).lastRoute, 'tailscale');
  assert.equal(store.get(ID_A).lastSeen, clock.now());
  store.flush();
  assert.equal(make().get(ID_A).lastRoute, 'tailscale');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/devices.test.js`
Expected: FAIL with `Cannot find module '../src/devices'`.

- [ ] **Step 3: Write the implementation**

`server/src/devices.js`:

```js
'use strict';

const c = require('./crypto');
const { apiError } = require('./errors');
const { readJson, writeJsonAtomic } = require('./fsutil');

const publicView = (rec) => ({
  deviceId: rec.deviceId,
  name: rec.name,
  pairedAt: rec.pairedAt,
  lastSeen: rec.lastSeen,
  lastRoute: rec.lastRoute,
});

/** Approved phones. Secrets are stored only as SHA-256 hashes. */
class DeviceStore {
  constructor({ file, now = Date.now, limits }) {
    this.file = file;
    this.now = now;
    this.limits = limits;
    const data = readJson(file, { devices: [], revoked: [] });
    this.devices = new Map((data.devices || []).map((d) => [d.deviceId, d]));
    this.revoked = Array.isArray(data.revoked) ? data.revoked : [];
    this.dirty = false;
  }

  _save() {
    writeJsonAtomic(this.file, { devices: [...this.devices.values()], revoked: this.revoked });
    this.dirty = false;
  }

  count() {
    return this.devices.size;
  }

  has(deviceId) {
    return this.devices.has(deviceId);
  }

  canAdd(deviceId) {
    return this.devices.has(deviceId) || this.devices.size < this.limits.maxDevices;
  }

  get(deviceId) {
    const rec = this.devices.get(deviceId);
    return rec ? publicView(rec) : null;
  }

  list() {
    return [...this.devices.values()].map(publicView);
  }

  /** Adds a device or, if the deviceId is already paired, replaces its secret (re-pair). */
  add({ deviceId, name, secret }) {
    if (!Buffer.isBuffer(secret) || secret.length !== c.SIZES.secret) throw new TypeError('secret must be 32 bytes');
    if (!this.canAdd(deviceId)) throw apiError('PAIR_LIMIT');
    const replaced = this.devices.has(deviceId);
    this.devices.set(deviceId, {
      deviceId,
      name,
      secretHash: c.sha256Hex(secret),
      pairedAt: this.now(),
      lastSeen: null,
      lastRoute: null,
    });
    this.revoked = this.revoked.filter((r) => r.deviceId !== deviceId);
    this._save();
    return { replaced };
  }

  verify(deviceId, secretB64u) {
    const rec = this.devices.get(deviceId);
    if (!rec) return { result: this.revoked.some((r) => r.deviceId === deviceId) ? 'revoked' : 'unknown' };
    let secret;
    try {
      secret = c.b64uDecode(secretB64u, c.SIZES.secret);
    } catch {
      return { result: 'bad_secret' };
    }
    if (!c.safeEqualHex(rec.secretHash, c.sha256Hex(secret))) return { result: 'bad_secret' };
    return { result: 'ok', device: publicView(rec) };
  }

  touch(deviceId, route) {
    const rec = this.devices.get(deviceId);
    if (!rec) return;
    rec.lastSeen = this.now();
    rec.lastRoute = route || rec.lastRoute;
    this.dirty = true;
  }

  flush() {
    if (this.dirty) this._save();
  }

  /** Laptop-side revoke: remove and remember, so that phone gets DEVICE_REVOKED instead of a generic 401. */
  revoke(deviceId) {
    if (!this.devices.delete(deviceId)) return false;
    this.revoked.push({ deviceId, revokedAt: this.now() });
    while (this.revoked.length > this.limits.maxRevokedTombstones) this.revoked.shift();
    this._save();
    return true;
  }

  /** Phone-side forget: remove without a tombstone. */
  remove(deviceId) {
    if (!this.devices.delete(deviceId)) return false;
    this._save();
    return true;
  }
}

module.exports = { DeviceStore };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/devices.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/devices.js server/test/devices.test.js
git commit -m "feat(server): approved-device store (hashed secrets, revoke tombstones, re-pair)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Session store

**Files:**
- Create: `server/src/sessions.js`
- Test: `server/test/sessions.test.js`

**Interfaces:**
- Consumes: `crypto.{random, b64uEncode, b64uDecode, sha256Hex, SIZES}`
- Produces `class SessionStore extends EventEmitter ({ idleMs, maxMs, now? })`:
  - `create(deviceId) → { token, expiresAt }` (ends the device's previous session with reason `replaced`)
  - `verify(token) → { deviceId, expiresAt } | null` (extends idle window; ends and returns null when expired)
  - `endByToken(token, reason = 'disconnected') → boolean`, `endForDevice(deviceId, reason) → boolean`, `endAll(reason)`
  - `isConnected(deviceId) → boolean`, `connectedDeviceIds() → string[]`, `sweep()`
  - emits `'end'` with `{ deviceId, reason }` where reason ∈ `replaced | disconnected | revoked | expired | shutdown`

- [ ] **Step 1: Write the failing test**

`server/test/sessions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/sessions');
const { createClock } = require('./helpers/clock');

const HOUR = 3600 * 1000;
const make = (opts = {}) => {
  const clock = createClock();
  const store = new SessionStore({ idleMs: 24 * HOUR, maxMs: 7 * 24 * HOUR, now: clock.now, ...opts });
  const ended = [];
  store.on('end', (e) => ended.push(e));
  return { clock, store, ended };
};

test('create then verify returns the device', () => {
  const { store, clock } = make();
  const { token, expiresAt } = store.create('dev');
  assert.equal(token.length, 43); // 32 bytes, base64url
  assert.equal(expiresAt, clock.now() + 24 * HOUR);
  assert.equal(store.verify(token).deviceId, 'dev');
  assert.equal(store.isConnected('dev'), true);
});

test('unknown, malformed and empty tokens verify to null', () => {
  const { store } = make();
  assert.equal(store.verify('nope'), null);
  assert.equal(store.verify(''), null);
  assert.equal(store.verify(undefined), null);
  assert.equal(store.verify('A'.repeat(43)), null);
});

test('a device has one active session: creating another ends the first', () => {
  const { store, ended } = make();
  const first = store.create('dev');
  const second = store.create('dev');
  assert.equal(store.verify(first.token), null);
  assert.equal(store.verify(second.token).deviceId, 'dev');
  assert.deepEqual(ended, [{ deviceId: 'dev', reason: 'replaced' }]);
});

test('activity extends the idle window', () => {
  const { store, clock } = make();
  const { token } = store.create('dev');
  clock.advance(20 * HOUR);
  assert.ok(store.verify(token));
  clock.advance(20 * HOUR); // 40 h since creation, 20 h since last use
  assert.ok(store.verify(token));
});

test('idle timeout ends the session', () => {
  const { store, clock, ended } = make();
  const { token } = store.create('dev');
  clock.advance(24 * HOUR);
  assert.equal(store.verify(token), null);
  assert.equal(store.isConnected('dev'), false);
  assert.deepEqual(ended, [{ deviceId: 'dev', reason: 'expired' }]);
});

test('the absolute lifetime cannot be extended by activity', () => {
  const { store, clock } = make();
  const { token } = store.create('dev');
  for (let visit = 1; visit <= 7; visit++) {
    clock.advance(23 * HOUR); // always inside the 24 h idle window
    assert.ok(store.verify(token), `still valid on visit ${visit} (${visit * 23} h)`);
  }
  clock.advance(23 * HOUR); // 184 h since creation, only 23 h idle: the 7 day (168 h) cap ends it
  assert.equal(store.verify(token), null);
});

test('endByToken, endForDevice and endAll', () => {
  const { store, ended } = make();
  const a = store.create('a');
  store.create('b');
  store.create('c');
  assert.equal(store.endByToken(a.token), true);
  assert.equal(store.endByToken(a.token), false);
  assert.equal(store.endForDevice('b', 'revoked'), true);
  store.endAll('shutdown');
  assert.deepEqual(ended, [
    { deviceId: 'a', reason: 'disconnected' },
    { deviceId: 'b', reason: 'revoked' },
    { deviceId: 'c', reason: 'shutdown' },
  ]);
  assert.deepEqual(store.connectedDeviceIds(), []);
});

test('sweep ends expired sessions that were never used again', () => {
  const { store, clock, ended } = make();
  store.create('dev');
  clock.advance(25 * HOUR);
  store.sweep();
  assert.deepEqual(ended, [{ deviceId: 'dev', reason: 'expired' }]);
});

test('connectedDeviceIds lists live devices only', () => {
  const { store, clock } = make();
  store.create('a');
  clock.advance(HOUR);
  store.create('b');
  assert.deepEqual(store.connectedDeviceIds().sort(), ['a', 'b']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/sessions.test.js`
Expected: FAIL with `Cannot find module '../src/sessions'`.

- [ ] **Step 3: Write the implementation**

`server/src/sessions.js`:

```js
'use strict';

const { EventEmitter } = require('node:events');
const c = require('./crypto');

/**
 * In-memory session tokens, one active session per device.
 * Tokens are indexed by their SHA-256 so lookups do not depend on comparing the raw token.
 */
class SessionStore extends EventEmitter {
  constructor({ idleMs, maxMs, now = Date.now }) {
    super();
    this.idleMs = idleMs;
    this.maxMs = maxMs;
    this.now = now;
    this.byKey = new Map(); // sha256(token) -> session
    this.byDevice = new Map(); // deviceId -> session
  }

  _expiry(session) {
    return Math.min(session.lastUsed + this.idleMs, session.createdAt + this.maxMs);
  }

  _end(session, reason) {
    this.byKey.delete(session.key);
    if (this.byDevice.get(session.deviceId) === session) this.byDevice.delete(session.deviceId);
    this.emit('end', { deviceId: session.deviceId, reason });
  }

  _lookup(tokenB64u) {
    let raw;
    try {
      raw = c.b64uDecode(tokenB64u, c.SIZES.token);
    } catch {
      return null;
    }
    return this.byKey.get(c.sha256Hex(raw)) || null;
  }

  create(deviceId) {
    this.endForDevice(deviceId, 'replaced');
    const raw = c.random(c.SIZES.token);
    const t = this.now();
    const session = { deviceId, key: c.sha256Hex(raw), createdAt: t, lastUsed: t };
    this.byKey.set(session.key, session);
    this.byDevice.set(deviceId, session);
    return { token: c.b64uEncode(raw), expiresAt: this._expiry(session) };
  }

  verify(tokenB64u) {
    const session = this._lookup(tokenB64u);
    if (!session) return null;
    const t = this.now();
    if (t >= this._expiry(session)) {
      this._end(session, 'expired');
      return null;
    }
    session.lastUsed = t;
    return { deviceId: session.deviceId, expiresAt: this._expiry(session) };
  }

  endByToken(tokenB64u, reason = 'disconnected') {
    const session = this._lookup(tokenB64u);
    if (!session) return false;
    this._end(session, reason);
    return true;
  }

  endForDevice(deviceId, reason) {
    const session = this.byDevice.get(deviceId);
    if (!session) return false;
    this._end(session, reason);
    return true;
  }

  endAll(reason) {
    for (const session of [...this.byKey.values()]) this._end(session, reason);
  }

  isConnected(deviceId) {
    const session = this.byDevice.get(deviceId);
    if (!session) return false;
    if (this.now() >= this._expiry(session)) {
      this._end(session, 'expired');
      return false;
    }
    return true;
  }

  connectedDeviceIds() {
    return [...this.byDevice.keys()].filter((id) => this.isConnected(id));
  }

  sweep() {
    for (const session of [...this.byKey.values()]) {
      if (this.now() >= this._expiry(session)) this._end(session, 'expired');
    }
  }
}

module.exports = { SessionStore };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/sessions.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions.js server/test/sessions.test.js
git commit -m "feat(server): session store (one per device, idle and absolute expiry)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Pairing state machine

**Files:**
- Create: `server/src/pairing.js`
- Test: `server/test/pairing.test.js`

**Interfaces:**
- Consumes: `DeviceStore` (`has`, `canAdd`, `add`), `crypto.*`, `errors.apiError`, `validate.{isUuid, cleanName}`, `ratelimit.createLimiter`, config `limits`
- Produces `class PairingManager extends EventEmitter ({ devices, fingerprint: Buffer(32), limits, now?, rng? })`:
  - `request({ deviceId, deviceName, commit, remoteIp, route }) → { requestId, nl }` (both base64url)
  - `reveal({ requestId, np }) → {}`
  - `approve(requestId) → { deviceId, replaced }`; `deny(requestId)`
  - `status({ requestId, deviceId, proof }) → { state:'pending' } | { state:'approved', secret }`; throws `PAIR_NOT_FOUND` / `PAIR_EXPIRED` / `PAIR_DENIED`
  - `waitForChange(requestId, timeoutMs) → Promise<void>`
  - `listPending() → view[]` where `view = { requestId, deviceId, deviceName, sas, sasDisplay, createdAt, expiresAt, remoteIp, route, isRepair }`
  - `sweep()`
  - events: `'pending'` (view, when a request becomes visible), `'resolved'` (`{ requestId, deviceId, state:'approved'|'denied' }`), `'device-replaced'` (`{ deviceId }`)

- [ ] **Step 1: Write the failing test**

`server/test/pairing.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const c = require('../src/crypto');
const { DeviceStore } = require('../src/devices');
const { PairingManager } = require('../src/pairing');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');
const { throwsCode } = require('./helpers/assertions');

function setup(t, limits = {}) {
  const clock = createClock();
  const allLimits = { ...DEFAULT_LIMITS, ...limits };
  const devices = new DeviceStore({ file: path.join(tmpDir(t), 'devices.json'), now: clock.now, limits: allLimits });
  const fingerprint = Buffer.alloc(32, 7);
  const pairing = new PairingManager({ devices, fingerprint, limits: allLimits, now: clock.now });
  return { clock, devices, fingerprint, pairing };
}

/** The phone's side of the protocol, built only from the shared primitives. */
function newPhone(fingerprint, deviceId = crypto.randomUUID()) {
  const np = c.random(16);
  return {
    deviceId,
    np,
    npB64: c.b64uEncode(np),
    commit: c.b64uEncode(c.commitOf(np)),
    proof: (requestId) => c.pairProof(np, c.b64uDecode(requestId, 16), deviceId),
    sas: (nl) => c.sasCode(fingerprint, np, c.b64uDecode(nl, 16)),
  };
}

const begin = (pairing, phone, extra = {}) =>
  pairing.request({
    deviceId: phone.deviceId,
    deviceName: 'Pixel 7',
    commit: phone.commit,
    remoteIp: '192.168.1.20',
    route: 'lan',
    ...extra,
  });

function revealed(pairing, phone, extra) {
  const { requestId, nl } = begin(pairing, phone, extra);
  pairing.reveal({ requestId, np: phone.npB64 });
  return { requestId, nl };
}

const statusOf = (pairing, phone, requestId) =>
  pairing.status({ requestId, deviceId: phone.deviceId, proof: phone.proof(requestId) });

test('happy path: both sides compute the same code and approval releases the secret to the proven caller', (t) => {
  const { pairing, devices, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const seen = [];
  pairing.on('pending', (view) => seen.push(view));

  const { requestId, nl } = begin(pairing, phone);
  assert.equal(pairing.listPending().length, 0, 'not visible before the reveal');
  pairing.reveal({ requestId, np: phone.npB64 });

  const [view] = pairing.listPending();
  assert.equal(view.sas, phone.sas(nl));
  assert.equal(view.sasDisplay, c.formatSas(view.sas));
  assert.equal(view.deviceName, 'Pixel 7');
  assert.equal(view.route, 'lan');
  assert.equal(view.isRepair, false);
  assert.deepEqual(Object.keys(view).sort(), [
    'createdAt', 'deviceId', 'deviceName', 'expiresAt', 'isRepair', 'remoteIp', 'requestId', 'route', 'sas', 'sasDisplay',
  ]);
  assert.equal(seen.length, 1);
  assert.deepEqual(statusOf(pairing, phone, requestId), { state: 'pending' });

  const resolved = [];
  pairing.on('resolved', (e) => resolved.push(e));
  assert.deepEqual(pairing.approve(requestId), { deviceId: phone.deviceId, replaced: false });
  assert.deepEqual(resolved, [{ requestId, deviceId: phone.deviceId, state: 'approved' }]);

  const done = statusOf(pairing, phone, requestId);
  assert.equal(done.state, 'approved');
  assert.equal(devices.verify(phone.deviceId, done.secret).result, 'ok');
  assert.equal(pairing.listPending().length, 0);
});

test('a wrong np at reveal is COMMIT_MISMATCH and kills the request', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId, np: c.b64uEncode(c.random(16)) }), 'COMMIT_MISMATCH');
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'PAIR_NOT_FOUND');
});

test('a tampered commit makes the honest reveal fail', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone, { commit: c.b64uEncode(c.random(32)) });
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'COMMIT_MISMATCH');
});

test('the reveal cannot be done twice', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'BAD_REQUEST');
});

test('an unrevealed request expires after the 10 second reveal window, freeing its slot', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  clock.advance(10_001);
  throwsCode(() => pairing.reveal({ requestId, np: phone.npB64 }), 'PAIR_EXPIRED');
});

test('a revealed request expires after 2 minutes', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  clock.advance(120_001);
  throwsCode(() => pairing.approve(requestId), 'PAIR_EXPIRED');
  assert.equal(pairing.listPending().length, 0);
});

test('approving before the reveal is not possible', (t) => {
  const { pairing, fingerprint } = setup(t);
  const { requestId } = begin(pairing, newPhone(fingerprint));
  throwsCode(() => pairing.approve(requestId), 'PAIR_NOT_FOUND');
});

test('input validation', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  throwsCode(() => begin(pairing, phone, { deviceId: 'nope' }), 'BAD_REQUEST');
  throwsCode(() => begin(pairing, phone, { deviceName: '   ' }), 'BAD_REQUEST');
  throwsCode(() => begin(pairing, phone, { commit: 'short' }), 'BAD_REQUEST');
  throwsCode(() => pairing.reveal({ requestId: 'unknown', np: phone.npB64 }), 'PAIR_NOT_FOUND');
});

test('pairing spam from one address is rate limited (5 per minute)', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  for (let i = 0; i < 5; i++) begin(pairing, phone); // same device: each replaces the previous request
  throwsCode(() => begin(pairing, phone), 'RATE_LIMITED');
});

test('at most 3 pairing requests can be open at once', (t) => {
  const { pairing, fingerprint } = setup(t);
  for (let i = 0; i < 3; i++) begin(pairing, newPhone(fingerprint), { remoteIp: `10.0.0.${i}` });
  throwsCode(() => begin(pairing, newPhone(fingerprint), { remoteIp: '10.0.0.9' }), 'PAIR_LIMIT');
});

test('a new request from the same device replaces its previous one', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const first = begin(pairing, phone);
  const second = begin(pairing, phone);
  throwsCode(() => pairing.reveal({ requestId: first.requestId, np: phone.npB64 }), 'PAIR_NOT_FOUND');
  pairing.reveal({ requestId: second.requestId, np: phone.npB64 });
  assert.equal(pairing.listPending().length, 1);
});

test('status gives one indistinguishable answer for unknown id, wrong device, wrong or missing proof', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const other = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  const bogusId = c.b64uEncode(c.random(16));

  const attempts = [
    () => pairing.status({ requestId: bogusId, deviceId: phone.deviceId, proof: phone.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: other.deviceId, proof: phone.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId, proof: 'a'.repeat(64) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId, proof: other.proof(requestId) }),
    () => pairing.status({ requestId, deviceId: phone.deviceId }),
    () => pairing.status({ requestId: 42, deviceId: phone.deviceId, proof: 'x' }),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (err) => err.code === 'PAIR_NOT_FOUND' && err.message === 'Pairing request not found.');
  }
});

test('status before the reveal is PAIR_NOT_FOUND (the laptop does not know np yet)', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = begin(pairing, phone);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('deny: the phone learns PAIR_DENIED once, then the request is gone', (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  pairing.deny(requestId);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_DENIED');
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('the secret can be re-fetched with the proof for 60 seconds, then it is gone', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);
  pairing.approve(requestId);
  const first = statusOf(pairing, phone, requestId);
  clock.advance(59_000);
  assert.equal(statusOf(pairing, phone, requestId).secret, first.secret);
  clock.advance(2_000);
  throwsCode(() => statusOf(pairing, phone, requestId), 'PAIR_NOT_FOUND');
});

test('re-pair replaces the secret, flags the request, and announces the replacement', (t) => {
  const { pairing, devices, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const first = revealed(pairing, phone);
  pairing.approve(first.requestId);
  const oldSecret = statusOf(pairing, phone, first.requestId).secret;

  const replaced = [];
  pairing.on('device-replaced', (e) => replaced.push(e));
  const again = newPhone(fingerprint, phone.deviceId);
  const second = revealed(pairing, again);
  assert.equal(pairing.listPending()[0].isRepair, true);
  assert.deepEqual(pairing.approve(second.requestId), { deviceId: phone.deviceId, replaced: true });
  const newSecret = statusOf(pairing, again, second.requestId).secret;

  assert.deepEqual(replaced, [{ deviceId: phone.deviceId }]);
  assert.equal(devices.verify(phone.deviceId, oldSecret).result, 'bad_secret');
  assert.equal(devices.verify(phone.deviceId, newSecret).result, 'ok');
});

test('the device limit is enforced at request time for new devices', (t) => {
  const { pairing, fingerprint } = setup(t, { maxDevices: 1 });
  const first = newPhone(fingerprint);
  pairing.approve(revealed(pairing, first).requestId);
  throwsCode(() => begin(pairing, newPhone(fingerprint), { remoteIp: '10.0.0.5' }), 'PAIR_LIMIT');
  begin(pairing, newPhone(fingerprint, first.deviceId), { remoteIp: '10.0.0.6' }); // a re-pair is still allowed
});

test('waitForChange resolves as soon as the request is approved, and times out otherwise', async (t) => {
  const { pairing, fingerprint } = setup(t);
  const phone = newPhone(fingerprint);
  const { requestId } = revealed(pairing, phone);

  const started = Date.now();
  const waiting = pairing.waitForChange(requestId, 5000);
  setTimeout(() => pairing.approve(requestId), 20);
  await waiting;
  assert.ok(Date.now() - started < 2000, 'resolved by the approval, not by the timeout');

  const timedOut = Date.now();
  await pairing.waitForChange(requestId, 30);
  assert.ok(Date.now() - timedOut >= 25);
});

test('sweep removes expired requests and wipes expired secrets', (t) => {
  const { pairing, fingerprint, clock } = setup(t);
  const a = newPhone(fingerprint);
  const b = newPhone(fingerprint);
  revealed(pairing, a, { remoteIp: '10.0.0.1' });
  const bReq = revealed(pairing, b, { remoteIp: '10.0.0.2' });
  pairing.approve(bReq.requestId);
  clock.advance(121_000);
  pairing.sweep();
  assert.equal(pairing.listPending().length, 0);
  throwsCode(() => statusOf(pairing, b, bReq.requestId), 'PAIR_NOT_FOUND');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/pairing.test.js`
Expected: FAIL with `Cannot find module '../src/pairing'`.

- [ ] **Step 3: Write the implementation**

`server/src/pairing.js`:

```js
'use strict';

const { EventEmitter } = require('node:events');
const c = require('./crypto');
const { apiError } = require('./errors');
const { isUuid, cleanName } = require('./validate');
const { createLimiter } = require('./ratelimit');

const isOpen = (rec) => rec.state === 'awaiting_reveal' || rec.state === 'pending';

/**
 * The pairing state machine (spec §3.2). A record goes:
 *   awaiting_reveal → pending → approved | denied        (or is removed on expiry / mismatch)
 * The phone commits to its nonce first; the laptop picks its own nonce after seeing the commit.
 */
class PairingManager extends EventEmitter {
  constructor({ devices, fingerprint, limits, now = Date.now, rng = c.random }) {
    super();
    this.devices = devices;
    this.fingerprint = fingerprint;
    this.limits = limits;
    this.now = now;
    this.rng = rng;
    this.requests = new Map(); // requestId -> record
    this.waiters = new Map(); // requestId -> Set<() => void>
    this.limiter = createLimiter({ max: limits.maxPairRequestsPerMinutePerIp, windowMs: 60_000, now });
  }

  // ---- internals -----------------------------------------------------------

  _view(rec) {
    return {
      requestId: rec.requestId,
      deviceId: rec.deviceId,
      deviceName: rec.deviceName,
      sas: rec.sas,
      sasDisplay: c.formatSas(rec.sas),
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      remoteIp: rec.remoteIp,
      route: rec.route,
      isRepair: rec.isRepair,
    };
  }

  _isExpired(rec) {
    const t = this.now();
    if (rec.state === 'awaiting_reveal') return t >= rec.revealBy;
    if (rec.state === 'pending') return t >= rec.expiresAt;
    if (rec.state === 'approved') return t >= rec.secretUntil;
    return t >= rec.expiresAt; // denied
  }

  _notify(requestId) {
    const set = this.waiters.get(requestId);
    if (set) for (const wake of [...set]) wake();
  }

  _delete(rec) {
    if (rec.secret) rec.secret.fill(0);
    this.requests.delete(rec.requestId);
    this._notify(rec.requestId);
  }

  /** Looks a request up, treating an expired one as gone (throws PAIR_EXPIRED once, then it no longer exists). */
  _get(requestId) {
    const rec = typeof requestId === 'string' ? this.requests.get(requestId) : undefined;
    if (!rec) throw apiError('PAIR_NOT_FOUND');
    if (this._isExpired(rec)) {
      this._delete(rec);
      throw apiError('PAIR_EXPIRED');
    }
    return rec;
  }

  _openCount() {
    let n = 0;
    for (const rec of this.requests.values()) if (isOpen(rec)) n++;
    return n;
  }

  // ---- phone-facing --------------------------------------------------------

  request({ deviceId, deviceName, commit, remoteIp, route }) {
    if (!isUuid(deviceId)) throw apiError('BAD_REQUEST', 'deviceId must be a UUID.');
    const name = cleanName(deviceName);
    if (!name) throw apiError('BAD_REQUEST', 'deviceName is required.');
    let commitBuf;
    try {
      commitBuf = c.b64uDecode(commit, 32);
    } catch {
      throw apiError('BAD_REQUEST', 'commit must be 32 bytes, base64url.');
    }
    const gate = this.limiter.attempt(remoteIp || 'unknown');
    if (!gate.allowed) throw apiError('RATE_LIMITED', undefined, { retryAfterMs: gate.retryAfterMs });

    this.sweep();
    for (const rec of [...this.requests.values()]) {
      if (rec.deviceId === deviceId && isOpen(rec)) this._delete(rec); // a device's new request replaces its old one
    }
    if (this._openCount() >= this.limits.maxPendingPairings) throw apiError('PAIR_LIMIT');
    if (!this.devices.canAdd(deviceId)) throw apiError('PAIR_LIMIT');

    const t = this.now();
    const rec = {
      requestId: c.b64uEncode(this.rng(c.SIZES.requestId)),
      deviceId,
      deviceName: name,
      commit: commitBuf,
      nl: this.rng(c.SIZES.nonce),
      np: null,
      state: 'awaiting_reveal',
      sas: null,
      createdAt: t,
      revealBy: t + this.limits.pairRevealWindowMs,
      expiresAt: t + this.limits.pairExpiryMs,
      remoteIp: remoteIp || 'unknown',
      route: route || 'other',
      isRepair: this.devices.has(deviceId),
      secret: null,
      secretUntil: 0,
    };
    this.requests.set(rec.requestId, rec);
    return { requestId: rec.requestId, nl: c.b64uEncode(rec.nl) };
  }

  reveal({ requestId, np }) {
    const rec = this._get(requestId);
    if (rec.state !== 'awaiting_reveal') throw apiError('BAD_REQUEST', 'This request was already revealed.');
    let npBuf;
    try {
      npBuf = c.b64uDecode(np, c.SIZES.nonce);
    } catch {
      throw apiError('BAD_REQUEST', 'np must be 16 bytes, base64url.');
    }
    if (!c.safeEqualHex(c.commitOf(npBuf).toString('hex'), rec.commit.toString('hex'))) {
      this._delete(rec);
      throw apiError('COMMIT_MISMATCH');
    }
    rec.np = npBuf;
    rec.sas = c.sasCode(this.fingerprint, npBuf, rec.nl);
    rec.state = 'pending';
    this.emit('pending', this._view(rec));
    return {};
  }

  /** Result of a pairing request. Every failure to prove knowledge of np is the same PAIR_NOT_FOUND. */
  status({ requestId, deviceId, proof }) {
    const rec = typeof requestId === 'string' ? this.requests.get(requestId) : undefined;
    if (!rec || !rec.np || deviceId !== rec.deviceId) throw apiError('PAIR_NOT_FOUND');
    let expected;
    try {
      expected = c.pairProof(rec.np, c.b64uDecode(requestId, c.SIZES.requestId), rec.deviceId);
    } catch {
      throw apiError('PAIR_NOT_FOUND');
    }
    if (!c.safeEqualHex(expected, proof)) throw apiError('PAIR_NOT_FOUND');

    if (this._isExpired(rec)) {
      const wasApproved = rec.state === 'approved';
      this._delete(rec);
      throw apiError(wasApproved ? 'PAIR_NOT_FOUND' : 'PAIR_EXPIRED');
    }
    if (rec.state === 'denied') {
      this._delete(rec);
      throw apiError('PAIR_DENIED');
    }
    if (rec.state === 'approved') return { state: 'approved', secret: c.b64uEncode(rec.secret) };
    return { state: 'pending' };
  }

  /** Resolves when the request changes state, or after timeoutMs (used for long-polling). */
  waitForChange(requestId, timeoutMs) {
    return new Promise((resolve) => {
      let set = this.waiters.get(requestId);
      if (!set) {
        set = new Set();
        this.waiters.set(requestId, set);
      }
      const wake = () => {
        clearTimeout(timer);
        set.delete(wake);
        if (!set.size) this.waiters.delete(requestId);
        resolve();
      };
      const timer = setTimeout(wake, timeoutMs);
      set.add(wake);
    });
  }

  // ---- laptop-facing -------------------------------------------------------

  listPending() {
    this.sweep();
    return [...this.requests.values()]
      .filter((rec) => rec.state === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((rec) => this._view(rec));
  }

  approve(requestId) {
    const rec = this._get(requestId);
    if (rec.state !== 'pending') throw apiError('PAIR_NOT_FOUND');
    const secret = this.rng(c.SIZES.secret);
    const { replaced } = this.devices.add({ deviceId: rec.deviceId, name: rec.deviceName, secret });
    rec.state = 'approved';
    rec.secret = secret;
    rec.secretUntil = this.now() + this.limits.pairSecretWindowMs;
    rec.isRepair = replaced;
    if (replaced) this.emit('device-replaced', { deviceId: rec.deviceId });
    this.emit('resolved', { requestId, deviceId: rec.deviceId, state: 'approved' });
    this._notify(requestId);
    return { deviceId: rec.deviceId, replaced };
  }

  deny(requestId) {
    const rec = this._get(requestId);
    if (rec.state !== 'pending') throw apiError('PAIR_NOT_FOUND');
    rec.state = 'denied';
    this.emit('resolved', { requestId, deviceId: rec.deviceId, state: 'denied' });
    this._notify(requestId);
  }

  sweep() {
    for (const rec of [...this.requests.values()]) if (this._isExpired(rec)) this._delete(rec);
  }
}

module.exports = { PairingManager };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/pairing.test.js`
Expected: PASS (19 tests).

- [ ] **Step 5: Run the whole suite**

Run: `cd server && npm test`
Expected: PASS, every file green, no leftover handles (the process exits on its own).

- [ ] **Step 6: Commit**

```bash
git add server/src/pairing.js server/test/pairing.test.js
git commit -m "feat(server): pairing state machine (commit-reveal SAS, proof-gated secret, re-pair)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation for the security core

**Files:**
- Create: `docs/pairing.md`
- Modify: `docs/decisions.md`, `docs/README.md`, `CHANGELOG.md`

- [ ] **Step 1: Write `docs/pairing.md`**

````markdown
# Pairing protocol

The exact byte-level protocol between the phone and the laptop for the first connection (and for re-pairing). Design rationale: spec §3.2. Reference implementation: `server/src/crypto.js` and `server/src/pairing.js`. The Flutter app must reproduce the known-answer vectors below.

## Goals

1. The laptop only ever gives a secret to a phone the user approved on the laptop.
2. A network attacker between phone and laptop cannot make the two 6-digit codes match (probability 1 in 1,000,000 per attempt).
3. Someone who learns a `requestId` still cannot obtain the secret.

## Values

| Name | Size | Chosen by | Notes |
|---|---|---|---|
| `fp` | 32 bytes | laptop | SHA-256 of the DER leaf certificate. The phone uses the fingerprint of the certificate its TLS session actually presented |
| `np` | 16 bytes | phone | cryptographic RNG |
| `nl` | 16 bytes | laptop | cryptographic RNG, chosen after the commit is received |
| `requestId` | 16 bytes | laptop | cryptographic RNG, never sequential |
| device secret | 32 bytes | laptop | returned once (re-fetchable for 60 s), stored only as SHA-256 |
| session token | 32 bytes | laptop | memory only |

On the wire every binary value is **base64url without padding, canonical** (a decoder rejects padding, other alphabets, whitespace and non-canonical trailing bits).

## Functions

All `‖` are raw-byte concatenation with no separators or length prefixes. Labels are ASCII.

```
commit  = SHA256( "FLASHPUSH-COMMIT-v1" ‖ np )
sasHash = SHA256( "FLASHPUSH-SAS-v1" ‖ fp ‖ np ‖ nl )
SAS     = decimal( uint32_big_endian(sasHash[0..4]) mod 1,000,000 ), zero-padded to 6 digits
shown   = SAS[0..3] + " " + SAS[3..6]                     e.g. "001 004"
proof   = hex( HMAC-SHA256( key = np, "FLASHPUSH-STATUS-v1" ‖ requestId ‖ UTF-8(deviceId) ) )
```

## Message flow

```
Phone                                                   Laptop
  |  POST /v1/pair/request {deviceId, deviceName, commit}  |
  |------------------------------------------------------->|  picks nl (after seeing commit)
  |  {requestId, nl}                                       |
  |<-------------------------------------------------------|
  |  POST /v1/pair/reveal {requestId, np}                  |  checks commit == SHA256(label ‖ np)
  |------------------------------------------------------->|  computes SAS, shows the approval card
  |  GET /v1/pair/status/:requestId  (X-Pair-Proof: proof) |
  |------------------------------------------------------->|  ... user compares codes, clicks Approve
  |  {state:"approved", secret, ...}                       |
  |<-------------------------------------------------------|
```

Both screens show the SAS; the user approves only if they match.

## Timing and limits

| Rule | Value |
|---|---|
| Reveal must arrive within | 10 s of the request (otherwise `PAIR_EXPIRED`) |
| Request lifetime | 2 min |
| Secret re-fetch window after approval | 60 s (proof required), then erased |
| Open requests | max 3; a device's new request replaces its old one |
| Requests per IP | 5 per minute |
| Paired devices | max 20 |

## Why the commit–reveal matters

Without it, a man-in-the-middle can try many nonces offline until the two codes collide. With it, `nl` exists only after the phone has committed to `np`, and `np` is revealed only after the phone has received `nl`, so an attacker must fix both legs' inputs before seeing the other side's random value.

## Error responses

A wrong `np` gives `COMMIT_MISMATCH` and the request is dropped. On the status route, an unknown request, a different `deviceId`, a missing or wrong proof, or a request whose `np` is not yet known **all** return the same `PAIR_NOT_FOUND` so the route cannot be used to test guesses.

## Known-answer test vectors

Inputs: `fp` = bytes `00 01 … 1f` (32 bytes); `np` = `10 11 … 1f`; `nl` = `20 21 … 2f`; `requestId` = `30 31 … 3f`; `deviceId` = `11111111-2222-3333-4444-555555555555`.

| Value | Result |
|---|---|
| `np` (base64url) | `EBESExQVFhcYGRobHB0eHw` |
| `requestId` (base64url) | `MDEyMzQ1Njc4OTo7PD0-Pw` |
| `commit` (hex) | `148f8a90dd839457dc23e50843a84c96c73365433d7277efea17c04322b1e017` |
| `commit` (base64url) | `FI-KkN2DlFfcI-UIQ6hMlsczZUM9cnfv6hfAQyKx4Bc` |
| `SAS` | `001004` (shown `001 004`), also tests zero padding |
| `proof` (hex) | `01b5a81d7a92704f2e4bda8b6a8e86f78f88a470b7e0bca9b6b668d7b2a035f5` |

These are asserted in `server/test/crypto.test.js`; the Flutter tests must assert the same values.
````

- [ ] **Step 2: Confirm the reveal window is in the spec**

The 10 second reveal window was added to spec §3.2 (the `**Limits:**` line) on 2026-09-21 when this plan was written. Verify it is still there; nothing to edit.

- [ ] **Step 3: Update decisions, docs index and changelog**

Append to `docs/decisions.md`:

```markdown

## Plan 1A — server security core

| Decision | Choice | Why |
|---|---|---|
| Unrevealed pair requests | expire after 10 s (`pairRevealWindowMs`) | the phone reveals immediately; otherwise 3 unrevealed requests could block pairing for 2 minutes |
| Certificate library | `selfsigned` 5.x (`keyType: 'ec'`, `notAfterDate`) | pure JS, supports P-256; `days` is not an option in this version |
| Timing/randomness | injectable `now` and `rng` | every expiry rule is tested with a fake clock, no sleeping |
| State files | `%APPDATA%\FlashPush`, atomic JSON writes | survives crashes; independent of the launch directory |
```

In `docs/README.md`, change the `pairing.md` row so it links to the written file, e.g. `| [pairing.md](pairing.md) | exact pairing crypto + test vectors | written (Plan 1A) |`, and keep `connection-state.md`, `transfers.md` as "written during implementation". Add a row for the plans: `| [superpowers/plans/](superpowers/plans/2026-09-21-v2-plan-index.md) | implementation plans (index + Plan 1A written) | Plan 1A done |` (replace the existing plans row).

Add to `CHANGELOG.md` under a new dated heading for the day the work is done:

```markdown
### Added
- Server security core (Plan 1A): config, error envelope, atomic JSON files, pairing crypto with known-answer vectors, laptop identity and EC P-256 certificate, approved-device store, sessions, rate limiter, idempotency cache, pairing state machine, all unit-tested (`npm test`).
- `docs/pairing.md`.

### Changed
- Unrevealed pairing requests now expire after 10 s (spec §3.2, `docs/decisions.md`).
```

- [ ] **Step 4: Verify and commit**

Run: `cd server && npm test` (Expected: PASS).

```bash
git add docs CHANGELOG.md
git commit -m "docs: pairing protocol, reveal window, Plan 1A decisions and changelog" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (spec §2/§3/§4.1–4.2):** identity and certificate (§3.1) → Task 3; sizes and encodings (§3.1–3.2) → Task 2; pairing flow, proof, re-pair, limits (§3.2) → Task 7; sessions, one per device, expiry (§3.3) → Task 6; hashed secrets, revoke tombstones, forget (§3.3) → Task 5; rate limits (§3.4) → Tasks 4 and 7; error envelope and codes (§4.1) → Task 1; idempotency (§4.2) → Task 4. HTTP routes, discovery, addresses, transfers, admin API, tray and everything in §5–§10 are **out of scope here** and belong to Plans 1B–6 (see the plan index). The 10 s reveal window is an addition to the spec, recorded in Task 8.

**Placeholder scan:** none; every step has complete code or exact text.

**Type consistency:** `crypto.sha256Hex` is used by `devices.js`, `sessions.js` and the tests (there is no `hashSecret`). `DeviceStore` methods used by `PairingManager` are `has`, `canAdd`, `add`. Event names are `pending`, `resolved`, `device-replaced` (pairing) and `end` (sessions). Limit names in `config.js` match those used in `devices.js`, `pairing.js` and the tests (`maxDevices`, `maxRevokedTombstones`, `maxPendingPairings`, `maxPairRequestsPerMinutePerIp`, `pairExpiryMs`, `pairRevealWindowMs`, `pairSecretWindowMs`).
