'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachTray } = require('../src/shell');

const ADMIN_URL = 'http://127.0.0.1:8760/';

function setup({ status = { state: 'running', reason: null }, pending = [], autostartOn = false } = {}) {
  const app = {
    bus: new EventEmitter(),
    pairing: Object.assign(new EventEmitter(), { listPending: () => app.pending }),
    lifecycle: { status: () => app.status },
    config: { receiveDir: 'C:\\Users\\Me\\Downloads\\FlashPush' },
    status,
    pending,
  };
  const tray = { updates: [], notes: [], update: (m) => tray.updates.push(m), notify: (t, b) => tray.notes.push([t, b]) };
  const desktop = { urls: [], folders: [], openUrl: (u) => desktop.urls.push(u), openFolder: (d) => desktop.folders.push(d) };
  const autostart = {
    enabled: autostartOn,
    sets: [],
    isEnabled: () => autostart.enabled,
    set(value) {
      autostart.sets.push(value);
      autostart.enabled = value;
    },
  };
  const stops = [];
  const logs = [];
  const shell = attachTray({ app, tray, autostart, desktop, adminUrl: ADMIN_URL, onStop: () => stops.push('stop'), log: (m) => logs.push(m) });
  return { app, tray, desktop, autostart, stops, logs, shell };
}

const ids = (model) => model.items.filter((i) => i.id).map((i) => i.id);

test('attaching sends the first menu straight away', () => {
  const { tray } = setup();
  assert.equal(tray.updates.length, 1);
  assert.equal(tray.updates[0].icon, 'running');
  assert.deepEqual(ids(tray.updates[0]), ['status', 'open', 'devices', 'files', 'autostart', 'stop']);
});

test('a change signal refreshes the menu with the new status and pending count, and repeats are not resent', () => {
  const { app, tray } = setup();
  app.bus.emit('changed');
  assert.equal(tray.updates.length, 1, 'nothing changed, nothing sent');

  app.status = { state: 'degraded', reason: 'Port 8765 is used by another program.' };
  app.pending = [{}, {}];
  app.bus.emit('changed');
  assert.equal(tray.updates.length, 2);
  assert.equal(tray.updates[1].icon, 'degraded');
  assert.ok(ids(tray.updates[1]).includes('approvals'));
  assert.equal(tray.updates[1].items.find((i) => i.id === 'approvals').label, 'Pending approvals (2)');
});

test('a new pairing request shows a balloon with the phone and its code', () => {
  const { app, tray } = setup();
  app.pairing.emit('pending', { deviceName: 'Pixel 7', sasDisplay: '482 916' });
  assert.deepEqual(tray.notes, [['FlashPush', 'Pixel 7 wants to connect, code 482 916']]);
});

test('open, approvals and devices open the admin page; files opens the receive folder', () => {
  const { shell, desktop } = setup();
  shell.onAction('open');
  shell.onAction('approvals');
  shell.onAction('devices');
  shell.onAction('files');
  assert.deepEqual(desktop.urls, [ADMIN_URL, ADMIN_URL, ADMIN_URL]);
  assert.deepEqual(desktop.folders, ['C:\\Users\\Me\\Downloads\\FlashPush']);
});

test('the autostart item toggles the setting and refreshes the checkbox', () => {
  const { shell, autostart, tray } = setup();
  shell.onAction('autostart');
  assert.deepEqual(autostart.sets, [true]);
  assert.equal(tray.updates.at(-1).items.find((i) => i.id === 'autostart').checked, true);
  shell.onAction('autostart');
  assert.deepEqual(autostart.sets, [true, false]);
  assert.equal(tray.updates.at(-1).items.find((i) => i.id === 'autostart').checked, false);
});

test('a failing autostart toggle is logged and does not break the tray', () => {
  const { shell, autostart, logs, tray } = setup();
  autostart.set = () => {
    throw new Error('APPDATA is not set.');
  };
  assert.doesNotThrow(() => shell.onAction('autostart'));
  assert.match(logs.join('\n'), /Start with Windows/);
  assert.ok(tray.updates.length >= 1);
});

test('an unreadable autostart state shows as off instead of failing the menu', () => {
  const { app, autostart, tray } = setup();
  autostart.isEnabled = () => {
    throw new Error('boom');
  };
  app.status = { state: 'stopped', reason: null };
  assert.doesNotThrow(() => app.bus.emit('changed'));
  assert.equal(tray.updates.at(-1).items.find((i) => i.id === 'autostart').checked, false);
});

test('stop calls onStop; unknown actions are ignored', () => {
  const { shell, stops, desktop } = setup();
  shell.onAction('stop');
  shell.onAction('rm -rf');
  shell.onAction(undefined);
  assert.deepEqual(stops, ['stop']);
  assert.deepEqual(desktop.urls, []);
});

test('detach stops listening', () => {
  const { app, tray, shell } = setup();
  shell.detach();
  app.status = { state: 'stopped', reason: null };
  app.bus.emit('changed');
  app.pairing.emit('pending', { deviceName: 'x', sasDisplay: '111 111' });
  assert.equal(tray.updates.length, 1);
  assert.deepEqual(tray.notes, []);
});
