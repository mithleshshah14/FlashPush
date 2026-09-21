# Setup (laptop)

How to install, start and connect FlashPush on Windows. Design background: [architecture.md](architecture.md), [security.md](security.md).

## Requirements

- Windows 10 or 11 and Node.js 22 or newer.
- A phone on the **same Wi-Fi**, or both devices on the same **Tailscale** network.
- No administrator rights, except for the one-time firewall step below.

## Install and run

```
cd server
npm install
npm start                  # server + tray icon
npm run start:headless     # server only, no tray icon
```

`npm start` runs `node src/cli.js`. You should see a **FlashPush icon in the notification area** (the tray). Right-click it:

| Menu item | What it does |
|---|---|
| status line | **Running**, **Starting**, **Degraded** (with the reason, for example "Port 8765 is used by another program.") or **Stopped** |
| Open FlashPush | opens the admin page in your browser (`http://127.0.0.1:8760`, this laptop only) |
| Pending approvals (n) | shown only when a phone is waiting; opens the admin page |
| Paired devices | opens the admin page |
| Open received files | opens `Downloads\FlashPush` in Explorer |
| Start with Windows | checkbox: starts FlashPush hidden when you sign in |
| Stop FlashPush | stops the server (running transfers get up to 5 s to finish) and removes the icon |

When a phone asks to pair, a balloon appears: **"Pixel 7 wants to connect, code 482 916"**. Click it to open the page, compare the code with the phone, and only then approve.

Starting FlashPush a second time does not start a second server: it opens the admin page of the running one and exits.

## Start with Windows

Use the tray checkbox, or the command line (from the `server` folder):

```
node src\cli.js --install-autostart      # turn on
node src\cli.js --status                 # prints: Start with Windows: on / off
node src\cli.js --uninstall-autostart    # turn off
```

What it does, exactly:

- writes one small text file, `FlashPush.vbs`, to your **Startup folder** (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) and a copy to the **Start Menu** programs folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs`), so you can also start FlashPush from the Start menu after choosing **Stop**;
- the file runs `node.exe src\cli.js` with a hidden window, in the project folder;
- it records the paths of `node.exe` and of the project at the time you turned it on: **turn it off and on again after moving the project or changing your Node.js installation**;
- it needs no administrator rights, changes no registry entry and creates no scheduled task. Turning it off deletes the two files; you can also delete them by hand.

You can read the file: it is plain text (open it in Notepad).

## Windows Firewall (once)

Windows blocks incoming connections from your phone until you allow them. Run **once**, in an **administrator PowerShell** (right-click Start, "Terminal (Admin)"), from the repository folder:

```
powershell -ExecutionPolicy Bypass -File scripts\allow-firewall.ps1
```

It adds two inbound rules in the group **FlashPush** (running it again replaces them, never duplicates):

| Rule | Protocol and port | Accepts connections from |
|---|---|---|
| FlashPush (TCP 8765) | TCP 8765: the phone API (HTTPS) | your local subnet, and `100.64.0.0/10` (Tailscale) |
| FlashPush (UDP 8766) | UDP 8766: finding the laptop | your local subnet, and `100.64.0.0/10` (Tailscale) |

Nothing else is opened: no other ports, no other remote addresses, no program or service wildcard, and every connection still needs an approved device. If you changed a port in `config.json`, pass it: `-DevicePort 9000 -DiscoveryPort 9001`. To undo: `scripts\remove-firewall.ps1` in an administrator PowerShell, or delete the group "FlashPush" in *Windows Defender Firewall with Advanced Security*.

You can inspect the rules afterwards: `Get-NetFirewallRule -Group FlashPush | Get-NetFirewallAddressFilter`.

## Tailscale (away from your Wi-Fi)

- Install Tailscale on the laptop and the phone and sign in to the **same tailnet** on both.
- The firewall rules above already allow Tailscale's address range (`100.64.0.0/10`); Windows often classes the Tailscale adapter as a public network, which is why the rules apply to **every profile**.
- If the Tailscale command-line tool is installed (`tailscale status --json` works in a terminal), FlashPush also shows this laptop's **MagicDNS name** (for example `mithlesh-pc.tail1234.ts.net`) in its address list, and phones prefer it because it survives IP changes. Without the tool the plain `100.x` address is used.
- UDP discovery does not cross Tailscale. On a new network the phone connects from the saved address list, or you add the laptop by its address once.

## Changing ports or the receive folder

Create `%APPDATA%\FlashPush\config.json`:

```json
{ "ports": { "device": 9000 }, "receiveDir": "D:\\Inbox" }
```

Restart FlashPush, and re-run the firewall script with the new ports.

## Antivirus notes

FlashPush is a small program that listens on your network, shows a tray icon and can start with Windows, so heuristic (behaviour-based) virus scanners may react to it. What actually happens:

- The tray icon is a **plain-text PowerShell script** (`server/tray/tray.ps1`) started by `node.exe` with `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File ...`. `-ExecutionPolicy Bypass` is needed because the script is not digitally signed; it applies to that one process only and changes no setting.
- The script compiles no code, downloads nothing, reads no files except its own icons, and changes no setting. It only talks to `node.exe` over its input and output pipes. The `.vbs` launcher only starts `node.exe`. The firewall scripts only add or remove the two rules above.
- The repository contains automated checks that fail if any script starts using runtime compilation, encoded commands, downloads, registry or scheduled-task changes, `netsh`, or starts other programs (`server/test/scripts.test.js`).

To verify for yourself: every script is a plain text file in this repository: `server/tray/tray.ps1`, `server/tray/build-icons.ps1`, `scripts/allow-firewall.ps1`, `scripts/remove-firewall.ps1`, and the launcher generator `server/src/autostart.js`. Read them before you trust them. If your antivirus still objects, keep any exclusion **limited to this project folder**, and add it only after you have reviewed the code.

## Troubleshooting

| Symptom | Check |
|---|---|
| The tray shows **Degraded: Port 8765 is used by another program** | another program (or a second FlashPush started differently) holds the port. Close it, or set another port in `config.json`. The admin page still works. |
| The phone cannot find or reach the laptop | run the firewall step above; make sure both are on the same Wi-Fi (some routers isolate wireless clients); on the phone use "Add by address" |
| No tray icon | start with `npm start` (not `start:headless`); the tray needs Windows PowerShell 5.1 (`powershell.exe`). The server keeps running without it and prints "The tray icon could not start". |
| No balloon for a pairing request | Windows may have notifications or Focus Assist turned off: open the tray menu instead, "Pending approvals" appears there |
| Start with Windows stopped working after moving the project | run `--uninstall-autostart`, then `--install-autostart` again from the new location |
| A new certificate warning on the phone | the laptop's certificate was recreated (state folder deleted): on the phone choose "Forget and pair again" |

## Troubleshooting: no tray icon, no notifications

| Cause | What to do |
|---|---|
| FlashPush was started **headless** (`npm run start:headless`) | Stop it and run `npm start` (the tray mode). Headless has no tray and no balloons by design. |
| FlashPush is **already running** (for example a headless copy or one started earlier) | A second `npm start` detects the running instance, opens its page and exits without a tray. Stop the running one first (Stop FlashPush in its tray menu, or end the `node.exe` running `src/cli.js`), then start again. |
| Windows **hides tray icons** | Click the ^ next to the clock; drag the FlashPush icon out to keep it visible. |
| **Antivirus blocked** the tray script | The tray is `server/tray/tray.ps1` (plain text, read it first). See [dev-safety.md](dev-safety.md); allow it only after reviewing it. |
| The **site is open** | By design no balloon appears while an admin page is open (the page shows new items live). Close the tab and send again. |
