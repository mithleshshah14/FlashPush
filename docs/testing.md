# Testing

## Automated

| What | Command | Notes |
|---|---|---|
| Laptop server (unit, HTTP API, end-to-end over TLS) | `cd server && npm test` | Node 22+ |
| Android app (unit, widget, integration) | `cd app && flutter analyze && flutter test` | analyzer must report no issues |

### What the app tests cover

- **Protocol crypto:** the known-answer vectors from [pairing.md](pairing.md) (commit, 6-digit code, proof) must come out identical to the server's, plus strict base64url and size checks.
- **Pinned TLS client:** the acceptance rule (pinned match / mismatch, trust on first use, second different certificate refused).
- **Real server integration** (`app/test/integration/`): starts the real Node server (`server/src/index.js`) through `app/test/support/loopback_server.js`, which forces **every listener onto 127.0.0.1**, on ephemeral ports in a temp folder, and exits when the test ends. Covers pairing with matching codes, connect, text and file send with a repeated operation id, live events, a wrong pin (`CertificateChanged`), disconnect and reconnect, revoke. Skipped automatically when Node.js is missing.
- **Connection state machine** with a fake network: address race, Tailscale route, backoff sequence, foreground pause and resume, immediate reconnect on an expired session, the terminal states, live events, revoked sessions, `withSession` retry, forget.
- **Discovery** (UDP, loopback only) and its 0 s / 3 s / 6 s / 12 s policy; the address race (fastest wins, a dead address does not delay, losers cancelled, per-candidate timeout).
- **Pairing flow** against a fake laptop that computes its side independently, and the pairing screen.
- **Screens:** Devices, Add by address, Laptop detail (tabs, empty states, offline mode, New transfer for Image/Text/Document, Save, problem states), Transfer tab, Settings, the shell (tabs, discovery only on Devices, shares, theme), and the two-icon connection controls (no status words, 48 dp targets, accessible labels).
- **Android bridge:** share intake and save-to-Downloads through a mocked platform channel.

### Rules for tests in this repository

- Never open a listener on a non-loopback interface (servers bind `127.0.0.1`; UDP test sockets bind loopback).
- Never leave a process running; integration helpers must stop what they start.
- Time is injected (no real waiting for backoff), and randomness only where the value does not matter.

## Manual checklist (needs a real phone and laptop)

The automated tests cannot cover the Android platform or a real network. Run this before releasing. Tick each line and note the phone model and Android version.

### Setup

- [ ] `cd server && npm start`; allow Node.js on **Private networks** in Windows Firewall.
- [ ] Install the APK (`cd app && flutter build apk` and copy it, or `flutter run` with USB debugging).
- [ ] The app asks for **no permissions** (no camera, storage or location prompts).

### Discovery and pairing (same Wi-Fi)

- [ ] Devices tab shows the laptop within a few seconds; pull down rescans.
- [ ] Tap the grey link icon on the laptop: the pairing screen shows a 6-digit code.
- [ ] The laptop admin page shows a request with **the same code**. Approve: the phone connects and opens the laptop screen.
- [ ] Deny once: the phone says the request was denied; Try again works.
- [ ] Let a request expire (2 minutes): the phone says it expired.
- [ ] Both icons are green on Wi-Fi; tapping the link icon disconnects (both grey) and tapping again reconnects **without** a new approval.
- [ ] No text like "Connected" appears anywhere; the icons look like buttons.

### Transfers

- [ ] Text: New transfer > Text > send; it appears on the laptop. Send from the laptop; it appears on the phone live.
- [ ] Image: New transfer > Image; pick two photos; progress shows; both appear on the laptop (in `Downloads\FlashPush`).
- [ ] Document: send a PDF; then send a file of a few hundred MB and watch progress.
- [ ] Laptop to phone: send an image and a PDF from the admin page; they show under Images and Files; Save puts them in **Downloads/FlashPush** on the phone.
- [ ] Messages, Images and Files each show only their own kind; empty states look right.
- [ ] Turn Wi-Fi off mid-upload: the failure is shown with a message and can be dismissed; retrying does not create a duplicate on the laptop.
- [ ] Share from another app (Gallery: an image; Chrome: a link): choose FlashPush; it arrives on the laptop. With no connection it asks to connect first.

### Reconnect and offline

- [ ] Stop the server while connected: the icons go grey and the app keeps retrying (it reconnects on its own after the server restarts).
- [ ] Press Disconnect, then stop and start the server: the app does **not** reconnect by itself.
- [ ] Lock the phone for a minute and unlock: the list refreshes and the connection is restored.
- [ ] Disconnected, open the laptop: saved Messages, Images and Files are still readable ("Showing saved history"); New transfer is replaced by Connect to send.
- [ ] Settings: turn off Reconnect automatically; stop the server; the app tries once and stays grey.

### Security behaviour

- [ ] **Revoke** the phone on the laptop admin page: the phone shows "Not paired anymore" with Re-pair and Forget. Re-pair asks for a new approval.
- [ ] Delete `%APPDATA%\FlashPush\cert.pem` and `key.pem`, restart the server: the phone shows "Laptop identity changed" and **does not send anything**. Forget and pair again works.
- [ ] A phone that was never approved cannot list or send anything (try from a browser: `https://<laptop>:8765/v1/items` gives 401).

### Tailscale

- [ ] Turn Wi-Fi off, keep mobile data and Tailscale on (both devices on the same tailnet). Connect: the link icon is green, the Wi-Fi icon grey; long-press shows "via Tailscale".
- [ ] Add by address with the laptop's Tailscale IP (or MagicDNS name) before ever pairing on Wi-Fi: pairing works and the code matches.
- [ ] Windows Firewall: the Tailscale adapter is often "Public"; if the phone cannot connect over Tailscale, allow TCP 8765 and UDP 8766 for the Tailscale range (the firewall script arrives with the Windows shell).

### Look

- [ ] Dark and light themes both look right (Settings > Appearance), text readable, touch targets comfortable.
- [ ] TalkBack reads the two icons as "Wi-Fi: on/off" and "Linked to laptop: on/off. Tap to connect/disconnect".
