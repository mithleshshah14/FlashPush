# Pairing protocol

The exact byte-level protocol between the phone and the laptop for the first connection (and for re-pairing). Design rationale: spec §3.2. Reference implementation: `server/src/crypto.js` and `server/src/pairing.js`. The Flutter app must reproduce the known-answer vectors below.

## Goals

1. The laptop only ever gives a secret to a phone the user approved on the laptop.
2. A network attacker between phone and laptop cannot make the two 6-digit codes match (probability 1 in 1,000,000 per attempt).
3. Someone who learns a `requestId` still cannot obtain the secret.

## Values

| Name | Size | Chosen by | Notes |
|---|---|---|---|
| `fp` | 32 bytes | laptop | SHA-256 of the DER leaf certificate. The phone uses the fingerprint of the certificate its TLS session actually presented |
| `np` | 16 bytes | phone | cryptographic RNG |
| `nl` | 16 bytes | laptop | cryptographic RNG, chosen after the commit is received |
| `requestId` | 16 bytes | laptop | cryptographic RNG, never sequential |
| device secret | 32 bytes | laptop | returned once (re-fetchable for 60 s), stored only as SHA-256 |
| session token | 32 bytes | laptop | memory only |

On the wire every binary value is **base64url without padding, canonical** (a decoder rejects padding, other alphabets, whitespace and non-canonical trailing bits).

## Functions

All `‖` are raw-byte concatenation with no separators or length prefixes. Labels are ASCII.

```
commit  = SHA256( "FLASHPUSH-COMMIT-v1" ‖ np )
sasHash = SHA256( "FLASHPUSH-SAS-v1" ‖ fp ‖ np ‖ nl )
SAS     = decimal( uint32_big_endian(sasHash[0..4]) mod 1,000,000 ), zero-padded to 6 digits
shown   = SAS[0..3] + " " + SAS[3..6]                     e.g. "001 004"
proof   = hex( HMAC-SHA256( key = np, "FLASHPUSH-STATUS-v1" ‖ requestId ‖ UTF-8(deviceId) ) )
```

## Message flow

```
Phone                                                   Laptop
  |  POST /v1/pair/request {deviceId, deviceName, commit}  |
  |------------------------------------------------------->|  picks nl (after seeing commit)
  |  {requestId, nl}                                       |
  |<-------------------------------------------------------|
  |  POST /v1/pair/reveal {requestId, np}                  |  checks commit == SHA256(label ‖ np)
  |------------------------------------------------------->|  computes SAS, shows the approval card
  |  GET /v1/pair/status/:requestId  (X-Pair-Proof: proof) |
  |------------------------------------------------------->|  ... user compares codes, clicks Approve
  |  {state:"approved", secret, ...}                       |
  |<-------------------------------------------------------|
```

Both screens show the SAS; the user approves only if they match.

## Timing and limits

| Rule | Value |
|---|---|
| Reveal must arrive within | 10 s of the request (otherwise `PAIR_EXPIRED`) |
| Request lifetime | 2 min |
| Secret re-fetch window after approval | 60 s (proof required), then erased |
| Open requests | max 3; a device's new request replaces its old one |
| Requests per IP | 5 per minute |
| Paired devices | max 20 |
| Status polling | the phone polls every 1-2 s (no long-poll) |

## Why the commit–reveal matters

Without it, a man-in-the-middle can try many nonces offline until the two codes collide. With it, `nl` exists only after the phone has committed to `np`, and `np` is revealed only after the phone has received `nl`, so an attacker must fix both legs' inputs before seeing the other side's random value.

## Error responses

A wrong `np` gives `COMMIT_MISMATCH` and the request is dropped. On the status route, an unknown request, a different `deviceId`, a missing or wrong proof, or a request whose `np` is not yet known **all** return the same `PAIR_NOT_FOUND` so the route cannot be used to test guesses.

## Known-answer test vectors

Inputs: `fp` = bytes `00 01 … 1f` (32 bytes); `np` = `10 11 … 1f`; `nl` = `20 21 … 2f`; `requestId` = `30 31 … 3f`; `deviceId` = `11111111-2222-3333-4444-555555555555`.

| Value | Result |
|---|---|
| `np` (base64url) | `EBESExQVFhcYGRobHB0eHw` |
| `requestId` (base64url) | `MDEyMzQ1Njc4OTo7PD0-Pw` |
| `commit` (hex) | `148f8a90dd839457dc23e50843a84c96c73365433d7277efea17c04322b1e017` |
| `commit` (base64url) | `FI-KkN2DlFfcI-UIQ6hMlsczZUM9cnfv6hfAQyKx4Bc` |
| `SAS` | `001004` (shown `001 004`), also tests zero padding |
| `proof` (hex) | `01b5a81d7a92704f2e4bda8b6a8e86f78f88a470b7e0bca9b6b668d7b2a035f5` |

These are asserted in `server/test/crypto.test.js`; the Flutter tests must assert the same values.
