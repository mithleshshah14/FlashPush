# Admin UI (laptop web page)

The page you use on the laptop to approve phones, send text and files, and manage devices. Served by the loopback admin server at `http://127.0.0.1:8760`. Designs: [`docs/design/README.md`](design/README.md) (Stitch, project "FlashPush v2"); screenshots of what was built: [`design/implemented/`](design/implemented/). Plan: [`superpowers/plans/2026-09-22-plan-4-laptop-ui.md`](superpowers/plans/2026-09-22-plan-4-laptop-ui.md).

## Views

| View | Route | What it shows |
|---|---|---|
| **Dashboard** | `#/dashboard` | status pill (and the reason when the server reports `degraded`), the addresses your phone can reach with route chips and Copy, listening port; **Send to phone** (target selector when several phones are paired, text box, file drop zone with per-file progress); **Shared items** (From/To chip, link/text/file/image thumbnail, Copy, Download, Delete, Clear history with confirmation); collapsible **Can't connect from your phone?** with the firewall command and the exact ports and ranges it opens |
| **Approvals** | `#/approvals` | one card per pending request: phone name, IP, route chip, `Re-pair of <name>` badge, the big 6-digit code, a live expiry countdown, **Approve** / **Deny** |
| **Devices** | `#/devices` | paired phones: last seen, route, connected status (filled dot = connected, ring = not), **Revoke** with confirmation |

Navigation is hash based, so back/forward and bookmarks work. The sidebar badge and the page title show the number of pending requests, for example `(2) Approvals · FlashPush`.

## How it talks to the server

All requests go to the same origin (`connect-src 'self'`).

| Purpose | Request |
|---|---|
| Load everything | `GET /admin/state` (laptop, addresses, ports, optional `status`, pending, devices, items) |
| Live updates | `EventSource('/admin/events')`; a `changed` event triggers a refetch of the state; there is no replay, every (re)connect refetches |
| Approve / deny | `POST /admin/pair/:id/approve` and `/deny` |
| Revoke | `DELETE /admin/devices/:id` |
| Send text | `POST /admin/text` |
| Send a file | `POST /admin/file` through `XMLHttpRequest` (for upload progress) with `X-Filename` (URL-encoded) and `X-Device-Id` |
| Files | `GET /admin/files/:id` (download) and `?inline=1` for image thumbnails (never SVG) |
| Delete / clear | `DELETE /admin/items/:id`, `POST /admin/history/clear` |

Every non-GET request carries `X-FlashPush-Admin: 1` (see [protocol.md](protocol.md)); the server's Host, Origin and Sec-Fetch-Site guard is unchanged.

**Offline behaviour:** if the event stream or a refetch fails, a banner reads "Can't reach FlashPush on this laptop. Trying again..." and the browser reconnects by itself (or the page reopens the stream after a few seconds if the browser gave up). When the server is back the banner disappears and the state refreshes.

## Theme

Dark by default; light follows `prefers-color-scheme` when the browser asks for it, and the sun/moon button in the sidebar switches manually. The choice is remembered in `localStorage` (every access is wrapped in `try/catch`, the page works without storage). Colours, radii and type come from `.stitch/DESIGN.md`; the CSS custom properties are at the top of `assets/app.css`.

## Accessibility

- Landmarks (`nav`, `main`), a skip link, real buttons and links, a visible focus ring, `aria-current="page"` on the active item.
- New pairing requests are announced through an `aria-live="polite"` region ("Pixel 7 wants to connect. Code 482 916."); errors use `role="alert"`.
- Confirmations use the native `<dialog>` (focus is trapped, Escape cancels, focus returns to the opener).
- State is never colour only: connection uses a filled dot versus a ring plus words; route chips carry text.
- `prefers-reduced-motion` disables transitions. Text contrast meets AA in both themes (the light theme uses white text on `#0346F4` for primary buttons).
- Layout works from 360 px to 1440 px: below 900 px the sidebar becomes a top bar, below 700 px the device table turns into stacked cards.

## Security rules for contributors

The page is served with `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Therefore:

- no inline `<script>`, `<style>`, `style=""` or `on...=` attributes; style through classes, `hidden`, `<progress>`;
- **never** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`: build nodes with `h()` (`assets/dom.js`) and `textContent`;
- links only for `http:`/`https:` URLs (`safeUrl`) with `rel="noopener noreferrer"`;
- no CDN, external font or external request.

`server/test/ui-sources.test.js` enforces these rules on every `npm test`. Static files are served from an in-memory allowlist (`server/src/static.js`): only `index.html` at `/` and files under `server/public/assets/` with a known extension; nothing else is reachable, whatever the URL looks like.

## Files

| File | Job |
|---|---|
| `server/public/index.html` | static page frame |
| `assets/app.js` | wiring: routes, state, live updates, theme |
| `assets/model.js` | pure helpers (formatting, view models); unit-tested |
| `assets/api.js`, `live.js`, `theme.js` | network, event stream, theme persistence; unit-tested with stubs |
| `assets/dom.js`, `shell.js`, `widgets.js` | DOM helper and icons, page frame updates, shared widgets |
| `assets/views/dashboard.js`, `approvals.js`, `devices.js` | one view each: `createView(ctx) -> { el, update(state, now), tick?(now) }` |
| `assets/app.css` | tokens, layout, components, both themes |
| `assets/favicon.png` | made from `app_icon.png` by `scripts/make-favicon.ps1` (transparent rounded corners) |

## Try it and take screenshots

The real server needs a paired phone to show anything interesting, so there is a demo with sample data:

```
cd server
node test/tools/demo-server.js 8761          # binds 127.0.0.1 only; mounts only the admin API; Ctrl+C when done
node test/tools/screenshots.js 8761 ../docs/design/implemented
```

The demo opens **no** phone-facing listener and no UDP socket. The screenshot tool starts its own headless Chrome with a throw-away profile and stops it afterwards (set `CHROME_PATH` if Chrome is elsewhere). It emulates dark and light, 1440x900 and 390x844, reports console errors and horizontal overflow.

## Known differences from the Stitch designs

- Fonts: Inter, Manrope and JetBrains Mono are named first but **not bundled** (no external requests); the system fonts stand in.
- Devices footer reads "N paired" instead of "3 of 20 devices" (the page does not know the device limit).
- The Stitch light Devices screen renders a dark content area next to a light sidebar; the built light theme is light throughout.
- The sidebar logo is the app icon itself (`favicon.png`) instead of the line glyph in the mock-ups.
- The status pill sits in the sidebar on Approvals and Devices and in the page header on the Dashboard, as in the designs.
