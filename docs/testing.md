# Testing

Automated checks and the manual checklists. Each part of the project has its own section.

## Windows shell (laptop side)

### Automated: `cd server && npm test`

The suite runs in a few seconds and covers the server (unit tests, the HTTP APIs, and end-to-end over real TLS) and the Windows shell:

| Area | What is checked |
|---|---|
| lifecycle | states starting / running / degraded / stopped, a taken port becomes `degraded` with the reason, graceful stop finishes a running upload, a forced stop aborts it and leaves no `.part` file |
| tray protocol | JSON-line encode/decode (split chunks, garbage, oversize), the menu model for every state, sanitised labels, tooltip length |
| tray controller | with a **fake** child process: spawn arguments (argument array, no shell), messages, click routing, unknown ids ignored, stop and kill |
| tray script and icons | `tray.ps1` **read as text**: messages treated as data, stdin read with `ReadLineAsync`, no forbidden constructs; the three `.ico` files parsed byte by byte |
| autostart | launcher **text** for paths with spaces, non-ASCII, and every hostile character; install, uninstall and status in a temp folder |
| firewall scripts | **read as text**: exactly TCP 8765 and UDP 8766, only `LocalSubnet` and `100.64.0.0/10`, nothing looser |
| every `.ps1` | none uses runtime compilation, encoded commands, downloads, registry or scheduled-task changes, `netsh`, or starts other programs |
| single instance, desktop | the running-instance check against a real admin API on loopback; browser and Explorer are only ever asked to open `http://127.0.0.1:<port>` and an absolute folder |
| MagicDNS | `tailscale status --json` parsing with fixtures; the address list ordering |
| CLI | argument parsing; install / status / uninstall; start-up and shutdown order with fakes |

**What the automated tests never do:** run PowerShell, WScript/CScript, `netsh` or any script; touch the real Startup folder, Start Menu or firewall; write outside a temp folder; or open a socket on anything but `127.0.0.1` (tests pass `overrides.bindHost = '127.0.0.1'`). Anything that needs the real thing is in the manual checklist below.

### Manual checklist (run these yourself)

Start clean: `cd server`, then `node src\cli.js --status` should say `Start with Windows: off`.

**1. Tray and notification**

1. `npm start`. Expect a FlashPush icon in the notification area within a few seconds (it may be under the "^" overflow arrow) and `FlashPush is running.` in the terminal.
2. Hover the icon: tooltip `FlashPush: Running`. Right-click: the items listed in [setup.md](setup.md), in that order; **Pending approvals** is absent.
3. **Open FlashPush** opens `http://127.0.0.1:8760/` in your browser. **Paired devices** does the same. **Open received files** opens `Downloads\FlashPush` in Explorer.
4. From a phone (or anything that can call the API), send a pairing request. Expect a balloon "`<phone> wants to connect, code 123 456`", the menu now shows **Pending approvals (1)**, and clicking the balloon opens the admin page.
5. Approve or deny on the admin page: the **Pending approvals** item disappears.

**2. Stop and relaunch**

1. Right-click, **Stop FlashPush**. Expect the icon to disappear and the terminal process to end within about 5 seconds; `http://127.0.0.1:8760` no longer answers.
2. Start again with `npm start`: works, the previous pairings are still listed.
3. With FlashPush running, run `npm start` again in a second terminal: it prints `FlashPush is already running: opening its page.`, opens the admin page, and exits. Still exactly one tray icon.

**3. Port in use (degraded)**

1. Stop FlashPush. In a terminal, hold the port: `node -e "require('net').createServer().listen(8765,'0.0.0.0');setInterval(()=>{},1000)"`.
2. `npm start`. Expect the server to start anyway, the tray tooltip and status line to read **Degraded - Port 8765 is used by another program.**, an amber icon, and the admin page to still work (its state shows the same reason).
3. Press Ctrl+C in the first terminal to release the port; restart FlashPush: **Running**, normal icon.

**4. Start with Windows**

1. Tray menu: tick **Start with Windows** (or `node src\cli.js --install-autostart`). `node src\cli.js --status` says `on`. Two files exist: `FlashPush.vbs` in the Startup folder (`Win+R`, `shell:startup`) and in the Start Menu programs folder (`shell:programs`). Open one in Notepad and read it: it must only start `node.exe` hidden.
2. **Sign out and sign in.** Expect the tray icon to appear by itself, no console window, and the admin page to answer.
3. **Restart the PC.** Same result after signing in.
4. Choose **Stop FlashPush**, then start it from the **Start menu** (search "FlashPush"): it comes back with the tray icon.
5. Untick **Start with Windows**: both files are gone; after the next sign-in FlashPush does not start.

**5. Firewall rule** (needs an administrator PowerShell)

1. Before running the script, try to connect from a phone on the same Wi-Fi: it should fail (or work only if you had already allowed Node.js).
2. `powershell -ExecutionPolicy Bypass -File scripts\allow-firewall.ps1`. Then `Get-NetFirewallRule -Group FlashPush | Get-NetFirewallPortFilter` shows TCP 8765 and UDP 8766, and `... | Get-NetFirewallAddressFilter` shows `LocalSubnet` and `100.64.0.0/10` as the remote addresses: nothing else.
3. Run the script a second time: still exactly two rules.
4. The phone now connects over Wi-Fi; with Tailscale on both devices and the phone off the Wi-Fi, it connects through the Tailscale address (or the MagicDNS name).
5. `scripts\remove-firewall.ps1`: the group is gone, and the phone can no longer reach the laptop.

**6. Sleep, network changes, crashes**

1. Close the laptop lid or choose Sleep, wake it: the tray icon is still there, the phone reconnects, transfers work.
2. Switch Wi-Fi networks, or turn Tailscale off and on: the admin page's address list updates within a minute; the phone reconnects from its saved addresses.
3. In Task Manager end the `node.exe` process running FlashPush: the tray icon disappears within a second or two (it exits when Node goes away). Start FlashPush again: it works, and no stale icon remains.
4. In Task Manager end only the `powershell.exe` tray process: the server keeps running (`http://127.0.0.1:8760` answers); restarting FlashPush brings the tray back.

### Antivirus notes

Behaviour-based scanners can flag a program that starts a hidden PowerShell script or adds a Startup entry. If your antivirus reacts while you run the checklist:

- The scripts involved are plain text files in the repository: `server/tray/tray.ps1` (the tray icon), `scripts/allow-firewall.ps1` and `remove-firewall.ps1` (two firewall rules), and the launcher text written by `server/src/autostart.js`. Read them first; they compile nothing, download nothing and change no settings apart from the two things you asked for (a Startup entry, the firewall rules).
- `node.exe` starts PowerShell with `-ExecutionPolicy Bypass` for that one process only, because the scripts are unsigned; this is the most likely trigger.
- Do not switch the antivirus off. If you decide the code is trustworthy, exclude **only this project folder**, and only after you have reviewed it.
- The automated `npm test` is designed not to trigger any of this: it never starts PowerShell or scripts.
