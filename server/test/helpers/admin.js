'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const c = require('../../src/crypto');
const { DEFAULT_LIMITS } = require('../../src/config');
const { DeviceStore } = require('../../src/devices');
const { SessionStore } = require('../../src/sessions');
const { PairingManager } = require('../../src/pairing');
const { ItemStore } = require('../../src/store');
const { createAdminApi } = require('../../src/adminApi');
const { loadPublicFiles } = require('../../src/static');
const { makePublicDir } = require('./public-dir');
const { tmpDir } = require('./tmp');

/** Mounts the real admin API on a loopback HTTP server. */
async function startAdmin(t, limitOverrides = {}) {
  const dir = tmpDir(t);
  const receiveDir = path.join(dir, 'received');
  const outboxDir = path.join(dir, 'outbox');
  fs.mkdirSync(receiveDir);
  fs.mkdirSync(outboxDir);
  const limits = { ...DEFAULT_LIMITS, minFreeDiskBytes: 0, ...limitOverrides };
  const devices = new DeviceStore({ file: path.join(dir, 'devices.json'), limits });
  const sessions = new SessionStore({ idleMs: limits.sessionIdleMs, maxMs: limits.sessionMaxMs });
  const pairing = new PairingManager({ devices, fingerprint: Buffer.alloc(32, 7), limits });
  const store = new ItemStore({ file: path.join(dir, 'items.json'), outboxDir, limits });
  const bus = new EventEmitter();
  const ports = { device: 8765, admin: 0, discovery: 8766 };
  const api = createAdminApi({
    identity: { laptopId: 'aaaaaaaa-0000-4000-8000-0000000000aa', name: 'TEST-PC' },
    devices,
    sessions,
    pairing,
    store,
    limits,
    receiveDir,
    outboxDir,
    addresses: () => [{ ip: '192.168.1.6', kind: 'lan' }],
    getPorts: () => ({ ...ports }),
    bus,
    notify: () => bus.emit('changed'),
    files: loadPublicFiles(makePublicDir(path.join(dir, 'public'))),
    log: () => {},
  });
  const server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ports.admin = server.address().port;
  t.after(async () => {
    api.closeAll();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  async function call(method, urlPath, { headers = {}, json, body, host } = {}) {
    const h = { host: host || `127.0.0.1:${ports.admin}`, ...headers };
    if (method !== 'GET' && !('x-flashpush-admin' in h)) h['x-flashpush-admin'] = '1';
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    // node:http (not fetch) so the Host header can be forged in the guard tests; agent:false so no socket is reused after a stop
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ports.admin, method, path: urlPath, headers: h, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          let parsed = null;
          try {
            parsed = JSON.parse(buffer.toString('utf8'));
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json: parsed, text: buffer.toString('utf8'), buffer });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  /** Opens the admin event stream and resolves the next named event (or null). */
  function events() {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ports.admin, path: '/admin/events', headers: { host: `127.0.0.1:${ports.admin}` }, agent: false }, (res) => {
        let buffer = '';
        const waiters = [];
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const match = /^event: (.*)$/m.exec(block);
            if (match && waiters.length) waiters.shift()(match[1]);
          }
        });
        resolve({
          status: res.statusCode,
          next: (ms = 1500) => new Promise((r) => {
            waiters.push(r);
            setTimeout(() => r(null), ms);
          }),
          close: () => req.destroy(),
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  /** Adds an approved phone directly (the pairing flow itself is covered elsewhere). */
  function addPhone(name = 'Pixel 7') {
    const deviceId = crypto.randomUUID();
    devices.add({ deviceId, name, secret: c.random(32) });
    return deviceId;
  }

  return { call, events, pairing, devices, sessions, store, bus, get adminPort() { return ports.admin; }, receiveDir, outboxDir, addPhone };
}

module.exports = { startAdmin };
