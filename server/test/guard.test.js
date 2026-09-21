'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { findBlocked } = require('./guard');

const REFUSED = /Tests must not run/;

test('findBlocked recognises the risky programs by name, path and argument', () => {
  assert.equal(findBlocked('powershell.exe', ['-NoProfile']), 'powershell');
  assert.equal(findBlocked('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'powershell');
  assert.equal(findBlocked('cmd.exe', ['/c', 'cscript //nologo x.vbs']), 'cscript');
  assert.equal(findBlocked('wscript'), 'wscript');
  assert.equal(findBlocked('netsh', ['advfirewall']), 'netsh');
  assert.equal(findBlocked('schtasks.exe'), 'schtasks');
  assert.equal(findBlocked('pwsh', []), 'pwsh');
});

test('findBlocked lets ordinary programs through', () => {
  assert.equal(findBlocked(process.execPath, ['-e', '0']), null);
  assert.equal(findBlocked('git', ['status']), null);
  assert.equal(findBlocked('tailscale', ['status', '--json']), null);
  assert.equal(findBlocked(undefined, undefined), null);
});

test('spawning a blocked program throws before anything starts', () => {
  assert.throws(() => childProcess.spawn('powershell', ['-File', 'x.ps1']), REFUSED);
  assert.throws(() => childProcess.spawnSync('pwsh'), REFUSED);
  assert.throws(() => childProcess.execFileSync('C:\\Windows\\System32\\wscript.exe'), REFUSED);
  assert.throws(() => childProcess.execSync('cscript //nologo x.vbs'), REFUSED);
  assert.throws(() => childProcess.exec('netsh advfirewall show allprofiles', () => {}), REFUSED);
  assert.throws(() => childProcess.execFile('schtasks', () => {}), REFUSED);
});

test('the promisified execFile cannot be used to get around the guard', async () => {
  await assert.rejects(promisify(childProcess.execFile)('powershell', ['-NoProfile']), REFUSED);
});

test('normal child processes still work, sync and async', async () => {
  const sync = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(sync.status, 0);
  const { stdout } = await promisify(childProcess.execFile)(process.execPath, ['-e', 'console.log("ok")']);
  assert.equal(stdout.trim(), 'ok');
});
