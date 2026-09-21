'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Lifecycle, listenFailureReason, createTracker } = require('../src/lifecycle');

test('starts in the starting state', () => {
  assert.deepEqual(new Lifecycle().status(), { state: 'starting', reason: null });
});

test('running and degraded set state and reason, and emit one change each', () => {
  const life = new Lifecycle();
  const seen = [];
  life.on('change', (s) => seen.push(s));
  life.running();
  life.running(); // no change, no event
  life.degraded('Port 8765 is used by another program.');
  life.degraded('Port 8765 is used by another program.');
  assert.deepEqual(seen, [
    { state: 'running', reason: null },
    { state: 'degraded', reason: 'Port 8765 is used by another program.' },
  ]);
});

test('stopped is final', () => {
  const life = new Lifecycle();
  life.stopped();
  life.running();
  life.degraded('x');
  assert.deepEqual(life.status(), { state: 'stopped', reason: null });
});

test('status returns a copy', () => {
  const life = new Lifecycle();
  life.status().state = 'hacked';
  assert.equal(life.status().state, 'starting');
});

test('listenFailureReason explains a taken port and other errors', () => {
  assert.equal(listenFailureReason({ code: 'EADDRINUSE' }, 8765), 'Port 8765 is used by another program.');
  assert.equal(listenFailureReason({ code: 'EADDRINUSE', port: 9000 }, 8765), 'Port 9000 is used by another program.');
  assert.equal(listenFailureReason({ code: 'EADDRINUSE' }, 8766, 'UDP'), 'UDP port 8766 is used by another program.');
  assert.equal(listenFailureReason({ code: 'EACCES', message: 'denied' }, 80), 'Could not listen on port 80: denied');
});

function fakeServer() {
  const server = new EventEmitter();
  const request = (url = '/v1/items') => {
    const req = { url };
    const res = new EventEmitter();
    server.emit('request', req, res);
    return res;
  };
  return { server, request };
}

test('tracker is idle with no requests and waits for a running one', async () => {
  const { server, request } = fakeServer();
  const tracker = createTracker();
  tracker.attach(server);
  assert.equal(await tracker.whenIdle(50), true);
  const res = request();
  let done = false;
  const idle = tracker.whenIdle(2000).then((v) => {
    done = v;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(done, false);
  res.emit('close');
  await idle;
  assert.equal(done, true);
});

test('tracker times out while a request is still running', async () => {
  const { server, request } = fakeServer();
  const tracker = createTracker();
  tracker.attach(server);
  request();
  assert.equal(await tracker.whenIdle(30), false);
});

test('event streams do not count as active work', async () => {
  const { server, request } = fakeServer();
  const tracker = createTracker();
  tracker.attach(server);
  request('/v1/events');
  request('/admin/events?x=1');
  assert.equal(await tracker.whenIdle(30), true);
});
