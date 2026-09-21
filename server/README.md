# FlashPush server (laptop side)

Node.js server that phones connect to over HTTPS to send and receive text, links and files. Runs on Windows with a tray icon and optional start with Windows; the core also runs on macOS/Linux (`npm run start:headless`).

## Run

Requires Node.js 22 or newer.

```
cd server
npm install
npm start                 # server + tray icon (Windows)
npm run start:headless    # server only
```

It prints the admin page address (`http://127.0.0.1:8760`, this laptop only). Open it (or use the tray icon) to approve phones that want to pair, send text/files to a phone, and manage paired phones and history. Starting it a second time just opens the running instance's page.

```
npm test        # 269 tests: unit, HTTP APIs, end-to-end over real TLS, and the Windows shell
```

The tests never run PowerShell or any script, never touch your Startup folder or firewall, and only listen on `127.0.0.1`; the parts that need the real desktop are a manual checklist in [testing.md](../docs/testing.md).

### Start with Windows

```
node src\cli.js --install-autostart      # or tick "Start with Windows" in the tray menu
node src\cli.js --status
node src\cli.js --uninstall-autostart
```

Details, the tray menu, and the one-time firewall step: [setup.md](../docs/setup.md).

## Where things are

| What | Where |
|---|---|
| Phone connections (HTTPS) | port 8765 |
| Admin page and API (this laptop only) | http://127.0.0.1:8760 |
| Discovery (UDP) | port 8766 |
| Files received from phones | `Downloads\FlashPush` |
| State (identity, certificate, devices, history, outbox) | `%APPDATA%\FlashPush` (override with `FLASHPUSH_HOME`) |

### Changing ports or the receive folder

If another program uses a port, create `%APPDATA%\FlashPush\config.json`:

```json
{ "ports": { "device": 9000 }, "receiveDir": "D:\\Inbox" }
```

## Windows Firewall

Windows blocks incoming connections until you allow them. Run `scripts\allow-firewall.ps1` once in an administrator PowerShell: it opens only TCP 8765 and UDP 8766, and only from your local subnet and Tailscale (`100.64.0.0/10`). Exactly what it does, and how to undo it, is in [setup.md](../docs/setup.md).

## Pairing a phone

1. The phone connects and asks to pair; the laptop's admin page shows a card with a 6-digit code.
2. Compare it with the code on the phone. **Only approve if they match.**
3. Approve. From then on the phone connects with one tap; use **Revoke** on the admin page to remove a phone.

## Documentation

[Setup](../docs/setup.md) · [Testing](../docs/testing.md) · [Architecture](../docs/architecture.md) · [Protocol](../docs/protocol.md) · [Pairing crypto](../docs/pairing.md) · [Security](../docs/security.md) · [Transfers](../docs/transfers.md) · [All docs](../docs/README.md)

[Architecture](../docs/architecture.md) · [Protocol](../docs/protocol.md) · [Pairing crypto](../docs/pairing.md) · [Security](../docs/security.md) · [Transfers](../docs/transfers.md) · [All docs](../docs/README.md)

## Admin page

`http://127.0.0.1:8760` shows the Stitch-designed UI (Dashboard, Approvals, Devices; dark and light). Its source is `server/public/` and needs no build step. See [docs/admin-ui.md](../docs/admin-ui.md) for how it works, the security rules for changing it, and how to preview it with sample data (`node test/tools/demo-server.js`, loopback only).
