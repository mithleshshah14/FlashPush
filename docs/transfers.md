# File and text transfers

How FlashPush stores, limits and protects transferred data. Implementation: `server/src/transfers.js` (uploads), `server/src/store.js` (history), `server/src/mime.js`. Design: spec §7.

## Limits

Constants in `server/src/config.js` (`DEFAULT_LIMITS`); tests override them.

| Limit | Value |
|---|---|
| Single file | 2 GiB |
| Text item | 1 MB |
| History entries | 500 (oldest pruned first) |
| Outbox (laptop → phone files) | 5 GiB |
| Free disk that must remain after a write | 512 MB |
| File name length | 200 characters (extension kept) |

## Upload lifecycle

1. `Content-Length` is **required** (`BAD_REQUEST` otherwise).
2. Rejected before anything is written: over the file limit (`PAYLOAD_TOO_LARGE`), outbox quota exceeded (`STORAGE_QUOTA`, laptop → phone only), not enough free disk (`INSUFFICIENT_STORAGE`).
3. The body streams into `<name>.<random>.part` in the target folder (created exclusively, `wx`).
4. When the byte count equals `Content-Length`, the final name is chosen (duplicates become `name (1).ext`, `name (2).ext`) and the `.part` file is renamed. Name choice and rename happen back to back in one synchronous step, so two uploads of the same name cannot collide.
5. Only then does a history entry appear.

**Failure:** a dropped connection, fewer bytes, or more bytes than `Content-Length` deletes the `.part` file and produces no entry (`BAD_REQUEST`, safe to retry). Stale `.part` files from a crash are removed at start-up (`sweepPartFiles`).

**Target folders:** phone → laptop files go to the user's `Downloads\FlashPush` (setting `receiveDir`); laptop → phone files go to `%APPDATA%\FlashPush\outbox`.

## File name safety

A client-supplied name is never a path. `sanitizeFilename` keeps only the last segment after treating `/` and `\` as separators, so `../x`, `..\x`, `C:\Windows\x`, `\\host\share\x` and `/etc/x` all become `x`. Then:

- `< > : " | ? *` and control characters become `_`
- leading dots are removed, trailing dots and spaces are removed (`report.` → `report`)
- reserved Windows device names get a `_` prefix (`CON` → `_CON`, `nul.txt` → `_nul.txt`)
- an empty result becomes `file`
- the length is capped at 200, keeping the extension

After the final path is built it must resolve **inside** the target folder. Files are created exclusively, so an existing symlink or junction at the name is never followed.

## History and retention

- One shared history per laptop, but **every entry belongs to one phone** (`deviceId`). A phone only ever sees its own entries; the laptop UI's send box targets one phone.
- Public item shape (what the API returns): `{ id, kind: 'text'|'file', from: 'phone'|'laptop', time, text?, name?, size?, mime? }`. The disk path and `deviceId` are never exposed to phones.
- `mime` comes from the extension (`mime.js`); the phone uses it to separate **Images** from **Files** and **Messages**.
- History is capped at 500 entries; adding one more prunes the oldest. **Received files (in Downloads) are never deleted** by pruning or by deleting an entry: only the history entry goes. **Outbox files are deleted** with their entry.
- Missing files: an entry whose file vanished from disk is dropped when the server starts.
- State is kept in `%APPDATA%\FlashPush\items.json` (atomic writes).

## Deferred

Per-file checksums, transfer IDs and resumable uploads (see `decisions.md`). TLS protects the bytes in transit and the `Content-Length` check plus the `.part` rename catch truncation.
