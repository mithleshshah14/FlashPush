'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installFakeDom, byClass, byTag } = require('./helpers/fake-dom');

installFakeDom();
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'assets', 'views', 'messages.js')).href);

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const phones = { A: { deviceId: A, name: 'Pixel' }, B: { deviceId: B, name: 'Galaxy' } };
const at = (hour, minute) => new Date(2026, 8, 22, hour, minute).getTime();
const NOW = at(15, 30);
const item = (id, from, when, text, deviceId = A) => ({ id, kind: 'text', from, time: when, text, deviceId });
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Mounts the view against a stubbed context and returns handles to its parts. */
async function mount(state, { failSend = false } = {}) {
  const { createMessages } = await load();
  const calls = { send: [], refresh: 0, announce: [] };
  const ctx = {
    send: async (method, url, body) => {
      calls.send.push([method, url, body]);
      if (failSend) throw new Error('boom');
    },
    refresh: async () => { calls.refresh += 1; },
    copyText: async () => true,
    announce: (message) => calls.announce.push(message),
  };
  const view = createMessages(ctx);
  view.update(state, NOW);
  const part = (name) => byClass(view.el, name)[0];
  return {
    view, calls, ctx,
    thread: part('thread'), pill: part('new-pill'), picker: byTag(view.el, 'select')[0], box: byTag(view.el, 'textarea')[0],
    sendButton: byTag(part('composer'), 'button')[0], subtitle: part('lead'),
    rows: () => byClass(part('thread'), 'msg'),
  };
}

test('with no phone paired the chat says so and cannot send', async () => {
  const m = await mount({ devices: [], items: [] });
  assert.match(m.thread.textContent, /Pair a phone first/);
  assert.equal(m.box.disabled, true);
  assert.equal(m.sendButton.disabled, true);
});

test('a paired phone with no messages shows the empty state; one phone means no picker', async () => {
  const m = await mount({ devices: [phones.A], items: [] });
  assert.match(m.thread.textContent, /No messages yet\. Say hello!/);
  assert.equal(m.picker.hidden, true);
  assert.equal(m.subtitle.textContent, 'Conversation with Pixel');
  assert.equal(m.box.disabled, false);
});

test('messages render as bubbles: phone left, laptop right, name on each run, time under each bubble', async () => {
  const m = await mount({
    devices: [phones.A],
    items: [
      item('1', 'phone', at(9, 0), 'hi'),
      item('2', 'phone', at(9, 1), 'are you there'),
      item('3', 'laptop', at(9, 2), 'see https://example.com/x today'),
      item('4', 'phone', at(9, 3), 'javascript:alert(1)'),
    ],
  });
  const rows = m.rows();
  assert.deepEqual(rows.map((r) => (r.className.includes('msg-laptop') ? 'laptop' : 'phone')), ['phone', 'phone', 'laptop', 'phone']);
  assert.equal(byClass(m.thread, 'msg-name').length, 2, 'the phone name shows once per run of its messages');
  assert.deepEqual(byClass(m.thread, 'msg-meta').map((n) => n.textContent), ['09:00', '09:01', '09:02', '09:03']);
  assert.equal(byClass(m.thread, 'day-sep').length, 1);
  assert.match(rows[0].textContent, /Pixel: hi/, 'screen readers hear who spoke');
  assert.match(rows[2].textContent, /You: see https:\/\/example.com\/x today/);
});

test('only http(s) URLs become links, opened safely; anything else stays plain text', async () => {
  const m = await mount({ devices: [phones.A], items: [item('1', 'phone', at(9, 0), 'open https://example.com/x now'), item('2', 'phone', at(9, 1), 'javascript:alert(1)')] });
  const links = byTag(m.thread, 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].attributes.href, 'https://example.com/x');
  assert.equal(links[0].attributes.rel, 'noopener noreferrer');
  assert.equal(links[0].attributes.target, '_blank');
});

test('a new message is appended without rebuilding the thread; a deletion rebuilds it', async () => {
  const first = [item('1', 'phone', at(9, 0), 'one'), item('2', 'laptop', at(9, 1), 'two')];
  const m = await mount({ devices: [phones.A], items: first });
  const before = m.rows();

  m.view.update({ devices: [phones.A], items: [...first, item('3', 'phone', at(9, 2), 'three')] }, NOW);
  const after = m.rows();
  assert.equal(after.length, 3);
  assert.equal(after[0], before[0], 'existing bubbles are the same nodes');
  assert.equal(after[1], before[1]);
  assert.equal(m.thread.attributes['aria-live'], 'polite');

  m.view.update({ devices: [phones.A], items: [first[1]] }, NOW);
  const rebuilt = m.rows();
  assert.equal(rebuilt.length, 1);
  assert.notEqual(rebuilt[0], before[1], 'a deletion rebuilds the thread');
  assert.equal(m.thread.attributes['aria-live'], 'polite', 'live announcements are back on after a rebuild');
});

test('a message that arrives while scrolled up shows the New messages pill, until you reach the bottom', async () => {
  const m = await mount({ devices: [phones.A], items: [item('1', 'phone', at(9, 0), 'one')] });
  Object.assign(m.thread, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
  m.view.update({ devices: [phones.A], items: [item('1', 'phone', at(9, 0), 'one'), item('2', 'phone', at(9, 1), 'two')] }, NOW);
  assert.equal(m.pill.hidden, false);

  m.thread.scrollTop = 600;
  await m.thread.dispatch('scroll');
  assert.equal(m.pill.hidden, true);
});

test('a message that arrives while at the bottom scrolls the thread down and shows no pill', async () => {
  const m = await mount({ devices: [phones.A], items: [item('1', 'phone', at(9, 0), 'one')] });
  Object.assign(m.thread, { scrollHeight: 1000, clientHeight: 400, scrollTop: 590 });
  m.view.update({ devices: [phones.A], items: [item('1', 'phone', at(9, 0), 'one'), item('2', 'phone', at(9, 1), 'two')] }, NOW);
  assert.equal(m.pill.hidden, true);
  assert.equal(m.thread.scrollTop, 1000);
});

test('Enter sends to the selected phone, clears the box and keeps focus in it', async () => {
  const m = await mount({ devices: [phones.A], items: [] });
  m.box.value = 'hello there';
  await m.box.dispatch('input');
  assert.equal(m.sendButton.disabled, false);

  const fired = await m.box.dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.equal(fired.defaultPrevented, true);
  assert.deepEqual(m.calls.send, [['POST', '/admin/text', { deviceId: A, text: 'hello there' }]]);
  assert.equal(m.box.value, '');
  assert.equal(m.calls.refresh, 1);
  assert.equal(m.box.focused, true);
});

test('Shift+Enter is a newline, and an empty or blank box cannot be sent', async () => {
  const m = await mount({ devices: [phones.A], items: [] });
  m.box.value = 'line one';
  await m.box.dispatch('input');
  const newline = await m.box.dispatch('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(newline.defaultPrevented, false, 'the browser inserts the newline');

  m.box.value = '   ';
  await m.box.dispatch('input');
  assert.equal(m.sendButton.disabled, true);
  const blank = await m.box.dispatch('keydown', { key: 'Enter' });
  assert.equal(blank.defaultPrevented, true, 'Enter on a blank box does nothing, not even a newline');
  await m.sendButton.dispatch('click');
  await settle();
  assert.deepEqual(m.calls.send, []);
});

test('a failed send shows the error inline and keeps the text', async () => {
  const m = await mount({ devices: [phones.A], items: [] }, { failSend: true });
  m.box.value = 'keep me';
  await m.box.dispatch('input');
  await m.sendButton.dispatch('click');
  await settle();
  assert.equal(byClass(m.view.el, 'error-text')[0].textContent, 'boom');
  assert.equal(m.box.value, 'keep me');
  assert.equal(m.sendButton.disabled, false, 'the user can try again');
});

test('with several phones a picker appears and switching shows the other conversation', async () => {
  const state = { devices: [phones.A, phones.B], items: [item('1', 'phone', at(9, 0), 'from Pixel'), item('2', 'phone', at(9, 1), 'from Galaxy', B)] };
  const m = await mount(state);
  assert.equal(m.picker.hidden, false);
  assert.equal(byTag(m.picker, 'option').length, 2);
  assert.match(m.thread.textContent, /from Pixel/);
  assert.doesNotMatch(m.thread.textContent, /from Galaxy/);

  m.picker.value = B;
  await m.picker.dispatch('change');
  assert.match(m.thread.textContent, /from Galaxy/);
  assert.doesNotMatch(m.thread.textContent, /from Pixel/);
  assert.equal(m.subtitle.textContent, 'Conversation with Galaxy');

  m.box.value = 'to Galaxy';
  await m.box.dispatch('input');
  await m.box.dispatch('keydown', { key: 'Enter' });
  await settle();
  assert.equal(m.calls.send[0][2].deviceId, B, 'messages go to the phone whose conversation is open');
});
