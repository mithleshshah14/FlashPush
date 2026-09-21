'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIp, listAddresses, parseTailscaleName, readTailscaleName, createAddressProvider } = require('../src/addresses');

const STATUS = JSON.stringify({ Self: { DNSName: 'Mithlesh-PC.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] } });
const nic = (address) => ({ address, family: 'IPv4', internal: false });

test('private ranges are lan', () => {
  for (const ip of ['192.168.1.6', '10.1.2.3', '172.16.0.1', '172.31.255.255']) assert.equal(classifyIp(ip), 'lan', ip);
});

test('172.x outside 16-31 is not lan', () => {
  assert.equal(classifyIp('172.15.0.1'), 'other');
  assert.equal(classifyIp('172.32.0.1'), 'other');
});

test('100.64.0.0/10 is tailscale, its neighbours are not', () => {
  assert.equal(classifyIp('100.101.102.103'), 'tailscale');
  assert.equal(classifyIp('100.64.0.1'), 'tailscale');
  assert.equal(classifyIp('100.127.255.255'), 'tailscale');
  assert.equal(classifyIp('100.63.255.255'), 'other');
  assert.equal(classifyIp('100.128.0.0'), 'other');
});

test('an interface named like tailscale wins over the address range', () => {
  assert.equal(classifyIp('192.168.5.5', 'Tailscale'), 'tailscale');
});

test('IPv4-mapped IPv6 is unwrapped, garbage is other', () => {
  assert.equal(classifyIp('::ffff:192.168.1.6'), 'lan');
  assert.equal(classifyIp('8.8.8.8'), 'other');
  assert.equal(classifyIp('garbage'), 'other');
  assert.equal(classifyIp('1..2.3'), 'other');
  assert.equal(classifyIp('256.1.1.1'), 'other');
});

test('listAddresses drops loopback, link-local and IPv6, and sorts lan, tailscale, other', () => {
  const nic = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });
  const result = listAddresses({
    Loopback: [nic('127.0.0.1', { internal: true })],
    Tailscale: [nic('100.101.102.103')],
    'Wi-Fi': [nic('192.168.1.6'), { address: 'fe80::1', family: 'IPv6', internal: false }],
    Ethernet: [nic('169.254.83.107'), nic('8.8.4.4')],
  });
  assert.deepEqual(result, [
    { ip: '192.168.1.6', kind: 'lan' },
    { ip: '100.101.102.103', kind: 'tailscale' },
    { ip: '8.8.4.4', kind: 'other' },
  ]);
});

test('parseTailscaleName returns the lower-cased MagicDNS name without the trailing dot', () => {
  assert.equal(parseTailscaleName(STATUS), 'mithlesh-pc.tail1234.ts.net');
});

test('parseTailscaleName rejects anything that is not a plain host name', () => {
  const withName = (DNSName) => JSON.stringify({ Self: { DNSName } });
  for (const bad of ['', '.', 'a b.ts.net.', 'x;rm -rf.ts.net.', 'a/b.ts.net.', 42, null, 'x'.repeat(300)]) {
    assert.equal(parseTailscaleName(withName(bad)), null, JSON.stringify(bad));
  }
  assert.equal(parseTailscaleName('not json'), null);
  assert.equal(parseTailscaleName('{}'), null);
  assert.equal(parseTailscaleName(JSON.stringify({ Self: null })), null);
});

test('readTailscaleName runs the CLI with a short timeout and parses its output', async () => {
  const calls = [];
  const exec = async (file, args, options) => {
    calls.push([file, args, options]);
    return STATUS;
  };
  assert.equal(await readTailscaleName(exec), 'mithlesh-pc.tail1234.ts.net');
  assert.deepEqual(calls, [['tailscale', ['status', '--json'], { timeout: 2000, windowsHide: true }]]);
});

test('readTailscaleName gives null when the CLI is missing, fails or prints garbage', async () => {
  assert.equal(await readTailscaleName(async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); }), null);
  assert.equal(await readTailscaleName(async () => 'garbage'), null);
});

test('the address provider adds the MagicDNS name before the Tailscale IP once refreshed', async () => {
  const interfaces = () => ({ 'Wi-Fi': [nic('192.168.1.6')], Tailscale: [nic('100.101.102.103')] });
  const provider = createAddressProvider({ interfaces, readName: async () => 'mithlesh-pc.tail1234.ts.net' });
  assert.deepEqual(provider.list().map((a) => a.ip || a.name), ['192.168.1.6', '100.101.102.103']);
  await provider.refresh();
  assert.deepEqual(provider.list(), [
    { ip: '192.168.1.6', kind: 'lan' },
    { name: 'mithlesh-pc.tail1234.ts.net', kind: 'tailscale-name' },
    { ip: '100.101.102.103', kind: 'tailscale' },
  ]);
});

test('the address provider keeps the last name when a refresh fails, and drops it when Tailscale reports none', async () => {
  let next = async () => 'a.ts.net';
  const provider = createAddressProvider({ interfaces: () => ({ 'Wi-Fi': [nic('192.168.1.6')] }), readName: () => next() });
  await provider.refresh();
  next = async () => { throw new Error('boom'); };
  await provider.refresh();
  assert.equal(provider.list().some((a) => a.kind === 'tailscale-name'), true);
  next = async () => null;
  await provider.refresh();
  assert.equal(provider.list().some((a) => a.kind === 'tailscale-name'), false);
});

test('without a reader the provider is just the interface list', () => {
  const provider = createAddressProvider({ interfaces: () => ({ 'Wi-Fi': [nic('192.168.1.6')] }) });
  assert.deepEqual(provider.list(), [{ ip: '192.168.1.6', kind: 'lan' }]);
});
