# Laptop Web UI (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary admin page with the Stitch-designed laptop UI: Dashboard, Approvals and Devices, dark and light, served by the existing loopback admin server.

**Architecture:** Plain HTML, CSS and ES modules (no framework, no build step, no dependencies) under `server/public/`. All logic that can be pure lives in `assets/model.js` and is unit-tested with `node:test`; DOM modules (`dom.js`, `shell.js`, `views/*.js`) only build elements with `createElement`/`textContent`. The server serves the files from an **in-memory allowlist** created at start-up (`static.js`), so a URL is only ever looked up in a `Map` and never becomes a file path.

**Tech Stack:** Node.js ≥ 22 (server, tests), browser ES modules, CSS custom properties, `EventSource`, `XMLHttpRequest` (upload progress), `<dialog>` (confirmations).

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §10; designs: `docs/design/README.md` and `.stitch/DESIGN.md` on branch `feature/stitch-designs` (`docs/design/screens/laptop-*.png`); API: `docs/protocol.md` (admin API).

## Global Constraints

- Strict CSP on the page: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (no `unsafe-inline` anywhere). Therefore: no inline `<script>`, no inline `<style>`, no `style="..."` attributes in markup, no inline event handlers. Styling from JS only through classes, `hidden`, `<progress>` and CSSOM.
- Never `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` with any data (a test greps the client sources). Text goes in with `textContent`; links only for `http:`/`https:` URLs with `rel="noopener noreferrer"`.
- No external network requests, fonts or CDNs. Font stacks fall back to system fonts (Inter/Manrope/JetBrains Mono are named first but not bundled).
- Static files: only files found under `server/public/assets/` plus `index.html` at `/`, read at start-up; served with correct `Content-Type` and `X-Content-Type-Options: nosniff`; anything else is `NOT_FOUND`. `%2e%2e`, `..`, backslashes and trailing-slash tricks never reach the file system.
- Every state-changing request sends `X-FlashPush-Admin: 1`; the admin guard (Host, Origin, Sec-Fetch-Site) is unchanged.
- Themes: follow `prefers-color-scheme`; a manual toggle is remembered in `localStorage` (every access inside `try/catch`, the page works without it).
- Accessibility: landmarks, real buttons/links, visible focus, `aria-live="polite"` announcement for new pairing requests, `aria-current="page"` on the active nav item, contrast AA for text, dialogs via `<dialog>`, `prefers-reduced-motion` respected.
- Layout works from 360 px to 1440 px (sidebar becomes a top bar under 900 px).
- Palette and typography tokens from `.stitch/DESIGN.md` §2–4 (navy `#030C1E`/`#112B58`, blue `#0346F4`/`#1CA2FD`, cyan `#45E2FD`, mint `#16F9CB`; light `#F4F8FF`/`#FFFFFF`; 12 px radius, pill chips).
- Optional server field: `status` (`{state, reason}`) in `GET /admin/state` is added by another plan; the UI shows "Running" when it is absent.
- Branch `feature/laptop-ui`. Commit trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Don't type ` `/` ` escapes in regex literals.

## File structure

| File | Responsibility |
|---|---|
| `server/src/static.js` | `loadPublicFiles(dir) → Map<urlPath, File>`, `serveFile(res, file)` (headers, CSP for HTML) |
| `server/src/adminApi.js` (small edit) | takes `files` instead of `pageHtml`; serves any `GET` whose path is in the map |
| `server/public/package.json` | `{"type":"module"}` so Node can import the client modules in tests |
| `server/public/index.html` | shell markup, links `assets/app.css` and `assets/app.js` |
| `server/public/assets/model.js` | pure functions (formatting, view models, route parsing, error text) |
| `server/public/assets/api.js` | `getState`, `send`, `uploadFile` (adds the admin header) |
| `server/public/assets/dom.js`, `icons.js` | element builder, SVG icons, confirm dialog, clipboard |
| `server/public/assets/theme.js` | light/dark/system with safe persistence |
| `server/public/assets/live.js` | EventSource + polling fallback, online/offline callbacks |
| `server/public/assets/shell.js` | sidebar/top bar, header status, offline banner, live region, title |
| `server/public/assets/views/dashboard.js`, `approvals.js`, `devices.js` | one view each: `createView(ctx) → { el, update(state, now) }` |
| `server/public/assets/app.js` | wiring: router, state, live updates, views |
| `server/public/assets/app.css` | tokens, layout, components, both themes |
| `server/public/assets/favicon.png`, `logo.png` | small images made from `app_icon.png` (`scripts/make-favicon.ps1`) |
| `server/test/static.test.js`, `server/test/ui-model.test.js`, `server/test/ui-api.test.js`, `server/test/ui-sources.test.js` | tests |
| `server/test/tools/demo-server.js` | starts the real server with demo data (used for screenshots) |

---

### Task 1: Allowlisted static files and the strict CSP

**Files:** Create `server/src/static.js`, `server/test/static.test.js`; modify `server/src/adminApi.js`, `server/src/index.js`, `server/test/helpers/admin.js`, `server/test/adminApi.test.js`, `server/test/e2e.test.js`; create `server/public/index.html` (placeholder title page replaced in Task 5), `server/public/assets/app.js` (empty module), `server/public/package.json`.

**Interfaces:** Produces `loadPublicFiles(publicDir) → Map<string, { type, body: Buffer, html: boolean }>` (keys `'/'` and `'/assets/<relative path with />'`; only `.html .js .css .png .ico .webp` are served, everything else is ignored); `serveFile(res, file)` writes `200` with `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-cache`, and for HTML also the CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. `createAdminApi({ ..., files })` (replaces `pageHtml`).

Tests (`static.test.js`, using a temp dir with `index.html`, `assets/app.js`, `assets/views/x.js`, `assets/app.css`, `assets/logo.png`, `assets/notes.txt`, `secret.txt` next to `index.html`):
- the map has `/`, `/assets/app.js`, `/assets/views/x.js`, `/assets/app.css`, `/assets/logo.png`; not `notes.txt`, `secret.txt`, `/index.html`
- content types: html `text/html; charset=utf-8`, js `text/javascript; charset=utf-8`, css `text/css; charset=utf-8`, png `image/png`
- admin API over HTTP: `GET /` gives HTML with the strict CSP (exact string) and `X-Frame-Options: DENY`; `GET /assets/app.js` gives js with `nosniff`; `GET /assets/../../src/index.js`, `/assets/%2e%2e/%2e%2e/src/index.js`, `/assets/..%2f..%2fsrc%2findex.js`, `/assets/views/`, `/assets/notes.txt`, `/index.html`, `/secret.txt` all give `404 NOT_FOUND`; POST to `/assets/app.js` is rejected; the guard still applies (foreign Host → 403).

Steps: write the tests (red: `Cannot find module '../src/static'`), implement `static.js` (recursive `readdirSync` of `assets/` at start-up, map by relative path with `/`), change `adminApi.js` (remove `PAGE_HEADERS`, `page`, the `GET /` route; in `handler`, after the guard: `const file = req.method === 'GET' ? files.get(url.pathname) : undefined; if (file) return serveFile(res, file);`), `index.js` (`files: loadPublicFiles(path.join(__dirname, '..', 'public'))`), `helpers/admin.js` (build a small temp public dir and pass `files`), update the two existing assertions (CSP now has no `unsafe-inline`; e2e title regex matches the new `index.html`), run the full suite (green), commit `feat(server): serve the admin UI from an allowlisted in-memory file map with a strict CSP`.

---

### Task 2: Pure UI model (`model.js`)

**Files:** Create `server/public/assets/model.js`, `server/test/ui-model.test.js`.

**Interfaces (all pure, exported):**
`formatSize(bytes)` → `'0 B' | '512 B' | '1.5 KB' | '2.4 MB' | '1.25 GB'`; `formatRelative(ts, now)` → `'Never' | 'Just now' | 'N min ago' | 'Today, HH:MM' | 'Yesterday, HH:MM' | 'D Mon YYYY'`; `routeInfo(kind)` → `{ key: 'wifi'|'tailscale'|'other', label }` (`lan`→Wi-Fi, `tailscale`/`tailscale-name`→Tailscale, else Other); `countdown(expiresAt, now)` → `'M:SS'` (never negative); `documentTitle(view, pendingCount)` → `'Dashboard · FlashPush'` or `'(2) Approvals · FlashPush'`; `parseRoute(hash)` → `'dashboard'|'approvals'|'devices'` (default dashboard, ignores query and case); `statusInfo(status)` → `{ label, tone: 'ok'|'warn'|'off', reason }` (absent → Running/ok); `safeUrl(text)` → the trimmed text when it is exactly one `http(s)` URL (no spaces) else `null`; `itemIcon(item)` → `'link'|'text'|'image'|'file'`; `itemChip(item, devices)` → `{ direction: 'from'|'to', label }` (`From phone`/`To phone`, with the phone name when more than one is paired); `sendTarget(devices)` → `{ needsChoice, defaultId, disabled }`; `newPendingIds(previousIds, pending)` → ids not seen before; `errorMessage(json, fallback)`; `firewallCommand` (string) and `firewallNote(ports)`.

Tests: one `test()` per function with the cases above, including boundaries (1023 B, 1024 B, 1 MiB−1; 59 s vs 60 s; local midnight for today/yesterday using `new Date(2026, 8, 22, 15, 30)`; `javascript:`/`data:`/`http://a b` never pass `safeUrl`; unknown route hash falls back; `countdown` after expiry is `'0:00'`; `statusInfo({state:'degraded',reason:'Port 8765 is used by another program'})` is `warn` with the reason). Load the module with `await import(pathToFileURL(...))`.

Steps: tests (red), implement, green, commit `feat(ui): pure view-model helpers`.

---

### Task 3: API client, theme, live updates

**Files:** Create `server/public/assets/api.js`, `theme.js`, `live.js`, `server/test/ui-api.test.js`.

**Interfaces:** `getState() → Promise<state>`; `send(method, path, body?) → Promise<json>` (JSON body, header `X-FlashPush-Admin: 1`, rejects with `Error(errorMessage(json))` on non-2xx); `uploadFile({ file, deviceId, onProgress }) → Promise<item>` (XMLHttpRequest `POST /admin/file`, headers `X-Filename` URL-encoded, `X-Device-Id` when given, `X-FlashPush-Admin: 1`); `theme.js`: `readTheme(storage) → 'light'|'dark'|'system'`, `saveTheme(storage, value)` (never throws), `resolveTheme(pref, prefersDark)`, `applyTheme(root, pref)`; `live.js`: `startLive({ onChange, onOnline, onOffline, retryMs })` → `{ stop() }` (EventSource `/admin/events`; `changed` → `onChange`; `error` → `onOffline` and retry; `open` → `onOnline` and `onChange`).

Tests with stubs (`globalThis.fetch`, a fake `XMLHttpRequest`, a fake storage that throws, a fake `EventSource`): every write carries the admin header and JSON content type; a GET does not need it; error envelopes become their `message`; non-JSON errors fall back; upload sets the filename header URL-encoded (`a b é.txt`), reports progress fractions and rejects with the envelope message; storage that throws is tolerated; `resolveTheme('system', true)` is dark; live: `open` calls `onOnline` then `onChange`, `error` calls `onOffline` once until the next `open`, `stop()` closes the source.

Steps: tests (red), implement, green, commit `feat(ui): api client, theme and live-update modules`.

---

### Task 4: DOM foundation, shell, tokens and layout

**Files:** Create `server/public/assets/dom.js`, `icons.js`, `shell.js`, `app.css`, `app.js`, `server/public/assets/logo.png`, `favicon.png`, `scripts/make-favicon.ps1`, `server/test/ui-sources.test.js`; replace `server/public/index.html`.

**Contents:** `dom.js`: `h(tag, props, ...children)` (props: `class`, `text`, `attrs`, `on`, `dataset`; children strings become text nodes; never HTML), `icon(name, size)` (SVG through `createElementNS`, decorative `aria-hidden`), `confirmDialog({ title, message, confirmLabel, danger })` (a `<dialog>`, resolves boolean, focus returns to the opener, Escape cancels), `copyText(text)` (Clipboard API with a `try/catch` fallback to a hidden `<textarea>` + `execCommand`). `shell.js`: sidebar with logo, three nav links (`Dashboard`, `Approvals` with count badge, `Devices`), laptop name and status pill, theme toggle button, offline banner (`role="status"`), `aria-live="polite"` region, `setActive(view)`, `setPending(count)`, `announce(text)`. `app.css`: tokens for both themes (`:root[data-theme]` plus `prefers-color-scheme` for `system`), grid layout, sidebar → top bar under 900 px, cards, chips, buttons, focus ring, `progress`, dialog, `prefers-reduced-motion`. `app.js`: minimal boot that renders the shell with an empty content area.

`ui-sources.test.js` (static checks over `server/public/**`): no `innerHTML|outerHTML|insertAdjacentHTML|document.write|eval\(|new Function` in `assets/**/*.js`; `index.html` has no inline `<script>` body, no `<style>`, no `style=` attribute and no `on\w+=` attribute; no `http://` or `https://` URL other than inside `href` targets built at run time (grep `src=`/`href=` in `index.html` are all relative); every file referenced from `index.html` exists in the allowlist.

Steps: source-check test first (red on the placeholder page), build the pieces, green, commit `feat(ui): shell, tokens, theme and DOM helpers`.

---

### Task 5: Dashboard view

**Files:** Create `server/public/assets/views/dashboard.js`; modify `app.js`, `app.css`.

**Behaviour:** cards **Addresses** (each address as route chip + monospace IP or name + Copy button; "Listening on port N"), **Send to phone** (target `<select>` shown only when `sendTarget(devices).needsChoice`; textarea; **Send text** disabled when empty or no phone paired, with a hint "Pair a phone first"; drop zone as a real `<button>` plus drag and drop, hidden `<input type="file" multiple>`; one `<progress>` row per upload with the file name, removed on success, error text kept with a dismiss button), **Shared items** (newest first; chip From/To; icon; text with URL as safe link; file name and size; images shown as a small `?inline=1` preview; buttons Copy (text), Download (files), Delete; **Clear history** through `confirmDialog`; empty state), **Can't connect from your phone?** (`<details>`: firewall command in a code block with Copy, `firewallNote(ports)`, the addresses to type on the phone). The header pill uses `statusInfo(state.status)`; a degraded reason is shown under the page title. `update(state, now)` patches lists without touching the textarea, the open `<details>`, or running uploads.

Steps: implement against the demo server, run `npm test` (green), commit `feat(ui): dashboard view`.

---

### Task 6: Approvals view

**Files:** Create `server/public/assets/views/approvals.js`; modify `app.js`, `shell.js`, `app.css`.

**Behaviour:** one card per pending request: phone name, route chip, IP (monospace), `Re-pair of <name>` badge when `isRepair`, large code in two groups (`sasDisplay`), "Expires in M:SS" updated every second (`tick(now)`), **Approve** (primary) and **Deny** (danger outline), explanatory copy from the design ("Approve it only if the code matches the one on the phone"), empty state. New requests are announced through the live region ("Pixel 7 wants to connect. Code 482 916.") using `newPendingIds`, the nav badge and `document.title` show the count, buttons disable while a request is in flight and errors (`PAIR_EXPIRED`) show inline.

Steps: implement, `npm test`, commit `feat(ui): approvals view`.

---

### Task 7: Devices view

**Files:** Create `server/public/assets/views/devices.js`; modify `app.js`, `app.css`.

**Behaviour:** table (cards under 700 px): phone icon and name, route chip from `lastRoute` (none → "–"), Last seen (`formatRelative`), status dot + "Connected"/"Not connected" (dot shape differs: filled vs ring), **Revoke** through `confirmDialog` ("Revoke Pixel 7? It has to be approved again to reconnect."), footer "N of 20 devices" and the revoke hint, empty state ("No phones paired yet").

Steps: implement, `npm test`, commit `feat(ui): devices view`.

---

### Task 8: Screenshots, comparison with the designs, fixes

**Files:** Create `server/test/tools/demo-server.js`, `docs/design/implemented/*.png`.

`demo-server.js` starts `createApp` on the default admin port in a temp home and seeds: two paired phones (one connected), two pending requests (one a re-pair), and a mixed history (link, pdf, image, text). Screenshots via headless Chrome (`--headless=new --screenshot --window-size`) of the three views, dark and light, at 1440×900 and 390×844. Compare with `laptop-*.png`, fix deviations, list the remaining ones in `docs/admin-ui.md`. Commit `docs(design): implemented screenshots` and any CSS fixes.

---

### Task 9: Documentation

**Files:** Create `docs/admin-ui.md`; modify `docs/README.md`, `docs/architecture.md` (admin UI section), `docs/security.md` (CSP and static rules, checklist item for new UI code), `docs/decisions.md`, `CHANGELOG.md`, `server/README.md`, `docs/protocol.md` (note that `GET /` and `/assets/*` are served from the allowlist).

`docs/admin-ui.md`: purpose, views and states, how it talks to the admin API (endpoints used, headers, live updates and offline behaviour), theme handling, keyboard and accessibility notes, CSP and coding rules for contributors (no inline anything, no `innerHTML`), file map, how to run it (`npm start`, `node test/tools/demo-server.js`), how the screenshots are made, known deviations from the designs.

Steps: write, run the full suite, commit `docs: admin UI guide, CSP and static-file rules, decisions and changelog`.

---

## Self-review

**Spec coverage (§10, task brief):** Dashboard (addresses, send text/files with progress and target choice, items feed with copy/download/delete and inline images, clear history, firewall help panel, status incl. degraded reason) → Tasks 5; Approvals (code, phone, IP, route, re-pair label, approve/deny, aria-live, title count) → 6; Devices (last seen, route, connected dot, revoke with confirm) → 7; hash navigation, live updates, offline banner, admin header on writes, themes with manual toggle, 360–1440 layout → 3–4; static allowlist, strict CSP, traversal tests → 1; screenshots dark/light desktop/mobile → 8; docs → 9.

**Placeholder scan:** none; behaviours and test cases are listed exhaustively, code lives in the referenced files and is written test-first per task.

**Type consistency:** view modules share `createView(ctx) → { el, update(state, now) }`; `model.js` names above are the only ones views import; `send`/`uploadFile`/`getState` are the only network entry points.
