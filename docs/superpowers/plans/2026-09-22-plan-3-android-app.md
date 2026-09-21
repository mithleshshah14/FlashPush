# Android App v2 (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 QR/token Android app with the v2 app: discovery, pinned-TLS pairing with the matching 6-digit code, one-tap connect/disconnect, per-laptop history (Messages / Images / Files), new transfers, offline history, reconnect with Tailscale-aware address racing, share-to-FlashPush, settings.

**Architecture:** Plain Flutter (Material 3) with `ChangeNotifier` controllers and no state-management package. Layers, each in its own folder under `app/lib/`: `core/` (protocol crypto, pinned TLS client, `LaptopApi`), `data/` (secret store, laptop store, history cache), `net/` (discovery, address race, backoff, connection state machine, pairing flow), `ui/` (screens and widgets). Controllers depend on the `LaptopApi` interface, so everything except the TLS client is tested with fakes; the real client is tested against the **real Node server** in an integration test.

**Tech Stack:** Flutter 3.41 / Dart 3.11, `dart:io` (`HttpClient`, `RawDatagramSocket`), `crypto`, `flutter_secure_storage`, `shared_preferences`, `path_provider`, `file_picker`, `url_launcher`. Removed: `http`, `mobile_scanner`.

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §3, §4, §5, §6, §9; `docs/protocol.md`; `docs/pairing.md`; `docs/security.md`; designs in `docs/design/` (Stitch project "FlashPush v2").

**Format note:** because this plan is long, each task lists exact files, the public interface, and the test cases to write first. The code is written test-first in the task's commit; the interfaces below are the contract between tasks.

## Global Constraints

- Android only. `minSdk` from Flutter (24+). Permissions: `INTERNET` only (no camera, no storage; downloads go through MediaStore, picking through the system picker).
- **HTTPS only**: no cleartext (`usesCleartextTraffic` removed). Certificate pinning through `HttpClient.badCertificateCallback` comparing SHA-256 of the presented DER certificate to the pinned value in constant time; during first pairing the callback only records the fingerprint, and a client that has recorded a fingerprint rejects any different one. The device secret is never sent on a connection whose certificate is not pinned.
- Secrets (device secret, pinned fingerprint, `deviceId`) only in secure storage; non-secrets in shared preferences. Never log or display secrets, session tokens, request ids or nonces.
- Protocol exactness: crypto exactly as `docs/pairing.md` (labels, byte layout, base64url strict); the Dart tests must reproduce the known-answer vectors (commit `148f8a90…`, SAS `001004`, proof `01b5a81d…`).
- Error handling branches on the API error `code`, never on the message.
- Header rule: no "Connected/Disconnected" text; two button-styled icons: Wi-Fi (status, green when reaching the laptop over local Wi-Fi) and link (green connected / grey not; tapping connects or disconnects). Different glyphs and semantics labels.
- Reconnect: exponential backoff 2 s → 60 s cap, foreground only; `SESSION_EXPIRED` reconnects at once; `DEVICE_NOT_PAIRED` (and a rejected secret) stop and offer Re-pair / Forget; a certificate mismatch stops and never sends the secret; laptop offline keeps retrying at the cap. Connect races saved addresses in parallel, 3 s per candidate, losers cancelled.
- Discovery scan policy: immediately, then after 3 s, 6 s, 12 s while nothing is found; pull-to-refresh runs a full scan; nothing runs while the screen is inactive.
- Code quality: files under ~250 lines, one responsibility each, no dead code, comments only for non-obvious reasons; `flutter analyze` must report no issues.
- Branch `feature/android-app-v2` (worktree `C:\MyWeb\FlashPush-android`), commit trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. `server/` is not modified.

## File map

| File | Responsibility |
|---|---|
| `lib/core/protocol_crypto.dart` | base64url, commit, SAS, proof, random, sha256 (pure) |
| `lib/core/errors.dart` | `ApiException(code, status, retryAfter)`, `CertificateChanged`, `Unreachable` |
| `lib/core/models.dart` | `Item`, `LaptopAddress`, `Laptop`, `Credentials`, `DiscoveredLaptop`, `Hello` |
| `lib/core/sse.dart` | SSE line parser (pure) |
| `lib/core/pinned_client.dart` | `HttpClient` with pin / trust-on-first-use fingerprint capture |
| `lib/core/laptop_api.dart` | `LaptopApi` interface and `HttpLaptopApi` |
| `lib/data/secret_store.dart` | `SecretStore` interface, secure-storage and in-memory implementations |
| `lib/data/laptop_store.dart` | device identity, saved laptops (prefs) + credentials (secret store) |
| `lib/data/history_cache.dart` | per-laptop item list + image thumbnails on disk |
| `lib/net/discovery.dart` | UDP scan and the scan-policy controller |
| `lib/net/address_race.dart` | parallel candidate race with per-candidate timeout and cancellation |
| `lib/net/backoff.dart` | reconnect delay policy |
| `lib/net/connection.dart` | `LaptopConnection`: link state machine, session, events, items, reconnect |
| `lib/net/pairing.dart` | `PairingFlow`: commit-reveal orchestration |
| `lib/net/transfer.dart` | text/file send with `X-Operation-Id` retries |
| `lib/app_controller.dart` | app-level state: laptops, discovery, active connection, settings, lifecycle, shares |
| `lib/native.dart`, `android/.../MainActivity.kt` | share intents and save-to-Downloads (kept, adapted) |
| `lib/theme.dart`, `lib/app.dart`, `lib/main.dart` | theme tokens, shell with bottom tabs, bootstrap |
| `lib/ui/*` | devices, pairing, laptop detail (+ tabs), new transfer sheet, add-by-address, settings, transfer tab, status icons |

---

### Task 1: Dependencies, v1 removal, protocol crypto

**Files:** modify `app/pubspec.yaml`, `app/android/app/src/main/AndroidManifest.xml`; delete `lib/api.dart`, `lib/home_page.dart`, `lib/pairing_page.dart`, `lib/main.dart` (rewritten later), `test/widget_test.dart`; create `lib/core/protocol_crypto.dart`, `test/core/protocol_crypto_test.dart`.
**Produces:** `b64uEncode(Uint8List) → String`, `b64uDecode(String, [int? length]) → Uint8List` (throws `FormatException` on non-canonical), `commitOf(np)`, `sasCode(fp, np, nl) → String (6 digits)`, `formatSas(String) → String`, `pairProof(np, requestId, deviceId) → String (hex)`, `sha256(bytes)`, `randomBytes(n)`, `constantTimeEquals(a, b)`.
**Tests first:** known-answer vectors from `docs/pairing.md` (commit hex and base64url, SAS `001004` and `001 004`, proof hex, `np`/`requestId` base64url); strict base64url (padding, `+`, whitespace, non-canonical trailing bits, wrong length); wrong-size inputs throw; constant-time equality on unequal lengths.
- [ ] Write the tests, run (fail), implement, run (pass), `flutter analyze`, commit `feat(app): protocol crypto with known-answer vectors, remove v1 dependencies`.

### Task 2: Models, errors, SSE parser

**Files:** create `lib/core/errors.dart`, `lib/core/models.dart`, `lib/core/sse.dart`, `test/core/models_test.dart`, `test/core/sse_test.dart`.
**Produces:** `Item.fromJson/toJson` (`id, kind, from, time, text?, name?, size?, mime?`, `isText`, `isImage` = `image/*`, `fromLaptop`), `LaptopAddress{host, port, kind}` (+json), `Laptop{id, name, addresses, lastHost?}` (+json, `copyWith`), `Credentials{secret, fingerprint}`, `DiscoveredLaptop{laptopId, name, host, port}`, `ApiException{code, status, retryAfter}`, `CertificateChanged`, `Unreachable`, `SseEvent{event, data}` and `Stream<SseEvent> parseSse(Stream<List<int>>)` (ignores `:` comments, joins split chunks).
**Tests first:** item JSON round trip incl. optional fields; image detection; laptop JSON round trip; SSE: two events in one chunk, one event split over chunks, comments ignored, invalid JSON data skipped.
- [ ] Tests, red, implement, green, commit `feat(app): models, errors and SSE parser`.

### Task 3: Pinned TLS client and the device API client (integration-tested against the real server)

**Files:** create `lib/core/pinned_client.dart`, `lib/core/laptop_api.dart`, `test/core/pinned_client_test.dart`, `test/support/real_server.dart`, `test/integration/api_integration_test.dart`.
**Produces:**
- `PinnedHttp({Uint8List? pin})` with `HttpClient client`, `Uint8List? seenFingerprint`, `bool mismatch`; behaviour: with a pin, accept only an equal fingerprint (set `mismatch` otherwise); without a pin, record the first fingerprint and accept only that same one afterwards. Pure decision function `bool acceptCertificate({pin, seen, presented})` is unit-tested.
- `abstract class LaptopApi` with `Future<Hello> hello()`, `Future<PairRequest> pairRequest({deviceId, deviceName, commit})`, `Future<void> pairReveal({requestId, np})`, `Future<PairStatus> pairStatus({requestId, deviceId, proof})`, `Future<Session> connect({deviceId, secret})`, `Future<void> disconnect(token)`, `Future<void> forget(token)`, `Future<List<Item>> items(token)`, `Future<Item> sendText(token, text, operationId)`, `Future<Item> sendFile(token, file, name, operationId, onProgress)`, `Future<File> download(token, item, dir, onProgress)`, `Future<List<int>?> thumbnail(token, item)`, `Future<void> deleteItem(token, id)`, `Stream<SseEvent> events(token)`, `void close()`. `HttpLaptopApi(host, port, {pin})` implements it over `PinnedHttp`, maps every non-2xx to `ApiException(code)`, network failures to `Unreachable`, pin failures to `CertificateChanged`, and refuses `connect()` unless a pin is set.
**Tests first:** unit: acceptance rules (pinned match / mismatch, first-use record, second different cert rejected); integration (skipped with a clear message if `node` is missing): start the real server (`node server/src/index.js`, temp `FLASHPUSH_HOME` with a `config.json` using ephemeral ports, temp `RECEIVE_DIR`), then: hello over TLS records the fingerprint; full pairing with the Dart crypto and approval through the admin API, codes equal; connect; send text and file, download and compare bytes, list; laptop-sent text arrives on the SSE stream; a wrong pin gives `CertificateChanged` and never sends the secret; revoke gives `DEVICE_NOT_PAIRED`.
- [ ] Tests, red, implement, green, commit `feat(app): pinned TLS client and device API client, integration-tested against the real server`.

### Task 4: Secret store, laptop store, history cache

**Files:** create `lib/data/secret_store.dart`, `lib/data/laptop_store.dart`, `lib/data/history_cache.dart`, tests under `test/data/`.
**Produces:** `SecretStore{read, write, delete}` (+ `FlutterSecretStore`, `MemorySecretStore`); `LaptopStore{init() → deviceId (created once, stored as secret), List<Laptop> laptops, save(Laptop, Credentials?), credentialsFor(id), remove(id), phoneName get/set}`; `HistoryCache(Directory dir)` with `load(laptopId) → List<Item>`, `save(laptopId, items)`, `thumbnailFile(laptopId, itemId)`, `saveThumbnail(...)`, `clear(laptopId)`, size-bounded thumbnail trimming (oldest first).
**Tests first:** device id stable across instances; credentials never written to the non-secret store (inspect prefs); remove wipes both; history round trip and per-laptop separation; corrupt file ignored; thumbnail cap evicts oldest.
- [ ] Tests, red, implement, green, commit.

### Task 5: Discovery and address race

**Files:** create `lib/net/discovery.dart`, `lib/net/address_race.dart`, tests under `test/net/`.
**Produces:** `Discovery.scan({targets, window}) → List<DiscoveredLaptop>` (UDP `FLASHPUSH_DISCOVER`, 2 s window, parses `FLASHPUSH_HERE`, ignores garbage); `DiscoveryController` implementing the 0/3/6/12 s policy with `start()`, `stop()`, `scanNow()`, exposing `results`; `raceAddresses<T>(candidates, probe, {timeout = 3s}) → Future<Winner<T>?>` where `probe(candidate, Cancel cancel)` and losers are cancelled once one succeeds.
**Tests first:** discovery against a loopback UDP responder (reply parsed, garbage ignored, no reply gives empty); policy with a fake clock (schedule, stops when found, stops on `stop()`); race: fastest success wins, one dead candidate does not delay, losers receive cancel, all fail gives null, per-candidate timeout.
- [ ] Tests, red, implement, green, commit.

### Task 6: Backoff and the connection state machine

**Files:** create `lib/net/backoff.dart`, `lib/net/connection.dart`, tests under `test/net/`.
**Produces:** `Backoff` (2, 4, 8, … capped at 60 s, `reset()`); `enum LinkState { notPaired, paired, connecting, connected, disconnecting, unreachable, certChanged, unpaired }`; `LaptopConnection` (a `ChangeNotifier`) with `state`, `items`, `route` (`wifi`/`tailscale`/none), `wifiUp`, `connect()`, `disconnect()`, `setForeground(bool)`, `forget()`, `refreshItems()`, and progress-free helpers used by transfers (`withSession`). Takes `apiFor(host, port, pin)`, `LaptopStore`, `HistoryCache`, timer/clock injection.
**Behaviour to test first (fake `LaptopApi`):** connect → race → session → items cached → connected; disconnect clears intent and calls the API; network loss keeps intent and retries with the backoff sequence; foreground false pauses retries and true resumes at once; `SESSION_EXPIRED` reconnects immediately; `DEVICE_NOT_PAIRED` and a rejected secret → `unpaired`, no retries; `CertificateChanged` → `certChanged`, secret never sent, no retries; live `item-added` / `item-deleted` update the list and cache; `expired` with reason `revoked` → `unpaired`; addresses refreshed and stored after each successful connect; Tailscale route sets `wifiUp=false`.
- [ ] Tests, red, implement, green, commit.

### Task 7: Pairing flow and transfers

**Files:** create `lib/net/pairing.dart`, `lib/net/transfer.dart`, tests under `test/net/`.
**Produces:** `PairingFlow(api, deviceId, deviceName)` with `Stream<PairingProgress>`: `waiting(sasDisplay)`, `approved(Credentials, Laptop info)`, `denied`, `expired`, `failed`; performs request → reveal → poll every 1.5 s, verifies the SAS from the certificate the TLS session presented, cancellable. `sendTextWithRetry` / `sendFileWithRetry` using one `operationId` per send, retrying network errors (max 3) and `RATE_LIMITED` after `Retry-After`.
**Tests first:** fake API driven through approve / deny / expired / commit mismatch; SAS shown equals the SAS computed from the recorded fingerprint; polling stops on cancel; retries reuse the same operation id and stop on non-retryable codes.
- [ ] Tests, red, implement, green, commit.

### Task 8: App controller

**Files:** create `lib/app_controller.dart`, `test/app_controller_test.dart`.
**Produces:** `AppController` (`ChangeNotifier`, `WidgetsBindingObserver`): saved + discovered laptops merged by id, single active connection, `scan()`, `addByAddress(host, port?)`, `startPairing(...)`, `connect(id)` / `disconnect(id)`, `forget(id)` / `rePair(id)`, settings (phone name, theme mode, auto-reconnect), lifecycle forwarding, `handleShare(SharePayload)` (needs a connected laptop, otherwise reports `needsConnection`).
**Tests first:** merge of discovered and saved; connecting a second laptop disconnects the first; forget wipes credentials and cache; share without connection is refused, with connection sends text and files; lifecycle pause/resume forwarded; auto-reconnect setting honoured.
- [ ] Tests, red, implement, green, commit.

### Task 9: Theme, shell, status icons

**Files:** create `lib/theme.dart`, `lib/app.dart`, `lib/main.dart`, `lib/ui/status_icons.dart`, tests under `test/ui/`.
**Tests first (widget):** the icon pair shows the right glyph/colour/semantics label for each `LinkState` and route; tapping the link icon calls connect when grey and disconnect when green; no text like "Connected" appears; the shell shows three tabs and switches.
- [ ] Tests, red, implement (design tokens from `.stitch/DESIGN.md`), green, commit.

### Task 10: Devices, add-by-address, pairing screens

**Files:** create `lib/ui/devices_page.dart`, `lib/ui/add_address_sheet.dart`, `lib/ui/pairing_page.dart`, tests.
**Tests first (widget, fake controller):** list with the three states, empty state, pull-to-refresh triggers a scan, "Add by address" validates input (IP, MagicDNS name, optional port) and adds; tapping a card opens the detail route; pairing screen shows the code (`482 916` grouping), reacts to approved / denied / expired, Cancel stops polling.
- [ ] Tests, red, implement, green, commit.

### Task 11: Laptop detail, new transfer, transfer tab, problem states

**Files:** create `lib/ui/laptop_detail_page.dart`, `lib/ui/message_list.dart`, `lib/ui/image_grid.dart`, `lib/ui/file_list.dart`, `lib/ui/new_transfer_sheet.dart`, `lib/ui/transfer_tab.dart`, `lib/ui/problem_view.dart`, tests.
**Tests first (widget):** Messages / Images / Files tabs show only their kind, with empty states; offline shows cached history and "connect to send" (no New transfer); New transfer sheet asks Image / Text / Document, text compose sends, file pick sends with progress; open link and copy actions; "Not paired anymore" offers Re-pair and Forget; "Laptop identity changed" offers Forget and pair again; Transfer tab shows the active laptop's detail or "Connect a laptop first".
- [ ] Tests, red, implement, green, commit.

### Task 12: Settings, native share and download bridge

**Files:** create `lib/ui/settings_page.dart`; modify `lib/native.dart`, `android/.../MainActivity.kt` (kept, adapted); tests.
**Tests first:** settings edit the phone name (persisted), list paired laptops with Re-pair / Forget, appearance, auto-reconnect toggle, rescan; native bridge parsing of share payloads and the save-to-Downloads call (with a mocked `MethodChannel`).
- [ ] Tests, red, implement, green, commit.

### Task 13: Docs, analyzer, build

**Files:** create `docs/connection-state.md`, `docs/testing.md`; modify `app/README.md`, `docs/README.md`, `docs/decisions.md`, `CHANGELOG.md`, this plan (progress).
- [ ] `flutter analyze` (no issues), `flutter test` (all), `flutter build apk --debug`; write the docs (state machine table and reconnect rules; manual device checklist covering pairing on LAN, Tailscale, revoke, offline history, share sheet, downloads, permissions), update the changelog/decisions/index, mark progress, commit `docs(app): connection state, testing checklist, README, changelog`.

---

## Self-review

**Spec coverage:** §3.2 pairing → Tasks 1, 3, 7; §3.3 sessions → 3, 6; §4 errors/idempotency → 3, 7; §5.1 discovery + scan policy + add by address → 5, 10; §5.2 addresses, race, saved vs verified → 4, 5, 6; §6 states and reconnect → 6 + docs; §6.3 SSE → 2, 6; §9 screens (tabs, detail, new transfer, settings, problem states, header icons, offline cache) → 9-12; share sheet and downloads → 12. Deferred: camera capture for the Image choice (system gallery picker only), see `docs/decisions.md`.

**Placeholder scan:** none; unspecified code is fully determined by the interfaces and tests listed per task.

**Type consistency:** `LaptopApi` (Task 3) is the only network seam used by Tasks 6, 7, 8; `Laptop`, `Credentials`, `Item` (Task 2) are the only models passed between layers; `LinkState` (Task 6) is consumed by Tasks 9-11.

## Progress (updated as the work was done)

All tasks below are done, test-first, one commit per task. Deviations from the plan as written:

- **Task 3:** `ApiFactory` takes a nullable pin (`null` for the first contact of a pairing); `thumbnail()` was dropped from `LaptopApi` (received images are cached as files and decoded at thumbnail size).
- **Task 6:** `LaptopConnection` also owns `imageFile`, `learnAddress`, an `autoReconnect` switch, and opens the event stream **before** fetching the list.
- **Task 8:** `forget` returns nothing; `addressOf(id)` supports Re-pair, which no longer forgets first.
- **Tasks 9-12:** the UI was split into small files (`connection_controls`, `devices_page`, `pairing_page`, `laptop_detail_page`, `message_list`, `image_grid`, `file_list`, `new_transfer_sheet`, `transfer_tab`, `problem_view`, `settings_page`, `platform_actions`, `format`, `empty_tab`); the platform seam (`PlatformActions`) replaces direct calls to the picker, `url_launcher` and the native bridge so screens are testable.
- **Not done:** camera capture for the Image choice; adaptive launcher icon (see `docs/decisions.md`, Plan 3).
