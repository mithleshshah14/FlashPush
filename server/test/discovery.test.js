'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { createDiscovery } = require('../src/discovery');

const identity = { laptopId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'MITHLESH-PC' };

async function boot(t, options = {}) {
  const discovery = createDiscovery({ identity, devicePort: 8765, ...options });
  const port = await discovery.start({ port: 0, host: '127.0.0.1' });
  t.after(() => discovery.stop());
  return port;
}

/** Sends one datagram and resolves with the reply text, or null if nothing arrives in `waitMs`. */
function probe(port, payload, waitMs = 150) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const finish = (value) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    socket.on('message', (msg) => finish(msg.toString()));
    socket.send(Buffer.from(payload), port, '127.0.0.1');
  });
}

test('answers a discover probe with the laptop identity and device port', async (t) => {
  const port = await boot(t);
  const reply = JSON.parse(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1 }), 1000));
  assert.deepEqual(reply, { t: 'FLASHPUSH_HERE', v: 1, laptopId: identity.laptopId, name: 'MITHLESH-PC', port: 8765 });
});

test('ignores garbage, other types, other versions and oversized datagrams', async (t) => {
  const port = await boot(t);
  assert.equal(await probe(port, 'not json'), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'SOMETHING_ELSE', v: 1 })), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 2 })), null);
  assert.equal(await probe(port, JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1, pad: 'x'.repeat(600) })), null);
});

test('limits how many probes one address gets answered', async (t) => {
  const port = await boot(t, { probesPer10s: 2 });
  const discover = JSON.stringify({ t: 'FLASHPUSH_DISCOVER', v: 1 });
  assert.notEqual(await probe(port, discover, 1000), null);
  assert.notEqual(await probe(port, discover, 1000), null);
  assert.equal(await probe(port, discover), null);
});

test('stop closes the socket and start can run again on the same port', async () => {
  const discovery = createDiscovery({ identity, devicePort: 8765 });
  const port = await discovery.start({ port: 0, host: '127.0.0.1' });
  await discovery.stop();
  const again = await discovery.start({ port, host: '127.0.0.1' });
  assert.equal(again, port);
  await discovery.stop();
});

test('start rejects when the port is already taken', async (t) => {
  const first = await boot(t);
  const second = createDiscovery({ identity, devicePort: 8765 });
  await assert.rejects(second.start({ port: first, host: '127.0.0.1' }), (e) => e.code === 'EADDRINUSE');
});
