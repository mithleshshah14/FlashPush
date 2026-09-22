'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installFakeDom, byClass, byTag } = require('./helpers/fake-dom');

installFakeDom();
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'assets', 'views', 'dashboard.js')).href);

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const phones = {
  A: { deviceId: A, name: 'Pixel', connected: true },
  B: { deviceId: B, name: 'Galaxy', connected: false },
};
const NOW = new Date(2026, 8, 22, 15, 30).getTime();

const base = (overrides = {}) => ({
  status: { state: 'running' },
  addresses: [],
  ports: { device: 8765, discovery: 8766 },
  devices: [],
  items: [],
  ...overrides,
});

/** Mounts the view against a stubbed context and returns handles to its parts. */
async function mount(state) {
  const { createDashboard } = await load();
  const calls = { send: [], refresh: 0 };
  const ctx = {
    send: async (method, url, body) => { calls.send.push([method, url, body]); },
    uploadFile: async () => {},
    confirmDialog: async () => true,
    copyText: async () => true,
    refresh: async () => { calls.refresh += 1; },
    announce: () => {},
  };
  const view = createDashboard(ctx);
  view.update(state);
  return { view, calls, card: byClass(view.el, 'card')[2] };
}

test('with no phones paired the devices card says so', async () => {
  const m = await mount(base());
  assert.match(m.card.textContent, /No phones paired yet/);
});

test('shows one row per device, and no message/image/file rows until one is opened', async () => {
  const m = await mount(base({ devices: [phones.A, phones.B] }));
  const rows = byClass(m.card, 'device-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Pixel/);
  assert.match(rows[0].textContent, /Connected/);
  assert.match(rows[1].textContent, /Galaxy/);
  assert.match(rows[1].textContent, /Not connected/);
  assert.equal(byClass(m.card, 'tabbar').length, 0);
});

test('clicking a device opens the three tabs, Messages first', async () => {
  const items = [{ id: '1', kind: 'text', from: 'phone', time: NOW, text: 'hi', deviceId: A }];
  const m = await mount(base({ devices: [phones.A], items }));
  await byClass(m.card, 'device-row')[0].dispatch('click');

  assert.equal(byClass(m.card, 'device-row').length, 0, 'the device list is replaced');
  const tabs = byClass(m.card, 'tab-btn');
  assert.deepEqual(tabs.map((t) => t.textContent), ['Messages', 'Images', 'Files']);
  assert.equal(tabs[0].attributes['aria-current'], 'page');
  assert.match(m.card.textContent, /hi/);
});

test('Images and Files tabs show only that device\'s items, split by mime', async () => {
  const items = [
    { id: 'img', kind: 'file', name: 'photo.jpg', size: 10, mime: 'image/jpeg', deviceId: A, from: 'phone', time: NOW },
    { id: 'doc', kind: 'file', name: 'notes.txt', size: 20, mime: 'text/plain', deviceId: A, from: 'phone', time: NOW },
    { id: 'other', kind: 'file', name: 'other.jpg', size: 10, mime: 'image/jpeg', deviceId: B, from: 'phone', time: NOW },
  ];
  const m = await mount(base({ devices: [phones.A, phones.B], items }));
  await byClass(m.card, 'device-row')[0].dispatch('click');

  const tabs = byClass(m.card, 'tab-btn');
  await tabs[1].dispatch('click');
  assert.match(m.card.textContent, /photo\.jpg/);
  assert.doesNotMatch(m.card.textContent, /notes\.txt/);
  assert.doesNotMatch(m.card.textContent, /other\.jpg/, "another phone's image does not leak in");

  await tabs[2].dispatch('click');
  assert.match(m.card.textContent, /notes\.txt/);
  assert.doesNotMatch(m.card.textContent, /photo\.jpg/);
});

test('the detail header shows the connection status', async () => {
  const m = await mount(base({ devices: [phones.A, phones.B] }));
  await byClass(m.card, 'device-row')[0].dispatch('click');
  assert.match(m.card.textContent, /Connected/);

  await byClass(m.card, 'back-btn')[0].dispatch('click');
  await byClass(m.card, 'device-row')[1].dispatch('click');
  assert.match(m.card.textContent, /Not connected/);
});

test('the Messages tab has a composer that sends to that device', async () => {
  const m = await mount(base({ devices: [phones.A] }));
  await byClass(m.card, 'device-row')[0].dispatch('click');

  const box = byTag(m.card, 'textarea')[0];
  const sendButton = byTag(byClass(m.card, 'composer')[0], 'button')[0];
  box.value = 'hello there';
  await box.dispatch('input');
  assert.equal(sendButton.disabled, false);

  await sendButton.dispatch('click');
  assert.deepEqual(m.calls.send, [['POST', '/admin/text', { deviceId: A, text: 'hello there' }]]);
  assert.equal(m.calls.refresh, 1);
});

test('the back button returns to the device list', async () => {
  const m = await mount(base({ devices: [phones.A] }));
  await byClass(m.card, 'device-row')[0].dispatch('click');
  assert.equal(byClass(m.card, 'device-row').length, 0);

  await byClass(m.card, 'back-btn')[0].dispatch('click');
  assert.equal(byClass(m.card, 'device-row').length, 1);
  assert.equal(byClass(m.card, 'tabbar').length, 0);
});

test('"Clear history" only shows over the device list, and clears via the admin API', async () => {
  const items = [{ id: '1', kind: 'text', from: 'phone', time: NOW, text: 'hi', deviceId: A }];
  const m = await mount(base({ devices: [phones.A], items }));
  const clearButton = byTag(m.card, 'button').find((b) => b.textContent === 'Clear history');
  assert.equal(clearButton.hidden, false);

  await byClass(m.card, 'device-row')[0].dispatch('click');
  assert.equal(clearButton.hidden, true);

  await byClass(m.card, 'back-btn')[0].dispatch('click');
  assert.equal(clearButton.hidden, false);
  await clearButton.dispatch('click');
  assert.deepEqual(m.calls.send, [['POST', '/admin/history/clear', {}]]);
  assert.equal(m.calls.refresh, 1);
});
