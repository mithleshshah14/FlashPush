'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'assets', 'model.js')).href);

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const at = (day, hour, minute) => new Date(2026, 8, day, hour, minute).getTime();
const NOW = at(22, 15, 30);
const text = (id, from, when, body, deviceId = A) => ({ id, kind: 'text', from, time: when, text: body, deviceId });

test('#/messages is a route, unknown routes still fall back to the dashboard', async () => {
  const { parseRoute } = await load();
  assert.equal(parseRoute('#/messages'), 'messages');
  assert.equal(parseRoute('#/Messages?x=1'), 'messages');
  assert.equal(parseRoute('#/approvals'), 'approvals');
  assert.equal(parseRoute('#/nope'), 'dashboard');
});

test('the tab title counts pairing requests and unread messages together', async () => {
  const { documentTitle } = await load();
  assert.equal(documentTitle('messages', 0), 'Messages · FlashPush');
  assert.equal(documentTitle('dashboard', 2), '(2) Dashboard · FlashPush');
  assert.equal(documentTitle('devices', 1, 3), '(4) Devices · FlashPush');
  assert.equal(documentTitle('messages', 0, 5), '(5) Messages · FlashPush');
});

test('dayLabel says Today, Yesterday, or the date', async () => {
  const { dayLabel } = await load();
  assert.equal(dayLabel(at(22, 1, 0), NOW), 'Today');
  assert.equal(dayLabel(at(21, 23, 59), NOW), 'Yesterday');
  assert.equal(dayLabel(at(12, 8, 0), NOW), '12 Sep 2026');
});

test('groupMessages keeps only text of that phone, oldest first, split by day', async () => {
  const { groupMessages } = await load();
  const items = [
    text('3', 'laptop', at(22, 9, 5), 'later today'),
    text('1', 'phone', at(21, 18, 32), 'yesterday evening'),
    text('x', 'phone', at(22, 9, 0), 'other phone', B),
    { id: 'f', kind: 'file', from: 'phone', time: at(22, 9, 1), name: 'a.pdf', deviceId: A },
    text('2', 'phone', at(22, 8, 0), 'this morning'),
  ];
  const groups = groupMessages(items, A, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.messages.map((m) => m.id)]), [
    ['Yesterday', ['1']],
    ['Today', ['2', '3']],
  ]);
  assert.equal(groupMessages(items, B, NOW)[0].messages[0].text, 'other phone');
  assert.deepEqual(groupMessages(items, 'nobody', NOW), []);
});

test('groupMessages puts the phone on the left, the laptop on the right, and marks the start of each run', async () => {
  const { groupMessages } = await load();
  const items = [
    text('1', 'phone', at(22, 9, 0), 'hi'),
    text('2', 'phone', at(22, 9, 1), 'are you there'),
    text('3', 'laptop', at(22, 9, 2), 'yes'),
    text('4', 'phone', at(22, 9, 3), 'great'),
  ];
  const messages = groupMessages(items, A, NOW)[0].messages;
  assert.deepEqual(messages.map((m) => [m.side, m.startsRun, m.clock]), [
    ['phone', true, '09:00'],
    ['phone', false, '09:01'],
    ['laptop', true, '09:02'],
    ['phone', true, '09:03'],
  ]);
});

test('a new day always starts a new run, even from the same side', async () => {
  const { groupMessages } = await load();
  const groups = groupMessages([text('1', 'phone', at(21, 23, 59), 'late'), text('2', 'phone', at(22, 0, 1), 'early')], A, NOW);
  assert.deepEqual(groups.map((g) => g.messages[0].startsRun), [true, true]);
});

test('unreadCount counts phone messages newer than the marker, optionally for one phone', async () => {
  const { unreadCount } = await load();
  const items = [
    text('1', 'phone', 100, 'old'),
    text('2', 'phone', 200, 'new'),
    text('3', 'laptop', 300, 'mine'),
    text('4', 'phone', 400, 'other phone', B),
    { id: 'f', kind: 'file', from: 'phone', time: 500, name: 'x', deviceId: A },
  ];
  assert.equal(unreadCount(items, 100), 2);
  assert.equal(unreadCount(items, 100, A), 1);
  assert.equal(unreadCount(items, 400), 0);
});

test('nextLastSeen: existing history is read on first load; unread builds up elsewhere; opening Messages reads all', async () => {
  const { nextLastSeen, unreadCount } = await load();
  const history = [text('1', 'phone', 100, 'a'), text('2', 'phone', 200, 'b')];

  let seen = nextLastSeen(history, null, false);
  assert.equal(seen, 200);
  assert.equal(unreadCount(history, seen), 0);

  const later = [...history, text('3', 'phone', 300, 'c'), text('4', 'laptop', 350, 'mine')];
  seen = nextLastSeen(later, seen, false);
  assert.equal(seen, 200, 'the marker does not move while another view is open');
  assert.equal(unreadCount(later, seen), 1);

  seen = nextLastSeen(later, seen, true);
  assert.equal(seen, 300);
  assert.equal(unreadCount(later, seen), 0);
  assert.equal(nextLastSeen([], null, false), 0);
});

test('safeLinkParts links only http(s) URLs and keeps trailing punctuation out of them', async () => {
  const { safeLinkParts } = await load();
  assert.deepEqual(safeLinkParts('just words'), [{ text: 'just words' }]);
  assert.deepEqual(safeLinkParts('see https://example.com/a?b=1 now'), [
    { text: 'see ' },
    { href: 'https://example.com/a?b=1', text: 'https://example.com/a?b=1' },
    { text: ' now' },
  ]);
  assert.deepEqual(safeLinkParts('(https://example.com/x).'), [
    { text: '(' },
    { href: 'https://example.com/x', text: 'https://example.com/x' },
    { text: ').' },
  ]);
  assert.deepEqual(safeLinkParts('http://a.test https://b.test'), [
    { href: 'http://a.test', text: 'http://a.test' },
    { text: ' ' },
    { href: 'https://b.test', text: 'https://b.test' },
  ]);
});

test('safeLinkParts never makes a link out of javascript:, data: or file: text', async () => {
  const { safeLinkParts } = await load();
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///c:/x', 'click https:// now']) {
    assert.equal(safeLinkParts(bad).some((part) => 'href' in part), false, bad);
  }
  assert.deepEqual(safeLinkParts(''), []);
});

test('phoneInitial takes the first letter, with a fallback', async () => {
  const { phoneInitial } = await load();
  assert.equal(phoneInitial('pixel 7'), 'P');
  assert.equal(phoneInitial('  Zed'), 'Z');
  assert.equal(phoneInitial(''), 'P');
  assert.equal(phoneInitial(undefined), 'U');
});

test('chatTarget keeps a valid choice, falls back to the first phone, and reports when a choice is needed', async () => {
  const { chatTarget } = await load();
  const devices = [{ deviceId: A, name: 'Pixel' }, { deviceId: B, name: 'Galaxy' }];
  assert.deepEqual(chatTarget(devices, B), { id: B, name: 'Galaxy', needsChoice: true });
  assert.deepEqual(chatTarget(devices, 'gone'), { id: A, name: 'Pixel', needsChoice: true });
  assert.deepEqual(chatTarget([devices[0]], null), { id: A, name: 'Pixel', needsChoice: false });
  assert.deepEqual(chatTarget([], null), { id: null, name: '', needsChoice: false });
});

test('composerAction: Enter sends, Shift+Enter and IME composition do not, empty or busy does nothing', async () => {
  const { composerAction } = await load();
  assert.equal(composerAction({ key: 'Enter' }, 'hello', false), 'send');
  assert.equal(composerAction({ key: 'Enter', shiftKey: true }, 'hello', false), 'none');
  assert.equal(composerAction({ key: 'Enter', isComposing: true }, 'hello', false), 'none');
  assert.equal(composerAction({ key: 'Enter' }, '   ', false), 'ignore');
  assert.equal(composerAction({ key: 'Enter' }, 'hello', true), 'ignore');
  assert.equal(composerAction({ key: 'a' }, 'hello', false), 'none');
});

test('composerRows follows the line count within 1..6', async () => {
  const { composerRows } = await load();
  assert.equal(composerRows(''), 1);
  assert.equal(composerRows('one line'), 1);
  assert.equal(composerRows('a\nb\nc'), 3);
  assert.equal(composerRows('1\n2\n3\n4\n5\n6\n7\n8'), 6);
});
