'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'assets', 'model.js')).href);

test('formatSize uses 1024 steps with sensible precision', async () => {
  const { formatSize } = await load();
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1023), '1023 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1024 * 1024 - 1), '1024.0 KB');
  assert.equal(formatSize(2.4 * 1024 * 1024), '2.4 MB');
  assert.equal(formatSize(1.25 * 1024 ** 3), '1.25 GB');
  assert.equal(formatSize(undefined), '');
});

test('formatRelative covers never, just now, minutes, today, yesterday and older dates', async () => {
  const { formatRelative } = await load();
  const now = new Date(2026, 8, 22, 15, 30).getTime();
  assert.equal(formatRelative(null, now), 'Never');
  assert.equal(formatRelative(now - 59_000, now), 'Just now');
  assert.equal(formatRelative(now - 60_000, now), '1 min ago');
  assert.equal(formatRelative(now - 12 * 60_000, now), '12 min ago');
  assert.equal(formatRelative(new Date(2026, 8, 22, 9, 5).getTime(), now), 'Today, 09:05');
  assert.equal(formatRelative(new Date(2026, 8, 21, 18, 32).getTime(), now), 'Yesterday, 18:32');
  assert.equal(formatRelative(new Date(2026, 8, 12, 8, 0).getTime(), now), '12 Sep 2026');
});

test('routeInfo maps address kinds to a key and label', async () => {
  const { routeInfo } = await load();
  assert.deepEqual(routeInfo('lan'), { key: 'wifi', label: 'Wi-Fi' });
  assert.deepEqual(routeInfo('tailscale'), { key: 'tailscale', label: 'Tailscale' });
  assert.deepEqual(routeInfo('tailscale-name'), { key: 'tailscale', label: 'Tailscale' });
  assert.deepEqual(routeInfo('other'), { key: 'other', label: 'Other' });
  assert.deepEqual(routeInfo(null), { key: 'other', label: 'Other' });
});

test('countdown is M:SS and never negative', async () => {
  const { countdown } = await load();
  assert.equal(countdown(1000 + 108_000, 1000), '1:48');
  assert.equal(countdown(1000 + 52_000, 1000), '0:52');
  assert.equal(countdown(1000 + 5_000, 1000), '0:05');
  assert.equal(countdown(1000, 5000), '0:00');
});

test('documentTitle shows the pending count only when there is one', async () => {
  const { documentTitle } = await load();
  assert.equal(documentTitle('dashboard', 0), 'Dashboard · FlashPush');
  assert.equal(documentTitle('approvals', 2), '(2) Approvals · FlashPush');
  assert.equal(documentTitle('devices', 1), '(1) Devices · FlashPush');
});

test('parseRoute falls back to the dashboard and ignores case and query', async () => {
  const { parseRoute } = await load();
  assert.equal(parseRoute(''), 'dashboard');
  assert.equal(parseRoute('#/approvals'), 'approvals');
  assert.equal(parseRoute('#/Devices?x=1'), 'devices');
  assert.equal(parseRoute('#/nope'), 'dashboard');
  assert.equal(parseRoute('#approvals'), 'approvals');
});

test('statusInfo defaults to Running and surfaces a degraded reason', async () => {
  const { statusInfo } = await load();
  assert.deepEqual(statusInfo(undefined), { label: 'Running', tone: 'ok', reason: '' });
  assert.deepEqual(statusInfo({ state: 'running' }), { label: 'Running', tone: 'ok', reason: '' });
  assert.deepEqual(statusInfo({ state: 'starting' }), { label: 'Starting', tone: 'warn', reason: '' });
  assert.deepEqual(statusInfo({ state: 'degraded', reason: 'Port 8765 is used by another program' }), {
    label: 'Degraded',
    tone: 'warn',
    reason: 'Port 8765 is used by another program',
  });
  assert.deepEqual(statusInfo({ state: 'stopped' }), { label: 'Stopped', tone: 'off', reason: '' });
});

test('safeUrl accepts exactly one http(s) URL and nothing else', async () => {
  const { safeUrl } = await load();
  assert.equal(safeUrl('https://docs.example.com/q3-report'), 'https://docs.example.com/q3-report');
  assert.equal(safeUrl('  http://a.test/x  '), 'http://a.test/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://a b', 'see https://a.test', 'ftp://a.test', '', 'https://']) {
    assert.equal(safeUrl(bad), null, bad);
  }
});

test('itemIcon and itemChip describe items', async () => {
  const { itemIcon, itemChip } = await load();
  assert.equal(itemIcon({ kind: 'text', text: 'https://a.test' }), 'link');
  assert.equal(itemIcon({ kind: 'text', text: 'hello' }), 'text');
  assert.equal(itemIcon({ kind: 'file', mime: 'image/png' }), 'image');
  assert.equal(itemIcon({ kind: 'file', mime: 'application/pdf' }), 'file');
  const phones = [{ deviceId: 'a', name: 'Pixel 7' }, { deviceId: 'b', name: 'Galaxy' }];
  assert.deepEqual(itemChip({ from: 'phone', deviceId: 'a' }, [phones[0]]), { direction: 'from', label: 'From phone' });
  assert.deepEqual(itemChip({ from: 'laptop', deviceId: 'a' }, [phones[0]]), { direction: 'to', label: 'To phone' });
  assert.deepEqual(itemChip({ from: 'phone', deviceId: 'b' }, phones), { direction: 'from', label: 'From Galaxy' });
  assert.deepEqual(itemChip({ from: 'laptop', deviceId: 'zzz' }, phones), { direction: 'to', label: 'To phone' });
});

test('sendTarget decides whether the phone selector is needed', async () => {
  const { sendTarget } = await load();
  assert.deepEqual(sendTarget([]), { needsChoice: false, defaultId: null, disabled: true });
  assert.deepEqual(sendTarget([{ deviceId: 'a' }]), { needsChoice: false, defaultId: 'a', disabled: false });
  assert.deepEqual(sendTarget([{ deviceId: 'a' }, { deviceId: 'b' }]), { needsChoice: true, defaultId: 'a', disabled: false });
});

test('newPendingIds returns only ids that were not seen before', async () => {
  const { newPendingIds } = await load();
  assert.deepEqual(newPendingIds(new Set(['a']), [{ requestId: 'a' }, { requestId: 'b' }]).map((p) => p.requestId), ['b']);
  assert.deepEqual(newPendingIds(new Set(), []), []);
});

test('errorMessage prefers the envelope message and falls back', async () => {
  const { errorMessage } = await load();
  assert.equal(errorMessage({ error: { code: 'X', message: 'Nope.' } }, 'fallback'), 'Nope.');
  assert.equal(errorMessage(null, 'fallback'), 'fallback');
  assert.equal(errorMessage({ error: {} }, 'fallback'), 'fallback');
});

test('firewall help mentions the exact ports and ranges', async () => {
  const { firewallCommand, firewallNote } = await load();
  assert.equal(firewallCommand, 'powershell -ExecutionPolicy Bypass -File scripts\\allow-firewall.ps1');
  assert.equal(
    firewallNote({ device: 8765, discovery: 8766 }),
    'Opens TCP 8765 and UDP 8766 for the local subnet and Tailscale (100.64.0.0/10) only.',
  );
});

test('addressLabel shows a MagicDNS name or an IP', async () => {
  const { addressText } = await load();
  assert.equal(addressText({ ip: '192.168.1.6', kind: 'lan' }), '192.168.1.6');
  assert.equal(addressText({ name: 'mithlesh-pc.tail1234.ts.net', kind: 'tailscale-name' }), 'mithlesh-pc.tail1234.ts.net');
});
