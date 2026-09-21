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
| `index.js` | `createApp()` builds and wires everything, returns `start({ tolerant })` / `stop({ graceMs })`; a library (the entry point is `cli.js`) |
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
| `adminApi.js` + `public/admin.html` | loopback admin routes and the (temporary) page |
| `cli.js` | the entry point: `npm start`, `--no-tray`, `--install-autostart`, `--uninstall-autostart`, `--status`; `runApp()` starts the app tolerantly, then the tray |
| `lifecycle.js` | the `starting / running / degraded / stopped` state, human reasons for failed listens, the in-flight request tracker used by graceful stop |
| `singleInstance.js` | asks `127.0.0.1:<admin port>/admin/ping` whether FlashPush already runs |
| `desktop.js` | opens the admin page in the browser and a folder in Explorer, with validated arguments and no shell |
| `tray-protocol.js`, `tray.js`, `shell.js` | the JSON-line protocol and menu model (pure), the controller that runs `tray/tray.ps1`, and the wiring from app events to the tray |
| `autostart.js` | generates and installs/removes the hidden `FlashPush.vbs` launcher (Startup folder and Start Menu) |
| `addresses.js` | also reads the MagicDNS name (`tailscale status --json`, best effort) |

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

`stop({ graceMs = 5000 })` is idempotent and follows a fixed order:

1. stop the timers and **stop accepting** connections (idle keep-alive connections are dropped);
2. **wait up to `graceMs`** for running transfers to finish (event streams do not count as work);
3. close all event streams, end all sessions (`shutdown`);
4. close every remaining connection (an upload that is still running is cut, and its `.part` file is deleted) and the listeners, and stop discovery;
5. mark the lifecycle `stopped`. The CLI then tells the tray to exit and remove its icon.

## What is not here yet

The Stitch-designed admin UI (Plan 4), the Android app (Plan 3), and the phone's address race and reconnect rules (Plan 6). The current admin page is a temporary plain page.

## Windows shell

`cli.js` is the entry point. `runApp()` starts the app with `start({ tolerant: true })`: each listener binds on its own, so a taken port makes FlashPush **degraded** (with the reason, e.g. "Port 8765 is used by another program.") instead of aborting. The state is in `GET /admin/state` as `status: { state, reason }` and every change raises the `changed` signal.

```
tray.ps1 (PowerShell, NotifyIcon)  <-- JSON lines over stdin/stdout -->  tray.js  <-->  shell.js  <-->  app events
```

- The tray is a **static script** started with an argument array. Node sends `menu` (icon, tooltip, items), `notify` and `exit`; the tray sends `ready`, `click` (a fixed menu id) and `notification-click`. Everything is display text or a fixed id; nothing received is executed. The tray exits when told to or when its input closes (Node has gone).
- `shell.js` rebuilds the menu when the status or the number of pending approvals changes (an unchanged menu is not resent), shows a balloon for each new pairing request, and maps clicks to actions (open the admin page, open the receive folder, toggle Start with Windows, stop).
- **Single instance:** before creating the app, `cli.js` asks the admin port whether FlashPush already answers; if so it opens that page and exits.
- **Start with Windows** is a hidden-window `.vbs` launcher generated from a fixed template from three validated paths; see [setup.md](setup.md).
- Test-only switch: `createApp({ overrides: { bindHost: '127.0.0.1' } })` keeps the device API and discovery on the loopback interface. Production listens on every interface because phones connect from the network.

Operating instructions: [setup.md](setup.md). Manual checks: [testing.md](testing.md).
