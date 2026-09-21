'use strict';

const os = require('node:os');

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function ipv4ToInt(ip) {
  if (!IPV4.test(ip)) return null;
  const parts = ip.split('.').map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/** 'lan' (private ranges), 'tailscale' (100.64.0.0/10 or a tailscale-named interface), otherwise 'other'. */
function classifyIp(ip, interfaceName = '') {
  const n = ipv4ToInt(String(ip).replace(/^::ffff:/, ''));
  if (n === null) return 'other';
  if (inCidr(n, '100.64.0.0', 10) || /tailscale/i.test(interfaceName)) return 'tailscale';
  if (inCidr(n, '192.168.0.0', 16) || inCidr(n, '10.0.0.0', 8) || inCidr(n, '172.16.0.0', 12)) return 'lan';
  return 'other';
}

/** The laptop's usable IPv4 addresses, best first. */
function listAddresses(interfaces = os.networkInterfaces()) {
  const rank = { lan: 0, tailscale: 1, other: 2 };
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const nic of list || []) {
      if (nic.family !== 'IPv4' || nic.internal || nic.address.startsWith('169.254.')) continue;
      found.push({ ip: nic.address, kind: classifyIp(nic.address, name) });
    }
  }
  return found.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

module.exports = { classifyIp, listAddresses };
