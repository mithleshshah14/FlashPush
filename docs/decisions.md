# Decisions log

Short record of what was decided, when, and why. Newest at the bottom.

## 2026-09-21 — v1 scope (initial conversation)

| Decision | Choice | Why |
|---|---|---|
| Phone side | Native Android app (Flutter) | wanted a real app with share-sheet integration |
| Data | Text/links, files, both directions | requested |
| Laptop side | Node.js server + web page | easy to send data from the laptop too |
| Repo | Single monorepo: `server/` + `app/` | protocol changes touch both; one history |

## 2026-09-21 — v2 (pairing, autostart, Tailscale)

| Decision | Choice | Why |
|---|---|---|
| Replace QR/link with approval | Phone finds laptop, taps **Connect**, laptop **approves once** | no per-use scanning; per-device revoke |
| Approval method | **Match code + Approve** (numeric comparison) | user can tell which phone is asking; defends against impostors |
| Code strength | **Commit–reveal** on top of TLS fingerprint | a code from the fingerprint alone can be ground offline by a MITM |
| Transport | **HTTPS, self-signed, fingerprint pinned** | plain HTTP leaks files and the pairing secret on shared Wi-Fi |
| Discovery | **UDP broadcast** + add-by-address fallback | zero dependencies; mDNS needs packages and an Android multicast lock |
| Laptop runtime | **Hidden process + tray icon**, autostart via Startup folder | no admin needed, can show notifications, files save to the user's folder (a Windows service can't) |
| Tray menu | Open UI, Pending approvals, Paired devices, Open files folder, Start with Windows, **Stop** | user asked for open-UI, stop, and other functions |
| Remote use | **Tailscale** via saved address list (LAN + `100.x`) | broadcast cannot cross Tailscale; no relay needed |
| Design tool | **Stitch** for both UIs | requested |
| Process | Superpowers: brainstorming → spec → plan → TDD | requested; documented in `docs/` |

## 2026-09-21 — design review and branding

| Decision | Choice | Why |
|---|---|---|
| External design review (`FlashPush_v2_design_review_suggestions.md`) | Adopted most of it into spec revision 2 | pairing proof, exact encodings, one session per device + expiry, re-pair, file limits/path safety/`.part` files, error envelope, idempotency, tray states, graceful stop, reconnect rules, SSE rules, retention, extra tests, new docs |
| Deferred: per-file SHA-256 / transfer IDs / resumable uploads | Not in v1 | TLS already protects integrity; `Content-Length` + `.part` rename catches truncation; hashing doubles read time for large phone files. The item model keeps room for an optional `sha256` |
| Deferred: IPv6 | Not in v1 | Tailscale and home LANs work over IPv4; address model can add it later |
| Firewall "Limited" status | Help panel instead of auto-detection | Windows has no reliable API for "blocked by firewall"; showing the exact command and rule scope is always accurate |
| Idempotency | `X-Operation-Id` on text/file sends | flaky Wi-Fi retries must not duplicate transfers; bounded memory (200 ids / 10 min per device) |
| Secret re-fetch window | 60 s after approval, proof required | a lost approval response should not force re-pairing |
| App icon | `app_icon.png` supplied by the user is the brand source | palette sampled into design tokens; derived assets (adaptive icon, tray `.ico`, favicon) in the plan; the PNG's black corners mean it cannot be used directly as a launcher icon |

## 2026-09-21 — repository workflow

| Decision | Choice | Why |
|---|---|---|
| Branch model | `main` (stable) ← `develop` (integration) ← `feature/<name>` | requested; keeps unfinished work off stable branches |
| Rule | Every new feature after today gets a new `feature/*` branch created from `develop` | requested; also stored in Claude's project memory |
| First commit | README on `main`, then `develop` from `main`, then `feature/v2-pairing-autostart-tailscale` from `develop` | requested order |
| Docs habit | After each completed piece of work, update `CHANGELOG.md` and the affected `docs/` files with that day's changes | requested |
| Pushing / merging | Only when asked | first push done 2026-09-21 on request: `main`, `develop` and `feature/v2-pairing-autostart-tailscale` to `origin` (github.com/mithleshshah14/FlashPush); nothing merged yet |
