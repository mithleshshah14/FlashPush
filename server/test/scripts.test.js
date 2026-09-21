'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The firewall scripts are never executed by the automated tests: they change Windows Firewall and
// need an administrator (see docs/setup.md and docs/testing.md). These checks only read the text so
// nobody can quietly loosen what the rule opens.
const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
const code = (name) => read(name).replace(/^\s*#.*$/gm, '');

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
