# FlashPush v2 — Design Review & Recommended Changes

**Review date:** 2026-09-21  
**Reviewed spec:** `2026-09-21-pairing-autostart-tailscale-design.md`  
**Status:** Recommended changes before implementation

## 1. Overall assessment

The design is strong and substantially cleaner than the v1 shared-token + QR approach. The separation between:

- LAN discovery
- HTTPS device API
- loopback-only admin API
- one-time pairing
- persistent device approval
- short-lived/in-memory sessions
- Tailscale as the remote transport

is coherent and gives FlashPush a good security and UX foundation.

I do **not** see a fundamental architectural blocker in the current spec. I would make the changes below before implementation, mainly to close a few security/edge-case ambiguities and make the protocol easier to implement consistently.

---

## 2. Priority 0 — Clarify the pairing protocol

### 2.1 Protect the unauthenticated `/pair/status/:requestId` endpoint

Current design:

> `GET /v1/pair/status/:id` is unauthenticated and, after approval, returns `{secret}` once.

The request ID should be treated as a high-entropy capability. Make this explicit:

- `requestId`: at least 128 random bits.
- Never use sequential IDs.
- Never log the request ID together with the issued device secret.
- The secret should be returned only after the phone proves knowledge of the pairing material.
- Consider requiring `{deviceId, proof}` on the status request, where the proof is derived from `np` or another pairing-specific secret.

This removes the assumption that knowledge of the request ID alone is sufficient to retrieve the newly issued device secret.

### 2.2 Define exactly what the laptop uses as `fp`

The SAS formula currently says:

`SHA256(fp ‖ np ‖ nl)`

The spec should explicitly state:

- `fp` is the SHA-256 hash of the laptop's DER-encoded leaf certificate.
- The laptop uses its own certificate fingerprint.
- The phone uses the fingerprint of the certificate actually presented by the TLS server.
- The byte encoding and concatenation format are identical on both implementations.

I recommend a versioned/domain-separated input such as:

`SHA256("FLASHPUSH-SAS-v1" || fp || np || nl)`

This avoids accidental protocol collisions and makes future protocol changes safer.

### 2.3 Specify nonce and request ID sizes

The spec gives `np` and `nl` as 16 random bytes, which is good. Add the exact requirements:

- `np`: 16 cryptographically random bytes.
- `nl`: 16 cryptographically random bytes.
- `requestId`: 16 or 32 cryptographically random bytes, encoded as URL-safe/base64url or UUID.
- Device secret: 32 cryptographically random bytes.
- Session token: 32 cryptographically random bytes.

This should be part of `docs/protocol.md`, not left implicit.

---

## 3. Priority 1 — Tighten device/session lifecycle

### 3.1 Give the device secret a rotation/re-pair story

The spec has:

- pair → issue secret
- revoke → remove device
- forget laptop → wipe local state

Add an explicit **re-pair** operation.

For example:

- `Re-pair` on the phone deletes local credentials and starts pairing again.
- Re-pairing the same `deviceId` can either rotate the secret or create a new device record.
- The old secret must immediately stop working when rotated.

This matters if the phone's secure storage becomes corrupted or the user wants to rotate credentials without manually deleting the laptop state.

### 3.2 Clarify whether multiple phone sessions are allowed

The current model says sessions are created in memory, but does not specify whether one device can have:

- one active session only, or
- multiple concurrent sessions.

I recommend **one active session per device**.

A new `POST /v1/session` would invalidate the previous session for that device. This simplifies state management and avoids surprising simultaneous connections.

### 3.3 Make session expiry explicit

Sessions are currently ended by disconnect or server restart.

Add an inactivity/absolute lifetime policy, for example:

- idle timeout: configurable, e.g. 24 hours
- absolute session lifetime: configurable, e.g. 7 days
- reconnect requires the persistent device secret but not re-pairing

This limits the lifetime of accidentally abandoned sessions while keeping the UX simple.

---

## 4. Priority 1 — Improve discovery behavior

### 4.1 Discovery should not be trusted — already correct

The spec explicitly treats UDP discovery as a hint and relies on TLS/SAS for identity. Keep this.

### 4.2 Add a discovery timeout/backoff strategy

The phone currently scans for ~2 seconds.

Define:

- initial scan duration
- retry interval
- exponential backoff while the screen is open
- behavior after returning to foreground
- whether a manual pull-to-refresh performs a full scan

Suggested behavior:

1. Immediate scan on Laptops screen.
2. 2-second listening window.
3. Retry after a short delay if no laptop is found.
4. Stop repeated background scanning when the screen is inactive.

This avoids unnecessary battery/network usage.

### 4.3 Handle networks that block broadcast

The spec already has "Add by address", which is good.

Make the UX explicit:

> "Can't find your laptop? Add by address"

This should be a first-class fallback rather than an obscure advanced feature because enterprise/public Wi-Fi can isolate clients or block broadcasts.

---

## 5. Priority 1 — Tailscale address handling needs one refinement

The current approach stores Tailscale IPv4 addresses and races all saved addresses.

Add:

- IPv6 support as a future/optional item, rather than assuming IPv4 forever.
- Tailscale MagicDNS as a preferred stable address when available.
- A distinction between "saved address" and "currently verified address".
- A timeout per connection attempt so one dead address cannot delay the whole race.

For example:

`connect timeout = 2–3 seconds per candidate`

The phone should cancel losing connection attempts immediately after one candidate successfully passes TLS pin verification.

---

## 6. Priority 1 — File-transfer safety

The current spec mentions streaming files to disk and sanitizing filenames. This deserves a little more detail because file transfer is one of the core product functions.

Add explicit limits for:

- maximum single-file size
- maximum total storage used by received files
- maximum number of stored items
- maximum filename/path length
- allowed/blocked path characters
- behavior when disk space is low
- behavior when a transfer is interrupted

Most importantly:

### Never trust a client-supplied path

Received files should always be written under a server-controlled receive directory.

Use a generated internal filename or sanitized basename, and never allow:

- `../`
- absolute paths
- Windows drive paths
- UNC paths
- symlink/junction traversal

The final resolved path should be verified to remain inside the receive directory.

---

## 7. Priority 1 — Add transfer integrity

TLS protects the connection, but a file-transfer protocol should still have explicit application-level transfer state.

For files, consider returning:

- `transferId`
- filename
- byte length
- MIME type
- SHA-256 checksum
- transfer status

The sender can calculate the SHA-256 while streaming.

The receiver verifies the final hash before marking the item as complete.

This gives you reliable detection of:

- interrupted transfers
- corrupted files
- incomplete writes
- future protocol bugs

It also makes resumable transfers possible later without redesigning the data model.

---

## 8. Priority 2 — Improve the API contract

The protocol section is good, but `docs/protocol.md` should define every endpoint using a consistent schema.

For each endpoint document:

- method
- path
- request body
- response body
- authentication requirement
- expected status codes
- error format
- idempotency behavior
- maximum body size
- retry behavior

Use one standard error structure, e.g.:

```json
{
  "error": {
    "code": "DEVICE_REVOKED",
    "message": "This device is no longer paired."
  }
}
```

The Flutter client should branch on stable error codes, not human-readable messages.

---

## 9. Priority 2 — Add idempotency rules

Some operations can be retried because of Wi-Fi instability.

Define idempotency for:

- `POST /session`
- `POST /text`
- `POST /file`
- `DELETE /items/:id`
- pairing operations

For file/text sending, a client-generated `operationId` would prevent duplicate transfers when the phone sends a request, loses the response, and retries.

Example:

`operationId = UUID`

The server remembers completed operation IDs for a bounded period and returns the original result for a duplicate request.

This is especially useful on mobile networks.

---

## 10. Priority 2 — Autostart and graceful shutdown

The autostart design is reasonable.

I would add:

### Startup readiness

The tray should distinguish:

- starting
- running
- degraded
- stopped

If a port is unavailable, the tray notification should explain the actual problem instead of simply saying FlashPush failed.

### Stop semantics

When the user selects **Stop FlashPush**:

1. Stop accepting new sessions/transfers.
2. Allow active transfers to finish for a short grace period.
3. Close SSE connections.
4. Stop HTTPS/admin/discovery listeners.
5. Tell the tray process to exit.
6. Remove the tray icon.

If the process is forced to stop, active transfers can be marked incomplete.

---

## 11. Priority 2 — Admin API security

The loopback + Host/Origin/custom-header approach is thoughtful.

One improvement: document clearly that this is a **browser CSRF defense**, not authentication.

The threat model already excludes malware running as the local user. Keep that limitation explicit.

Also consider generating a local admin capability/token if the UI eventually needs to support more sensitive actions. Do not rely on the custom header as a general authentication mechanism.

---

## 12. Priority 2 — Windows firewall setup UX

The firewall requirement is currently described as a one-time administrator script.

Make setup failure visible.

The laptop UI could show:

> Network access: Limited  
> Allow FlashPush through Windows Firewall

and provide the exact setup command/instructions.

Also document the security scope of the rule:

- TCP 8765
- UDP 8766
- LAN/private networks
- Tailscale `100.64.0.0/10`

Avoid opening unrelated ports.

---

## 13. Priority 3 — Better connection-state model

The phone currently has:

`Not paired → Paired → Connected`

I recommend making the internal state machine slightly richer:

```text
DISCOVERING
   ↓
DISCOVERED
   ↓
NOT_PAIRED
   ↓
PAIRING
   ↓
PAIRED
   ↓
CONNECTING
   ↓
CONNECTED
   ↓
DISCONNECTING
```

With failure states represented separately:

```text
CONNECT_FAILED
LAPTOP_UNREACHABLE
CERT_CHANGED
REVOKED
PAIR_EXPIRED
```

The UI can still display only the simple three/four states, but the internal model will make reconnection logic much easier.

---

## 14. Priority 3 — Reconnection behavior

The current spec says:

> The app keeps a "connected" intent and silently reconnects when the laptop is reachable again, unless the user pressed Disconnect.

This is good UX, but define the exact behavior.

Recommended:

- Explicit **Disconnect** cancels reconnect intent.
- Temporary network loss keeps reconnect intent.
- Retry with exponential backoff.
- Do not reconnect indefinitely at a high frequency.
- If the device was revoked, stop retrying and show "Device revoked".
- If the certificate changes, stop retrying and require re-pair.
- If the laptop is simply offline, keep the device paired and retry later.

This will prevent battery drain and confusing status behavior.

---

## 15. Priority 3 — SSE lifecycle

`GET /events` is listed as SSE.

Document:

- heartbeat interval
- reconnect behavior
- `Last-Event-ID` support or explicit decision not to support it
- event IDs
- behavior when the session expires
- maximum number of SSE connections per device

For a mobile client, I would keep the SSE connection only while the relevant screen/session is active unless there is a strong product requirement for persistent background updates.

This aligns with the current v1 non-goal of no background push notifications.

---

## 16. Priority 3 — Data retention and cleanup

The spec says items/files are persisted but does not define retention.

Add a policy:

- maximum item count
- maximum disk usage
- optional automatic cleanup
- whether deleting an item deletes its file
- whether sent and received items have different retention
- behavior after uninstall/reinstall
- manual "Clear history" action

This will matter surprisingly quickly once users start sending files.

---

## 17. Recommended additional test cases

The current test plan is already good. Add these cases:

### Security

- wrong SAS
- modified `np`
- modified `nl`
- modified commit
- expired pairing request
- pairing request flood
- status polling with an invalid request ID
- status polling from another device
- revoked device attempting to reconnect
- stale session token
- certificate mismatch
- changed certificate after state deletion
- duplicate session creation
- replayed `operationId`

### Networking

- Wi-Fi → Tailscale transition
- Tailscale → Wi-Fi transition
- laptop IP changes
- laptop hostname changes
- Wi-Fi client isolation
- UDP discovery unavailable
- Tailscale unavailable
- one of several saved addresses dead
- IPv6-only/IPv6-preferred environment if supported

### File handling

- duplicate filenames
- `../` filename
- absolute Windows path
- UNC path
- extremely long filename
- zero-byte file
- very large file
- interrupted transfer
- disk full
- duplicate transfer retry
- checksum mismatch

### Windows lifecycle

- sign-in with autostart enabled
- sign-out/sign-in
- reboot
- sleep/wake
- network adapter changes
- Stop → Start
- process crash → relaunch
- port already occupied

---

## 18. Documentation changes

Add these documents/sections:

```text
docs/
├── architecture.md
├── protocol.md
├── security.md
├── pairing.md              # NEW: pairing protocol in detail
├── connection-state.md     # NEW: phone/laptop state machines
├── transfers.md             # NEW: file-transfer lifecycle/integrity
├── setup.md
├── testing.md
├── decisions.md
└── design/
```

`pairing.md` should contain the exact cryptographic protocol.

`transfers.md` should contain file lifecycle, checksum, retry, and storage rules.

`connection-state.md` should be the source of truth for reconnect behavior.

---

## 19. One wording change I strongly recommend

The goal currently says:

> "Security: every request from an unapproved device is rejected."

That is slightly inaccurate because `/hello` and the pairing endpoints intentionally accept unauthenticated requests.

Change it to:

> **Security: every data/admin operation from an unapproved device is rejected. Only discovery, identity, and rate-limited pairing endpoints are unauthenticated.**

This makes the security model much more precise.

---

## 20. Suggested implementation order

I would implement in this order:

1. **Core server + HTTPS + certificate generation**
2. **Device identity + secure device store**
3. **Pairing state machine + SAS**
4. **Session authentication**
5. **LAN discovery**
6. **Flutter discovery + pairing UI**
7. **Basic text transfer**
8. **File transfer + integrity checks**
9. **Laptop web UI**
10. **Windows tray**
11. **Autostart**
12. **Tailscale address handling**
13. **Reconnection/state machine**
14. **Security/integration testing**
15. **Stitch polish + documentation**

This keeps the security-critical protocol stable before the Windows UX and remote-network pieces are layered on.

---

## Final recommendation

**Keep the overall architecture.**

The strongest parts of the current design are the removal of the reusable shared token, explicit device approval, certificate pinning, loopback-only admin surface, and the separation of LAN discovery from actual trust.

Before implementation, I would specifically lock down:

1. Pair-status authorization/proof.
2. Exact cryptographic encoding/versioning.
3. Device secret rotation/re-pairing.
4. Session lifetime and single-session behavior.
5. File-transfer limits/path safety/integrity.
6. API error/idempotency contracts.
7. Reconnection state machine.
8. Data retention/cleanup.

These are mostly protocol-hardening and lifecycle decisions rather than architectural changes, so they should be relatively cheap to incorporate now and considerably more expensive after the implementation spreads across Node, Flutter, and the Windows tray.
