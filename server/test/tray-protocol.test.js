'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, createLineDecoder, buildMenu, TRAY_ACTIONS } = require('../src/tray-protocol');

const running = { state: 'running', reason: null };
const ids = (menu) => menu.items.filter((i) => i.id).map((i) => i.id);
const item = (menu, id) => menu.items.find((i) => i.id === id);

function decode(chunks) {
  const seen = [];
  const decoder = createLineDecoder((m) => seen.push(m));
  for (const chunk of chunks) decoder.push(chunk);
  return seen;
}

test('encode writes one JSON line', () => {
  const line = encode({ type: 'notify', title: 'a', body: 'b' });
  assert.equal(line.endsWith('\n'), true);
  assert.equal(line.slice(0, -1).includes('\n'), false);
  assert.deepEqual(JSON.parse(line), { type: 'notify', title: 'a', body: 'b' });
});

test('encode keeps newlines inside strings escaped, so one message is always one line', () => {
  const line = encode({ label: 'a\nb\r\nc' });
  assert.equal(line.split('\n').length, 2);
  assert.deepEqual(JSON.parse(line), { label: 'a\nb\r\nc' });
});

test('the decoder handles messages split across chunks and several messages in one chunk', () => {
  const seen = decode(['{"type":"rea', 'dy"}\n{"type":"click","id":"open"}\n{"type":"cl', 'ick","id":"stop"}\n']);
  assert.deepEqual(seen, [{ type: 'ready' }, { type: 'click', id: 'open' }, { type: 'click', id: 'stop' }]);
});

test('the decoder accepts Buffers and CRLF line endings', () => {
  assert.deepEqual(decode([Buffer.from('{"type":"ready"}\r\n')]), [{ type: 'ready' }]);
});

test('the decoder ignores blank lines, invalid JSON and non-objects', () => {
  assert.deepEqual(decode(['\n', 'not json\n', '[1,2]\n', '5\n', 'null\n', '{"type":"ready"}\n']), [{ type: 'ready' }]);
});

test('the decoder drops an oversize line without buffering it, then recovers', () => {
  const seen = [];
  const decoder = createLineDecoder((m) => seen.push(m), 100);
  decoder.push('x'.repeat(50));
  decoder.push('y'.repeat(200)); // still the same line: now over the limit
  decoder.push('z'.repeat(500) + '\n{"type":"ready"}\n');
  assert.deepEqual(seen, [{ type: 'ready' }]);
});

test('TRAY_ACTIONS is exactly the ids the tray may send back', () => {
  assert.deepEqual([...TRAY_ACTIONS].sort(), ['approvals', 'autostart', 'devices', 'files', 'open', 'stop']);
});

test('the running menu has the specified items in order, with no approvals entry at zero', () => {
  const menu = buildMenu({ status: running, pendingCount: 0, autostart: false });
  assert.deepEqual(ids(menu), ['status', 'open', 'devices', 'files', 'autostart', 'stop']);
  assert.equal(item(menu, 'status').label, 'FlashPush: Running');
  assert.equal(item(menu, 'status').enabled, false);
  assert.equal(item(menu, 'open').label, 'Open FlashPush');
  assert.equal(item(menu, 'devices').label, 'Paired devices');
  assert.equal(item(menu, 'files').label, 'Open received files');
  assert.equal(item(menu, 'autostart').label, 'Start with Windows');
  assert.equal(item(menu, 'stop').label, 'Stop FlashPush');
  assert.equal(menu.icon, 'running');
});

test('pending approvals appear between Open and Paired devices when there are any', () => {
  const menu = buildMenu({ status: running, pendingCount: 2, autostart: false });
  assert.deepEqual(ids(menu), ['status', 'open', 'approvals', 'devices', 'files', 'autostart', 'stop']);
  assert.equal(item(menu, 'approvals').label, 'Pending approvals (2)');
});

test('the autostart item is a checkbox that reflects the setting', () => {
  assert.equal(item(buildMenu({ status: running, pendingCount: 0, autostart: true }), 'autostart').checked, true);
  assert.equal(item(buildMenu({ status: running, pendingCount: 0, autostart: false }), 'autostart').checked, false);
});

test('degraded shows the reason and the degraded icon; starting and stopped use the neutral icon', () => {
  const degraded = buildMenu({ status: { state: 'degraded', reason: 'Port 8765 is used by another program.' }, pendingCount: 0, autostart: false });
  assert.equal(item(degraded, 'status').label, 'FlashPush: Degraded - Port 8765 is used by another program.');
  assert.equal(degraded.icon, 'degraded');
  assert.equal(buildMenu({ status: { state: 'starting', reason: null }, pendingCount: 0, autostart: false }).icon, 'stopped');
  const stopped = buildMenu({ status: { state: 'stopped', reason: null }, pendingCount: 0, autostart: false });
  assert.equal(item(stopped, 'status').label, 'FlashPush: Stopped');
  assert.equal(stopped.icon, 'stopped');
});

test('hostile or huge text is sanitised: no control characters, capped length', () => {
  const menu = buildMenu({ status: { state: 'degraded', reason: 'bad\r\n\u0007reason' + 'x'.repeat(500) }, pendingCount: 0, autostart: false });
  const label = item(menu, 'status').label;
  assert.equal(/[\u0000-\u001f\u007f]/.test(label), false);
  assert.ok(label.length <= 140);
});

test('a bogus pending count cannot break the menu', () => {
  for (const bad of [-3, NaN, 'x', undefined, 1.9]) {
    const menu = buildMenu({ status: running, pendingCount: bad, autostart: false });
    const approvals = item(menu, 'approvals');
    assert.equal(approvals === undefined || /^Pending approvals \(\d+\)$/.test(approvals.label), true, String(bad));
  }
});

test('the tooltip fits the Windows limit of 63 characters', () => {
  const menu = buildMenu({ status: { state: 'degraded', reason: 'y'.repeat(300) }, pendingCount: 0, autostart: false });
  assert.ok(menu.tooltip.length <= 63);
  assert.match(menu.tooltip, /^FlashPush/);
});
