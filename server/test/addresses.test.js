'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIp, listAddresses } = require('../src/addresses');

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
