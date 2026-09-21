# Windows Shell (Plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the laptop side a proper Windows citizen: an explicit start-up state (running / degraded), graceful stop, a single instance, a tray icon with notifications, start with Windows, a least-privilege firewall rule script, and the laptop's Tailscale MagicDNS name in its address list.

**Architecture:** Pure, headlessly testable Node modules (`lifecycle`, `tray-protocol`, `autostart`, `desktop`, `singleInstance`, `shell`, `cli`) around a small static PowerShell tray script that talks to Node over newline-delimited JSON. `createApp()` stays free of Windows-only side effects; only the CLI starts the tray. Nothing here needs admin rights except the one-time firewall script.

**Tech Stack:** Node.js ≥ 22 (no new dependencies), Windows PowerShell 5.1 (`System.Windows.Forms.NotifyIcon`), WScript (`.vbs` launcher).

**Spec:** `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §5.2 (MagicDNS), §5.3 (firewall), §8 (autostart, tray, lifecycle), §12 (edge cases), §13 (tests)

## Global Constraints

- No admin rights at run time. The only elevated step is `scripts/allow-firewall.ps1`, run by the user.
- Scripts (`tray.ps1`, the `.vbs` launcher, the firewall scripts) are static or generated from fixed templates; every dynamic value (paths) is validated and escaped, never concatenated from user or network input. The tray script never uses `Invoke-Expression`, never builds commands from message text, and treats every message field as display text only.
- Firewall rules open only TCP 8765 and UDP 8766 for remote addresses LocalSubnet and 100.64.0.0/10 (a Windows rule holds one protocol, so it is two rules in one group named `FlashPush`).
- Tests never touch the real Startup folder, Start Menu or firewall; paths are parameters and tests use temp directories.
- Tray menu (exact): status line, Open FlashPush, Pending approvals (n) (hidden at 0), Paired devices, Open received files, Start with Windows (checkbox), Stop FlashPush. Balloon: `<phone> wants to connect, code 482 916`; clicking it opens the page.
- Stop order: (1) stop accepting new connections, (2) let active transfers finish up to 5 s, (3) close event streams, (4) close listeners, (5) tell the tray to exit; a forced stop aborts transfers and deletes their `.part` files.
- Never log secrets, tokens or request ids.
- Branch `feature/windows-shell`. Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Docs updated in the same change.

---

### Task 1: Lifecycle state
Files: create `server/src/lifecycle.js`; test `server/test/lifecycle.test.js`.
Interfaces: `class Lifecycle extends EventEmitter` (`status() → {state, reason}`, `running()`, `degraded(reason)`, `stopped()`, event `change`; `stopped` is final; no event when unchanged); `listenFailureReason(err, port, protocol='TCP')`; `createTracker() → {attach(server), whenIdle(ms)}` counting in-flight non-SSE requests.
Tests: initial `starting`; transitions and single event per change; `stopped` final; status copy; reason text (`Port 8765 is used by another program.`, UDP variant, other errors); tracker idle / waits / times out.
- [ ] tests → fail → implement → pass → commit `feat(server): lifecycle state and request tracker`

### Task 2: Tolerant start, status in admin API, graceful stop
Files: modify `server/src/index.js`, `server/src/adminApi.js`, tests; create `server/test/lifecycle.e2e.test.js`.
Interfaces: `createApp` also returns `{lifecycle, bus}`; `start({tolerant=false})` (strict unchanged; tolerant records failures, ends running/degraded, skips discovery if the device port failed); `stop({graceMs=5000})` per the stop order; `createAdminApi(..., getStatus)`; `GET /admin/state` gains `status`.
Tests: state.status; degraded start with a taken port keeps admin up; strict still rejects; graceful stop finishes an upload; forced stop aborts and leaves no `.part`; stop idempotent.
- [ ] tests → fail → implement → whole suite passes → commit `feat(server): degraded start-up state, status in admin state, graceful stop`

### Task 3: MagicDNS name
Files: modify `server/src/addresses.js`; test `server/test/addresses.test.js`.
Interfaces: `parseTailscaleName(json)`, `readTailscaleName(exec?)` (2 s timeout, failure → null), `createAddressProvider({interfaces?, readName?}) → {list(), refresh()}` adding `{name, kind:'tailscale-name'}` before the Tailscale IP; `createApp({readTailscaleName})` defaults to none.
- [ ] tests → fail → implement → pass → commit `feat(server): Tailscale MagicDNS name in the address list`

### Task 4: Tray protocol (pure)
Files: create `server/src/tray-protocol.js`; test `server/test/tray-protocol.test.js`.
Interfaces: `encode(msg)`, `createLineDecoder(onMessage)`, `buildMenu({status, pendingCount, autostart})`, `TRAY_ACTIONS`.
Tests: round trip; split/multiple/garbage/oversize lines; menu per state; approvals hidden at 0; sanitised labels; tooltip ≤ 63 chars.
- [ ] tests → fail → implement → pass → commit `feat(server): tray message protocol and menu model`

### Task 5: Tray controller, static script, icons
Files: create `server/src/tray.js`, `server/tray/tray.ps1`, `server/tray/build-icons.ps1`, `server/tray/glyph.svg`, three `.ico` files; test `server/test/tray.test.js`.
Interfaces: `createTray({spawn?, scriptPath?, iconDir?, onAction, log?}) → {start(), update(model), notify(title, body), stop()}`; PowerShell spawned with an argument array, no shell.
Tests: fake child (args, messages, action routing, unknown ignored, stop, failed spawn); Windows only: scripts parse, icons load, real tray reports `ready` and exits cleanly.
- [ ] tests → fail → implement → pass → commit `feat(server): tray icon controller, static tray script and icons`

### Task 6: Autostart
Files: create `server/src/autostart.js`; test `server/test/autostart.test.js`.
Interfaces: `buildLauncher({nodeExe, script, workDir})`, `installAutostart`, `uninstallAutostart`, `autostartStatus` (all take `appData`).
Tests: spaces ok; quotes, `%`, newlines, relative paths rejected; install/idempotent/uninstall/status in a temp dir; Windows: generated launcher run with `cscript //nologo` starts node.
- [ ] tests → fail → implement → pass → commit `feat(server): start with Windows (launcher generator, install, uninstall, status)`

### Task 7: Firewall scripts
Files: create `scripts/allow-firewall.ps1`, `scripts/remove-firewall.ps1`; test `server/test/scripts.test.js`.
Tests (Windows): scripts parse; the allow script has only TCP 8765 / UDP 8766 with `LocalSubnet,100.64.0.0/10` and nothing looser.
- [ ] tests → fail → implement → pass → commit `feat: least-privilege firewall scripts for the LAN and Tailscale`

### Task 8: Single instance, desktop helpers, tray wiring, CLI
Files: create `server/src/singleInstance.js`, `desktop.js`, `shell.js`, `cli.js`; modify `server/src/index.js`, `server/package.json`; tests for each.
Interfaces: `findRunningInstance(adminPort, fetchFn?)`, `desktop.openUrl` (loopback only) / `openFolder`, `attachTray({app, tray, autostart, desktop, adminUrl, onStop})`, `parseArgs(argv)`, `main(argv)`.
- [ ] tests → fail → implement → whole suite passes → commit `feat(server): single instance, tray wiring and CLI`

### Task 9: Documentation
Create `docs/setup.md`, `docs/testing.md`; update architecture, security, protocol, docs index, decisions, changelog, server README, root README.
- [ ] write → commit `docs: setup and testing guides, Windows shell architecture, security and decisions`

---

## Self-review
Spec coverage: §8 lifecycle/stop → T1-2; single instance, tray, autostart → T4-6, 8; §5.3 firewall → T7; §5.2 MagicDNS → T3; §12 port in use → T2; §13 manual checklist → T9. Deviations (two firewall rules in one group; `.vbs` doubles as the Start Menu entry) go in the decisions log. `status()` is `{state, reason}` everywhere; tray action ids are shared by `tray-protocol`, `tray`, `shell`.
