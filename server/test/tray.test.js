'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createTray } = require('../src/tray');

const TRAY_DIR = path.join(__dirname, '..', 'tray');

/** A stand-in for the PowerShell child: records what Node writes, lets the test speak as the tray. */
function fakeChild() {
  const child = new EventEmitter();
  child.written = [];
  child.stdin = {
    writable: true,
    write: (text) => child.written.push(JSON.parse(text)),
    end() {
      child.stdinEnded = true;
    },
    on() {},
  };
  child.stdout = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };
  child.say = (message) => child.stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`));
  return child;
}

function setup(extra = {}) {
  const child = fakeChild();
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    return child;
  };
  const actions = [];
  const tray = createTray({ spawn, scriptPath: 'C:\\app\\tray\\tray.ps1', iconDir: 'C:\\app\\tray', onAction: (id) => actions.push(id), ...extra });
  return { tray, child, calls, actions };
}

test('starts PowerShell with an argument array, no shell, hidden window, and the script and icon folder', () => {
  const { tray, calls } = setup();
  assert.equal(tray.start(), true);
  const [file, args, options] = calls[0];
  assert.equal(file, 'powershell.exe');
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', 'C:\\app\\tray\\tray.ps1', '-IconDir', 'C:\\app\\tray']);
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, undefined);
});

test('update sends the menu model and notify sends a sanitised balloon', () => {
  const { tray, child } = setup();
  tray.start();
  tray.update({ icon: 'running', tooltip: 'FlashPush: Running', items: [{ id: 'open', label: 'Open FlashPush' }] });
  tray.notify('Pixel 7\n7', `wants to connect, code 482 916${'!'.repeat(400)}`);
  assert.deepEqual(child.written[0], { type: 'menu', icon: 'running', tooltip: 'FlashPush: Running', items: [{ id: 'open', label: 'Open FlashPush' }] });
  assert.equal(child.written[1].type, 'notify');
  assert.equal(child.written[1].title, 'Pixel 7 7');
  assert.ok(child.written[1].body.length <= 255);
  assert.match(child.written[1].body, /^wants to connect, code 482 916/);
});

test('clicks on known menu ids and on the notification are routed; anything else is ignored', () => {
  const { tray, child, actions } = setup();
  tray.start();
  child.say({ type: 'ready' });
  child.say({ type: 'click', id: 'open' });
  child.say({ type: 'click', id: 'stop' });
  child.say({ type: 'notification-click' });
  child.say({ type: 'click', id: 'status' }); // not an action
  child.say({ type: 'click', id: '"; calc' });
  child.say({ type: 'click' });
  child.say({ type: 'weird' });
  child.stdout.emit('data', Buffer.from('not json at all\n'));
  assert.deepEqual(actions, ['open', 'stop', 'approvals']);
});

test('whenReady resolves true when the tray reports ready, false if it exits first', async () => {
  const a = setup();
  a.tray.start();
  const ready = a.tray.whenReady();
  a.child.say({ type: 'ready' });
  assert.equal(await ready, true);

  const b = setup();
  b.tray.start();
  const never = b.tray.whenReady();
  b.child.emit('exit', 1);
  assert.equal(await never, false);
});

test('stop asks the tray to exit and closes its input; the promise resolves when the child exits', async () => {
  const { tray, child } = setup();
  tray.start();
  const stopping = tray.stop();
  assert.deepEqual(child.written.at(-1), { type: 'exit' });
  assert.equal(child.stdinEnded, true);
  child.emit('exit', 0);
  await stopping;
});

test('stop kills a tray that does not exit in time', async () => {
  const { tray, child } = setup({ killAfterMs: 20 });
  tray.start();
  const stopping = tray.stop();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(child.killed, true);
  child.emit('exit', null);
  await stopping;
});

test('after the child exits, update and notify do nothing and stop resolves at once', async () => {
  const { tray, child } = setup();
  tray.start();
  child.emit('exit', 0);
  tray.update({ icon: 'running', tooltip: 't', items: [] });
  tray.notify('a', 'b');
  assert.equal(child.written.length, 0);
  await tray.stop();
});

test('a failing spawn makes start return false without throwing', async () => {
  const tray = createTray({
    spawn: () => {
      throw new Error('ENOENT');
    },
    onAction: () => {},
    log: () => {},
  });
  assert.equal(tray.start(), false);
  assert.equal(await tray.whenReady(), false);
  await tray.stop();
});

test('a child that reports an error does not crash and counts as exited', async () => {
  const { tray, child } = setup({ log: () => {} });
  tray.start();
  child.emit('error', new Error('spawn failed'));
  await tray.stop();
});

// The tray script is never executed by the automated tests (see docs/testing.md for the manual run).
// These checks only read files.
const read = (name) => fs.readFileSync(path.join(TRAY_DIR, name), 'utf8');

// (Forbidden constructs such as runtime compilation, downloads and encoded commands are checked for
// every .ps1 in the repository by scripts.test.js.)
test('tray.ps1 treats messages as data: parsed as JSON, type compared as text', () => {
  const code = read('tray.ps1').replace(/^\s*#.*$/gm, '');
  assert.match(code, /ConvertFrom-Json/);
  assert.match(code, /\[string\]\$message\.type/);
});

test('tray.ps1 reads stdin with a pending ReadLineAsync polled by the UI timer, and exits at end of input', () => {
  const code = read('tray.ps1').replace(/^\s*#.*$/gm, '');
  assert.match(code, /System\.IO\.StreamReader/);
  assert.match(code, /\.ReadLineAsync\(\)/);
  assert.match(code, /\.IsCompleted/);
  assert.match(code, /\$null -eq \$line\)\s*\{\s*Stop-Tray/, 'a null line means stdin closed');
});

test('tray.ps1 only sends the documented messages and only removes its own icon', () => {
  const code = read('tray.ps1');
  const sent = [...code.matchAll(/type\s*=\s*'([a-z-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(sent)], ['click', 'notification-click', 'ready']);
  assert.match(code, /\$tray\.Visible = \$false/);
});

test('the icon generator and glyph source exist next to the icons', () => {
  assert.match(read('build-icons.ps1'), /flashpush-\$name\.ico/);
  assert.match(read('glyph.svg'), /<svg /);
});

/** Reads an .ico directory in plain Node: no PowerShell, no GDI. */
function readIco(file) {
  const bytes = fs.readFileSync(path.join(TRAY_DIR, file));
  assert.equal(bytes.readUInt16LE(0), 0, 'reserved');
  assert.equal(bytes.readUInt16LE(2), 1, 'type is icon');
  const count = bytes.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const width = bytes[at] || 256;
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    entries.push({ width, height: bytes[at + 1] || 256, planes: bytes.readUInt16LE(at + 4), bits: bytes.readUInt16LE(at + 6), png: bytes.subarray(offset, offset + size), size, offset });
  }
  return { bytes, entries };
}

test('the three tray icons are valid multi-size PNG-compressed .ico files', () => {
  for (const state of ['running', 'degraded', 'stopped']) {
    const { bytes, entries } = readIco(`flashpush-${state}.ico`);
    assert.deepEqual(entries.map((e) => e.width), [16, 24, 32, 48, 256], state);
    let expectedOffset = 6 + 16 * entries.length;
    for (const e of entries) {
      assert.equal(e.width, e.height);
      assert.deepEqual([e.planes, e.bits], [1, 32]);
      assert.equal(e.offset, expectedOffset, 'images are stored back to back');
      assert.equal(e.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
      assert.equal(e.png.readUInt32BE(16), e.width, 'PNG width matches the directory');
      expectedOffset += e.size;
    }
    assert.equal(expectedOffset, bytes.length, 'no trailing garbage');
  }
});

test('the three tints are different images', () => {
  const [a, b, c] = ['running', 'degraded', 'stopped'].map((s) => readIco(`flashpush-${s}.ico`).bytes.toString('hex'));
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});
