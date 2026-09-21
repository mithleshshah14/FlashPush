'use strict';

const dgram = require('node:dgram');
const { createLimiter } = require('./ratelimit');

const MAX_DATAGRAM = 512;

/** Answers "is there a FlashPush laptop here?" broadcasts. The reply is a hint; trust comes from TLS pinning. */
function createDiscovery({ identity, devicePort, probesPer10s = 20 }) {
  const limiter = createLimiter({ max: probesPer10s, windowMs: 10_000 });
  const reply = Buffer.from(
    JSON.stringify({ t: 'FLASHPUSH_HERE', v: 1, laptopId: identity.laptopId, name: identity.name, port: devicePort }),
  );
  let socket = null;

  function onMessage(msg, rinfo) {
    if (msg.length > MAX_DATAGRAM) return;
    let probe;
    try {
      probe = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!probe || probe.t !== 'FLASHPUSH_DISCOVER' || probe.v !== 1) return;
    if (!limiter.attempt(rinfo.address).allowed) return;
    socket.send(reply, rinfo.port, rinfo.address);
  }

  function start({ port, host = '0.0.0.0' }) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      s.once('error', reject);
      s.on('message', onMessage);
      s.bind(port, host, () => {
        s.off('error', reject);
        s.on('error', () => {}); // a stray send error must not crash the server
        socket = s;
        resolve(s.address().port);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!socket) return resolve();
      const s = socket;
      socket = null;
      s.close(resolve);
    });
  }

  return { start, stop };
}

module.exports = { createDiscovery };
