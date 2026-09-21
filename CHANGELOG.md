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

### Planned
- Spec revision 2 **approved**.
- Implementation split into plans (`docs/superpowers/plans/2026-09-21-v2-plan-index.md`): 1A server security core, 1B server API and transfers, 2 Stitch designs, 3 Android app v2, 4 laptop web UI, 5 Windows shell, 6 Tailscale/reconnect/hardening. **Plan 1A is written in full** (8 test-first tasks with complete code, including known-answer crypto vectors computed from the spec's definitions).

### Changed
- **Over-engineering review applied** to Plan 1A and the spec (about 290 lines fewer, `docs/decisions.md`): idempotency cache without promises (an in-flight duplicate gets `429` + `Retry-After`), no revoked tombstones (`DEVICE_REVOKED` removed; revoke and forget are one `remove`, the phone sees `DEVICE_NOT_PAIRED`), no long-poll on pair status (phone polls every 1-2 s), sessions keyed by token, one `expiresAt` per pairing record, `config.json` limited to ports and receive folder, injectable `rng`/TLS `now`/`CODES` removed. Rejected: dropping TLS/pinning/SAS in favour of Tailscale only.
- Spec §3.2: an unrevealed pairing request now expires after **10 s** (was covered only by the 2 min limit), so anyone on the Wi-Fi cannot fill the 3 pending slots and block pairing.
- Repository set up on `main` with a README as the first commit; `develop` created from `main`; work continues on `feature/v2-pairing-autostart-tailscale` (branching rules recorded in `docs/decisions.md`). All three branches pushed to `origin` (remote was empty; no force push).

### Verified
- **Plan 1A code executed**: every code block in the plan was extracted into a scratch copy and run with `node --test`: 77 tests, all passing. This caught a real bug (a literal U+2028 in a regex character class made `validate.js` a syntax error); fixed in the plan and covered by a new test.
- Server API exercised with curl: token check (401), text and file upload, path-traversal filename sanitizing, download, loopback web UI.
- App: `flutter analyze` clean, 3 unit tests pass, debug APK builds.
- Not tested on a real phone yet.
