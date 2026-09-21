# FlashPush v2 designs (Stitch)

Both UIs are designed in **Stitch**. Everything below is the record of that work: where it lives, what each screen is, the prompts, the tokens and how to regenerate.

| | |
|---|---|
| Stitch project | **FlashPush v2** (private) |
| Project id | `14054862547846302879` (open it from Stitch's project list, or `https://stitch.withgoogle.com/projects/14054862547846302879`) |
| Design system | "FlashPush", asset `assets/11926690439085629516` (dark, Manrope / Inter / JetBrains Mono, 12 px radius) |
| Tokens and rules | [`.stitch/DESIGN.md`](../../.stitch/DESIGN.md) |
| Previews | [`screens/`](screens/) (mobile 780 px wide, desktop/mockup 2560 px wide) |
| Source spec | `docs/superpowers/specs/2026-09-21-pairing-autostart-tailscale-design.md` §9–§10 |

## Legend

**Connection controls on the phone: green = on, grey = off.** Two icon buttons, never words:

- **Wi-Fi** (arcs + dot): the phone reaches the laptop over local Wi-Fi. Status; tapping shows the route.
- **Link** (two chain links): the connection to the laptop. **Tapping it connects (grey) or disconnects (green).** It replaces the separate Connect / Disconnect text button.
- Not colour-only: on = solid glyph, off = outlined and slashed glyph, plus accessible labels. On the Tailscale route the Wi-Fi control is grey, the link control green, and "via Tailscale" is a tooltip / long-press note only.

Other status colours: pairing state words `Paired` (blue dot) and `Not paired` (grey dot); route chips `Wi-Fi` (cyan) and `Tailscale` (blue-violet outline); warnings amber, denials and revokes coral.

## Current screens

Bottom tab bar on every phone screen: **Devices | Transfer | Settings**. Tapping a laptop on Devices opens the **laptop detail** screen (Messages | Images | Files); the Transfer tab is a shortcut to the connected laptop's detail screen, or "Connect a laptop first".

### Android app (phone)

| Screen | Theme | Stitch id | PNG |
|---|---|---|---|
| Devices: laptops list (connected / Tailscale route / not paired), **icon buttons (v3)** | dark | `a83b6859ea9b45a89a5e70045cdf0ece` | `screens/android-devices-list.png` |
| Devices: laptops list, **icon buttons (v3)** | light | `b20d49fd810b44f1ac2de22291631382` | `screens/android-devices-list-light.png` |
| Devices: empty state ("Looking for your laptop...") | dark | `3241560b717e4fd99999761d013a1553` | `screens/android-devices-empty.png` |
| Add laptop by address (bottom sheet) | dark | `06453225d7854d828481c32b77335b21` | `screens/android-add-by-address.png` |
| Pairing: waiting, code `482 916` (header: back + title only, no session yet) | dark | `23b1fdbdaae548e2a55e06e9670e3f63` | `screens/android-pairing-waiting.png` |
| Pairing: approved, **icon buttons (v3)** | dark | `443a2bdd675640e5879babd523b3698d` | `screens/android-pairing-approved.png` |
| Pairing: denied | dark | `5c79cc21fddd4908a3cf27ab33868bf2` | `screens/android-pairing-denied.png` |
| Pairing: expired | dark | `ca1a29414b2743e6b12df7c939c3073e` | `screens/android-pairing-expired.png` |
| Problem: not paired anymore (Re-pair / Forget) | dark | `518c615180084b249caf7e13176121b4` | `screens/android-not-paired-anymore.png` |
| Problem: laptop identity changed | dark | `a5c9f90052ab41f9859e505354b10e80` | `screens/android-identity-changed.png` |
| Laptop detail: Messages (connected), **icon buttons (v3)** | dark | `f22d86df4f0d4e32916d00290957f80b` | `screens/android-detail-messages.png` |
| Laptop detail: Images (connected), **icon buttons (v3)** | dark | `38a4331b2dc447c18608c5e6a41e0712` | `screens/android-detail-images.png` |
| Laptop detail: Images, empty, **icon buttons (v3)** | dark | `432109ac80e747219cced4dbe150f295` | `screens/android-detail-images-empty.png` |
| Laptop detail: Files (with a file mid-transfer), **icon buttons (v3)** | dark | `72ed333580064425a2446cd8e29c3eea` | `screens/android-detail-files.png` |
| Laptop detail: Files, empty, **icon buttons (v3)** | dark | `f9fd8a0372c94654b493b1b677348737` | `screens/android-detail-files-empty.png` |
| Laptop detail: not connected (offline banner, saved history, "Connect to send") | dark | `babf3c643e824d7396126b84aa752e37` | `screens/android-detail-not-connected.png` |
| New transfer: choose type (Image / Text / Document) | dark | `0e511268de98464a8e7eeae7bd5fbde3` | `screens/android-new-transfer-sheet.png` |
| New transfer: Text compose, **icon buttons (v3)** | dark | `03a00ccd64364674a6219d46db290903` | `screens/android-new-transfer-text.png` |
| Transfer tab: not connected ("Connect a laptop first") | dark | `f5d523438acf437696571061f33f28b4` | `screens/android-transfer-not-connected.png` |
| Settings (phone name, paired laptops, appearance, connection, about) | dark | `857a53de87a64fddad47ae69468225fc` | `screens/android-settings.png` |

### Laptop web UI (desktop 1440×900) — approved, unchanged

| Screen | Theme | Stitch id | PNG |
|---|---|---|---|
| Dashboard (Running) | dark | `9069133eed9c4683bc93405585acbd5a` | `screens/laptop-dashboard.png` |
| Dashboard (Degraded: "Port 8765 is used by another program") | dark | `52e602681b5046f089f01a29c3345ecc` | `screens/laptop-dashboard-degraded.png` |
| Dashboard | light | `4067014dddcf49ababdd632a995fea11` | `screens/laptop-dashboard-light.png` |
| Approvals (two pending, one "Re-pair of Pixel 7") | dark | `d6bb040a1bbb4cfd9d12b7e372ff9a5b` | `screens/laptop-approvals.png` |
| Approvals | light | `9f7795791d2247b5accb8a37cae84a2f` | `screens/laptop-approvals-light.png` |
| Devices (paired phones, Revoke) | dark | `e8153d85374f4d659e30de9ba57d3919` | `screens/laptop-devices.png` |
| Devices | light | `26c01a1608fd4af29978d845a4493b58` | `screens/laptop-devices-light.png` |

## Icon-button pass (header connection controls): status

Target spec: [`.stitch/DESIGN.md`](../../.stitch/DESIGN.md) §6 (two rounded 44–48 dp icon buttons, link = connect/disconnect action replacing the text button, no status words, green = on / grey = off, "via Tailscale" only as a tooltip).

| Screen | Header / row controls |
|---|---|
| Devices list, dark (`a83b6859…`) | **v3 done.** Row buttons for all three states; the Tailscale row shows Wi-Fi grey and link green; pairing state moved into the subtitle (`100.101.102.103 · Paired`) so no status text sits next to the icons |
| Laptop detail: Messages (`f22d86df…`) | **v3 done** (both ON) |
| Laptop detail: Images empty (`432109ac80e747219cced4dbe150f295`) | **v3 done** (both ON, no text button) |
| Laptop detail: Images (`38a4331b...`), Files (`72ed3335...`), Files empty (`f9fd8a03...`) | **v3 done** (both ON, no text button) |
| Laptop detail: not connected | v2 (`babf3c64...`). **Still to convert (both OFF, link = tap to connect)** |
| Laptop detail: Tailscale route | `ad67d5f8966c405a92435e2f5a36add6` exists but has a visible "via Tailscale" caption, which is **not allowed**; superseded. **To create:** Wi-Fi OFF, link ON, route shown by an info tooltip bubble on the Wi-Fi icon; plus a small route popup (Wi-Fi / Tailscale / address) |
| Devices list light (`b20d49fd...`), Pairing approved (`443a2bdd...`), New transfer text (`03a00ccd...`) | **v3 done** |
| Pairing waiting (`23b1fdbd...`) | **done**: header is back arrow and title only (no session exists yet); consistent style |
| Devices empty, Add by address, pairing denied / expired, problem states, Settings, Transfer not connected | no connection state in the header. Add by address still lacks the dimmed tab bar behind its sheet (batch 3) |

The laptop web UI is approved and untouched.

Working prompt for one screen (single change, as a `generate_variants` of the screen, or the same text at the end of a full `generate_screen_from_text` prompt):

```
Keep everything exactly the same EXCEPT the top app bar controls. Remove the outlined "Disconnect" text
button and any status words. On the right of the app bar show TWO icon BUTTONS side by side, each a
rounded-square button container (12px radius, 44dp x 44dp touch target, subtle filled background, a soft
ring hinting the pressed state): (1) a Wi-Fi status button with the Wi-Fi icon; (2) a link ACTION button
with the link icon (two chain links) that disconnects when tapped and replaces the old Disconnect button.
ON = solid mint #16F9CB glyph on a mint-tinted container rgba(22,249,203,0.12) with a hairline mint border.
OFF = outlined grey #6B7FA3 glyph with a diagonal slash in a transparent container with a grey border.
Labels: "Wi-Fi: on|off", "Linked to laptop: on|off. Tap to disconnect|connect". No text next to the buttons.
```

## Superseded screens (still in the project)

Stitch has no delete tool, so earlier iterations remain in the project. Do not implement from these; delete them in the Stitch UI if they are in the way.

| Id | What it was | Replaced by |
|---|---|---|
| `a3baf43c392c4af69c08fbef4dff1c10` | Devices list with small icons and text pairing status (v2) | `a83b6859…` |
| `b32a29cf1a9e4dc695edddfbe2b61fd9` | laptop detail Messages with small icons plus a text Disconnect button (v2) | `f22d86df…` |
| `0256a34dbb6145bd9f5916021b32c16f` | first Devices list (invented "MDNS", port and "Mesh" details) | `a3baf43c…` |
| `1c2a89cd85044fb588899d9c6a8cdeae` | Devices list with details removed but "Connected" word kept | `a3baf43c…` |
| `5bfc3bf76e4d4ae1a36dc734e7384ad9`, `0d5b5a2b06cc4139ba9bd84b4931a2cb` | light Devices list with text status / v2 icons | `b20d49fd...` |
| `38d00674332046dcb5b7c2e3d268708b`, `653c521d3fab4ab99237b5ee34297df2`, `effe229ab83b4ada99b53f21da6be3f3` | pairing waiting / approved and Text compose, older headers | `23b1fdbd...`, `443a2bdd...`, `03a00ccd...` |
| `000280748ff74326abcb889d5101c3e7` | empty state without tab bar | `3241560b…` |
| `f04a1836550c42bab81668bf94297569`, `74d01f5c0de24975aa0a790de9fece00` | pairing waiting / approved, older header | `38d00674…`, `653c521d…` |
| `0c348cf5efc440a28e6891c701404a0d`, `cb5821b940e54a358e500564c798c620`, `c08637559dfb4461a26c23a268e9bed5` | detail Images / Files / Files empty with small icons and a text Disconnect button (v2) | `38a4331b...`, `72ed3335...`, `f9fd8a03...` |
| `0ea25c9867dd4afa86f7f60e499a7399` | Images empty, small icons plus text Disconnect (v2) | `432109ac...` |
| `ad67d5f8966c405a92435e2f5a36add6` | Tailscale route with a visible caption (not allowed) | to create (tooltip variant) |
| `919f332856ab417ea5becf551db65a75`, `1dbc2dc330034431a3db5c218b4ebb8c`, `15562c610e2847d3b6d6f0a134caec2c`, `6db95cecea1a4e9699069af38910a600`, `cf4a3d9d19884fdaab60bb83fd822ea9`, `9e078367c2a34073b109bc087ee163b2` | laptop detail with "Connected" text status | the versions in the table above |
| `6e4972e7b12f4364821c30c1ca0ec070`, `c9c2e5f2581042da91c92a2a23463b68` | first "Transfer tab" chat screens (the connected Transfer tab is now the laptop detail screen) | `b32a29cf…` |
| `0942bf00…`, `aea1788c…`, `28a1a8cc…`, `99fb96d5…`, `44767cb2…`, `7f5a773f…` | generated SVG illustrations (broken link, scanning, logo mark, empty images, empty files, shield); they are assets used by screens, not screens | keep |

## Prompts

Every screen was generated with the same structure (Stitch skill "Prompt Enhancement Pipeline"):

```
[vibe: what the screen is, calm/technical/trustworthy, not playful, device and size]

DESIGN SYSTEM (REQUIRED):
- Palette: <tokens from .stitch/DESIGN.md with hex and role>
- Styles: 12px rounded cards and buttons, pill chips, 1px hairline borders, flat surfaces, glow only on ...
- Rules: no emojis. Use ONLY the texts listed below. Do NOT add extra subtitles, badges, ports, protocol names or versions.

PAGE STRUCTURE:
1. Top app bar: ...
2. ... numbered components with the exact copy
N. Bottom tab bar (Material 3 navigation bar) with exactly three tabs: Devices, Transfer, Settings (<active> highlighted)
```

The "Use ONLY the texts listed" rule matters: without it Stitch invents plausible technical labels (mDNS, ports, version strings) that contradict the spec.

Per-screen content (all copy is exactly as designed; see the PNGs):

- **Devices list:** three laptop cards (`MITHLESH-PC` Wi-Fi 192.168.1.6 connected; `Studio-Laptop` Tailscale 100.101.102.103 paired; `Office-Desktop` Wi-Fi 192.168.1.22 not paired with "Needs approval on the laptop"), hint "Pull down to scan again", footer "Can't find your laptop? Add by address".
- **Pairing:** code `482 916`, "Check it matches the code on your laptop, then approve there.", waiting row, "Expires in 1:52", Cancel; outcome screens Approved / Denied / Request expired with Try again / Back to laptops.
- **Laptop detail:** header (name + connection controls), tabs Messages | Images | Files, history grouped Today / Yesterday, extended FAB `New transfer`; Files shows a 45 % transfer with Cancel; offline variant has an amber banner "Offline. Showing saved history." and `Connect to send`.
- **New transfer:** sheet "What do you want to send?" with Image ("Choose from your gallery or take a photo."), Text ("Write a message or paste a link."), Document ("Send any file from your phone."); then the Send text compose screen.
- **Settings:** phone name (`Pixel 7`), paired laptops with Re-pair / Forget, Appearance (System / Dark / Light), Connection (auto-reconnect, "Scan again for laptops"), About (version, documentation).
- **Laptop UI:** sidebar (logo, Dashboard, Approvals badge, Devices, host + Running); Dashboard (addresses with route chips, Send to phone, Shared items, collapsible "Can't connect from your phone?" with `scripts\allow-firewall.ps1` and the rule scope TCP 8765 / UDP 8766 for the local subnet and 100.64.0.0/10); Approvals; Devices (last seen, route, Connected dot, Revoke, "3 of 20 devices").

## How to regenerate or change a screen

1. Use the Stitch MCP tools (`generate_screen_from_text` with `designSystem: assets/11926690439085629516`; `deviceType` `MOBILE` or `DESKTOP`).
2. Put **all** changes in **one** initial prompt (see the notes below).
3. Export: the screenshot URL from `get_screen` / the generate result plus a size suffix: `<url>=w780` (mobile artboards) or `<url>=w2560` (desktop and phone-in-canvas mockups). The HTML export is in the `htmlCode.downloadUrl` of the same result.
4. Save as `docs/design/screens/<platform>-<name>.png`, update the table above and the CHANGELOG.

## Notes on Stitch behaviour (read before editing)

- **`edit_screens` does not persist.** It reports success and returns DOM operations, but the stored HTML and screenshot keep the same file ids and content. Three edits made this way (tab bar on three screens, cleanup of invented details) had to be redone by regenerating.
- **`generate_variants` persists only the first change.** A variant with several changes kept the first (removing invented details) and dropped the follow-up step (adding icons). Single-change variants work (colour scheme, one header change); multi-change work should be a fresh `generate_screen_from_text`.
- **`generate_variants` returns one variant per call**, even when several screens are selected.
- **Parallel generation is unreliable:** results were returned but the project listing lagged for many minutes. Generate one screen per call. `list_screens` and the project canvas are eventually consistent (screens can be missing for a while after generation, then appear).
- Some generations come back as a phone mockup on a 2560×2048 artboard tagged `DESKTOP` instead of a native 780×1830 mobile artboard. The content is the same; the PNGs are exported at the size the artboard has.
- The generator adds a default bottom navigation bar and invented technical details unless told not to; the prompt rules above prevent this.
- Long-running generations can time out; the screen usually still completes and shows up in `list_screens` later. Do not retry immediately.
