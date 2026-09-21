'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The firewall scripts are never executed by the automated tests: they change Windows Firewall and
// need an administrator (see docs/setup.md and docs/testing.md). These checks only read the text so
// nobody can quietly loosen what the rule opens.
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const TRAY = path.join(__dirname, '..', 'tray');
const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
const code = (name) => read(name).replace(/^\s*#.*$/gm, '');

// What no FlashPush script may ever do. Heuristic virus scanners react to exactly these constructs,
// and none of them is needed: the scripts are plain text that only draws icons, shows a tray icon
// and adds/removes two firewall rules.
const FORBIDDEN = [
  [/Add-Type\s+(?!-AssemblyName)/i, 'runtime compilation (Add-Type -TypeDefinition / -MemberDefinition)'],
  [/Invoke-Expression|\biex\b/i, 'Invoke-Expression'],
  [/-EncodedCommand|-enc\b|FromBase64String/i, 'encoded commands / base64'],
  [/Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile|WebClient|Start-BitsTransfer|\bcurl\b|\bwget\b/i, 'downloads'],
  [/Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|\breg(\.exe)?\s+(add|delete)|HKLM:|HKCU:|HKEY_/i, 'registry changes'],
  [/schtasks|Register-ScheduledTask|New-ScheduledTask|Set-ScheduledTask/i, 'scheduled tasks'],
  [/\bnetsh\b/i, 'netsh'],
  [/Start-Process|Invoke-Command|Invoke-Item|\[scriptblock\]::Create/i, 'starting other programs or building code'],
  [/\[(System\.)?Reflection\.Assembly\]::(Load|LoadFrom|LoadFile)|\.CreateInstance\(|DllImport|Add-MpPreference|Set-MpPreference|Set-ExecutionPolicy/i, 'assembly loading, P/Invoke or changing security settings'],
];

const scriptFiles = () => [
  ...fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.ps1')).map((f) => path.join(SCRIPTS, f)),
  ...fs.readdirSync(TRAY).filter((f) => f.endsWith('.ps1')).map((f) => path.join(TRAY, f)),
];

test('every PowerShell script in the repository is free of the constructs scanners flag', () => {
  const files = scriptFiles();
  assert.ok(files.length >= 4, 'found the tray, icon and firewall scripts');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\s*#.*$/gm, '').replace(/<#[\s\S]*?#>/g, '');
    for (const [pattern, what] of FORBIDDEN) {
      assert.doesNotMatch(text, pattern, `${path.basename(file)} must not use ${what}`);
    }
  }
});

test('the only Add-Type in the repository loads framework assemblies', () => {
  for (const file of scriptFiles()) {
    const uses = fs.readFileSync(file, 'utf8').replace(/^\s*#.*$/gm, '').match(/Add-Type[^\n]*/g) || [];
    for (const line of uses) assert.match(line, /^Add-Type -AssemblyName System\.(Windows\.Forms|Drawing)\s*$/);
  }
});

test('allow-firewall.ps1 needs an administrator and keeps one rule group', () => {
  const text = code('allow-firewall.ps1');
  assert.match(read('allow-firewall.ps1'), /^#Requires -RunAsAdministrator/m);
  assert.match(text, /-Group\s+\$Group/);
  assert.match(text, /\$Group\s*=\s*'FlashPush'/);
});

test('allow-firewall.ps1 opens exactly TCP 8765 and UDP 8766, inbound, allow', () => {
  const text = code('allow-firewall.ps1');
  assert.match(text, /\[int\]\$DevicePort\s*=\s*8765/);
  assert.match(text, /\[int\]\$DiscoveryPort\s*=\s*8766/);
  assert.equal((text.match(/New-NetFirewallRule/g) || []).length, 2, 'two rules: a rule holds one protocol');
  assert.match(text, /-Protocol\s+TCP\s+-LocalPort\s+\$DevicePort/);
  assert.match(text, /-Protocol\s+UDP\s+-LocalPort\s+\$DiscoveryPort/);
  assert.equal((text.match(/-Direction\s+Inbound/g) || []).length, 2);
  assert.equal((text.match(/-Action\s+Allow/g) || []).length, 2);
  assert.doesNotMatch(text, /-Action\s+(Block|Bypass)/i);
});

test('allow-firewall.ps1 only admits the local subnet and the Tailscale range', () => {
  const text = code('allow-firewall.ps1');
  assert.match(text, /\$Remote\s*=\s*@\('LocalSubnet',\s*'100\.64\.0\.0\/10'\)/);
  assert.equal((text.match(/-RemoteAddress\s+\$Remote/g) || []).length, 2, 'both rules are scoped');
  assert.doesNotMatch(text, /-RemoteAddress\s+(Any|\*|0\.0\.0\.0)/i);
  assert.doesNotMatch(text, /-Program\b|-Service\b|-LocalPort\s+(Any|\*)/i);
});

test('the ports are validated so the script cannot open a low or arbitrary range', () => {
  const text = code('allow-firewall.ps1');
  assert.equal((text.match(/ValidateRange\(1024,\s*65535\)/g) || []).length, 2);
  assert.doesNotMatch(text, /Invoke-Expression|\biex\b|netsh/i);
});

test('allow-firewall.ps1 replaces the group first, so running it twice leaves two rules', () => {
  const text = code('allow-firewall.ps1');
  assert.ok(text.indexOf('Remove-NetFirewallRule') < text.indexOf('New-NetFirewallRule'));
});

test('remove-firewall.ps1 removes only the FlashPush group', () => {
  const text = code('remove-firewall.ps1');
  assert.match(text, /\$Group\s*=\s*'FlashPush'/);
  assert.match(text, /Remove-NetFirewallRule\s+-Group\s+\$Group/);
  assert.doesNotMatch(text, /-All\b|\*/);
  assert.doesNotMatch(text, /New-NetFirewallRule|Set-NetFirewall/);
});
