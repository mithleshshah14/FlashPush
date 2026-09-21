# Architecture

How the laptop side (`server/`) is put together. The design rationale is in the [v2 spec](superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md); this page describes what is built.

## The three listeners

| Listener | Bind | Reachable from | Purpose |
|---|---|---|---|
| Device API | HTTPS `0.0.0.0:8765` (TLS ≥ 1.2, self-signed EC P-256) | LAN and Tailscale; only approved devices get past `/v1/hello` and pairing | phone ↔ laptop |
| Admin API and page | HTTP `127.0.0.1:8760` | this laptop only | approve/deny, devices, send from the laptop |
| Discovery | UDP `0.0.0.0:8766` | LAN broadcast | "is there a FlashPush laptop here?" |

Ports can be changed in `config.json` (`{"ports":{"device":9000}}`) when another program holds one.

## Modules (`server/src/`)

| Module | Responsibility |
|---|---|
| `index.js` | `createApp()` builds and wires everything, returns `start()` / `stop()`; the CLI entry |
| `config.js` | state folder, ports, paths, limits (constants) |
| `fsutil.js` | JSON read, atomic JSON write |
| `errors.js` | error codes, HTTP statuses, the JSON envelope |
| `validate.js` | UUID check, name cleaning |
| `crypto.js` | pairing primitives: commit, SAS code, proof, base64url, hashing |
| `identity.js` | the laptop's permanent ID and display name |
| `tls.js` | self-signed certificate and its SHA-256 fingerprint |
| `devices.js` | approved phones; only a hash of each secret is stored |
| `pairing.js` | the pairing state machine (commit–reveal, expiry, limits) |
| `sessions.js` | in-memory session tokens, one per device |
| `ratelimit.js`, `idempotency.js` | sliding-window limiter; remembers `X-Operation-Id`s |
| `addresses.js` | the laptop's addresses classified as lan / tailscale / other |
| `discovery.js` | UDP responder |
| `store.js`, `mime.js` | per-phone history, retention, mime types |
| `transfers.js` | safe streamed uploads |
| `http.js` | JSON in/out, error envelope, router, SSE, file streaming |
| `deviceApi.js` | the phone-facing `/v1` routes |
| `adminApi.js` | loopback admin routes; also serves the UI files from the allowlist |
| `static.js` + `public/` | in-memory allowlist of the admin UI files (`index.html`, `assets/*`), served with the strict CSP; see [admin-ui.md](admin-ui.md) |

Dependencies only point downwards: the two APIs depend on the stores and helpers; the stores never depend on HTTP.

## State on disk

`%APPDATA%\FlashPush\` (override with `FLASHPUSH_HOME`):

| File | Content |
|---|---|
| `identity.json` | laptop ID and name |
| `key.pem`, `cert.pem` | the TLS key (private) and certificate |
| `devices.json` | approved phones (secret hashes, last seen) |
| `items.json` | history (text, file records) |
| `outbox\` | files sent laptop → phone |
| `config.json` | optional: `ports`, `receiveDir` |

Files received from phones go to `Downloads\FlashPush` (`receiveDir`). All JSON is written atomically (temp file + rename).

## Start-up (`createApp` then `start`)

1. load config, create folders, delete unfinished `.part` uploads left by a crash
2. load or create the identity and the certificate (logs when a new certificate is created, because paired phones will then refuse it)
3. build the stores (`devices`, `sessions`, `pairing`, `items`, `idempotency`)
4. wire events: a re-pair ends the device's old session; pairing, session and item events raise one `changed` signal for the admin UI
5. build the two APIs and the HTTPS/HTTP servers
6. `start()` listens on the device port, the admin port and the discovery port in that order; if any fails it stops what already started and rethrows (an `EADDRINUSE` names the port)
7. a 10-second timer sweeps expired pairing requests

## Request path (device API)

TLS handshake → `deviceApi.handler` → router → the route handler → `requireSession` (bearer token → session → device, counts failures per address) → store/transfers → `sendJson`. Every error, however it arises, leaves through `sendError` as the documented envelope; unexpected errors are logged on the laptop and shown to the phone only as `INTERNAL`.

## Live updates

Phones get SSE (`/v1/events`): `item-added`, `item-deleted`, `expired`. The admin page gets one `changed` event and refetches `/admin/state`. There is no replay: clients refetch the list after every (re)connect.

## Shutdown (`stop`)

Idempotent: stop the timers, end all sessions (`shutdown`), close all event streams, close both servers and their connections, close the UDP socket.

## What is not here yet

Windows tray, notifications, autostart, start-up degraded state (Plan 5); the Stitch-designed admin UI (Plan 4); the Android app (Plan 3); Tailscale name resolution and the phone's address race (Plan 6).

## Admin UI (Plan 4)

`server/public/` holds the laptop web UI: plain HTML, CSS and ES modules, no build step. At start-up `static.js` reads `index.html` and everything under `assets/` (known extensions only) into a `Map` keyed by URL path; the admin handler answers `GET` requests by looking the path up in that map, so a URL can never become a file path. The page talks to the admin API only (same origin) and refreshes on the `changed` event. Details: [admin-ui.md](admin-ui.md).
