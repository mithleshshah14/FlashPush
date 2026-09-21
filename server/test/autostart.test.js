'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildLauncher, installAutostart, uninstallAutostart, autostartStatus } = require('../src/autostart');
const { tmpDir } = require('./helpers/tmp');

const good = {
  nodeExe: 'C:\\Program Files\\nodejs\\node.exe',
  script: 'C:\\Users\\Me\\My App\\server\\src\\cli.js',
  workDir: 'C:\\Users\\Me\\My App\\server',
};

// Automated tests only build launcher TEXT and write it under a temp folder.
// Nothing here runs wscript/cscript or touches the real Startup folder (see docs/testing.md for the manual run).

test('the launcher runs node hidden, with the paths quoted for VBScript', () => {
  const text = buildLauncher(good);
  assert.match(text, /^' FlashPush launcher/);
  assert.match(text, /CreateObject\("WScript\.Shell"\)/);
  assert.match(text, /shell\.CurrentDirectory = "C:\\Users\\Me\\My App\\server"/);
  assert.match(
    text,
    /shell\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Users\\Me\\My App\\server\\src\\cli\.js""", 0, False/,
  );
  assert.equal(text.includes('\r\n'), true);
});

test('non-ASCII folder names are kept', () => {
  const text = buildLauncher({ ...good, workDir: 'C:\\Users\\Zoë\\server' });
  assert.match(text, /Zoë/);
});

test('paths that could break out of the command line are refused', () => {
  const refuse = (patch, why) => assert.throws(() => buildLauncher({ ...good, ...patch }), /path|extension|absolute/i, why);
  refuse({ nodeExe: 'C:\\a"b\\node.exe' }, 'double quote');
  refuse({ script: 'C:\\a\\100%\\cli.js' }, 'percent (environment expansion)');
  refuse({ workDir: 'C:\\a\nb' }, 'newline');
  refuse({ workDir: 'C:\\a\rb' }, 'carriage return');
  refuse({ script: 'C:\\a\\b<c>\\cli.js' }, 'angle brackets');
  refuse({ script: 'C:\\a\\b|c\\cli.js' }, 'pipe');
  refuse({ script: 'C:\\a\\b*\\cli.js' }, 'wildcard');
  refuse({ script: 'C:\\a\\b?\\cli.js' }, 'question mark');
  refuse({ nodeExe: 'C:\\a\u0000b\\node.exe' }, 'NUL');
  refuse({ nodeExe: 'node.exe' }, 'relative');
  refuse({ script: '..\\cli.js' }, 'relative');
  refuse({ workDir: '\\\\server\\share' }, 'UNC');
  refuse({ nodeExe: 'C:\\tools\\node.cmd' }, 'not an .exe');
  refuse({ script: 'C:\\app\\cli.vbs' }, 'not a .js');
  refuse({ nodeExe: undefined }, 'missing');
  refuse({ script: 42 }, 'not a string');
});

function appDataFolders(root) {
  return {
    startup: path.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'FlashPush.vbs'),
    startMenu: path.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FlashPush.vbs'),
  };
}

test('install writes the launcher (UTF-16 with BOM) to the Startup folder and the Start Menu', (t) => {
  const appData = tmpDir(t);
  const result = installAutostart({ ...good, appData });
  assert.deepEqual(result, appDataFolders(appData));
  for (const file of Object.values(result)) {
    const bytes = fs.readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'UTF-16LE byte order mark');
    assert.equal(bytes.subarray(2).toString('utf16le'), buildLauncher(good));
  }
});

test('install is idempotent and replaces an older launcher', (t) => {
  const appData = tmpDir(t);
  installAutostart({ ...good, appData });
  installAutostart({ ...good, workDir: 'C:\\Other\\server', script: 'C:\\Other\\server\\src\\cli.js', appData });
  const startup = appDataFolders(appData).startup;
  assert.match(fs.readFileSync(startup).subarray(2).toString('utf16le'), /C:\\Other\\server\\src\\cli\.js/);
});

test('status reports whether start with Windows is on', (t) => {
  const appData = tmpDir(t);
  assert.deepEqual(autostartStatus({ appData }), { enabled: false, startMenu: false });
  installAutostart({ ...good, appData });
  assert.deepEqual(autostartStatus({ appData }), { enabled: true, startMenu: true });
  fs.rmSync(appDataFolders(appData).startMenu);
  assert.deepEqual(autostartStatus({ appData }), { enabled: true, startMenu: false });
});

test('uninstall removes both files, tolerates absence and leaves other files alone', (t) => {
  const appData = tmpDir(t);
  const { startup } = installAutostart({ ...good, appData });
  const neighbour = path.join(path.dirname(startup), 'Other.lnk');
  fs.writeFileSync(neighbour, 'x');
  uninstallAutostart({ appData });
  uninstallAutostart({ appData });
  assert.deepEqual(autostartStatus({ appData }), { enabled: false, startMenu: false });
  assert.equal(fs.existsSync(neighbour), true);
});

test('a bad path is rejected before anything is written', (t) => {
  const appData = tmpDir(t);
  assert.throws(() => installAutostart({ ...good, script: 'C:\\a"b\\cli.js', appData }));
  assert.deepEqual(fs.readdirSync(appData), []);
});

test('without an explicit folder the real %APPDATA% is required, and its absence is an error (never a guess)', (t) => {
  const saved = process.env.APPDATA;
  delete process.env.APPDATA;
  t.after(() => {
    if (saved !== undefined) process.env.APPDATA = saved;
  });
  assert.throws(() => installAutostart(good), /APPDATA/);
  assert.throws(() => uninstallAutostart({}), /APPDATA/);
  assert.throws(() => autostartStatus({}), /APPDATA/);
});
