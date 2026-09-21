'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const c = require('../../src/crypto');
const { DEFAULT_LIMITS } = require('../../src/config');
const { DeviceStore } = require('../../src/devices');
const { SessionStore } = require('../../src/sessions');
const { PairingManager } = require('../../src/pairing');
const { ItemStore } = require('../../src/store');
const { OperationCache } = require('../../src/idempotency');
const { createDeviceApi } = require('../../src/deviceApi');
const { tmpDir } = require('./tmp');

/** Mounts the real device API on a plain HTTP server (TLS is covered by the end-to-end test). */
async function startApi(t, limitOverrides = {}) {
  const dir = tmpDir(t);
  const receiveDir = path.join(dir, 'received');
  const outboxDir = path.join(dir, 'outbox');
  fs.mkdirSync(receiveDir);
  fs.mkdirSync(outboxDir);
  const limits = { ...DEFAULT_LIMITS, minFreeDiskBytes: 0, ...limitOverrides };
  const fingerprint = Buffer.alloc(32, 7);
  const devices = new DeviceStore({ file: path.join(dir, 'devices.json'), limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint, limits });
  const store = new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits });
  const ops = new OperationCache({ max: limits.idempotencyMaxEntries, ttlMs: limits.idempotencyTtlMs });
  const identity = { laptopId: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' };
  const api = createDeviceApi({
    identity,
    devices,
    sessions,
    pairing,
    store,
    ops,
    limits,
    receiveDir,
    addresses: () => [{ ip: '192.168.1.6', kind: 'lan' }],
    log: () => {},
  });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    api.closeAll();
    sessions.endAll('shutdown');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, urlPath, { token, headers = {}, json, body } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    const res = await fetch(base + urlPath, { method, headers: h, body: payload });
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, json: parsed, text, buffer };
  }

  async function events(token) {
    const res = await fetch(`${base}/v1/events`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) return { status: res.status, next: async () => null, close() {} };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function next(timeoutMs = 2000) {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith(':')) continue; // heartbeat / connected comment
          const event = /^event: (.*)$/m.exec(block);
          const data = /^data: (.*)$/m.exec(block);
          return { event: event && event[1], data: data && JSON.parse(data[1]) };
        }
        const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), timeoutMs))]);
        if (chunk.timeout || chunk.done) return null;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
    return { status: 200, next, close: () => reader.cancel().catch(() => {}) };
  }

  async function pairDevice(name = 'Pixel 7', deviceId = crypto.randomUUID()) {
    const np = c.random(16);
    const first = await call('POST', '/v1/pair/request', { json: { deviceId, deviceName: name, commit: c.b64uEncode(c.commitOf(np)) } });
    const { requestId } = first.json;
    await call('POST', '/v1/pair/reveal', { json: { requestId, np: c.b64uEncode(np) } });
    pairing.approve(requestId);
    const proof = c.pairProof(np, c.b64uDecode(requestId, 16), deviceId);
    const status = await call('GET', `/v1/pair/status/${requestId}?deviceId=${deviceId}`, { headers: { 'x-pair-proof': proof } });
    const secret = status.json.secret;
    const session = await call('POST', '/v1/session', { headers: { authorization: `Device ${deviceId}:${secret}` } });
    return { deviceId, secret, token: session.json.sessionToken };
  }

  return { base, call, events, pairDevice, api, devices, sessions, pairing, store, ops, receiveDir, outboxDir, limits, fingerprint };
}

module.exports = { startApi };
