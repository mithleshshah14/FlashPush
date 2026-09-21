'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { parseArgs, runCommand, runApp } = require('../src/cli');
const { tmpDir } = require('./helpers/tmp');

test('parseArgs: no arguments means run with the tray', () => {
  assert.deepEqual(parseArgs([]), { command: 'run', tray: true });
});

test('parseArgs: flags select one command; --no-tray only changes how run behaves', () => {
  assert.deepEqual(parseArgs(['--no-tray']), { command: 'run', tray: false });
  assert.deepEqual(parseArgs(['--install-autostart']), { command: 'install-autostart', tray: true });
  assert.deepEqual(parseArgs(['--uninstall-autostart']), { command: 'uninstall-autostart', tray: true });
  assert.deepEqual(parseArgs(['--status']), { command: 'status', tray: true });
  assert.deepEqual(parseArgs(['--help']), { command: 'help', tray: true });
});

test('parseArgs: unknown options and combined commands are errors, never guessed', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown option: --nope/);
  assert.throws(() => parseArgs(['--install-autostart', '--status']), /one command/i);
  assert.throws(() => parseArgs(['--install-autostart', '--no-tray']), /--no-tray/);
  assert.throws(() => parseArgs(['status']), /Unknown option/);
});

const paths = { nodeExe: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\FlashPush\\server\\src\\cli.js', workDir: 'C:\\FlashPush\\server' };

test('install, status and uninstall drive the launcher files (in a temp folder, never the real Startup folder)', (t) => {
  const appData = tmpDir(t);
  const logs = [];
  const deps = { paths, appData, log: (m) => logs.push(m) };

  assert.equal(runCommand('status', deps), 0);
  assert.match(logs.at(-1), /Start with Windows: off/);

  assert.equal(runCommand('install-autostart', deps), 0);
  assert.match(logs.at(-1), /Start with Windows is on/);
  assert.equal(fs.existsSync(`${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\FlashPush.vbs`), true);

  runCommand('status', deps);
  assert.match(logs.at(-1), /Start with Windows: on/);

  assert.equal(runCommand('uninstall-autostart', deps), 0);
  assert.match(logs.at(-1), /Start with Windows is off/);
  runCommand('status', deps);
  assert.match(logs.at(-1), /Start with Windows: off/);
});

test('install reports a bad path as an error instead of writing anything', (t) => {
  const appData = tmpDir(t);
  const logs = [];
  const code = runCommand('install-autostart', { paths: { ...paths, script: 'C:\\a"b\\cli.js' }, appData, log: (m) => logs.push(m) });
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /plain absolute Windows path/);
  assert.deepEqual(fs.readdirSync(appData), []);
});

// ---- runApp with fakes: no sockets, no PowerShell ----

function fakeApp(status = { state: 'running', reason: null }) {
  const order = [];
  const app = {
    order,
    bus: new EventEmitter(),
    pairing: Object.assign(new EventEmitter(), { listPending: () => [] }),
    lifecycle: { status: () => status },
    config: { receiveDir: 'C:\\Downloads\\FlashPush' },
    ports: () => ({ device: 8765, admin: 8760, discovery: 8766 }),
    start: async (options) => {
      order.push(['app.start', options]);
    },
    stop: async () => {
      order.push(['app.stop']);
    },
  };
  return app;
}

function fakeTray(app, { starts = true } = {}) {
  return {
    updates: [],
    start: () => {
      app.order.push(['tray.start']);
      return starts;
    },
    update(m) {
      this.updates.push(m);
    },
    notify() {},
    stop: async () => {
      app.order.push(['tray.stop']);
    },
  };
}

const fakeDesktop = { openUrl: () => true, openFolder: () => true };
const fakeAutostart = { isEnabled: () => false, set() {} };

test('runApp starts tolerantly, then the tray, and the tray gets its first menu', async () => {
  const app = fakeApp();
  const tray = fakeTray(app);
  await runApp({ app, createTrayFn: () => tray, desktop: fakeDesktop, autostart: fakeAutostart, log: () => {}, exit: () => {} });
  assert.deepEqual(app.order.map((o) => o[0]), ['app.start', 'tray.start']);
  assert.deepEqual(app.order[0][1], { tolerant: true });
  assert.equal(tray.updates.length, 1);
});

test('runApp without a tray just runs the server', async () => {
  const app = fakeApp();
  const { shutdown } = await runApp({ app, createTrayFn: null, desktop: fakeDesktop, autostart: fakeAutostart, log: () => {}, exit: () => {} });
  await shutdown();
  assert.deepEqual(app.order.map((o) => o[0]), ['app.start', 'app.stop']);
});

test('a tray that cannot start is logged and the server keeps running', async () => {
  const app = fakeApp();
  const logs = [];
  const tray = fakeTray(app, { starts: false });
  await runApp({ app, createTrayFn: () => tray, desktop: fakeDesktop, autostart: fakeAutostart, log: (m) => logs.push(m), exit: () => {} });
  assert.match(logs.join('\n'), /tray icon could not start/i);
  assert.equal(tray.updates.length, 0);
  assert.equal(app.order.some((o) => o[0] === 'app.stop'), false);
});

test('a degraded start is reported with its reason', async () => {
  const app = fakeApp({ state: 'degraded', reason: 'Port 8765 is used by another program.' });
  const logs = [];
  await runApp({ app, createTrayFn: null, desktop: fakeDesktop, autostart: fakeAutostart, log: (m) => logs.push(m), exit: () => {} });
  assert.match(logs.join('\n'), /Port 8765 is used by another program\./);
});

test('Stop FlashPush in the tray stops the server first, then the tray, then exits once', async () => {
  const app = fakeApp();
  const tray = fakeTray(app);
  const exits = [];
  let onAction;
  await runApp({
    app,
    createTrayFn: (handler) => {
      onAction = handler;
      return tray;
    },
    desktop: fakeDesktop,
    autostart: fakeAutostart,
    log: () => {},
    exit: (code) => exits.push(code),
  });
  onAction('stop');
  onAction('stop'); // a second click while stopping must not stop twice
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(app.order.map((o) => o[0]), ['app.start', 'tray.start', 'app.stop', 'tray.stop']);
  assert.deepEqual(exits, [0]);
});

test('shutdown is idempotent', async () => {
  const app = fakeApp();
  const { shutdown } = await runApp({ app, createTrayFn: null, desktop: fakeDesktop, autostart: fakeAutostart, log: () => {}, exit: () => {} });
  await Promise.all([shutdown(), shutdown()]);
  assert.equal(app.order.filter((o) => o[0] === 'app.stop').length, 1);
});
