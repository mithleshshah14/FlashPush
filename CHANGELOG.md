# Changelog

Newest first. Every working day's changes are recorded here and in the affected files under `docs/`.

## 2026-09-21

### Added
- **v1 prototype** (working): Node.js server with a web page (`server/`) and a Flutter Android app (`app/`). Send text, links and files in both directions over the same Wi-Fi; pair by QR code or link; share to FlashPush from any Android app; files from the phone land in `Downloads/FlashPush`.
- Project `README.md`, `app/README.md`, and this changelog.
- `app_icon.png` (brand artwork supplied by the user).
- Project setting enabling the Superpowers plugin (`.claude/settings.json`).
- **Documentation set** under `docs/`: index, decisions log, and the v2 design spec (revision 2).

### Designed (not built yet)
- **v2**: automatic laptop discovery, one-time approval on the laptop with a matching 6-digit code, one-tap Connect/Disconnect, HTTPS with certificate pinning, Windows autostart with a tray icon (open UI, pending approvals, devices, files folder, start-with-Windows, stop), Tailscale support. Spec: `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md`.
- Spec revision 2 incorporates an external design review (`docs/FlashPush_v2_design_review_suggestions.md`): pairing proof and exact encodings, one session per device with expiry, re-pair, file limits and path safety, error envelope, idempotency, reconnect rules, retention. Deferrals and reasons are in `docs/decisions.md`.
- Brand palette sampled from the icon; derived icon assets planned.

### Changed
- Repository set up on `main` with a README as the first commit; `develop` created from `main`; work continues on `feature/v2-pairing-autostart-tailscale` (branching rules recorded in `docs/decisions.md`).

### Verified
- Server API exercised with curl: token check (401), text and file upload, path-traversal filename sanitizing, download, loopback web UI.
- App: `flutter analyze` clean, 3 unit tests pass, debug APK builds.
- Not tested on a real phone yet.
