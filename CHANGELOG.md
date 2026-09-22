# Changelog

Newest first. Every working day's changes are recorded here and in the affected files under `docs/`.

## 2026-09-23 (branch `feature/dashboard-device-tabs`)

### Changed
- **Dashboard (admin UI):** the "Files and images" card is now a **Devices** list; clicking a phone swaps the card in place to **Messages / Images / Files** tabs for that phone (back arrow returns to the list). Reuses the existing chat bubble rendering (`messageRow`/`daySeparator`, now exported from `views/messages.js`) and the existing file/image row rendering, so nothing chat-related is duplicated. `docs/admin-ui.md` updated.
- The Messages tab is a real conversation, not read-only: it has its own compose bar (Enter sends, matching the full Messages page), and the detail header shows Connected / Not connected for that phone.
- The Images and Files tabs each have an "Add images" / "Add files" button that uploads straight to that phone (parity with the app's per-tab send action), instead of only being reachable from the top-of-page Send card.
- **Removed the Messages nav item/page** (`#/messages`): messaging now lives entirely in the Dashboard's per-device Messages tab, so the separate page was redundant. Unread tracking and the tab title now key off the Dashboard being open instead of Messages; the unread badge moved to the Dashboard nav item (`#unread-badge`, was `#messages-badge`). The old full-page chat component (`createMessages`) and its tests stay in `views/messages.js` / `ui-messages.test.js`, just unrouted, in case it's wanted back.
- **Android app:** the "New message" floating button + modal sheet on the Messages tab is replaced with an inline compose bar (`MessageComposer`, new), pinned under the thread — closer to a normal messaging app. It only shows while connected; offline still only offers "Connect to send". Images/Files tabs are unchanged (still their own send button + picker).
- Server suite: **358 tests, all passing** (up from 349): 9 new tests for the device/tab pane in `server/test/ui-dashboard.test.js`, plus `querySelector` and `remove()` added to the fake-DOM test helper. Flutter suite: **179 tests, all passing**, `flutter analyze` clean.

### Fixed
- **Autostart never installed on this dev machine** — `node src/cli.js --install-autostart` had never been run here, so nothing launched FlashPush (or its tray icon) at sign-in. Not a code bug; now installed.

### Added
- **Android app:** a foreground in-app banner ("MITHLESH-PC sent a message/an image/a file", tap to open) when an item arrives from the laptop while you're on a different screen. `LaptopConnection.incoming` (new stream, emits only for genuinely new laptop-sent items, not the phone's own or duplicates) aggregates through `AppController.incomingItems` to a listener in `HomeShell`. Chose this over true background/closed-app push: the connection is deliberately foreground-only (battery reasons, `docs/decisions.md`), so nothing can arrive while the app is backgrounded or closed today — background push would need a foreground service or a real push relay, a bigger architectural change than was asked for.
- **Android app: the phone name defaults to the real device model** ("Samsung SM-S938B") instead of the generic "Android phone", the first time settings load with no name saved yet (`AppSettings.hasPhoneName`, checked in `main.dart`). Read via a new native method (`MainActivity.deviceModel()`, `android.os.Build`) through the existing `flashpush/native` channel — no new Flutter dependency. `Build.MODEL` is the hardware model code, not a marketing name (e.g. "SM-S938B" not "Galaxy S25 Ultra"); there is no reliable API for the marketing name without a lookup table. Still editable in Settings as before. Only applies to *future* pairings — an already-paired device's name on the laptop is fixed at pairing time; renaming and then Re-pairing (not Forget) pushes the new name.

### Fixed
- **Three duplicate "Android phone" entries on the laptop's Devices list** — not a code bug: repeatedly running `flutter install` during this session's testing uninstalled the app first each time, wiping its stored device id/credentials, so it re-paired as a "new" phone every time. Revoked the two stale entries; the current phone was untouched. Follow-up installs in this session now use `adb install -r` to update in place instead.

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

## 2026-09-22

### Built (Plan 3, branch `feature/android-app-v2`)
- **Android app v2** (Flutter): automatic discovery (UDP, with the 3/6/12 s scan policy) and Add by address (IP or Tailscale name); pairing with the matching 6-digit code (commit-reveal exactly as `docs/pairing.md`); one-tap connect/disconnect through two icon buttons (Wi-Fi, link) with no status words; laptop screen with separate **Messages / Images / Files** tabs, **New transfer** (Image / Text / Document), history cached for offline reading; retry-safe sending with progress; save to Downloads/FlashPush; Settings; Share to FlashPush; problem screens for "Not paired anymore" and "Laptop identity changed".
- **Security:** HTTPS only with certificate pinning (no trusted roots; the device secret is never sent on an unpinned connection), secrets only in Android secure storage, no cleartext, only the `INTERNET` permission.
- **Connection state machine:** intent-based reconnect with 2 s to 60 s backoff, foreground only, address race (parallel, 3 s per candidate, losers cancelled), immediate reconnect on an expired session, terminal states for a revoked phone or a changed certificate.
- Removed the v1 QR/token app, the `http` and `mobile_scanner` packages and the cleartext flag.
- **Tests:** `flutter analyze` clean and **170 tests passing**, including the known-answer crypto vectors and an integration test against the real Node server over TLS (loopback only).
- Docs: `docs/connection-state.md`, `docs/testing.md` (with the manual checklist for a real phone), `app/README.md`, plan `docs/superpowers/plans/2026-09-22-plan-3-android-app.md`.
- Found and fixed while building: a lost-event race (the event stream is now opened before the list is fetched), concurrent cache writes corrupting `items.json`, a future that waited on itself in the image cache, and discovery notifying during the first build.

## 2026-09-22

### Added
- **Stitch designs** (Plan 2, started 2026-09-21): project `FlashPush v2` (`14054862547846302879`) with a shared dark design system, 19 phone screens and 7 laptop-UI screens (dark + light where requested), exported to `docs/design/screens/` (27 PNGs), documented in `docs/design/README.md` and `.stitch/DESIGN.md` (tokens, components, connection-control spec).
- Phone screens: Devices list (dark, light, empty), add by address, pairing (waiting, approved, denied, expired), problem states (not paired anymore, identity changed), laptop detail with Messages / Images / Files history (plus empty and offline states), New transfer (choose type, text compose), Transfer tab (not connected), Settings. Bottom tabs Devices | Transfer | Settings.
- Laptop UI: Dashboard (running, degraded, light), Approvals (dark, light), Devices (dark, light).

### Changed
- Design decisions taken from user review (recorded in `docs/decisions.md`): connection state is two icon buttons (Wi-Fi status + link action) with no status words, green = on / grey = off; tapping a laptop opens a detail screen with history split into Messages / Images / Files and a "New transfer" flow; the Transfer tab is a shortcut to the connected laptop's detail.

### Design pass completed
- **Icon-button connection controls (v3)** now on every phone screen that shows connection state (Devices list dark and light, laptop detail Messages / Images / Files and their empty states, offline, Tailscale route, pairing waiting / approved, New transfer text). Added: Tailscale-route screen (route named in a tooltip bubble on the Wi-Fi button), route popup, Add-by-address with the dimmed tab bar behind the sheet. Cosmetic issues and superseded ids are listed in `docs/design/README.md`.

### Notes
- Stitch limitations found and documented: `edit_screens` does not persist, `generate_variants` keeps only the first change and returns one variant per call, listing lags after generation. Superseded iterations remain in the Stitch project (no delete tool) and are listed in `docs/design/README.md`.

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

### Integrated (all v2 branches merged into `develop`)
- Server, Windows shell, Stitch-designed laptop UI, Android app, Stitch design docs and the antivirus test guard are all on `develop`. Merged tree verified: server **309 tests**, app **170 tests**, `flutter analyze` clean. New: `docs/quickstart.md`.
- Not verified without hardware: the Android app on a real phone (discovery, pairing, share sheet, Downloads), the real tray/notification/autostart/firewall on the laptop, Tailscale on a real network. Checklists: `docs/testing.md`.

### Fixed / added after the first run on a real phone (2026-09-22)
- **Launcher icon:** the app showed Flutter's default icon. It now uses the brand artwork: an adaptive icon (artwork on a navy gradient, safe-zone sized) plus rounded icons for every density, generated by `scripts/make-android-icons.py` (Pillow, pure image processing). Preview: `docs/design/implemented/android-launcher-icon.png`. Guarded by `app/test/launcher_icon_test.dart`.
- **Wi-Fi icon showed "off" for a laptop the phone had just found over Wi-Fi.** The icon meant "connected over Wi-Fi", so it was crossed out until pairing. It now means what the spec says: the phone reaches the laptop over the local Wi-Fi, so it is on for any laptop that answered the latest Wi-Fi discovery scan (paired or not). New test in `app_controller_test.dart`.

### Changed (design feedback, phone)
- The center button on the laptop screen now sends for the tab you are on: **Messages** opens the text box, **Images** the gallery, **Files** the file explorer, with no "New transfer" chooser step (spec section 9, decisions log). The chooser sheet is removed. Tests updated.

### Added (laptop)
- **Tray notification for what a phone sends** while the admin site is not open: one balloon per burst ("Pixel 7 sent a message / an image / a file / 3 items: …"), never showing content; clicking opens the chat (`#/messages`) for messages or the dashboard (`#/dashboard`) for files and images. The pairing balloon now opens `#/approvals`. New `itemNotifier.js` (pure, 10 tests), `adminApi.viewers()`, per-balloon click targets in the tray. Server suite: **324 tests**. Manual steps in `docs/testing.md`.

### Added (laptop chat view)
- **Messages** on the laptop web UI is now a separate, chat-style view (`#/messages`): one conversation per phone, bubbles (phone left, laptop right), day separators, grouped runs, safe clickable links, copy on hover, a "New messages" pill when you scrolled up, and a compose bar pinned at the bottom (Enter sends, Shift+Enter newline). An in-memory **unread badge** on the Messages nav item and in the page title.
- The Dashboard feed is now **Files and images** only; its text box moved into Messages (an "Open Messages" link stays). Deep links `#/messages`, `#/dashboard`, `#/approvals` work when opened directly (for the tray).
- Tests: `ui-chat-model.test.js`, `ui-messages.test.js` (fake DOM helper). Demo data has a two-day conversation; the screenshot tool includes Messages.

### Fixed (found on the real phone)
- **After pairing, only the Wi-Fi icon stayed green.** The "connect" intent was kept only in memory, so restarting the app (or reinstalling it, or restarting the laptop server while the app was closed) left the laptop as "paired, not connected". The app now remembers which laptop you connected and reconnects it on its own at start (auto-reconnect on); Disconnect, Forget or connecting another laptop clears it. 4 new tests (**179 app tests**). Rules in `docs/connection-state.md`.

### Fixed (user feedback on the real phone)
- **"Paired" was shown next to a grey (not connected) link icon.** A paired laptop now shows only its two icons; words remain only for "Not paired" and "Identity changed" (spec section 9, decisions log).
- **No tray icon and no balloon for a photo sent from the phone:** the server that was running was a headless copy (no tray by design). Troubleshooting for "no tray icon" (headless, already running, hidden icons, antivirus, site open) added to `docs/setup.md`; the quickstart says the tray mode is `npm start`.

### Pushed
- All of the above was pushed to GitHub on `feature/v2-pairing-autostart-tailscale` (fast-forward, no force). `main` and `develop` on GitHub are unchanged. Laptop-side changes are planned for the next working day.

### Security (public repository)
- **Full-history audit: no secrets, no sensitive file names, no personal data in files** (546 files, 106 commits, all refs); mobile-specific files (keystores, `key.properties`, `local.properties`, `google-services.json`, APKs) were never committed.
- Added: wider `.gitignore` for secrets and keys, `scripts/audit-secrets.py`, `.githooks/pre-push`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/CODEOWNERS`, a pull request template and `docs/repo-security.md` (what public means, the GitHub settings to switch on, the accepted exposure of commit author emails and sample names).

### Security (applied on GitHub)
- Branch protection on `main` and `develop` (PR + 1 approval + code owners, no force push, no deletion, owner bypass), private vulnerability reporting, Dependabot alerts, wiki and projects off; verified by reading the settings back. Details and how to reproduce: `docs/repo-security.md`.

### Changed (GitHub)
- The first feature was merged to `develop` and `main` by pull request (squash), so GitHub shows one commit each; the detailed history stays on `feature/v2-pairing-autostart-tailscale`.
- Branch protection relaxed for a solo maintainer: PR still required, no approval or code-owner review needed, no force pushes or deletions (`docs/repo-security.md`).

### License
- Added the **GNU General Public License v3.0** (`LICENSE`, README section, `license` field, contribution clause). 2FA on the owner account confirmed.

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
