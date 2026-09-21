# Quickstart: your first end-to-end test

About 10 minutes. You need: this laptop (Windows, Node.js 22+), an Android phone with USB debugging (or an existing way to install an APK), and both on the same Wi-Fi.

## 1. Start the laptop side

```
cd server
npm install
npm start
```

`npm start` runs the server **with the tray icon**. The first time, Windows asks whether to allow Node.js through the firewall: choose **Private networks**. (Prefer no tray? `npm run start:headless`.)

Open the address it prints, `http://127.0.0.1:8760`. That is the admin page (this laptop only): Dashboard, Approvals, Devices.

## 2. Install the phone app

Build once (about 4 minutes) and install:

```
cd app
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Or copy `app-debug.apk` to the phone and open it.

## 3. Pair

1. On the phone open **FlashPush** → **Devices**. Your laptop should appear (if not, pull down to rescan, or use **Add by address** and type the laptop's IP shown on the Dashboard).
2. Tap the **link icon** on the laptop row. The phone shows a 6-digit code.
3. The laptop shows an approval card (and the tray notification). **Only if both codes are identical**, press **Approve**.
4. The link icon turns green: connected.

## 4. Send things

- Phone → laptop: open the laptop and use the center button: on **Messages** it opens the text box, on **Images** the gallery, on **Files** the file explorer. Files land in `Downloads\FlashPush`.
- Laptop → phone: on the Dashboard use **Send to phone** (text or drag a file in). It appears in the phone's Messages / Images / Files tabs.
- Share to FlashPush from any Android app's Share menu.

## 5. Try the safety features

- **Disconnect** with the link icon, then reconnect: no new approval is needed.
- **Revoke** the phone on the laptop's Devices view: the phone is told it is no longer paired.
- Turn Wi-Fi off on the phone with **Tailscale** on: use **Add by address** with the laptop's Tailscale name or `100.x` address (needs the firewall script, see below).

## Optional, one-time, by you

These change your machine, so nothing runs them automatically. Read each script first (they are short plain text):

- **Firewall for Tailscale and Wi-Fi:** `scripts/allow-firewall.ps1` as administrator (opens only TCP 8765 and UDP 8766 to your local subnet and Tailscale).
- **Start with Windows:** tray menu → *Start with Windows*, or `node src/cli.js --install-autostart`.

Full manual checklists: [testing.md](testing.md). Setup details and troubleshooting: [setup.md](setup.md). If your antivirus reacts: [dev-safety.md](dev-safety.md).

## Known gaps

- The Android app has not been run on a real device yet; expect first-run rough edges and report them.
- Camera capture is not built (gallery only); the launcher has no themed (monochrome) icon.
- The rewritten tray script has only had static checks; its first real run is on your machine.
