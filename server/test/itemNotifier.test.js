'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createItemNotifier, describe } = require('../src/itemNotifier');

const DEVICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const text = (from = 'phone') => ({ item: { kind: 'text', from, text: 'secret words' }, deviceId: DEVICE });
const file = (name, mime = 'application/pdf') => ({ item: { kind: 'file', from: 'phone', name, mime }, deviceId: DEVICE });

/** A notifier with a controllable clock: `fire()` runs the pending timers. */
function setup({ siteOpen = false } = {}) {
  const sent = [];
  const timers = [];
  const state = { siteOpen };
  const notifier = createItemNotifier({
    notify: (title, body, target) => sent.push({ title, body, target }),
    isSiteOpen: () => state.siteOpen,
    phoneName: (id) => (id === DEVICE ? 'Pixel 7' : 'A phone'),
    setTimer: (fn) => {
      const timer = { fn, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  const fire = () => timers.filter((t) => !t.cleared).forEach((t) => t.fn());
  return { notifier, sent, timers, state, fire };
}

test('describe words one item and a mix, without ever quoting content', () => {
  assert.equal(describe('Pixel 7', { message: 1, image: 0, file: 0 }).body, 'Pixel 7 sent a message');
  assert.equal(describe('Pixel 7', { message: 0, image: 1, file: 0 }).body, 'Pixel 7 sent an image');
  assert.equal(describe('Pixel 7', { message: 0, image: 0, file: 1 }).body, 'Pixel 7 sent a file');
  assert.equal(describe('Pixel 7', { message: 1, image: 2, file: 0 }).body, 'Pixel 7 sent 3 items: 1 message, 2 images');
  assert.equal(describe('Pixel 7', { message: 3, image: 0, file: 1 }).body, 'Pixel 7 sent 4 items: 3 messages, 1 file');
  assert.equal(describe('Pixel 7', { message: 1, image: 0, file: 0 }).title, 'FlashPush');
});

test('describe sends a message-only balloon to the chat and anything with files or images to the dashboard', () => {
  assert.equal(describe('P', { message: 2, image: 0, file: 0 }).target, 'messages');
  assert.equal(describe('P', { message: 0, image: 1, file: 0 }).target, 'items');
  assert.equal(describe('P', { message: 1, image: 0, file: 1 }).target, 'items');
});

test('one message gives one notification after the batching window', () => {
  const { notifier, sent, fire } = setup();
  notifier.add(text());
  assert.equal(sent.length, 0, 'not before the window ends');
  fire();
  assert.deepEqual(sent, [{ title: 'FlashPush', body: 'Pixel 7 sent a message', target: 'messages' }]);
});

test('a burst is one notification, counting each kind (images by mime type)', () => {
  const { notifier, sent, timers, fire } = setup();
  notifier.add(text());
  notifier.add(file('a.png', 'image/png'));
  notifier.add(file('b.jpg', 'image/jpeg'));
  notifier.add(file('c.pdf'));
  assert.equal(timers.length, 1, 'one window for the burst');
  fire();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'Pixel 7 sent 4 items: 1 message, 2 images, 1 file');
  assert.equal(sent[0].target, 'items');
});

test('the notification never contains the message text or a file name', () => {
  const { notifier, sent, fire } = setup();
  notifier.add(text());
  notifier.add(file('bank-statement.pdf'));
  fire();
  const shown = JSON.stringify(sent);
  assert.equal(shown.includes('secret words'), false);
  assert.equal(shown.includes('bank-statement'), false);
});

test('items the laptop sent itself never notify', () => {
  const { notifier, sent, timers } = setup();
  notifier.add(text('laptop'));
  assert.equal(timers.length, 0);
  assert.equal(sent.length, 0);
});

test('nothing is shown while the site is open, neither at arrival nor at the end of the window', () => {
  const open = setup({ siteOpen: true });
  open.notifier.add(text());
  assert.equal(open.timers.length, 0);

  const closesLater = setup();
  closesLater.notifier.add(text());
  closesLater.state.siteOpen = true; // the user opened the site during the window
  closesLater.fire();
  assert.equal(closesLater.sent.length, 0);
});

test('after a notification the next item starts a new window and a new notification', () => {
  const { notifier, sent, fire } = setup();
  notifier.add(text());
  fire();
  notifier.add(file('x.png', 'image/png'));
  fire();
  assert.deepEqual(sent.map((n) => n.body), ['Pixel 7 sent a message', 'Pixel 7 sent an image']);
});

test('each phone gets its own notification', () => {
  const { notifier, sent, fire } = setup();
  notifier.add(text());
  notifier.add({ item: { kind: 'text', from: 'phone' }, deviceId: 'bbbbbbbb-0000-4000-8000-000000000002' });
  fire();
  assert.deepEqual(sent.map((n) => n.body).sort(), ['A phone sent a message', 'Pixel 7 sent a message']);
});

test('dispose cancels pending notifications', () => {
  const { notifier, sent, timers, fire } = setup();
  notifier.add(text());
  notifier.dispose();
  assert.equal(timers[0].cleared, true);
  fire();
  assert.equal(sent.length, 0);
});
