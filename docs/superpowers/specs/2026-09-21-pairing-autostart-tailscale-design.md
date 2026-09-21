# FlashPush v2: device pairing, autostart and Tailscale — Design

Status: **revision 2.1, approved 2026-09-21; simplified after an over-engineering review (see `docs/decisions.md`)** · Date: 2026-09-21
Supersedes the v1 shared-token design (QR/link + one token).
Revision 2 folds in `docs/FlashPush_v2_design_review_suggestions.md`; what was adopted or deferred is in `docs/decisions.md`.

## 1. Goals

1. The phone **finds the laptop by itself** on the Wi-Fi. No QR code or link typed each time.
2. A phone must be **approved once on the laptop**. After that, **Connect / Disconnect is one tap** in the app.
3. The laptop side **starts with Windows**, runs hidden, and is controlled from a **tray icon** (open UI, pending approvals, paired devices, files folder, start-with-Windows toggle, **stop**).
4. **Security:** every data or admin operation from an unapproved device is rejected. Only discovery, laptop identity (`/hello`) and rate-limited pairing endpoints are unauthenticated. Traffic is encrypted and approvals can be revoked.
5. It also works **away from the laptop's Wi-Fi over Tailscale**.
6. Both UIs are designed in **Stitch** first. **Everything is documented** (planning → code).

### Non-goals (v1)

- Internet relay or port forwarding (Tailscale covers remote use).
- iOS, or a non-Windows laptop shell (the server core stays cross-platform; tray and autostart are Windows-only).
- Background push notifications on the phone (laptop → phone items appear while the app is open and connected).
- End-to-end encryption on top of TLS; multi-user accounts.
- IPv6 addressing (IPv4 only in v1; the address model leaves room for it).
- Resumable transfers and per-file checksums (see `docs/decisions.md`).

## 2. Architecture

```
Phone (Flutter, Android)                       Laptop (Node.js, Windows)
┌────────────────────────┐   UDP 8766 discover  ┌──────────────────────────────────┐
│ Laptops list           │ ───────────────────► │ discovery (UDP)                  │
│ Connect / Disconnect   │                      │                                  │
│ pinned-TLS client      │   HTTPS 8765 (v1 API)│ device API (TLS, pinned cert)    │
│ secure storage         │ ◄──────────────────► │  pairing · sessions · items      │
└────────────────────────┘  LAN or Tailscale    │                                  │
                                                │ admin API + UI (HTTP 127.0.0.1:  │
 Laptop browser  ─────────── 127.0.0.1:8760 ──► │   8760, loopback only)           │
 Tray (PowerShell) ◄──── stdin/stdout JSON ───► │ tray bridge · autostart          │
                                                └──────────────────────────────────┘
State: %APPDATA%\FlashPush\  (override: FLASHPUSH_HOME)
```

Three listeners with different trust levels:

| Listener | Bind | Who can reach it | Purpose |
|---|---|---|---|
| Device API | HTTPS `0.0.0.0:8765` | any host on LAN/Tailscale; only approved devices get past `/v1/hello` and pairing | phone ↔ laptop |
| Admin UI/API | HTTP `127.0.0.1:8760` | this laptop only | approve/deny, devices, send from laptop |
| Discovery | UDP `0.0.0.0:8766` | LAN broadcast | answer "FlashPush?" with name/ID/port |

### Server modules (`server/src/`)

Each has one job and is testable alone.

| Module | Responsibility |
|---|---|
| `config.js` | state directory, ports, paths, limits (limits are constants; `config.json` may set only ports and the receive folder) |
| `identity.js` | permanent laptop ID + display name |
| `tls.js` | create/load self-signed cert (generated with the small pure-JS `selfsigned` package, the only new server dependency; `qrcode` is removed); SHA-256 fingerprint |
| `crypto.js` | the pairing primitives in §3.2 (commit, SAS, proof) and random helpers, exactly as specified, shared by server and integration-test client |
| `devices.js` | approved-device store; issue secret (store SHA-256 only); verify; remove (revoke and forget are the same) |
| `pairing.js` | pairing state machine, expiry, limits |
| `sessions.js` | in-memory session tokens: one per device, idle + absolute expiry |
| `ratelimit.js` | small sliding-window limiter keyed by IP |
| `addresses.js` | list laptop addresses, classify `lan` / `tailscale`, optional MagicDNS name |
| `discovery.js` | UDP responder |
| `store.js` | items (text/files), quotas, retention, persistence |
| `transfers.js` | streamed uploads: `.part` file, size/quota/disk checks, path safety, atomic rename |
| `idempotency.js` | bounded per-device memory of completed `operationId`s |
| `errors.js` | error codes and the JSON error envelope |
| `deviceApi.js` | HTTPS routes under `/v1` |
| `adminApi.js` | loopback-only routes under `/admin` + serves the web UI |
| `tray.js` + `tray.ps1` | tray icon, menu, status, notifications |
| `autostart.js` | install/remove Startup launcher; single-instance check |
| `lifecycle.js` | start-up readiness states and graceful shutdown |
| `index.js` | wires everything together |

## 3. Security model

### 3.1 Identity, secrets and sizes

| Value | Definition |
|---|---|
| `laptopId` | UUID v4, created once |
| Laptop certificate | self-signed EC P-256, 10 years. `fp` = **SHA-256 of the DER-encoded leaf certificate**, 32 raw bytes (hex in JSON) |
| `deviceId` | UUID v4 created once on the phone; name e.g. "Pixel 7" |
| `np`, `nl` | 16 bytes each from a cryptographic RNG, base64url in JSON |
| `requestId` | 16 bytes from a cryptographic RNG, base64url. Never sequential |
| Device secret | 32 random bytes, base64url. Laptop stores only `SHA-256(secret)` |
| Session token | 32 random bytes, base64url, memory only |

The phone keeps the device secret and the laptop's pinned fingerprint in Android secure storage (Keystore-backed). Secrets, tokens and request IDs are never put in URLs (except the request ID path segment in §3.2) and are never logged.

### 3.2 Pairing (first time, or re-pair) — numeric comparison with commit–reveal

A code taken from the fingerprint alone can be ground offline by a man-in-the-middle, so both sides contribute a nonce and the phone commits first.

**Exact encodings** (identical on server and Flutter; unit-tested against fixed vectors in both):

- All concatenations (`‖`) are raw bytes with **no separators or length prefixes**. Every field is fixed length except the ASCII label at the front, so the input is unambiguous.
- `commit = SHA256( "FLASHPUSH-COMMIT-v1" ‖ np )`
- `sasHash = SHA256( "FLASHPUSH-SAS-v1" ‖ fp ‖ np ‖ nl )`; `SAS = uint32_big_endian(sasHash[0..4]) mod 1,000,000`, zero-padded to six digits and displayed as `482 916`.
- `proof = HMAC-SHA256( key = np, msg = "FLASHPUSH-STATUS-v1" ‖ requestId_bytes ‖ UTF-8(deviceId) )`, hex.
- The laptop uses **its own** certificate's `fp`. The phone uses the fingerprint of the certificate **the TLS session actually presented**.

**Flow:**

1. Phone → `POST /v1/pair/request {deviceId, deviceName, commit}`. It records the presented certificate's `fp`.
2. Laptop creates a pending request, picks `nl` **after** seeing the commit, returns `{requestId, nl}`. A new request from the same `deviceId` replaces its previous pending one.
3. Phone → `POST /v1/pair/reveal {requestId, np}`. Laptop checks `SHA256("FLASHPUSH-COMMIT-v1" ‖ np) == commit`, else `COMMIT_MISMATCH` and the request is dropped.
4. Both compute `SAS`. The laptop shows it on the approval card; the phone shows it on its waiting screen.
5. User confirms the codes match and clicks **Approve** (laptop UI or tray notification). Mismatch → **Deny**.
6. Phone polls (every 1–2 s, no long-poll) `GET /v1/pair/status/:requestId?deviceId=…` with header `X-Pair-Proof: <proof>`. A wrong or missing proof, wrong device or unknown request gets the same `PAIR_NOT_FOUND` answer (no oracle). On `approved` with a valid proof it receives `{secret, laptop, addresses}`.
7. The secret can be fetched again with a valid proof for **60 seconds** after approval, so a lost response does not force re-pairing; after that it is erased from memory and the request record is deleted.

**Why this is sound:** `nl` is chosen after the commit, and the phone reveals `np` only after receiving `nl`. A man-in-the-middle must fix both legs' inputs before learning the other side's random value, so matching codes appear with probability 1 in 1,000,000 per attempt, and every attempt shows up as a pairing request the user can see.

**Re-pair:** pairing again with an existing `deviceId` (phone menu "Re-pair", or after credentials were lost) goes through the same approval. On approval the device record's secret is **replaced**: the old secret stops working immediately and its session is ended. The approval card says "Re-pair of *Pixel 7*".

**Limits:** the phone must send its reveal within **10 seconds** of the request or the request expires (an unrevealed request could otherwise hold one of the 3 pending slots for 2 minutes and let anyone on the Wi-Fi block pairing); a revealed request expires after **2 minutes**; max **3 pending**; max **5 pair requests/minute/IP**; max **20 approved devices**. The approval card shows the requester's route (Wi-Fi vs Tailscale) and IP.

### 3.3 Sessions: Connect / Disconnect

- **Connect:** `POST /v1/session` with `Authorization: Device <deviceId>:<secret>` → `{sessionToken, expiresAt, laptop:{id,name}, addresses:[…]}`. The client must verify the pinned fingerprint **before** sending the secret; mismatch → abort with `CERT_CHANGED` handling (§6).
- **One active session per device.** A new `POST /v1/session` invalidates that device's previous session and closes its event stream. The call is idempotent from the client's point of view.
- **Expiry:** idle timeout **24 h**, absolute lifetime **7 days** (both in `config.json`). Expired → `401 SESSION_EXPIRED`; the app silently reconnects with the device secret, no re-pairing.
- All data routes require `Authorization: Bearer <sessionToken>`.
- **Disconnect:** `DELETE /v1/session` ends the session and its event stream; that phone gets 401 on data routes until it connects again. The pairing stays, so Connect needs no approval.
- Server restart ends all sessions.
- **Forget laptop** (phone) → `DELETE /v1/devices/self` (best effort) + local wipe. **Revoke** (laptop UI/tray) → device removed and its sessions ended; that phone's next attempt gets `DEVICE_NOT_PAIRED`. No separate "revoked" state is remembered.

### 3.4 Blocking unapproved traffic

- The only unauthenticated device-API routes: `GET /v1/hello`, `POST /v1/pair/request`, `POST /v1/pair/reveal`, `GET /v1/pair/status/:id` (the last needs the proof header). Everything else without a valid session → `401`.
- Failed auth attempts limited to **10/minute/IP**, then `429 RATE_LIMITED`.
- Secrets/tokens compared with `crypto.timingSafeEqual`.

### 3.5 Admin surface (loopback)

- Bound to `127.0.0.1` only. Requests must have `Host: 127.0.0.1:8760` or `localhost:8760` (blocks DNS rebinding); state-changing calls also need the header `X-FlashPush-Admin: 1`, and any `Origin` header must be the admin origin.
- **This is a browser cross-site defense, not authentication.** A custom header forces a CORS preflight the server never approves, so web pages the user visits can't drive the admin API. Any process running as the user can still call it. Such malware is out of scope; if the UI ever gains more sensitive actions, add a local capability token then.

### 3.6 Threat model summary (documented in `docs/security.md`)

| Threat | Handled by |
|---|---|
| Stranger on café/home Wi-Fi reads traffic | TLS |
| Stranger tries the API | 401 for everything but hello/pairing; rate limits |
| Stranger spams pairing | 3 pending cap, per-IP limit, 2-minute expiry, needs a human Approve |
| Someone who learns a `requestId` steals the new secret | status needs the `np`-derived proof |
| Man-in-the-middle during first pairing | commit–reveal SAS (1 in 10⁶ per attempt) |
| Later MITM / cert swap | pinned fingerprint; client refuses mismatch |
| Stolen/lost phone | Revoke on the laptop |
| Abandoned session | 24 h idle / 7 day absolute expiry |
| Web page attacking localhost admin | loopback bind, Host check, custom header |
| Attacker with local user access to the laptop | **not** protected (state files are user-readable) |

## 4. API conventions

### 4.1 Error envelope

Every non-2xx JSON response:

```json
{ "error": { "code": "DEVICE_NOT_PAIRED", "message": "This device is not paired with this laptop." } }
```

The Flutter client branches on `code`, never on `message`.

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | malformed input |
| `UNAUTHORIZED` | 401 | missing/invalid credentials |
| `SESSION_EXPIRED` | 401 | session gone or expired: reconnect |
| `DEVICE_NOT_PAIRED` | 401 | laptop does not know this device (never paired, forgotten or revoked): stop retrying, offer Re-pair / Forget |
| `RATE_LIMITED` | 429 | slow down (`Retry-After`) |
| `PAIR_NOT_FOUND` | 404 | unknown request / wrong proof |
| `PAIR_EXPIRED` | 410 | request timed out |
| `PAIR_DENIED` | 403 | user pressed Deny |
| `PAIR_LIMIT` | 429 | too many pending requests or devices |
| `COMMIT_MISMATCH` | 400 | revealed `np` does not match the commit |
| `PAYLOAD_TOO_LARGE` | 413 | over the size limit |
| `INSUFFICIENT_STORAGE` | 507 | not enough free disk |
| `STORAGE_QUOTA` | 507 | storage quota reached |
| `ITEM_NOT_FOUND` | 404 | no such item |
| `INTERNAL` | 500 | server bug |

### 4.2 Idempotency

- `POST /text` and `POST /file` accept a client-generated `X-Operation-Id` (UUID). The server remembers completed operation IDs **per device, last 200 or 10 minutes**, and a duplicate returns the original item with `200` and no second copy. If the same ID is still uploading, the duplicate gets `429 RATE_LIMITED` with `Retry-After: 1`; the phone retries and then receives the stored result, so a second write never starts.
- `POST /session` replaces the device's session (safe to repeat). `DELETE /session`, `DELETE /items/:id`, `DELETE /devices/self` treat "already gone" as success. Pairing: see §3.2 (same `deviceId` replaces its pending request).

### 4.3 Body limits

JSON bodies max 1 MB (`PAYLOAD_TOO_LARGE`). Text max 1 MB. Files: see §7.

## 5. Discovery and Tailscale

### 5.1 LAN discovery (UDP 8766)

Phone broadcasts `{"t":"FLASHPUSH_DISCOVER","v":1}` to `255.255.255.255` (and each subnet broadcast) and listens for a **2 second window**. Laptop replies unicast `{"t":"FLASHPUSH_HERE","v":1,"laptopId","name","port":8765}`. The reply is a hint only; identity is decided by TLS pinning and SAS, never by discovery.

**Scan policy (phone):** scan immediately when the Laptops screen opens and when the app returns to the foreground; if nothing is found, retry after 3 s, 6 s and 12 s, then stop; pull-to-refresh runs a full scan; no scanning while the screen is inactive.

**First-class fallback:** the empty state reads "Can't find your laptop? **Add by address**", because client-isolated or broadcast-blocking Wi-Fi is common.

### 5.2 Tailscale and address handling

- Broadcast does not cross Tailscale, so remote use works from **saved addresses**.
- `addresses.js` lists the laptop's IPv4 addresses, each tagged `tailscale` (inside `100.64.0.0/10`, or interface name like `tailscale*`), `lan` (192.168/16, 10/8, 172.16/12) or `other`. Link-local `169.254.x.x` is dropped. If the Tailscale CLI is on `PATH`, `tailscale status --json` is used, best effort, to also report the laptop's **MagicDNS name**, which is preferred over the raw `100.x` IP when present (it survives IP changes). No CLI → the `100.x` IP alone.
- The phone keeps, per laptop, **saved addresses** (from the last successful session or pairing) and remembers which one was **last verified**. Every successful connect refreshes the list, so a Tailscale address learned on Wi-Fi is available off Wi-Fi.
- **Connect** races the saved addresses: `GET /v1/hello` to each with a **3 second timeout per candidate**; the first candidate that passes TLS **pin verification** wins, all other attempts are cancelled immediately, and the UI shows "via Wi-Fi" or "via Tailscale".
- **Add laptop by address** (IP or MagicDNS name, optional port, default 8765) handles first-time pairing when the phone is only on Tailscale or the Wi-Fi blocks broadcast. Approval and SAS are identical.
- Requirements: Tailscale running on both devices, same tailnet.

### 5.3 Windows Firewall

- The Tailscale adapter is often classed as **Public**, and some setups block the first run. `scripts/allow-firewall.ps1` (run once as administrator) adds one inbound rule: **TCP 8765 + UDP 8766** only, limited to `LocalSubnet` and `100.64.0.0/10`. No other ports or remote ranges. The port list and scope are documented in `docs/setup.md`.
- Windows gives no reliable API to detect "blocked by firewall", so the laptop UI has an always-available panel **"Can't connect from your phone?"** showing the exact command and the rule's scope, plus the addresses the phone should reach.

## 6. Phone connection model

### 6.1 States

Internal states (source of truth: `docs/connection-state.md`):

```
DISCOVERING → DISCOVERED → NOT_PAIRED → PAIRING → PAIRED → CONNECTING → CONNECTED → DISCONNECTING → PAIRED
```

Failure states, kept separate from the main path: `CONNECT_FAILED`, `LAPTOP_UNREACHABLE`, `CERT_CHANGED`, `UNPAIRED`, `PAIR_EXPIRED`, `PAIR_DENIED`.
The UI collapses these to **Not paired / Paired / Connected** plus a short reason when something failed.

### 6.2 Reconnect behavior

- The app holds a **connect intent**. Pressing **Disconnect** clears it. Temporary network loss or a laptop restart keeps it.
- With intent set, retry with exponential backoff (2 s, 4 s, 8 s … capped at **60 s**), only while the app is in the foreground, and re-running the address race each time.
- `SESSION_EXPIRED` → reconnect immediately with the device secret.
- `DEVICE_NOT_PAIRED` (revoked or forgotten on the laptop) → clear intent, mark **Not paired**, offer **Re-pair** or **Forget**. No more retries.
- `CERT_CHANGED` (presented fingerprint ≠ pinned) → clear intent, never send the secret, show "Laptop identity changed", offer **Forget & pair again**. No more retries.
- Laptop simply offline → stay paired, keep retrying at the capped interval.

### 6.3 Event stream (SSE) lifecycle

- `GET /v1/events`: heartbeat comment every **25 s**; the client treats 60 s of silence as a dead link.
- Events carry **no replay**: there is no `Last-Event-ID` support by decision. On every (re)connect the client refetches `GET /v1/items`, then applies live events, which is simpler and cannot desync.
- At most **2** event streams per device; a new session closes the old one; session expiry sends an `event: expired` then closes.
- The stream is open only while the app has a connected session in the foreground (no background push in v1).

## 7. Files, storage and retention

### 7.1 Limits (constants in `config.js`)

| Limit | Default |
|---|---|
| Single file | 2 GiB |
| Text item | 1 MB |
| History entries | 500 (oldest pruned first) |
| Outbox (laptop → phone) storage | 5 GiB |
| File name length | 200 characters after sanitizing |
| Minimum free disk after write | 512 MB |

### 7.2 Upload safety (`transfers.js`)

- **Never trust a client path.** The client-supplied name is reduced to a sanitized basename (`/` `\` `:` `*` `?` `"` `<` `>` `|` and control characters replaced; leading dots removed; reserved Windows names such as `CON`, `NUL`, `COM1` get a `_` prefix; trailing dots/spaces trimmed).
- Absolute paths, drive paths (`C:\…`), UNC paths (`\\host\…`) and `../` all collapse to their basename.
- Files are always written under the server-controlled receive/outbox directory. After building the final path the code checks `path.resolve(target)` stays inside that directory. Files are created with an exclusive flag (`wx`), which fails instead of following an existing symlink or junction.
- Upload writes to `<name>.part` in the same directory and **renames** on completion. Before starting, `Content-Length` is checked against the file limit, the quota, and free disk space (`fs.statfs`), returning `PAYLOAD_TOO_LARGE`, `STORAGE_QUOTA` or `INSUFFICIENT_STORAGE`.
- **Interrupted transfer:** if the connection drops, or the bytes received do not equal `Content-Length`, the `.part` file is deleted, nothing appears in the feed, and the phone shows a retryable failure. Stale `.part` files are removed at start-up. Retrying with the same `X-Operation-Id` is safe (§4.2).
- Duplicate names get ` (1)`, ` (2)` suffixes.
- **Integrity:** TLS protects data in transit and the `Content-Length` check catches truncation. Per-file checksums, transfer IDs and resumable uploads are deferred (recorded in `docs/decisions.md`); the item model has room for an optional `sha256` later.

### 7.3 Retention

- **Items belong to one phone.** Every history entry carries the `deviceId` of the phone it was sent by or to, and a phone only ever sees its own entries, so several paired phones do not read each other's messages. The laptop UI's send box targets one phone (the only one, or a chosen one). File entries also carry a `mime` type (derived from the extension) so the phone can separate Images from Files.

- History is capped at 500 entries; pruning removes the oldest entry. Pruning a **received** file removes only the history entry, **never the file in the user's Downloads/FlashPush folder**. Pruning or deleting an **outbox** entry (laptop → phone) removes its file.
- Deleting an item in the UI follows the same rule. The laptop UI has **Clear history** with the same rules.
- Uninstalling or deleting the state folder leaves received files in place; only history and outbox go.

## 8. Laptop: autostart, tray, lifecycle

- **Autostart:** launcher `FlashPush.vbs` in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` runs `node.exe src\index.js` hidden (window style 0). Installed/removed by `node src/index.js --install-autostart` / `--uninstall-autostart` or the tray toggle. No admin rights. The `node.exe` path is recorded at install time.
- **Single instance:** at start, if `127.0.0.1:8760` already answers `/admin/ping` with the FlashPush signature, the new process opens the UI and exits.
- **Start-up states** (`lifecycle.js`, shown by the tray icon and admin UI): `starting` → `running`, or `degraded` when a listener failed (for example port 8765 taken). Degraded names the real cause ("Port 8765 is used by another program") in the tray tooltip, a notification and the UI, and keeps the working listeners up. `stopped` after Stop.
- **Tray** (Windows PowerShell hosting `System.Windows.Forms.NotifyIcon`, controlled by Node over newline-delimited JSON on stdin/stdout, no npm dependency; it exits when Node's stdin closes):

  | Item | Action |
  |---|---|
  | Status line | Running / Starting / Degraded (reason) |
  | **Open FlashPush** | opens `http://127.0.0.1:8760` |
  | **Pending approvals (n)** | opens the approvals view (hidden when 0) |
  | **Paired devices** | opens the devices view |
  | **Open received files** | opens the receive folder in Explorer |
  | **Start with Windows** ✓ | toggles autostart |
  | **Stop FlashPush** | graceful stop below |

- **Graceful stop:** (1) stop accepting new sessions and uploads; (2) let active transfers finish for up to **5 seconds**; (3) close event streams; (4) close the HTTPS, admin and discovery listeners; (5) tell the tray to exit and remove its icon. Transfers still running afterwards are aborted and their `.part` files removed.
- **Notifications:** a Windows balloon "Pixel 7 wants to connect — code 482 916"; clicking opens the approvals view.
- A Start Menu shortcut "FlashPush" (created with autostart) relaunches after **Stop**.

## 9. Phone app (Flutter)

Screens (designed in Stitch first, saved in `docs/design/`):

The app has **bottom navigation with three tabs: Devices, Transfer, Settings.**

**Connection status is shown with two icons, never with the words Connected/Disconnected:**

| Icon | Green | Grey |
|---|---|---|
| Wi-Fi | the phone reaches the laptop over the local Wi-Fi | not on the laptop's local network |
| Connection (link) | connected to the laptop (active session) | not connected |

Over Tailscale the Wi-Fi icon stays grey, the connection icon is green and the laptop detail subtitle reads "via Tailscale". Icons differ in shape and carry accessible labels, so state is never colour alone.

1. **Devices (laptops list):** discovered + saved laptops, each row with name, route, status and a **Connect / Disconnect** button; "Can't find your laptop? Add by address"; pull-to-refresh rescans. **Tapping a laptop row opens its detail screen** (item 2); the Connect button on the row only connects/disconnects.
2. **Laptop detail** (a screen of its own, opened from the list): header with the laptop name, the **two status icons** (below) and Connect/Disconnect, then three **separate tabs**:
   - **Messages:** previous text and links, both directions, newest last, with copy/open.
   - **Images:** a thumbnail grid of every image sent or received; tap for full view and Save.
   - **Files:** documents and other files with name, size, direction and Save/Open.
   A prominent **New transfer** button opens item 3.
3. **New transfer:** a bottom sheet that first asks the **type**: **Image** (gallery or camera), **Text** (compose text or paste a link) or **Document** (any file). Then the pick/compose step, then progress. If the laptop is not connected it offers to connect first.
4. **Pairing:** shows the 6-digit code, "Check it matches the laptop, then approve there", cancel; states approved / denied / expired.
5. **Transfer tab:** a shortcut to the detail screen of the currently connected laptop, or "Connect a laptop first" with a button to the Devices tab.
6. **Settings:** this phone's name, paired laptops (Re-pair, Forget), appearance (system / dark / light), connection (auto-reconnect, scan again), about.
7. **Problem states:** "Not paired anymore" (Re-pair / Forget) and "Laptop identity changed" (Forget and pair again) replace the detail content.

**History on the phone:** the phone keeps a per-laptop local cache of item metadata and image thumbnails, so Messages, Images and Files are readable while disconnected. Full files and full-size images are fetched from the laptop when connected (or are already on the phone if it sent or saved them).

Implementation notes: `dart:io` `HttpClient` with a `badCertificateCallback` that compares the presented certificate's fingerprint to the pinned one (during first pairing it only records it); `flutter_secure_storage` for secret + fingerprint; `crypto` for SHA-256/HMAC. `usesCleartextTraffic` is removed (HTTPS only). Share-sheet sending works against the connected laptop; if not connected it asks to connect.

### 9.1 Branding and icon assets

The supplied `app_icon.png` (repo root, 1254×1254 RGB, no transparency) shows a phone and laptop joined by two circular arrows with a document between them, on a navy rounded tile. It is the source for the brand and for every icon:

- **Palette** (sampled from the icon, used as Stitch design tokens and in both UIs, replacing the v1 indigo): navy background `#030C1E` → `#112B58`; blue `#0346F4` / `#1CA2FD`; cyan `#00A2FA` → `#45E2FD`; mint-green accent `#16F9CB` → `#47FCE3`. Dark-first, with a light theme derived from the same hues.
- **The PNG cannot be used as-is.** The black corners are painted pixels, so it would show a black square as a launcher icon. Derived assets (built in the plan, recorded in `docs/design/`):
  - **Android adaptive icon:** foreground = the phone/arrows/laptop artwork on transparency, scaled into the 66% safe zone; background = solid navy `#0A1B3D`; plus a monochrome layer for themed icons (Android 13+). Generated with `flutter_launcher_icons`.
  - **Windows tray + Start Menu shortcut:** a multi-size `.ico` (16/24/32/48/256). At 16 px the full illustration turns to mush, so the small sizes use a simplified glyph (the two arrows around a dot) in the same colors. Tray states (running / degraded / stopped) tint that glyph.
  - **Web UI:** favicon and header logo, cropped from the same artwork.

## 10. Laptop web UI (Stitch-designed)

Views: **Dashboard** (status + degraded reason, addresses and routes, send text/files to the phone, shared items feed, Clear history, the "Can't connect from your phone?" panel), **Approvals** (pending cards with code, requester name/IP/route, Approve/Deny, "Re-pair of …" label), **Devices** (paired phones with last seen, route, connected dot, Revoke). The QR/link is removed. Same visual language as the app.

## 11. Protocol summary (full detail per endpoint in `docs/protocol.md`, exact crypto in `docs/pairing.md`)

Every endpoint in `protocol.md` is documented with: method, path, auth, request body, response body, status codes, error codes, idempotency, max body size, and retry guidance.

Device API (HTTPS 8765, prefix `/v1`):

| Route | Auth | Purpose |
|---|---|---|
| `GET /hello` | none | identify a FlashPush laptop |
| `POST /pair/request`, `POST /pair/reveal` | none (rate-limited) | pairing |
| `GET /pair/status/:id` | proof header | pairing result |
| `POST /session`, `DELETE /session` | device secret / session | connect, disconnect |
| `DELETE /devices/self` | session | forget |
| `GET /items`, `GET /events` (SSE), `POST /text`, `POST /file`, `GET /files/:id`, `DELETE /items/:id` | session | data |

Admin API (HTTP 127.0.0.1:8760, prefix `/admin`): `GET /ping`, `GET /state` (+ SSE `/events`), `POST /pair/:id/approve|deny`, `DELETE /devices/:id`, `POST /history/clear`, `POST /text`, `POST /file`, `GET /files/:id`, `DELETE /items/:id`, `POST /autostart {enabled}`, `POST /open-folder`.

## 12. Errors and edge cases

- Approve after expiry → UI shows "expired"; nothing issued.
- Two phones request at once → each card has its own code and request; approving one never approves the other.
- Laptop IP changes → phone retries saved addresses and discovery; addresses refresh on the next connect.
- Laptop certificate regenerated (state deleted) → phone refuses (`CERT_CHANGED`) and offers "Forget & pair again".
- No network on the laptop → server still runs on loopback; addresses list is empty and the UI says so.
- Port in use (8765 / 8766 / 8760) → `degraded` state with the specific reason (§8).
- Disk full or low → `INSUFFICIENT_STORAGE`, transfer rejected before it starts (or aborted with `.part` cleanup).

## 13. Testing

**Server (`node:test`, no new test dependency):**

- **Crypto vectors:** commit, SAS, proof against fixed known-answer vectors, shared with the Flutter tests.
- **Pairing security:** wrong SAS path, modified `np`, modified `nl`, modified commit, expired request, request flood (limits), status polling with an invalid request ID, with the wrong device, with a wrong/missing proof, re-fetch within and after the 60 s window, re-pair replaces the old secret.
- **Sessions and auth:** revoked device reconnecting (`DEVICE_NOT_PAIRED`), stale/unknown token, duplicate session creation invalidates the first, idle and absolute expiry, certificate mismatch handling, replayed `operationId`.
- **Files:** duplicate names, `../`, absolute Windows path, UNC path, drive path, reserved names, overlong name, zero-byte file, oversize file, quota reached, disk-low rejection, interrupted upload leaves no item and no `.part`, retry with same `operationId`, symlink at target refused.
- **Other units:** devices store (hash-only storage, remove, re-pair), rate limiter, address classification (incl. Tailscale range and link-local drop), admin Host/Origin/header guard, discovery reply, launcher file generation, retention pruning (received files kept, outbox files removed).
- **Integration:** start the HTTPS server on ephemeral ports and drive the full flow (pair → approve → session → send text/file → disconnect → 401 → revoke) with a Node client acting as the phone.

**Flutter:** unit tests for SAS/commit/proof vectors, pin-decision logic, address race (one dead address, cancellation), reconnect state machine (backoff, revoked, cert changed), storage; widget tests for the laptops list states with a fake API.

**Manual checklist (`docs/testing.md`):**

- *Networking:* pairing on LAN; Wi-Fi → Tailscale and Tailscale → Wi-Fi transitions; laptop IP change; laptop hostname change; Wi-Fi client isolation; UDP discovery blocked; Tailscale off; one dead saved address among several.
- *Windows lifecycle:* sign-in with autostart; sign-out/sign-in; reboot; sleep/wake; network adapter change; Stop → relaunch; process crash → relaunch; port already in use; tray items; notification click; firewall rule.

## 14. Documentation deliverables

```
docs/
  README.md            index
  architecture.md      how the pieces fit
  protocol.md          every endpoint: schema, errors, idempotency, limits
  pairing.md           the exact cryptographic protocol + test vectors
  connection-state.md  phone/laptop state machines, reconnect rules (source of truth)
  transfers.md         file lifecycle, limits, path safety, retention
  security.md          threat model and what is/isn't protected
  setup.md             install, autostart, firewall rule, Tailscale
  testing.md           automated + manual checklists
  decisions.md         choices and why (incl. review triage)
  design/              Stitch screens + design tokens
  superpowers/         this spec and the implementation plan
```

Plus updated root `README.md` and `CHANGELOG.md`.

## 15. Build order

Security-critical protocol first, Windows and remote-network pieces layered on afterwards; Stitch designs are produced early so the UI tasks build to them.

1. Core server layout, HTTPS and certificate generation
2. Device identity and secure device store
3. Pairing state machine and SAS (with shared test vectors)
4. Session authentication, expiry and the error envelope
5. LAN discovery
6. Stitch designs for the app and the laptop UI
7. Flutter: pinned client, secure storage, discovery, laptops list, pairing UI
8. Text transfer with idempotency
9. File transfer with `.part`, limits and quotas
10. Laptop web UI
11. Windows tray and lifecycle states
12. Autostart, single instance and the firewall script
13. Tailscale address handling and the address race
14. Reconnection state machine
15. Security/integration tests, manual checklist, documentation pass

## 16. Migration from v1

v1 (token + HTTP + QR) is replaced, not kept alongside, because blocking unapproved traffic is a goal. The old `/api/*`, the `?t=` token and the QR panel are removed. Existing v1 users pair once.
