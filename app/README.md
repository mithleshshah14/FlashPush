# FlashPush app (Android)

Flutter app that sends text, links and files between your phone and your laptop running the FlashPush server (see [`../server`](../server)). It finds the laptop by itself, pairs once with a matching 6-digit code, and then connects with one tap, over Wi-Fi or Tailscale.

## What it does

- **Devices tab:** laptops seen on the network and saved ones. Each shows two icon buttons instead of status words: **Wi-Fi** (green when reaching the laptop over local Wi-Fi) and **link** (green when connected; tapping it connects or disconnects). "Can't find your laptop? Add by address" takes an IP or a Tailscale name.
- **Pairing:** the phone shows a 6-digit code; approve on the laptop only if it shows the same one. After that, connecting needs no approval.
- **Laptop screen** (tap a laptop): **Messages**, **Images** and **Files** kept separate, all readable offline from a local cache; Messages has its own compose bar under the thread, Images/Files send through a **center button** (*Send image* opens the gallery, *Send file* the file explorer). A tab you're not on shows a small count badge instead of a banner when something new arrives on it; on another screen entirely, a banner shows with an Open action.
- **Transfer tab:** a shortcut to the connected laptop.
- **Settings:** phone name, paired laptops (Re-pair, Forget), theme, automatic reconnect, rescan, about.
- **Share to FlashPush** from any Android app; files received are saved to **Downloads/FlashPush**.
- **Reconnects** by itself with backoff when the laptop goes out of reach; stops and tells you when the laptop revoked the phone or its identity changed. Details: [`../docs/connection-state.md`](../docs/connection-state.md).

## Security

- Every connection is **HTTPS with certificate pinning**: the laptop's certificate fingerprint is recorded when you pair, and a different certificate is refused. The device secret is never sent over an unpinned connection.
- The device secret, pinned fingerprint and this phone's ID live in Android's secure storage; nothing secret is kept in preferences or logged.
- No cleartext HTTP, and the only permission is `INTERNET`.
- Protocol and threat model: [`../docs/pairing.md`](../docs/pairing.md), [`../docs/protocol.md`](../docs/protocol.md), [`../docs/security.md`](../docs/security.md).

## Run it

Requirements: Flutter (stable) with the Android SDK; the laptop server running (`cd server && npm start`).

```
cd app
flutter pub get
flutter run                        # debug build on a connected phone
flutter build apk                  # build/app/outputs/flutter-apk/app-release.apk
flutter analyze && flutter test    # checks (the integration test needs Node.js)
```

Testing, including the manual checklist for a real phone: [`../docs/testing.md`](../docs/testing.md).

## Code map (`lib/`)

| Folder / file | Responsibility |
|---|---|
| `core/protocol_crypto.dart` | pairing crypto (commit, 6-digit code, proof), base64url, UUID |
| `core/pinned_client.dart`, `core/http_laptop_api.dart` | TLS with certificate pinning; the HTTP client for the laptop API |
| `core/laptop_api.dart`, `models.dart`, `errors.dart`, `sse.dart` | the API interface, data types, error types and messages, event-stream parser |
| `data/` | secret store, saved laptops, settings, per-laptop history cache |
| `net/connection.dart` | the connection state machine (reconnect, backoff, address race, events) |
| `net/discovery.dart`, `address_race.dart`, `address_input.dart`, `backoff.dart` | UDP discovery, parallel address probing, "add by address" parsing, retry delays |
| `net/pairing.dart`, `transfer.dart`, `transfer_queue.dart`, `downloads.dart` | pairing flow, retry-safe sending, upload progress, saving files |
| `app_controller.dart` | app-wide state: laptop rows, the single active connection, shares, settings |
| `ui/` | screens and widgets (Devices, Pairing, Laptop detail and its tabs, the per-tab send button, Settings) |
| `theme.dart`, `app.dart`, `main.dart` | design tokens, the three-tab shell, start-up |
| `native.dart`, `android/.../MainActivity.kt` | share intake and saving to Downloads |

## Design

The screens follow the Stitch project "FlashPush v2" (`docs/design/` and `.stitch/DESIGN.md` on the design branch). Fonts are the system fonts (with a monospace family for addresses, sizes and the code) instead of the design's Manrope/Inter/JetBrains Mono, to avoid bundling font files; see [`../docs/decisions.md`](../docs/decisions.md).
