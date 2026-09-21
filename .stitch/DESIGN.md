# Design System: FlashPush v2

**Stitch project:** `FlashPush v2` (id `14054862547846302879`), design system asset `assets/11926690439085629516` ("FlashPush").
Source of truth for both UIs: the Android app and the laptop web UI. Use the tokens below when implementing (Plan 3 app, Plan 4 web UI); the exported screens are in `docs/design/screens/`.

## 1. Atmosphere

Calm, technical, trustworthy. Dark-first (deep navy) with a derived light theme. Not playful: no emojis, no mascots, restrained glow (only on primary buttons, the pairing code and "on" connection controls), flat surfaces with hairline borders.

Brand motif (from `app_icon.png`): a phone and a laptop joined by two circular arrows, with a document between them.

## 2. Colour tokens

| Role | Dark | Light |
|---|---|---|
| Background | `#030C1E` fading to `#112B58` (vertical) | `#F4F8FF` |
| Surface (cards) | `#0A1B3D` | `#FFFFFF` |
| Surface high / sheets | `#112B58` | `#EAF1FB` |
| Hairline border | `rgba(69,226,253,0.12–0.20)` | `#D5E3F7` |
| Text | `#E8F0FF` | `#0A1B3D` |
| Secondary text | `#9DB2D6` | `#4F6790` |
| Primary action | `#1CA2FD` (strong `#0346F4`) | `#1CA2FD` / `#0346F4`, white text |
| Cyan highlight | `#45E2FD` | `#007A99` on `#E0F7FE` chips |
| **Connection ON** (mint) | `#16F9CB` (soft glow) | `#0BB58F` |
| **Connection OFF** (neutral grey) | `#6B7FA3` | `#6B7FA3` |
| Warning | `#FFB547` | `#B45309` on `#FEF3C7` |
| Error / Deny / Revoke | `#FF6B6B` | `#E5484D` |
| Tailscale chip | blue-violet outline `#8B5CF6`-ish (`#5B54F6` in light) | `#5B54F6` |

Stitch's generated Material 3 roles (from the seed `#1CA2FD`, secondary `#16F9CB`, tertiary `#0346F4`, neutral `#0A1B3D`, variant TONAL_SPOT) are stored in the design system asset.

## 3. Typography

| Use | Font | Weight |
|---|---|---|
| Headings, titles, buttons | Manrope | 600–700 |
| Body, labels, chips | Inter | 400–500 |
| Addresses, pairing codes, firewall command, sizes | JetBrains Mono | 400–500 |

The pairing code is large monospaced digits in two groups of three (`482 916`), about 64 px on the phone.

## 4. Shape, spacing, depth

- Corner radius **12 px** for cards, fields and buttons; **pill** for chips; 24 px top corners on bottom sheets.
- Spacing scale: 4 / 8 / 12 / 16 / 24 (Stitch `spacingScale: 2`); 16 px screen gutters on the phone.
- Depth: 1 px hairline borders, flat surfaces. Glow only on primary buttons, the pairing code and "on" connection controls. Light theme uses a very soft shadow instead of glow.

## 5. Components

- **Route chip:** pill; `Wi-Fi` in cyan, `Tailscale` in a blue-violet outline. Used in list rows and on the laptop UI.
- **Status word:** only for pairing state: `Not paired` (grey dot), `Paired` (blue dot). Connection state is **never** a word (see §6).
- **Bottom tab bar (phone):** Material 3 navigation bar, exactly three tabs: `Devices` (laptop icon), `Transfer` (swap arrows), `Settings` (gear); active tab has a cyan pill indicator. Present on every phone screen except full-screen compose and modal sheets (dimmed behind sheets).
- **Laptop shell:** 240 px left sidebar (logo, `Dashboard`, `Approvals` with count badge, `Devices`, host name + `Running`), content on the right; 1440×900 target.
- **Extended FAB (`New transfer`):** blue, plus icon, on the laptop-detail screens; replaced by `Connect to send` when offline.
- **Empty states:** simple line-art illustration in cyan/mint, heading, one line of body copy, one outlined action.

## 6. Connection controls (phone headers and list rows) — approved 2026-09-22

Connection state is shown with **two icon buttons and no status words** (no "Connected", "Disconnected", "via …" text).

| Control | Shape | Role | On (green) | Off (grey) |
|---|---|---|---|---|
| **Wi-Fi** | three arcs and a dot | status: the phone reaches the laptop over the local Wi-Fi; tap shows the route | solid, mint | outline with a diagonal slash, `#6B7FA3` |
| **Link** | two chain links | **action**: tap connects (when grey) or disconnects (when green); replaces the separate `Connect` / `Disconnect` text button | solid, mint | outline with a diagonal slash, `#6B7FA3` |

- Each icon sits in a **rounded button container** with a 44–48 dp touch target, a subtle filled (on) or outlined (off) background, and a hinted pressed state.
- State is not colour-only: on = solid glyph, off = outlined + slashed glyph; each control has an accessible label (`Wi-Fi: on/off`, `Linked to laptop: on/off`, plus `Tap to connect` / `Tap to disconnect` on the link).
- **Tailscale route:** Wi-Fi control grey, link control green. The words "via Tailscale" appear only as a tooltip / long-press note, never as visible text.
- Legend for docs and reviews: **green = on, grey = off.**

## 7. Screens

The list of screens, ids, exports and prompts is in `docs/design/README.md`.

## 8. Regenerating a screen

1. Generate with `generate_screen_from_text` (`designSystem: assets/11926690439085629516`, `deviceType: MOBILE` or `DESKTOP`) using the structured prompt pattern in `docs/design/README.md`.
2. **Put every change in the one initial prompt.** Multi-step edits do not persist in Stitch (see the notes in `docs/design/README.md`).
3. Export the preview with the `=w780` (mobile) or `=w2560` (desktop) size suffix on the screenshot URL.
