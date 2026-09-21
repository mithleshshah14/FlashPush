# Security

What FlashPush protects, how, and what it does **not** protect. Design: spec §3. Protocol details: [pairing.md](pairing.md), [protocol.md](protocol.md), [transfers.md](transfers.md).

## Assets and trust boundaries

- **Assets:** what you send (text, links, files), the ability to send to your laptop, the laptop's Downloads folder.
- **Untrusted:** everything on the network (other people on the Wi-Fi, other tailnet members), every request until it authenticates, every file name and header a client sends.
- **Trusted:** the person at the laptop (approves pairings), the logged-in Windows account.

## What is built

| Threat | Protection |
|---|---|
| Someone on the Wi-Fi reads traffic | HTTPS everywhere (TLS ≥ 1.2, EC P-256 certificate) |
| Someone tries the API | everything except `hello` and pairing needs a session; failed authentication is rate limited (10/min per address) |
| Someone spams pairing | 5 requests/min per address, 3 open requests, 20 devices, 2-minute lifetime, a request must be revealed within 10 s, and a human must click Approve |
| A man-in-the-middle during first pairing | commit–reveal 6-digit comparison: 1 in 1,000,000 per attempt, and each attempt is visible on the laptop |
| A later man-in-the-middle or a swapped laptop | the phone pins the certificate fingerprint and refuses a different one |
| Someone learns a pairing `requestId` | the secret is only released with a proof derived from a nonce only the phone knows |
| Stolen device secret database | only SHA-256 hashes are stored |
| Lost or stolen phone | Revoke on the laptop ends its session at once and removes the device |
| Forgotten open session | 24 h idle / 7 day absolute expiry |
| A web page you visit attacks the admin page | loopback-only bind; `Host`, `Origin`, `Sec-Fetch-Site` checks; a custom header on every state-changing call; strict CSP; `X-Frame-Options: DENY` |
| DNS rebinding against the admin page | the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` |
| Hostile file names (`../`, `C:\`, UNC, `CON`) | reduced to a plain basename, resolved path checked, exclusive create, never overwrites |
| Half-written or oversize uploads | `.part` file + rename, `Content-Length` required and enforced, size, quota and free-disk limits |
| Script in an uploaded SVG | never served inline; downloads carry `nosniff` |
| One phone reading another's data | every item belongs to one device; lists, downloads and deletes check ownership |
| Duplicate sends on flaky Wi-Fi | `X-Operation-Id` idempotency |
| Information leaks in errors | unexpected errors become `INTERNAL`; details only in the laptop log; secrets, tokens and request IDs are never logged |
| Discovery abuse | replies are a small hint, 512-byte input limit, 20 probes per 10 s per source |
| A script that starts with Windows does more than it says | the launcher is generated from a fixed template from three validated paths (no quotes, `%`, control characters or relative paths), starts only `node.exe`, and tests fail if it gains registry, file, download or shell access |
| The tray script is fed hostile text | it is static, parses messages as JSON data, only ever compares the message type, sends only fixed ids, and compiles or downloads nothing; menu labels are stripped of control characters and capped |
| Tray or browser helpers run attacker-chosen commands | programs are started with argument arrays (no shell); the browser is only asked to open `http://127.0.0.1:<port>` and Explorer an absolute drive path |
| The firewall rule opens too much | two rules only (TCP 8765, UDP 8766) from `LocalSubnet` and `100.64.0.0/10`; a test reads the script and fails if either widens |

## Windows integration (tray, start with Windows, firewall)

Nothing here needs administrator rights except the one-time firewall script, which you run yourself.

| Piece | What it can do | What it cannot do |
|---|---|---|
| `server/tray/tray.ps1` | show a tray icon and balloons, send menu clicks | run code it receives, compile code, download, write files, change settings |
| `FlashPush.vbs` launcher | start `node.exe src\cli.js` hidden | touch the registry, files, other programs, or anything not in its three validated paths |
| `scripts/allow-firewall.ps1` | add two inbound rules (TCP 8765, UDP 8766) from `LocalSubnet` and `100.64.0.0/10` | open other ports or addresses (a test enforces this) |
| `scripts/remove-firewall.ps1` | remove the `FlashPush` rule group | anything else |

`node.exe` starts PowerShell with `-ExecutionPolicy Bypass` for that single process because the scripts are unsigned; it changes no policy. Heuristic virus scanners can react to a hidden PowerShell script or a Startup entry: see the antivirus notes in [setup.md](setup.md), and read the scripts (they are plain text). Automated tests never execute these scripts; `server/test/scripts.test.js` scans every `.ps1` and fails on runtime compilation, encoded commands, downloads, registry or scheduled-task changes, `netsh`, or starting other programs.

## The admin guard is not authentication

The admin API defends against **browsers** (cross-site requests, rebinding, framing). Any program running as your Windows user can still call `127.0.0.1:8760`. Malware with that access is out of scope, as is anyone who can read `%APPDATA%\FlashPush` (the state files are user-readable). If the admin UI ever gains more sensitive actions, add a local capability token.

## Not protected

- Traffic metadata (who talks to whom, when, sizes).
- Approving a pairing whose code does not match. The code exists so you can catch that: **only approve when both screens show the same 6 digits**.
- Anyone with access to your Windows account or an unlocked laptop.
- A compromised phone (it holds the device secret).

## Review checklist for every new route

1. Authentication: which scheme? Is a missing/invalid credential the right error code?
2. Ownership: does it check the item/device belongs to the caller?
3. Input: body size limit, type checks, no path or command built from client data.
4. Abuse: rate limit or natural bound (per address, per device, per request)?
5. Errors: only documented codes through `sendError`; nothing internal in messages.
6. Logging: no secrets, tokens, request IDs or file contents.
7. Docs: `protocol.md` and this table updated.

## Reporting

This is a personal project; open an issue on the repository, or contact the maintainer directly for anything security related.

## Admin UI: CSP and static files (Plan 4)

| Rule | How it is enforced |
|---|---|
| Page CSP without `unsafe-inline` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, plus `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`; asserted in `static.test.js` |
| Only allowlisted files are served | `loadPublicFiles` reads the files once; requests are Map lookups. Tests try `../`, `%2e%2e`, `%2f`, `%5c`, `%00`, directories, other extensions, `/index.html`, files next to the page |
| Assets are read-only and guarded | non-GET is not routed; the Host / Origin / Sec-Fetch-Site guard applies to assets too |
| No HTML from data, no inline code | `ui-sources.test.js` fails the build on `innerHTML`, `eval`, inline scripts/styles/handlers and external URLs |
| Links from shared text | only exact `http(s)` URLs, `rel="noopener noreferrer"`; `javascript:` and `data:` never become links |
| Images | thumbnails come from `?inline=1`, which the server never allows for SVG |

Review checklist addition for UI changes: does the change need an inline script or style, an external request, or HTML built from data? If yes, redesign it.

## Tray notifications

Balloons name the phone and the kind of item ("Pixel 7 sent a file") but never the message text or a file name: Windows can show them on a locked or shared screen and keeps them in the notification history. Text passed to the tray is cleaned and length-limited, and a click only maps to one of three fixed pages (approvals, messages, dashboard); nothing received from a phone is ever used to build a URL or a command.
