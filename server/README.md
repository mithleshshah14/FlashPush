# FlashPush server (laptop side)

Node.js server that phones connect to over HTTPS to send and receive text, links and files. Runs on Windows (the tray icon and autostart arrive in a later plan); the core also runs on macOS/Linux.

## Run

Requires Node.js 22 or newer.

```
cd server
npm install
npm start
```

It prints the admin page address (`http://127.0.0.1:8760`, this laptop only). Open it to approve phones that want to pair, send text/files to a phone, and manage paired phones and history.

```
npm test        # 169 tests: unit, HTTP API, and end-to-end over real TLS
```

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

The first start asks whether Node.js may accept connections: allow it on **Private networks**, otherwise phones cannot reach the laptop. Tailscale needs an extra rule (covered with the Windows shell plan).

## Pairing a phone

1. The phone connects and asks to pair; the laptop's admin page shows a card with a 6-digit code.
2. Compare it with the code on the phone. **Only approve if they match.**
3. Approve. From then on the phone connects with one tap; use **Revoke** on the admin page to remove a phone.

## Documentation

[Architecture](../docs/architecture.md) · [Protocol](../docs/protocol.md) · [Pairing crypto](../docs/pairing.md) · [Security](../docs/security.md) · [Transfers](../docs/transfers.md) · [All docs](../docs/README.md)
