# Development safety: antivirus and local security

FlashPush is developed on machines with security software (Kaspersky in the maintainer's case). Some things a build or test can do look exactly like malware to a behavior scanner, so this project avoids them by rule and enforces the rule in code.

## What triggered it

On 2026-09-22 Kaspersky's System Watcher blocked the test file `server/test/tray.test.js` (`PDM:Exploit.Win32.Generic`, a generic behavior detection), and earlier a leftover demo server listening on every network interface caused warnings. The files were reviewed: the tray script is static and does nothing with received data, and the test used a fake `spawn`. Scanners still react to the *shape* of the activity:

| Pattern | Why scanners dislike it |
|---|---|
| `node.exe` starting `powershell.exe -ExecutionPolicy Bypass -File …` | common malware launch chain |
| `Add-Type -TypeDefinition` (C# compiled at runtime by PowerShell) | in-memory code generation |
| VBS run by `wscript`/`cscript`, `mshta`, `rundll32`, `regsvr32`, `certutil`, `bitsadmin` | script hosts and living-off-the-land tools |
| `netsh`, `schtasks`, registry edits, files in the Startup folder | persistence and firewall changes |
| a new program listening on `0.0.0.0` or answering UDP broadcasts | looks like a backdoor or scanner |

## The rules

1. **Tests never launch those programs.** Test the pure logic (message formats, menu models, generated script *text*) with an injected fake `spawn`. `server/test/guard.js` is loaded before every test by `npm test` (`node --import ./test/guard.js`): any real `spawn`/`exec`/`execFile` (sync, callback or promisified) of `powershell`, `pwsh`, `wscript`, `cscript`, `mshta`, `netsh`, `schtasks`, `regsvr32`, `rundll32`, `certutil`, `bitsadmin` or `msiexec` throws, and `guard.test.js` proves it. A human at a terminal can override deliberately with `FLASHPUSH_ALLOW_SCRIPTS=1`.
2. **No runtime code generation in shipped scripts.** PowerShell scripts under `server/tray/` and `scripts/` must not use `Add-Type -TypeDefinition`, `Invoke-Expression`, `-EncodedCommand`, downloads, registry or scheduled-task changes. Loading framework assemblies (`Add-Type -AssemblyName`) is fine.
3. **Test servers bind `127.0.0.1` only**, use ephemeral ports, and are stopped when the test ends. Screenshot or demo servers are started for the length of one task and stopped after it; no server is left running in the background.
4. **Nothing changes the machine by itself.** The autostart entry, Start Menu shortcut and firewall rule are explicit user steps documented in `docs/setup.md`; tests and agents never create them (use temp folders and pure generators in tests).
5. **Review before running.** Code written by an assistant is read and searched for the patterns above before it is executed on a real machine:

```
git grep -nE "Add-Type -TypeDefinition|Invoke-Expression|\biex\b|-EncodedCommand|DownloadString|Invoke-WebRequest|wscript|cscript|mshta|netsh|schtasks|reg add|child_process" -- server scripts
```

   Every hit must be explained by a test or a comment.

## Running the real scripts yourself

The real tray, autostart and firewall checks are manual steps in `docs/testing.md`. Run them from an ordinary terminal so you see what happens. All scripts are plain text in this repository; read them first.

## If your antivirus alerts

1. Read the alert's **object path and name** (which file or process).
2. Open that file in the repository and read it. If it is generated output or a build tool (Gradle, Dart, Node) you recognise, it is a false positive.
3. Prefer a **narrow exclusion** (the project folder, or one tool) only after reviewing the code; do not turn protection off.
4. Send the alert details to the maintainer so the pattern can be avoided in code.
