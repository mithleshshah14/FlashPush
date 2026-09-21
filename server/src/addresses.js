'use strict';

const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

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

/** The laptop's MagicDNS name from `tailscale status --json`, or null when it is not a plain host name. */
function parseTailscaleName(jsonText) {
  let name;
  try {
    name = JSON.parse(jsonText).Self.DNSName;
  } catch {
    return null;
  }
  if (typeof name !== 'string') return null;
  const host = name.replace(/\.$/, '').toLowerCase();
  return host.length > 0 && host.length <= 253 && HOST_NAME.test(host) ? host : null;
}

/** Best effort: no Tailscale CLI, a failure or a timeout all mean "no name". `exec` is injectable for tests. */
async function readTailscaleName(exec = async (file, args, options) => (await execFileAsync(file, args, options)).stdout) {
  try {
    return parseTailscaleName(await exec('tailscale', ['status', '--json'], { timeout: 2000, windowsHide: true }));
  } catch {
    return null;
  }
}

/**
 * The address list shown to phones: interface addresses plus, once `refresh()` has run, the MagicDNS name
 * (placed after the LAN addresses and before the Tailscale IP, since a name survives IP changes).
 */
function createAddressProvider({ interfaces = os.networkInterfaces, readName } = {}) {
  let name = null;

  function list() {
    const addresses = listAddresses(interfaces());
    if (name) {
      const at = addresses.findIndex((a) => a.kind !== 'lan');
      addresses.splice(at === -1 ? addresses.length : at, 0, { name, kind: 'tailscale-name' });
    }
    return addresses;
  }

  async function refresh() {
    if (!readName) return;
    try {
      name = await readName();
    } catch {
      /* keep the last known name */
    }
  }

  return { list, refresh };
}

module.exports = { classifyIp, listAddresses, parseTailscaleName, readTailscaleName, createAddressProvider };
