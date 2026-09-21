# Changelog

Newest first. Every working day's changes are recorded here and in the affected files under `docs/`.

## 2026-09-22

### Built (Plan 3, branch `feature/android-app-v2`)
- **Android app v2** (Flutter): automatic discovery (UDP, with the 3/6/12 s scan policy) and Add by address (IP or Tailscale name); pairing with the matching 6-digit code (commit-reveal exactly as `docs/pairing.md`); one-tap connect/disconnect through two icon buttons (Wi-Fi, link) with no status words; laptop screen with separate **Messages / Images / Files** tabs, **New transfer** (Image / Text / Document), history cached for offline reading; retry-safe sending with progress; save to Downloads/FlashPush; Settings; Share to FlashPush; problem screens for "Not paired anymore" and "Laptop identity changed".
- **Security:** HTTPS only with certificate pinning (no trusted roots; the device secret is never sent on an unpinned connection), secrets only in Android secure storage, no cleartext, only the `INTERNET` permission.
- **Connection state machine:** intent-based reconnect with 2 s to 60 s backoff, foreground only, address race (parallel, 3 s per candidate, losers cancelled), immediate reconnect on an expired session, terminal states for a revoked phone or a changed certificate.
- Removed the v1 QR/token app, the `http` and `mobile_scanner` packages and the cleartext flag.
- **Tests:** `flutter analyze` clean and **170 tests passing**, including the known-answer crypto vectors and an integration test against the real Node server over TLS (loopback only).
- Docs: `docs/connection-state.md`, `docs/testing.md` (with the manual checklist for a real phone), `app/README.md`, plan `docs/superpowers/plans/2026-09-22-plan-3-android-app.md`.
- Found and fixed while building: a lost-event race (the event stream is now opened before the list is fetched), concurrent cache writes corrupting `items.json`, a future that waited on itself in the image cache, and discovery notifying during the first build.

## 2026-09-21

### Added
- **v1 prototype** (working): Node.js server with a web page (`server/`) and a Flutter Android app (`app/`). Send text, links and files in both directions over the same Wi-Fi; pair by QR code or link; share to FlashPush from any Android app; files from the phone land in `Downloads/FlashPush`.
- Project `README.md`, `app/README.md`, and this changelog.
- `app_icon.png` (brand artwork supplied by the user).
- Project setting enabling the Superpowers plugin (`.claude/settings.json`).
- **Documentation set** under `docs/`: index, decisions log, and the v2 design spec (revision 2).

### Designed (not built yet)
- **v2**: automatic laptop discovery, one-time approval on the laptop with a matching 6-digit code, one-tap Connect/Disconnect, HTTPS with certificate pinning, Windows autostart with a tray icon (open UI, pending approvals, devices, files folder, start-with-Windows, stop), Tailscale support. Spec: `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md`.
- Spec revision 2 incorporates an external design review (`docs/FlashPush_v2_design_review_suggestions.md`): pairing proof and exact encodings, one session per device with expiry, re-pair, file limits and path safety, error envelope, idempotency, reconnect rules, retention. Deferrals and reasons are in `docs/decisions.md`.
- Brand palette sampled from the icon; derived icon assets planned.

### Built (Plan 1A, branch `feature/server-security-core`)
- Server security core in `server/src/`: `config`, `errors` (error envelope), `fsutil` (atomic JSON), `validate`, `crypto` (commit / SAS / proof primitives), `identity`, `tls` (EC P-256 self-signed certificate + fingerprint), `devices` (hashed secrets, re-pair, remove), `sessions` (one per device, idle 24 h / absolute 7 d), `ratelimit`, `idempotency`, `pairing` (commit-reveal state machine).
- Written test-first: **77 tests, all passing** (`cd server && npm test`), including the pairing known-answer vectors and a real TLS handshake whose presented fingerprint matches the one the phone will pin.
- New dependency: `selfsigned`. The v1 `server.js` and web page are untouched until Plan 1B replaces them.
- `docs/pairing.md` (exact protocol, timings, test vectors).

### Changed (spec, phone screens)
- Spec §9: bottom tabs Devices / Transfer / Settings; tapping a laptop opens a detail screen with separate Messages, Images and Files tabs and a New transfer sheet (Image / Text / Document); phone keeps a local history cache. Spec §7: items belong to one phone (`deviceId`) and files carry `mime`; §7.1 no longer claims limits are editable in `config.json`.
- Requirements forwarded to the Stitch designer (screens: laptop detail x3 tabs, new-transfer sheet, compose, offline state, Transfer and Settings tabs, laptop UI).

### Built (Plan 1B-i, branch `feature/server-api-transfers`)
- `addresses.js` (lan / tailscale / other, link-local dropped), `mime.js`, `store.js` (per-phone history, retention, outbox cleanup), `transfers.js` (sanitized names, `.part` files, size / quota / disk checks, interrupted-upload cleanup), `discovery.js` (UDP responder, rate limited). Test-first; the whole server suite is now **113 tests, all passing**.
- `docs/transfers.md`.

### Changed (design feedback)
- Mobile header shows two status icons (Wi-Fi green/grey, connection green/grey) instead of "Connected/Disconnected" text (spec §9). Laptop screens approved; dark and light modes kept.

### Built (Plan 1B-ii-a)
- `http.js` (JSON in/out, error envelope, router, SSE helper) and `deviceApi.js`: the whole phone-facing `/v1` API: hello, pairing (request / reveal / status with proof), sessions (connect, disconnect, forget), per-phone history, text and file upload with `X-Operation-Id` idempotency, downloads (inline only for non-SVG images), live events with the `expired` event, failed-auth rate limit. New error codes `NOT_FOUND` and `FORBIDDEN`; sessions emit `start`.
- Server suite is now **149 tests, all passing**, including 25 that drive the API over real HTTP.
- `docs/protocol.md`: every route, auth scheme, error code, idempotency rule and limit.

### Built (Plan 1B-ii-b)
- `adminApi.js`: loopback admin API (state, events, approve/deny, revoke, send text/file to a phone, history, files) with a browser cross-site guard; `index.js`: `createApp()` wires the HTTPS device API, admin API and UDP discovery, with clean start/stop and port-in-use reporting; a temporary admin page (`server/public/admin.html`).
- The v1 `server.js`, its web page and the `qrcode` dependency are removed.
- **End-to-end test over real TLS** (pair with matching codes, phone and laptop text and files, disconnect/reconnect, revoke, phone isolation, admin guard, UDP discovery, restart keeps certificate and pairing, clean stop, port in use). Server suite: **169 tests, all passing**.
- Docs: `architecture.md`, `security.md`, admin API and discovery in `protocol.md`, `server/README.md`, updated root README.

### Planned
- Spec revision 2 **approved**.
- Implementation split into plans (`docs/superpowers/plans/2026-09-21-v2-plan-index.md`): 1A server security core, 1B server API and transfers, 2 Stitch designs, 3 Android app v2, 4 laptop web UI, 5 Windows shell, 6 Tailscale/reconnect/hardening. **Plan 1A is written in full** (8 test-first tasks with complete code, including known-answer crypto vectors computed from the spec's definitions).

### Changed
- **Over-engineering review applied** to Plan 1A and the spec (about 290 lines fewer, `docs/decisions.md`): idempotency cache without promises (an in-flight duplicate gets `429` + `Retry-After`), no revoked tombstones (`DEVICE_REVOKED` removed; revoke and forget are one `remove`, the phone sees `DEVICE_NOT_PAIRED`), no long-poll on pair status (phone polls every 1-2 s), sessions keyed by token, one `expiresAt` per pairing record, `config.json` limited to ports and receive folder, injectable `rng`/TLS `now`/`CODES` removed. Rejected: dropping TLS/pinning/SAS in favour of Tailscale only.
- Spec §3.2: an unrevealed pairing request now expires after **10 s** (was covered only by the 2 min limit), so anyone on the Wi-Fi cannot fill the 3 pending slots and block pairing.
- Repository set up on `main` with a README as the first commit; `develop` created from `main`; work continues on `feature/v2-pairing-autostart-tailscale` (branching rules recorded in `docs/decisions.md`). All three branches pushed to `origin` (remote was empty; no force push).

### Verified
- **Plan 1A code executed**: every code block in the plan was extracted into a scratch copy and run with `node --test`: 77 tests, all passing. This caught a real bug (a literal U+2028 in a regex character class made `validate.js` a syntax error); fixed in the plan and covered by a new test.
- Server API exercised with curl: token check (401), text and file upload, path-traversal filename sanitizing, download, loopback web UI.
- App: `flutter analyze` clean, 3 unit tests pass, debug APK builds.
- Not tested on a real phone yet.
