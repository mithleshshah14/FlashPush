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

## 2026-09-21 — over-engineering review of Plan 1A (ponytail)

Applied to the plan and spec before any code was written (about 290 lines fewer).

| Change | Why | Note |
|---|---|---|
| Idempotency cache: no promises/wait/forgetDevice; an in-flight duplicate gets `429 RATE_LIMITED` + `Retry-After: 1` | phone retries anyway; the review's claim that the exclusive `.part` create would catch duplicates is wrong (unique naming would write `name (1)`), so an in-flight marker stays | spec §4.2 |
| Rate limiter: dropped `maxKeys` and `reset`; kept `isBlocked` + `record` + `attempt` | the failed-auth limit in Plan 1B counts only failures, so it needs `isBlocked`/`record` (review said only `attempt` was used) | |
| Sessions keyed by the token string; dropped `sweep` and `connectedDeviceIds` | a 256-bit random token needs no hashed index; `verify` already expires lazily | |
| Device store: no `touch`/`flush`/dirty persistence | last-seen is a UI nicety; kept in memory | |
| No revoked tombstones: `revoke` and `forget` are one `remove`; `DEVICE_REVOKED` code removed | one nicer error message was not worth ~25 lines + persistence; phone shows "Not paired" and offers Re-pair | spec §3.3, §4.1, §6.2 |
| No long-poll: the phone polls pair status every 1–2 s | ~60 requests at most over LAN; removes waiters and timers | spec §3.2 |
| One `expiresAt` deadline per pairing record | replaces the 4-branch expiry check | |
| `rng` injection, TLS `now`, `CODES` export, `config.json` limits removed | nothing used them (`config.json` still sets ports and the receive folder, e.g. when a port is taken) | spec §2 |
| **Rejected:** drop TLS/pinning/SAS and rely on Tailscale only | LAN use without Tailscale is a goal, and the design was approved; recorded as considered | |

## Plan 1A — server security core

| Decision | Choice | Why |
|---|---|---|
| Unrevealed pair requests | expire after 10 s (`pairRevealWindowMs`) | the phone reveals immediately; otherwise 3 unrevealed requests could block pairing for 2 minutes |
| Certificate library | `selfsigned` 5.x (`keyType: 'ec'`, `notAfterDate`) | pure JS, supports P-256; `days` is not an option in this version |
| Timing | injectable `now` | every expiry rule is tested with a fake clock, no sleeping |
| State files | `%APPDATA%\FlashPush`, atomic JSON writes | survives crashes; independent of the launch directory |
| Simplifications from the over-engineering review | see the "over-engineering review of Plan 1A" section of this file | fewer moving parts before anything is built |

## 2026-09-21 — phone screens: laptop detail and new transfer

| Decision | Choice | Why |
|---|---|---|
| Tapping a laptop | opens a **laptop detail** screen with separate **Messages / Images / Files** tabs and a **New transfer** button | requested: read previous messages, see sent images and files separately, start a transfer |
| New transfer | bottom sheet asks the type first: **Image**, **Text**, **Document** | requested |
| Bottom navigation | Devices, Transfer, Settings; the Transfer tab is a shortcut to the connected laptop's detail screen | keeps the earlier Transfer/Settings request without two screens doing the same job |
| History offline | phone caches item metadata and image thumbnails per laptop | history must be readable while disconnected |
| Items belong to one phone | every history entry has a `deviceId`; a phone sees only its own; files carry a `mime` type | several paired phones must not read each other's messages; `mime` lets the phone split Images from Files |

## Plan 1B-i — server foundations

| Decision | Choice | Why |
|---|---|---|
| Address classification | built in 1B-i (`addresses.js`), MagicDNS and the phone's address race stay in Plan 6 | the route (Wi-Fi vs Tailscale) is needed on the approval card at pairing time |
| Upload part file | `<name>.<random>.part`; final name chosen synchronously just before the rename | two uploads of one name cannot collide or overwrite each other |
| Discovery replies | rate limited to 20 per 10 s per source address | a UDP responder must not be usable as an amplifier or a flood target |
| Received files vs history | pruning or deleting a history entry never deletes a file in Downloads | the user's own files must not disappear because a list got trimmed |
| Item ownership | entries carry `deviceId` and are filtered per phone | several paired phones must not read each other's messages |

## 2026-09-22 — Stitch review feedback

| Decision | Choice | Why |
|---|---|---|
| Mobile connection status | two icons: **Wi-Fi** (green = reaches the laptop over local Wi-Fi) and **connection/link** (green = connected, grey = not); no Connected/Disconnected words | requested; compact header |
| Tailscale route | Wi-Fi icon grey, link icon green, subtitle "via Tailscale" | the user asked for two icons only; the route stays visible without a third icon (assumption, easy to change) |
| Accessibility | different icon shapes plus accessible labels | colour must not be the only signal |
| Laptop UI | approved as designed; keep both dark and light modes | requested |

## Plan 1B-ii-a — device API

| Decision | Choice | Why |
|---|---|---|
| Shape | `createDeviceApi(deps) → { handler, closeAll }`, a plain request handler | tested over plain HTTP in milliseconds; mounted on HTTPS in Plan 1B-ii-b, where TLS is covered by the end-to-end test |
| New error codes | `NOT_FOUND` (404), `FORBIDDEN` (403) | unknown routes and the admin guard need a code that is not a domain error |
| `GET /v1/items` | returns `{ "items": [...] }` | leaves room for paging fields later without a breaking change |
| Wrong secret vs unknown device | `UNAUTHORIZED` vs `DEVICE_NOT_PAIRED` | the phone only stops retrying and offers Re-pair when the laptop truly does not know it |
| SVG | never served inline | an SVG can carry script; only raster images may be `inline` |
| Duplicate in-flight transfer | `429` + `Retry-After: 1` | no promise plumbing; the phone retries and gets the stored result |
| Session `start` event | added to `SessionStore` | the admin UI refreshes when a phone connects |
| Test harness | real modules, plain HTTP, `fetch`, phone flow helper `pairDevice` | every route is exercised over the wire, not by calling functions |

## 2026-09-22 — Stitch review, round 2 and working mode

| Decision | Choice | Why |
|---|---|---|
| Header icons | drawn as buttons; the connection icon **is** the connect/disconnect control; no status text next to them | requested; one control instead of icon + text + button |
| Working mode | run the remaining plans as a pipeline without asking between steps; report when done so the user can test | requested; guardrails: security, clean code, documentation |

## Plan 1B-ii-b — admin API and wiring

| Decision | Choice | Why |
|---|---|---|
| Admin guard | loopback address + `Host` + `Origin` + `Sec-Fetch-Site` + custom header on writes | blocks cross-site requests and DNS rebinding from web pages; explicitly not authentication (documented) |
| Admin page CSP | inline scripts allowed only because the temporary page is one inline file | the Stitch-designed UI (Plan 4) will ship external scripts and drop it |
| Temporary page | plain HTML, DOM built with `textContent` only | usable now without an XSS surface; replaced later |
| `createApp()` | returns `start()` / `stop()`, all ports configurable (0 in tests) | end-to-end tests run the real server on ephemeral ports in about 50 ms |
| Listen failure | stop what started, rethrow, name the port on `EADDRINUSE` | a half-started server is worse than none; Plan 5 turns this into the tray degraded state |
| Sending from the laptop | requires a target phone when several are paired | items belong to one phone |
| Test HTTP clients | `agent: false` | the default agent keeps sockets alive and hid a real connection-refused check |
| v1 | `server.js`, its page and `qrcode` removed | the shared-token API cannot coexist with the approval model |

## 2026-09-22 — antivirus safety (Kaspersky alert)

| Decision | Choice | Why |
|---|---|---|
| Cause | Kaspersky System Watcher blocked `tray.test.js` (`PDM:Exploit.Win32.Generic`); earlier a leftover demo server listened on all interfaces | behavior heuristics react to node launching PowerShell with `-ExecutionPolicy Bypass`, runtime C# compilation, script hosts and network-wide listeners |
| Enforcement | `server/test/guard.js`, loaded by `npm test`, makes any test that really launches PowerShell, VBS hosts, netsh, schtasks and similar throw (promisified `execFile` included); `guard.test.js` proves it | a rule that is only written down gets broken by the next generated test |
| Tray script | must not use `Add-Type -TypeDefinition` (stdin is read with a polled `ReadLineAsync`) | removes runtime compilation, the strongest heuristic trigger |
| Real scripts | tray, autostart and firewall checks are manual steps for the user | nothing on the machine changes without an explicit step |
| Test servers | loopback only, stopped when done | no orphaned network-wide listeners |
| Process | agent-written code is grepped for risky patterns and reviewed before it is run (`docs/dev-safety.md`) | catches the problem before the scanner does |

## Plan 5 — Windows shell

| Decision | Choice | Why |
|---|---|---|
| Start-up failures | `start({ tolerant: true })` from the CLI only; strict start stays the default for `createApp` | the spec wants a working admin page and a named reason when a port is taken; tests and library users still get a hard failure |
| Two firewall rules in one group | TCP 8765 and UDP 8766 as separate rules named in group `FlashPush` | a Windows firewall rule holds one protocol |
| Firewall profile | `-Profile Any` | Tailscale's adapter is often classed as Public; the remote-address scope is what limits the rule |
| Launcher file | one `.vbs` used for both the Startup folder and the Start Menu (no `.lnk`) | creating a shortcut needs COM or PowerShell; the launcher text is enough, needs no extra script, and is easy to read |
| Launcher encoding | UTF-16 with byte order mark | WScript reads it correctly for non-ASCII folder names |
| Tray stdin | a pending `StreamReader.ReadLineAsync()` polled by the UI timer; **no `Add-Type -TypeDefinition`** | runtime C# compilation is a classic heuristic-scanner trigger (the user's antivirus flagged the first version); the polling version compiles nothing |
| Antivirus safety rules | tests never execute PowerShell, WScript, `netsh` or any script, and only bind `127.0.0.1`; a static test scans every `.ps1` for compilation, encoded commands, downloads, registry, scheduled tasks, `netsh`, other programs | the user's antivirus reacted to project activity; real tray, autostart and firewall checks are manual steps in [testing.md](testing.md) |
| `bindHost` override | `createApp({ overrides: { bindHost } })`, default `0.0.0.0` | tests must not open sockets on the network; production must (phones connect from it) |
| Entry point | `cli.js`; `index.js` became a library | one place parses arguments and wires the Windows-only parts, `createApp` stays free of them |
| MagicDNS | best-effort `tailscale status --json` (2 s timeout), injected reader, refreshed every 60 s | no dependency, no failure when Tailscale is absent |
| Test helper | temp-folder cleanup retries | a scanner holding a freshly written file open made an unrelated test fail with ENOTEMPTY |

## Plan 4 - laptop web UI

| Decision | Choice | Why |
|---|---|---|
| Stack | plain HTML, CSS, ES modules; no framework, no build step, no dependency | nothing to maintain or attack; the pages are small |
| Serving files | in-memory allowlist read at start-up, Map lookup per request | traversal is impossible by construction, not by string checks |
| CSP | no `unsafe-inline` for scripts or styles | the temporary page needed it; the real UI does not, so XSS gets no foothold |
| DOM building | `createElement` + `textContent` only; enforced by a source test | messages and file names come from phones |
| Pure logic in `model.js` | formatting and view models are DOM-free and unit-tested in Node | the browser code stays thin |
| Live updates | keep the server's "changed, then refetch" model | no replay logic; same as the phone API |
| Fonts | named but not bundled; system fonts fall back | no external requests, no font licences to carry |
| Theme | dark default, follows the OS in light, manual toggle remembered in `localStorage` (guarded) | design shows both; storage may be blocked |
| Logo | the app icon as a small PNG with transparent corners | the icon's black corners are painted pixels (see the icon decision) |
| Demo/screenshots | demo mounts only the admin API on 127.0.0.1; no HTTPS or UDP listener | tooling must never expose anything to the network |

## Plan 3 - Android app v2

| Decision | Choice | Why |
|---|---|---|
| State management | plain `ChangeNotifier` controllers, no package | one app-level controller and one connection object per laptop; nothing here needs more |
| Network seam | `LaptopApi` interface; `HttpLaptopApi` is tested against the **real Node server** | everything above the wire is tested with fakes, and the real client with the real laptop, so the two sides cannot drift |
| Certificate pinning | `HttpClient` with no trusted roots; every certificate goes through one pure acceptance rule (`acceptCertificate`) | a laptop is only trusted by the fingerprint that was approved; the device secret is only sent on a pinned client (`connect` refuses otherwise) |
| Open the event stream before fetching the list | listen first, then fetch | the laptop does not replay events, so fetch-then-listen could miss one (found by a flaky integration test) |
| Images cached as files, not thumbnails | received images are stored (bounded to 100 MB, oldest evicted) and decoded at thumbnail size on screen | avoids an image-processing dependency; the plan said "thumbnails" |
| Re-pair does not forget first | it starts a new pairing at the laptop's last address; success replaces the old credentials and pin, cancelling changes nothing | forgetting first would lose the pairing and history if the user backs out, and raced with the screen closing itself |
| Tailscale detection | 100.64.0.0/10 and `*.ts.net`, also for typed addresses | the Wi-Fi/link icons and the route chip depend on it |
| Discovery targets | `255.255.255.255` plus `x.y.z.255` per interface address (a /24 is assumed) | Dart exposes no netmasks; Add by address covers other networks |
| Fonts | system fonts, monospace for addresses/sizes/code | the design names Manrope, Inter and JetBrains Mono; bundling them adds files and a licence step for no functional gain (revisit if branding requires it) |
| Background gradient | flat navy (`#030C1E`) instead of the fade to `#112B58` | flat surfaces per the design's own "restrained" rule; trivial to add later |
| Not done | camera capture for the Image choice; the adaptive launcher icon and monochrome layer | Image uses the system gallery picker. The icon needs a transparent foreground cut from `app_icon.png`, which needs image tooling; tracked in the spec section 9.1 |
| Test servers | the integration test launches the unmodified server through `loopback_server.js`, which forces all listeners onto 127.0.0.1 | tests must never open a port on the network |

## 2026-09-22 — Stitch designs (Plan 2)

| Decision | Choice | Why |
|---|---|---|
| Phone navigation | Bottom tabs **Devices \| Transfer \| Settings**; tapping a laptop opens a **laptop detail** screen (Messages \| Images \| Files) with a `New transfer` action; Transfer tab is a shortcut to the connected laptop's detail | user feedback: history should be separated by type and reachable per laptop |
| New transfer | bottom sheet "What do you want to send?" (Image / Text / Document) then a compose or picker step | user feedback |
| Connection state | **two icon buttons, no words**: Wi-Fi (status) and link (action: connect / disconnect); green = on, grey = off; on = solid glyph, off = outlined + slashed; Tailscale route: Wi-Fi grey, link green, "via Tailscale" only as tooltip | user feedback; not colour-only for accessibility; 44–48 dp touch targets |
| Offline detail screen | history stays readable from the phone's local cache; `New transfer` becomes `Connect to send` | user feedback |
| Laptop UI | approved as designed; dark and light kept | user feedback |
| Light theme | derived from the same hues (`#F4F8FF` background, darker mint `#0BB58F`) for the Devices list and the laptop screens | spec §9.1 |
| Design workflow | one screen per generation call; all changes in the initial prompt; export via `=w780` / `=w2560` | Stitch `edit_screens` does not persist and variants keep only the first change (`docs/design/README.md`) |

## 2026-09-22 — first run on a real phone

| Decision | Choice | Why |
|---|---|---|
| Wi-Fi icon meaning | on = the laptop answered the latest Wi-Fi discovery (or the connection is up over Wi-Fi), regardless of pairing | the spec says "reaches the laptop over the local Wi-Fi"; showing a crossed-out Wi-Fi next to a laptop that was just discovered over Wi-Fi is misleading |
| Launcher icon | adaptive icon: brand artwork with the navy keyed out on a navy gradient, art scaled into the 66 dp safe zone; rounded tiles for old Android | the source PNG has painted black corners and an opaque navy tile; keying gives clean results under circle, squircle and rounded-square masks |
| Generator | `scripts/make-android-icons.py`, Pillow only | reproducible; no PowerShell or other script hosts (see `docs/dev-safety.md`) |
| Not done | monochrome (themed) icon layer | Android 13+ themed icons would need a separate single-color glyph |

## 2026-09-22 — the center button acts on the current tab (user feedback)

| Decision | Choice | Why |
|---|---|---|
| Sending | the round center button follows the tab: Messages → text box, Images → gallery, Files → file explorer | requested: no extra "New transfer" chooser step |
| Type chooser sheet | removed (supersedes the earlier "New transfer asks the type first" decision) | it became dead code; one tap now does the job |
| Button position | bottom center | requested ("click on center") |
| Stitch designs | the "New transfer: choose type" sheet screens are superseded by this behaviour; the per-tab button is not yet drawn in Stitch | the app and spec are the source of truth until the designs are refreshed |

## 2026-09-22 — tray notification for what a phone sends (user request)

| Decision | Choice | Why |
|---|---|---|
| When | an item arrives from a phone and no admin page is open | requested: notify only when the site is not already open |
| How many | one balloon per phone per burst (2.5 s window), e.g. "sent 3 items: 1 message, 2 images" | requested "one notification"; avoids a balloon per file of a batch |
| Content | phone name and kinds only, never text or file names | notifications can appear on a locked or shared screen |
| Click | messages only → `#/messages` (chat); anything with a file or image → `#/dashboard`; pairing → `#/approvals` | opens the page where the item is shown |
| "Site is open" | any admin page holding its live-update stream | simple and exact; a page open in a hidden tab still counts as open (documented limitation) |

## 2026-09-22 — laptop chat view (user feedback)

| Decision | Choice | Why |
|---|---|---|
| Messages on the laptop | a separate **Messages** view that looks like a chat | requested: "it should look like I am having a chat" |
| Chat content | **text only**, one conversation per phone (picker when several are paired) | files and images already have their own list; a chat with mixed attachments would need new design work |
| Dashboard feed | now **Files and images** only; the text box moved to Messages (an "Open Messages" link remains) | text lives in one place, so nothing appears twice |
| Unread badge | counts phone messages that arrived while another view was open; the marker lives **in memory only** | no new storage or server state; existing history is read on load, and a reload starts fresh (documented limit) |
| Deep links | `#/messages` (new message), `#/dashboard` (file or image), `#/approvals` (pairing) open directly | the tray notification opens the right place |
| Rendering | new bubbles are appended, the thread is rebuilt only on removal or phone change | screen readers announce only the new message, and the scroll position is kept |
| View tests | a small fake DOM (`fake-dom.js`) instead of a browser or jsdom | no new dependency and no browser launch (see `docs/dev-safety.md`) |
| Design | built from the existing tokens; no Stitch screen yet (prompt in `docs/design/README.md`) | Stitch access is rate limited; the behaviour was the request |

## 2026-09-22 — the connection resumes by itself (found on the real phone)

| Decision | Choice | Why |
|---|---|---|
| Cause | the connect intent was only in memory, so after an app restart or a reinstall the laptop showed "paired, not connected" and only the Wi-Fi icon was green | user observation: after pairing both icons should be green |
| Fix | remember the laptop the user asked to connect (`activeLaptopId`); reconnect it at app start when auto-reconnect is on; clear it on Disconnect, Forget or connecting another laptop | matches spec 6.2 ("keeps the intent unless the user pressed Disconnect") which the first implementation only honoured while the app process lived |
| Not resumed | with auto-reconnect off; a laptop that was never connected | respects the setting; no surprise connections |

## 2026-09-22 — no "Paired" word next to the icons; tray troubleshooting (user feedback)

| Decision | Choice | Why |
|---|---|---|
| Device row status word | removed for paired laptops; kept only for "Not paired" and "Identity changed" | "Paired" beside a grey link icon looked like a contradiction; the icons already show reachability and connection; words only where the user must act |
| Tray troubleshooting | documented in `docs/setup.md` and the quickstart | the user saw no tray and no balloon because the running server was a headless copy started by the assistant; headless and "already running" are now spelled out |

## 2026-09-22 — push to the feature branch

| Decision | Choice | Why |
|---|---|---|
| What was pushed | the whole of local `develop` (all merged v2 work: server, Windows shell, laptop UI, Android app, designs, docs, safety guard, fixes from the first phone run) as a fast-forward of `origin/feature/v2-pairing-autostart-tailscale` (no force) | requested: push everything to the feature branch |
| Not pushed | `origin/main` and `origin/develop` stay as they were until the owner decides to merge | the feature branch is the review point |
| Pre-push check | no key or token files, no tracked file over 2 MB, no token-like strings | nothing sensitive goes public |
| Next | more laptop-side changes tomorrow, each on its own `feature/*` branch from `develop` | branching rule |

## 2026-09-22 — the repository is public: secrets audit and contribution model (user concern)

| Decision | Choice | Why |
|---|---|---|
| Audit | scanned every file in every commit on all refs (546 files, 106 commits) for private keys, tokens, API keys, signing passwords, sensitive file names, personal data and image metadata: nothing found | a public repository publishes its whole history |
| Guards | wider `.gitignore` (keys, keystores, `key.properties`, `local.properties`, `.env*`, `google-services.json`, APK/AAB, state files), `scripts/audit-secrets.py`, a pre-push hook, a PR template checklist | make a leak fail loudly instead of relying on care |
| "Only PRs, no direct changes" | already how a public repo behaves for strangers (they cannot push); reinforced with `CODEOWNERS`, `CONTRIBUTING.md`, `SECURITY.md`, PR template and the GitHub settings in `docs/repo-security.md` (branch rules, review required, no force pushes, secret scanning and push protection) | requested |
| "Nobody should clone it" | cannot be done on a public repository; needs a private repository (which also removes stars, forks and outside PRs) or a public repo containing only what is meant to be public | GitHub has no read-only-for-PRs-but-not-cloneable mode |
| Author email | every commit carries the author's git email; use GitHub's noreply address going forward; rewriting history is left to the owner | not a secret in files, but public metadata |

## 2026-09-22 — repository protections applied on GitHub

| Decision | Choice | Why |
|---|---|---|
| Branch protection | `main` and `develop`: PR + 1 approval + code owners, no force push, no deletion, owner may bypass; `feature/*` unprotected | outsiders can only propose changes through pull requests from forks; a solo owner must still be able to merge |
| Other settings | private vulnerability reporting on, Dependabot alerts on, wiki/projects off; secret scanning and push protection were already on | requested hardening of the public repository |
| Not changed | visibility stays public, forking and issues stay on | the goal was "fork, star and PRs are fine" |
| Follow-up | merge the feature branch into `develop` and `main` by pull request so the policy files become active | GitHub reads them from the default branch |

## 2026-09-22 — approvals relaxed for a solo maintainer (user question)

| Decision | Choice | Why |
|---|---|---|
| Required approval on `main` / `develop` | removed: PR still required, 0 approvals, no code-owner requirement; force pushes and deletions still blocked | one maintainer cannot approve their own PR, so the rule only forced an owner bypass; outsiders are stopped by having no write access, not by approvals |
| Revisit when | a collaborator with write access is added | then require approvals again |
| Squash merges | the first feature was squash-merged; its 112-commit history is kept on the feature branch | keep the branch, or use merge commits |
| Local branches | local `develop` and `main` were reset/fast-forwarded to GitHub after verifying identical content and that the detailed history is on the pushed feature branch | keep local and remote aligned after squash merges |

## 2026-09-22 — license: GNU GPL v3 (user decision)

| Decision | Choice | Why |
|---|---|---|
| License | **GPL-3.0** (`LICENSE` is the unmodified official text; SPDX `GPL-3.0-only` in `server/package.json`) | requested; anyone may use and change FlashPush, but a distributed derivative must stay open source, so it cannot be repackaged as a closed product |
| Contributions | a pull request means the contribution is licensed under GPL v3 too (stated in `CONTRIBUTING.md`) | inbound = outbound, no separate agreement needed |
| "only" vs "or later" | `GPL-3.0-only`; changing to `GPL-3.0-or-later` later is possible while the owner holds the copyright | keeps exactly the version the owner chose |
| Dependencies | Flutter/Dart packages (BSD/MIT/Apache) and `selfsigned` (MIT) are compatible with GPL v3 and keep their own licenses | no conflict |
| 2FA | enabled on the owner account (confirmed by the owner) | account security for a public repository |

## 2026-09-23 — Dashboard device tabs, messaging parity, notifications (branch `feature/dashboard-device-tabs`)

| Decision | Choice | Why |
|---|---|---|
| Dashboard's "Files and images" card | replaced with a **Devices** list; clicking a phone swaps the card in place to **Messages / Images / Files** tabs for that phone, no new route | requested; mirrors the phone's own laptop-detail tabs instead of a flat combined list |
| Messages tab (laptop) | a real conversation with its own compose bar, not read-only with a link to a separate page | "it told you it should be like messaging app" |
| Images/Files tabs (laptop) | each got its own "Add images" / "Add files" upload button, targeting that phone directly | parity with the app's per-tab send action; previously only the top-of-page Send card could upload |
| Messages page/nav item | removed entirely; `#/messages` falls back to the Dashboard like any unknown route | redundant once the Dashboard covers messaging per-device; the old full-page chat component stays in the tree, just unrouted |
| App composer | the "New message" floating button + modal sheet replaced with an inline compose bar under the thread | "shouldn't there be a composer in the app as well" |
| App default phone name | detects the real device model (`Build.MANUFACTURER`/`MODEL` via the existing native channel) instead of the generic "Android phone", the first time no name has been saved | requested; no new Flutter dependency needed |
| Notifications for incoming items | an in-app banner while foregrounded but elsewhere, not true background/closed-app push | the connection is deliberately foreground-only for battery reasons (see connection-state.md); background push would need a foreground service or a push relay, out of scope for this ask |
| Banner vs. per-tab badges | the banner only fires when you are not viewing that laptop's detail page at all (pushed from Devices, or as the Transfer tab's shortcut); a tab you're on a *different* tab of the same laptop gets a small count badge instead, cleared on opening it | the banner was showing even while already on the exact tab, and its SnackBar covered the compose box |
| Three duplicate "Android phone" devices | not a code bug: `flutter install` uninstalls first, wiping the stored device id, so each reinstall during testing re-paired as a "new" phone; revoked the two stale ones | root-caused, not patched around; future installs in a session use `adb install -r` to update in place |
