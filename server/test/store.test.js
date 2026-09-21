'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ItemStore } = require('../src/store');
const { DEFAULT_LIMITS } = require('../src/config');
const { tmpDir } = require('./helpers/tmp');
const { createClock } = require('./helpers/clock');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function setup(t, limits = {}) {
  const dir = tmpDir(t);
  const outboxDir = path.join(dir, 'outbox');
  const receiveDir = path.join(dir, 'received');
  fs.mkdirSync(outboxDir);
  fs.mkdirSync(receiveDir);
  const clock = createClock();
  const make = () =>
    new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits: { ...DEFAULT_LIMITS, ...limits }, now: clock.now });
  const file = (folder, name, content = 'x') => {
    const p = path.join(folder, name);
    fs.writeFileSync(p, content);
    return p;
  };
  return { make, store: make(), clock, outboxDir, receiveDir, file, dir };
}

test('a phone only sees its own items, oldest first, without deviceId or path', (t) => {
  const { store, clock } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'one' });
  clock.advance(1000);
  store.add({ deviceId: B, kind: 'text', from: 'phone', text: 'other phone' });
  clock.advance(1000);
  store.add({ deviceId: A, kind: 'text', from: 'laptop', text: 'two' });
  const items = store.list(A);
  assert.deepEqual(items.map((i) => i.text), ['one', 'two']);
  for (const item of items) {
    assert.equal('deviceId' in item, false);
    assert.equal('path' in item, false);
  }
  assert.equal(store.list().length, 3);
  assert.equal(store.list()[1].deviceId, B); // the all-items view (admin) includes deviceId
});

test('file items get a mime type from the name', (t) => {
  const { store, receiveDir, file } = setup(t);
  const item = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'pic.png', size: 1, path: file(receiveDir, 'pic.png') });
  assert.equal(item.mime, 'image/png');
  assert.equal(store.list(A)[0].mime, 'image/png');
});

test('get returns the full record including the disk path', (t) => {
  const { store, receiveDir, file } = setup(t);
  const p = file(receiveDir, 'a.txt');
  const item = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'a.txt', size: 1, path: p });
  assert.equal(store.get(item.id).path, p);
  assert.equal(store.get('nope'), null);
});

test('remove deletes an outbox file but never a received file', (t) => {
  const { store, outboxDir, receiveDir, file } = setup(t);
  const out = file(outboxDir, 'to-phone.txt');
  const recv = file(receiveDir, 'from-phone.txt');
  const o = store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'to-phone.txt', size: 1, path: out });
  const r = store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'from-phone.txt', size: 1, path: recv });
  assert.equal(store.remove(o.id), true);
  assert.equal(store.remove(r.id), true);
  assert.equal(store.remove(r.id), false);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(recv), true);
});

test('history is capped: the oldest entry is pruned with the same file rules', (t) => {
  const { store, outboxDir, file } = setup(t, { maxHistory: 2 });
  const p = file(outboxDir, 'old.txt');
  store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'old.txt', size: 1, path: p });
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'b' });
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'c' });
  assert.deepEqual(store.list(A).map((i) => i.text), ['b', 'c']);
  assert.equal(fs.existsSync(p), false);
});

test('clear removes one phone\'s history or everything', (t) => {
  const { store } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'a' });
  store.add({ deviceId: B, kind: 'text', from: 'phone', text: 'b' });
  assert.equal(store.clear(A), 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.clear(), 1);
  assert.equal(store.list().length, 0);
});

test('outboxBytes sums laptop-to-phone file sizes only', (t) => {
  const { store, outboxDir, receiveDir, file } = setup(t);
  store.add({ deviceId: A, kind: 'file', from: 'laptop', name: 'a', size: 100, path: file(outboxDir, 'a') });
  store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'b', size: 999, path: file(receiveDir, 'b') });
  store.add({ deviceId: A, kind: 'text', from: 'laptop', text: 'hi' });
  assert.equal(store.outboxBytes(), 100);
});

test('items persist across restarts; file entries whose file vanished are dropped', (t) => {
  const { store, make, receiveDir, file } = setup(t);
  store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'kept' });
  const p = file(receiveDir, 'gone.txt');
  store.add({ deviceId: A, kind: 'file', from: 'phone', name: 'gone.txt', size: 1, path: p });
  fs.rmSync(p);
  assert.deepEqual(make().list(A).map((i) => i.text), ['kept']);
});

test('add and delete emit events carrying the owning device', (t) => {
  const { store } = setup(t);
  const events = [];
  store.on('add', (e) => events.push(['add', e.deviceId, e.item.text]));
  store.on('delete', (e) => events.push(['delete', e.deviceId]));
  const item = store.add({ deviceId: A, kind: 'text', from: 'phone', text: 'hi' });
  store.remove(item.id);
  assert.deepEqual(events, [['add', A, 'hi'], ['delete', A]]);
});
