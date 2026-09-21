# FlashPush app (Android)

Flutter app that sends text, links and files between your phone and your laptop running the FlashPush server (see [`../server`](../server)).

## Status

This is the **v1 prototype**: pair by scanning the QR code on the laptop page (or pasting the link), then send and receive over plain HTTP. The **v2 rewrite** (automatic discovery, one-tap Connect/Disconnect, approval on the laptop with a matching code, HTTPS with a pinned certificate, Tailscale) is designed in [`../docs`](../docs/README.md) and not built yet.

## What works today

- Pair with a laptop by QR scan or pasted link; the pairing is remembered.
- Send text/links and files (any number) to the laptop, with progress.
- Receive what the laptop sends, live, and save files to `Downloads/FlashPush`.
- **Share to FlashPush** from any Android app (text, links, single or multiple files).
- Open links, copy text, delete items.

## Run it

Requirements: Flutter (stable), Android SDK, a phone with USB debugging (or an emulator on the same network as the laptop).

```
cd app
flutter pub get
flutter run                       # debug build on the connected phone
flutter build apk                 # build/app/outputs/flutter-apk/app-release.apk
flutter analyze && flutter test   # checks
```

The laptop server must be running first (`cd server && npm start`).

## Code map

| File | Responsibility |
|---|---|
| `lib/main.dart` | app shell, theme, remembered pairing |
| `lib/pairing_page.dart` | QR scan / paste link, connection check |
| `lib/home_page.dart` | live feed, sending, downloads, share handling |
| `lib/api.dart` | HTTP client for the server (items, upload, download, live events) |
| `lib/native.dart` | bridge to Android (share intents, save to Downloads) |
| `android/.../MainActivity.kt` | native side of that bridge |

## Android notes

- Needs the `INTERNET` permission; the camera permission is requested by the QR scanner.
- v1 uses cleartext HTTP on the local network (`usesCleartextTraffic`). v2 removes this in favour of HTTPS.
- Files received via the share sheet are copied to the app cache before upload.
