# FlashPush documentation

| Document | What it covers | Status |
|---|---|---|
| [../CHANGELOG.md](../CHANGELOG.md) | what changed, day by day | live |
| [decisions.md](decisions.md) | choices made and why | live |
| [superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md](superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md) | v2 design: pairing, security, autostart/tray, Tailscale (revision 2) | approved 2026-09-21 |
| [FlashPush_v2_design_review_suggestions.md](FlashPush_v2_design_review_suggestions.md) | external review of the spec; triage in decisions.md | input |
| [pairing.md](pairing.md) | exact pairing crypto, message flow, limits and test vectors | written (Plan 1A) |
| [dev-safety.md](dev-safety.md) | antivirus-safe development rules, the test guard, how to react to an alert | written |
| [architecture.md](architecture.md) | listeners, modules, state on disk, start-up and shutdown | written (Plan 1B-ii-b) |
| [admin-ui.md](admin-ui.md) | laptop web UI: views, API use, theme, accessibility, security rules, screenshots | written (Plan 4) |
| [security.md](security.md) | threats and protections, what is not protected, review checklist | written (Plan 1B-ii-b) |
| [design/implemented/](design/implemented/) | screenshots of the built laptop UI (dark/light, desktop/mobile) | written (Plan 4) |
| [protocol.md](protocol.md) | device API, admin API and UDP discovery reference | written (Plans 1B-ii-a/b) |
| [setup.md](setup.md) | install, tray, start with Windows, firewall rule and its scope, Tailscale, antivirus notes, troubleshooting | written (Plan 5) |
| [testing.md](testing.md) | automated suite, what tests never do, manual Windows checklist | written (Plan 5) |
| [transfers.md](transfers.md) | file lifecycle, limits, path safety, retention, per-phone history | written (Plan 1B-i) |
| connection-state.md | phone/laptop state machines and reconnect rules | written during implementation |
| [superpowers/plans/2026-09-21-v2-plan-index.md](superpowers/plans/2026-09-21-v2-plan-index.md) | implementation plans: index of 7 plans, with Plan 1A (server security core) written in full | Plan 1A done (77 tests); 1B next |
| architecture.md | how the pieces fit | written during implementation |
| protocol.md | full HTTP/UDP protocol reference | written during implementation |
| security.md | threat model and what is/isn't protected | written during implementation |
| setup.md | install, autostart, firewall, Tailscale | written during implementation |
| testing.md | automated + manual test checklists | written during implementation |
| design/ | Stitch screens and design tokens | after spec approval |

Process: brainstorm → written spec → implementation plan → test-first implementation → docs updated in the same change.
