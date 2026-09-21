# Device API protocol (phone ↔ laptop)

HTTPS on port **8765**, all routes under `/v1`. Implementation: `server/src/deviceApi.js`, `server/src/http.js`. Crypto for pairing: [pairing.md](pairing.md). File rules: [transfers.md](transfers.md). The loopback admin API and UDP discovery are at the end of this page.

## Conventions

- Bodies are JSON (`Content-Type: application/json`) except file uploads (raw bytes). Binary values inside JSON are **base64url, no padding, canonical**.
- **Errors** always look like this, with the HTTP status from the table below. Clients branch on `code`, never on `message`:

```json
{ "error": { "code": "SESSION_EXPIRED", "message": "Your session has ended. Connect again." } }
```

  `Retry-After` (whole seconds) is set on `429` responses.

| Code | HTTP | Meaning / what the phone should do |
|---|---|---|
| `BAD_REQUEST` | 400 | malformed input; fix the request |
| `COMMIT_MISMATCH` | 400 | pairing reveal did not match the commit; start over |
| `UNAUTHORIZED` | 401 | missing or wrong credentials (a wrong device secret lands here) |
| `SESSION_EXPIRED` | 401 | session unknown, replaced, ended or expired; reconnect with the device secret |
| `DEVICE_NOT_PAIRED` | 401 | the laptop does not know this device (never paired, forgotten or revoked); stop retrying, offer Re-pair / Forget |
| `PAIR_DENIED` | 403 | the user pressed Deny |
| `FORBIDDEN` | 403 | admin API only (bad Host/Origin/header) |
| `PAIR_NOT_FOUND` | 404 | unknown pairing request, wrong device, wrong or missing proof |
| `ITEM_NOT_FOUND` | 404 | no such item or file (also for another phone's items) |
| `NOT_FOUND` | 404 | unknown route or method |
| `PAIR_EXPIRED` | 410 | the pairing request timed out |
| `PAYLOAD_TOO_LARGE` | 413 | over the size limit |
| `RATE_LIMITED` | 429 | too many failed auths, pairing requests, or a transfer still in progress; wait `Retry-After` |
| `PAIR_LIMIT` | 429 | too many pending pairings or paired devices |
| `INTERNAL` | 500 | laptop-side bug (details are only in the laptop log) |
| `INSUFFICIENT_STORAGE` | 507 | not enough free disk on the laptop |
| `STORAGE_QUOTA` | 507 | outbox quota reached |

## Authentication

| Scheme | Header | Used by |
|---|---|---|
| none | | `GET /hello`, `POST /pair/request`, `POST /pair/reveal` |
| pairing proof | `X-Pair-Proof: <hex>` and `?deviceId=` | `GET /pair/status/:id` |
| device secret | `Authorization: Device <deviceId>:<secret>` | `POST /session` |
| session | `Authorization: Bearer <sessionToken>` | everything else |

Failed authentication (bad/missing bearer token, wrong device secret, unknown device) is counted per source address: after **10 failures in a minute** further authenticated requests get `429 RATE_LIMITED` until the window slides. Pairing requests are limited separately (5 per minute per address).

## Routes

### `GET /v1/hello`
No auth. `200 {"app":"flashpush","v":1,"laptopId":"<uuid>","name":"MITHLESH-PC"}`. Used to recognise a laptop at an address.

### `POST /v1/pair/request`
No auth, body ≤ 1 MB. Request `{"deviceId":"<uuid>","deviceName":"Pixel 7","commit":"<b64u 32 bytes>"}` → `200 {"requestId","nl"}`.
Errors: `BAD_REQUEST`, `RATE_LIMITED`, `PAIR_LIMIT`. A new request from the same `deviceId` replaces its previous one. Unrevealed requests expire after 10 s.

### `POST /v1/pair/reveal`
No auth. Request `{"requestId","np"}` → `200 {}`. Errors: `BAD_REQUEST` (already revealed / malformed), `COMMIT_MISMATCH` (request dropped), `PAIR_NOT_FOUND`, `PAIR_EXPIRED`. From this point the request is visible on the laptop with its 6-digit code.

### `GET /v1/pair/status/:requestId?deviceId=<uuid>`
Header `X-Pair-Proof: <hex>`. Poll every 1–2 s (no long-poll).
`200 {"state":"pending"}` while waiting; `200 {"state":"approved","secret","laptop":{"id","name"},"addresses":[{"ip","kind"}]}` once approved (the secret can be fetched again with the proof for 60 s, then it is gone).
Errors: `PAIR_NOT_FOUND` (every proof failure looks the same), `PAIR_DENIED` (once, then not found), `PAIR_EXPIRED`.

### `POST /v1/session`  ·  connect
Device-secret auth. `200 {"sessionToken","expiresAt","laptop":{"id","name"},"addresses":[…]}`. Replaces this device's previous session (its event stream is closed with `expired`). Errors: `UNAUTHORIZED` (wrong secret or malformed header), `DEVICE_NOT_PAIRED`, `RATE_LIMITED`.
Sessions expire after **24 h idle** or **7 days** total; expiry shows up as `SESSION_EXPIRED`, and the phone silently reconnects with its secret.

### `DELETE /v1/session`  ·  disconnect
Session auth. `200 {}`. The pairing stays; the same secret reconnects. Repeating it later gives `SESSION_EXPIRED`.

### `DELETE /v1/devices/self`  ·  forget
Session auth. `200 {}`. The laptop removes this device and ends its session (best effort from the phone; the laptop can also revoke).

### `GET /v1/items`
Session auth. `200 {"items":[Item…]}`, oldest first, only this phone's items.
`Item = {"id","kind":"text"|"file","from":"phone"|"laptop","time":<ms>,"text"?,"name"?,"size"?,"mime"?}`. `deviceId` and disk paths are never included.

### `POST /v1/text`
Session auth. Request `{"text":"…"}` (≤ 1 MB, not blank). `201 <Item>`. Errors: `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`.
**Idempotent** with `X-Operation-Id` (below).

### `POST /v1/file`
Session auth. Raw body with headers `Content-Length` (**required**) and `X-Filename: <URL-encoded name>`. `201 <Item>` (the `name` is the sanitized, possibly renamed, final name).
Errors: `BAD_REQUEST` (no length, interrupted, size mismatch), `PAYLOAD_TOO_LARGE` (> 2 GiB), `INSUFFICIENT_STORAGE`. Nothing is stored unless the whole file arrived. **Idempotent** with `X-Operation-Id`.

### `GET /v1/files/:id`
Session auth. Streams the file. Headers: `Content-Type` from the item's mime, `Content-Length`, `Content-Disposition: attachment; filename*=UTF-8''<name>`, `X-Content-Type-Options: nosniff`.
`?inline=1` switches to `inline` **only** for images other than SVG. Errors: `ITEM_NOT_FOUND` (also for another phone's file). No range requests.

### `DELETE /v1/items/:id`
Session auth. `200 {}` even if the item is already gone or belongs to another phone (nothing is removed in that case).

### `GET /v1/events`  ·  live updates (SSE)
Session auth, `Content-Type: text/event-stream`. Events (each `event:` name plus one JSON `data:` line):

| Event | Data | When |
|---|---|---|
| `item-added` | `Item` | a new item for this phone (either direction) |
| `item-deleted` | `{"id"}` | an item was deleted |
| `expired` | `{"reason":"replaced"|"revoked"|"expired"}` | the session ended for another reason than disconnect; the stream then closes |

A `: ping` comment every 25 s; treat 60 s of silence as a dead link. **No replay**: after every (re)connect fetch `GET /v1/items` first, then apply events. At most 2 streams per device; opening a third closes the oldest.

## Idempotency: `X-Operation-Id`

Send a fresh UUID-like value (8–64 characters of letters, digits, `-`, `_`) with each `POST /v1/text` and `POST /v1/file` and reuse it when retrying after a lost response.

| Situation | Response |
|---|---|
| first time | `201` and the item |
| repeat after the first finished | `200` and the **original** item (nothing is stored twice) |
| repeat while the first is still uploading | `429 RATE_LIMITED` with `Retry-After: 1`; retry and you get the `200` |
| malformed id | `400 BAD_REQUEST` |

The laptop remembers the last 200 operations (or 10 minutes) per device. `DELETE` routes and `POST /session` are naturally safe to repeat.

## Limits at a glance

JSON bodies 1 MB · text 1 MB · files 2 GiB · 10 failed auths/min/address · 5 pair requests/min/address · 3 open pairing requests · 20 paired devices · 2 event streams/device.

---

# Admin API (this laptop only)

HTTP on `127.0.0.1:8760`, used by the admin page and the tray. Implementation: `server/src/adminApi.js`. **This is a browser cross-site defence, not authentication** (see [security.md](security.md)). Every request must:

- come from a loopback address and have `Host: 127.0.0.1:<port>` or `localhost:<port>`
- have no `Origin`, or `Origin: http://<host>`; no `Sec-Fetch-Site`, or `same-origin` / `none`
- for anything other than GET/HEAD, carry `X-FlashPush-Admin: 1`

Otherwise `403 FORBIDDEN`. Errors use the same envelope as the device API.

| Route | Body / headers | Success | Errors |
|---|---|---|---|
| `GET /` | | the admin page (strict CSP, `X-Frame-Options: DENY`) | |
| `GET /admin/ping` | | `{"app":"flashpush-admin","v":1}` (used to detect a running instance) | |
| `GET /admin/state` | | `{laptop, addresses, ports, receiveDir, pending[], devices[] (+connected), items[] (+deviceId)}` | |
| `GET /admin/events` | | SSE, event `changed` whenever `state` may have changed | |
| `POST /admin/pair/:id/approve` | | `{}` | `PAIR_NOT_FOUND`, `PAIR_EXPIRED`, `PAIR_LIMIT` |
| `POST /admin/pair/:id/deny` | | `{}` | `PAIR_NOT_FOUND`, `PAIR_EXPIRED` |
| `DELETE /admin/devices/:id` | | `{}`; the phone's session ends at once | `BAD_REQUEST` (not a UUID), `NOT_FOUND` |
| `POST /admin/text` | `{"text","deviceId"?}` | `201 <Item + deviceId>` | `BAD_REQUEST`, `PAYLOAD_TOO_LARGE` |
| `POST /admin/file` | raw body; `Content-Length`, `X-Filename` (URL-encoded), `X-Device-Id`? | `201 <Item + deviceId>` (stored in the outbox) | `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`, `STORAGE_QUOTA`, `INSUFFICIENT_STORAGE` |
| `GET /admin/files/:id` | `?inline=1` (non-SVG images only) | the file | `ITEM_NOT_FOUND` |
| `DELETE /admin/items/:id` | | `{}` (outbox files are deleted with the entry; received files stay) | |
| `POST /admin/history/clear` | `{"deviceId"?}` | `{"removed":<n>}` | `BAD_REQUEST` |

`deviceId` selects the target phone: optional when exactly one phone is paired, required when several are, and an error when none are.

# UDP discovery

UDP `8766`. A phone broadcasts `{"t":"FLASHPUSH_DISCOVER","v":1}` (under 512 bytes); each laptop answers that sender directly with

```json
{ "t": "FLASHPUSH_HERE", "v": 1, "laptopId": "<uuid>", "name": "MITHLESH-PC", "port": 8765 }
```

At most 20 probes per 10 seconds are answered per source address. The reply is a **hint only**: the phone must still verify the laptop through TLS pinning (and, on first contact, the pairing code).

## Static files (admin server)

Besides the API, the admin server answers `GET /` with the admin UI and `GET /assets/...` with its files. Only files found under `server/public/` when the server started are served (`index.html` at `/`, everything else under `assets/` with the extensions `.js .css .png .ico .webp .html`); any other path is `404 NOT_FOUND`. The page carries a strict CSP, see [security.md](security.md).
