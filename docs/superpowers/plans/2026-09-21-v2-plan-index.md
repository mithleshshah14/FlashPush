# FlashPush v2: plan index

Spec: [`../specs/2026-09-21-pairing-autostart-tailscale-design.md`](../specs/2026-09-21-pairing-autostart-tailscale-design.md) (revision 2, approved 2026-09-21)

The spec covers several independent subsystems, so it is split into plans that each produce working, testable software. Plans are written in full detail **just before they run**, because later plans depend on what earlier ones actually produce (and the UI plans depend on the Stitch designs).

| # | Plan | Delivers | Spec sections | Depends on | Detail |
|---|---|---|---|---|---|
| 1A | **Server security core** | crypto primitives, identity, TLS cert, device store, sessions, rate limiter, idempotency, pairing state machine, all unit-tested | §3, §4.1–4.2 | none | [written](2026-09-21-plan-1a-server-security-core.md) |
| 1B-i | **Server foundations** | address classification, per-phone history store, safe streamed uploads, UDP discovery | §5.1-5.2, §7 | 1A | [done](2026-09-22-plan-1b-i-server-foundations.md) |
| 1B-ii-a | **Device API** | error-enveloped `/v1` API: pairing, sessions, history, text + file transfer with idempotency, live events; `protocol.md` | §3.3-3.4, §4, §6.3, §11 | 1B-i | [done](2026-09-22-plan-1b-ii-a-device-api.md) |
| 1B-ii-b | **Admin API and wiring** | loopback admin API + temporary page, `index.js` wiring, HTTPS end-to-end test, `architecture.md`, `security.md` | §3.5, §2 | 1B-ii-a | [done](2026-09-22-plan-1b-ii-b-admin-and-wiring.md) |
| 2 | **Stitch designs** | Android screens and laptop UI screens, design tokens from the icon palette, `docs/design/` | §9, §10 | none (can run beside 1A/1B) | to write |
| 3 | **Android app v2** | pinned-TLS client, secure storage, discovery, laptops list, pairing UI, Connect/Disconnect, text + file transfer against `/v1` | §6, §9 | 1B, 2 | to write |
| 4 | **Laptop web UI** | dashboard, approvals, devices, "Can't connect" panel, favicon | §10 | 1B, 2 | to write |
| 5 | **Windows shell** | tray + notifications, lifecycle states, graceful stop, autostart, single instance, firewall script, `setup.md` | §5.3, §8 | 1B, 4 | to write |
| 6 | **Tailscale + reconnect + hardening** | address classification and MagicDNS, address race, reconnect state machine, SSE rules, remaining tests, `connection-state.md`, `testing.md` | §5.2, §6 | 3, 5 | to write |

Suggested order: 1A → 1B, with 2 in parallel; then 3 and 4; then 5; then 6.

## Working rules for every plan

- **Branching (project rule):** each plan runs on its own `feature/<name>` branch created from `develop`. Never commit to `main` or `develop` directly.
- **Docs (project rule):** the last task of every plan updates `CHANGELOG.md` and the affected `docs/` files.
- **Test-first:** failing test → minimal code → passing test → commit.
- **Commits:** small, one per task step group; commit messages end with the `Co-Authored-By` trailer when Claude writes them.

## Before Plan 1A can start

`develop` currently only contains the README. The v1 prototype, the docs and the spec live on `feature/v2-pairing-autostart-tailscale`. That branch should be merged into `develop` first (recommended: `git merge --no-ff`, then push), so that each plan's feature branch can be created from a `develop` that contains the code it builds on. This needs the repository owner's go-ahead.
