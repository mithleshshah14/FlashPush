# FlashPush

Send text, links and files between your Android phone and your Windows laptop, over the same Wi-Fi or over Tailscale. No cloud, no accounts: the two devices talk directly.

## Status

| Part | State |
|---|---|
| v1 prototype (shared token + QR code, plain HTTP) | working, being replaced |
| v2 (device pairing, approval on the laptop, HTTPS, tray + autostart, Tailscale) | design written, implementation not started |

v2 is designed in [`docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md`](docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md).

## What it will do (v2)

- The phone **finds the laptop automatically** on the Wi-Fi. No QR code or link to type each time.
- A new phone must be **approved once on the laptop** (both screens show the same 6-digit code). After that, **Connect / Disconnect is one tap** in the app.
- The laptop side **starts with Windows**, runs hidden, and lives in the **system tray**: open the UI, see pending approvals and paired devices, open the received-files folder, toggle start-with-Windows, or stop it.
- **Encrypted** (HTTPS with a pinned certificate). Anything from an unapproved device is rejected; only discovery, laptop identity and rate-limited pairing are open.
- Works **away from home Wi-Fi over Tailscale**.
- Send text, links and files in **both directions**, and share to FlashPush from any Android app.

## Repository layout

```
FlashPush/
  server/       Node.js server + web UI (runs on the laptop)
  app/          Flutter Android app (runs on the phone)
  docs/         design, protocol, security, setup, decisions, plans
  app_icon.png  source artwork for all icons
  CHANGELOG.md  what changed, day by day
```

## Try the v1 prototype

Laptop (Node.js 18+):

```
cd server
npm install
npm start
```

Open http://localhost:8765, then on the phone (`cd app && flutter run`, USB debugging on) tap **Scan QR code**. Allow Node.js through Windows Firewall on **Private networks** when prompted.

Files from the phone are saved to `Downloads/FlashPush`.

## Documentation

Everything lives in [`docs/`](docs/README.md): the design spec, the reasoning behind each decision, and (as they are written) the protocol, pairing, security, setup and testing guides. [`CHANGELOG.md`](CHANGELOG.md) records what changed on each working day.

## Branching and workflow

| Branch | Purpose |
|---|---|
| `main` | stable, released state |
| `develop` | integration branch; all feature work merges here |
| `feature/<name>` | one branch per feature, always created from `develop` |

Each piece of work follows: brainstorm → written spec → implementation plan → test-first implementation. The docs and `CHANGELOG.md` are updated at the end of every working day's changes.

## Tech

Node.js (`http`, `https`, `dgram`) for the laptop; Flutter (Dart) for Android; Stitch for UI design; Tailscale for remote access.
