# FlashPush

Send text, links and files between your Android phone and your Windows laptop, over the same Wi-Fi or over Tailscale. No cloud, no accounts: the two devices talk directly.

## Status

| Part | State |
|---|---|
| v1 prototype (shared token + QR code, plain HTTP) | server part removed; the old Android app is being replaced |
| v2 server (pairing, approval, HTTPS, per-phone history, transfers, discovery, admin API) | **built and tested** (169 tests) |
| v2 Android app (pairing, discovery, Messages/Images/Files, Tailscale-aware reconnect) | **built and tested** (170 tests); real-device checks pending, see `docs/testing.md` |
| Stitch-designed laptop UI, Windows tray + autostart | designed; being built |

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

## Run the laptop side (v2 server)

Node.js 22 or newer:

```
cd server
npm install
npm start
```

Open the address it prints (`http://127.0.0.1:8760`, this laptop only) to approve phones, send text and files, and manage devices. Run the one-time firewall step, and see the tray icon and start-with-Windows options, in [`docs/setup.md`](docs/setup.md). Details: [`server/README.md`](server/README.md). Tests: `cd server && npm test`.

The Android app in `app/` is the v2 app (see [`app/README.md`](app/README.md)); the remaining plans are listed in [`docs/superpowers/plans/2026-09-21-v2-plan-index.md`](docs/superpowers/plans/2026-09-21-v2-plan-index.md).

## Documentation

Everything lives in [`docs/`](docs/README.md): the design spec, the reasoning behind each decision, and (as they are written) the protocol, pairing, security, setup and testing guides. [`CHANGELOG.md`](CHANGELOG.md) records what changed on each working day.

## Contributing and security

Changes come in as pull requests from forks: see [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately: [SECURITY.md](SECURITY.md). The repository is public, so it is scanned for secrets before every push: [docs/repo-security.md](docs/repo-security.md).

## Branching and workflow

| Branch | Purpose |
|---|---|
| `main` | stable, released state |
| `develop` | integration branch; all feature work merges here |
| `feature/<name>` | one branch per feature, always created from `develop` |

Each piece of work follows: brainstorm → written spec → implementation plan → test-first implementation. The docs and `CHANGELOG.md` are updated at the end of every working day's changes.

## Tech

Node.js (`http`, `https`, `dgram`) for the laptop; Flutter (Dart) for Android; Stitch for UI design; Tailscale for remote access.
