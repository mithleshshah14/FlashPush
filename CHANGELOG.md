# Changelog

Newest first. Every working day's changes are recorded here and in the affected files under `docs/`.

## 2026-09-22 — Windows shell (branch `feature/windows-shell`)

### Added
- **Lifecycle:** `starting / running / degraded / stopped`; a taken port makes FlashPush *degraded* with the reason instead of aborting (tolerant start from the CLI); `status` in `GET /admin/state`; graceful stop (finish running transfers for up to 5 s, then cut the rest and delete their `.part` files).
- **Tray icon** (`server/tray/tray.ps1`, `server/src/tray*.js`, `shell.js`): status line, Open FlashPush, Pending approvals (n), Paired devices, Open received files, Start with Windows, Stop FlashPush; a balloon "*phone* wants to connect, code 482 916" on a new pairing request. Icons generated from a simplified glyph (`server/tray/`).
- **Start with Windows:** hidden `FlashPush.vbs` launcher in the Startup folder and Start Menu (`--install-autostart`, `--uninstall-autostart`, `--status`, or the tray checkbox); no admin rights, no registry, no scheduled task.
- **Single instance:** starting FlashPush again opens the running instance's page.
- **Firewall scripts** (`scripts/allow-firewall.ps1`, `remove-firewall.ps1`): TCP 8765 and UDP 8766 from `LocalSubnet` and `100.64.0.0/10` only.
- **Tailscale MagicDNS name** in the address list (`{name, kind:'tailscale-name'}`).
- New entry point `server/src/cli.js` (`npm start`, `npm run start:headless`).
- Docs: `docs/setup.md` (with antivirus notes), `docs/testing.md` (automated suite and manual Windows checklist); architecture, security and protocol updated.

### Changed
- `index.js` is now a library; `start()` and `stop()` take options (`tolerant`, `graceMs`); `createApp` accepts `readTailscaleName` and the test-only `overrides.bindHost`.
- After the user's antivirus flagged the project: the tray no longer compiles code at run time, tests never execute scripts and bind only to `127.0.0.1`, and static tests forbid runtime compilation, encoded commands, downloads, registry and scheduled-task changes and `netsh` in every script.

### Verified
- `cd server && npm test`: **269 tests, all passing** (up from 169).
- **Not verified on a real desktop** (by design; see the manual checklist in `docs/testing.md`): the actual tray icon and balloon, sign-in autostart, the firewall rules, and connecting a phone through them.

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

### Added (antivirus safety)
- `server/test/guard.js` + `guard.test.js` (loaded by `npm test`): tests can no longer launch PowerShell, VBS hosts, netsh, schtasks and similar; `docs/dev-safety.md` documents the rules and what to do on an alert. Server suite: **174 tests**.

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

## 2026-09-22 (laptop UI branch)

### Built (Plan 4)
- The real laptop web UI replaces the temporary admin page: **Dashboard**, **Approvals**, **Devices**, dark and light, 360 to 1440 px, live updates, offline banner, aria-live announcements for new pairing requests, confirmations via `<dialog>`, per-file upload progress, image thumbnails, firewall help panel.
- `server/src/static.js`: allowlisted in-memory static files; the page and assets are served with a strict CSP (no `unsafe-inline`).
- Client code split into small modules (`model`, `api`, `live`, `theme`, `dom`, `shell`, `widgets`, three views). Tests: static-file allowlist and traversal, pure model, API/theme/live with stubs, and source rules (no `innerHTML`, no inline code, no external URLs). Server suite: **204 tests, all passing**.
- Tools: a loopback-only demo server and a screenshot script; screenshots in `docs/design/implemented/`; `scripts/make-favicon.ps1` builds the favicon from `app_icon.png`.
- Docs: `docs/admin-ui.md`, additions to architecture, security, decisions, docs index and server README.
