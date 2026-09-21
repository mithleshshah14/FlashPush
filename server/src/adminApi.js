'use strict';

const fs = require('node:fs');
const { apiError } = require('./errors');
const { saveUpload } = require('./transfers');
const { isUuid } = require('./validate');
const web = require('./http');
const { serveFile } = require('./static');

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * The loopback admin API. The guard is a browser cross-site defence, not authentication:
 * anything running as the logged-in user on this laptop can still call it.
 */
function createAdminApi({ identity, devices, sessions, pairing, store, limits, receiveDir, outboxDir, addresses, getPorts, bus, notify, files, getStatus = () => ({ state: 'running', reason: null }), log = console.error }) {
  const streams = new Set();
  const laptop = { id: identity.laptopId, name: identity.name };

  function guard(req) {
    const host = web.headerValue(req, 'host');
    const { admin } = getPorts();
    if (!LOOPBACK.has(web.remoteAddress(req)) || (host !== `127.0.0.1:${admin}` && host !== `localhost:${admin}`)) {
      throw apiError('FORBIDDEN', 'Unexpected Host header.');
    }
    const origin = web.headerValue(req, 'origin');
    if (origin !== undefined && origin !== `http://${host}`) throw apiError('FORBIDDEN', 'Unexpected Origin.');
    const site = web.headerValue(req, 'sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') throw apiError('FORBIDDEN', 'Cross-site requests are not allowed.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && web.headerValue(req, 'x-flashpush-admin') !== '1') {
      throw apiError('FORBIDDEN', 'Missing X-FlashPush-Admin header.');
    }
  }

  /** Which phone a laptop-side send is for. */
  function targetDevice(deviceId) {
    if (deviceId !== undefined && deviceId !== null && deviceId !== '') {
      if (!isUuid(deviceId) || !devices.has(deviceId)) throw apiError('BAD_REQUEST', 'Unknown device.');
      return deviceId;
    }
    const all = devices.list();
    if (all.length === 1) return all[0].deviceId;
    throw apiError('BAD_REQUEST', all.length ? 'deviceId is required when several phones are paired.' : 'No phone is paired yet.');
  }

  const ping = (req, res) => web.sendJson(res, 200, { app: 'flashpush-admin', v: 1 });

  const state = (req, res) =>
    web.sendJson(res, 200, {
      laptop,
      addresses: addresses(),
      ports: getPorts(),
      status: getStatus(),
      receiveDir,
      pending: pairing.listPending(),
      devices: devices.list().map((d) => ({ ...d, connected: sessions.isConnected(d.deviceId) })),
      items: store.list(),
    });

  function openEvents(req, res) {
    const sse = web.openSse(req, res);
    const onChange = () => sse.send('changed', {});
    bus.on('changed', onChange);
    streams.add(sse);
    sse.onClose(() => {
      bus.off('changed', onChange);
      streams.delete(sse);
    });
  }

  function resolvePairing(action) {
    return (req, res, { params }) => {
      pairing[action](params.id);
      web.sendJson(res, 200, {});
    };
  }

  function revoke(req, res, { params }) {
    if (!isUuid(params.id)) throw apiError('BAD_REQUEST', 'Invalid device id.');
    const existed = devices.remove(params.id);
    sessions.endForDevice(params.id, 'revoked');
    if (!existed) throw apiError('NOT_FOUND');
    notify();
    web.sendJson(res, 200, {});
  }

  async function sendText(req, res) {
    const body = await web.readJson(req, limits.maxTextBytes + 1024);
    const deviceId = targetDevice(body.deviceId);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw apiError('BAD_REQUEST', 'text is required.');
    if (Buffer.byteLength(text) > limits.maxTextBytes) throw apiError('PAYLOAD_TOO_LARGE');
    web.sendJson(res, 201, store.add({ deviceId, kind: 'text', from: 'laptop', text }));
  }

  async function sendFile(req, res) {
    const deviceId = targetDevice(web.headerValue(req, 'x-device-id'));
    let name;
    try {
      name = decodeURIComponent(web.headerValue(req, 'x-filename') || 'file');
    } catch {
      throw apiError('BAD_REQUEST', 'X-Filename is not valid URL-encoding.');
    }
    const length = Number(web.headerValue(req, 'content-length'));
    const saved = await saveUpload({
      stream: req,
      dir: outboxDir,
      name,
      contentLength: Number.isInteger(length) ? length : undefined,
      limits,
      usedBytes: store.outboxBytes(),
      checkQuota: true,
    });
    web.sendJson(res, 201, store.add({ deviceId, kind: 'file', from: 'laptop', name: saved.name, size: saved.size, path: saved.path }));
  }

  function download(req, res, { params, url }) {
    const item = store.get(params.id);
    if (!item || item.kind !== 'file' || !fs.existsSync(item.path)) throw apiError('ITEM_NOT_FOUND');
    web.streamFile(res, item, web.canInline(item.mime, url.searchParams.get('inline') === '1'));
  }

  function deleteItem(req, res, { params }) {
    store.remove(params.id);
    web.sendJson(res, 200, {});
  }

  async function clearHistory(req, res) {
    const body = await web.readJson(req);
    const deviceId = body.deviceId === undefined ? undefined : targetDevice(body.deviceId);
    web.sendJson(res, 200, { removed: store.clear(deviceId) });
  }

  const route = web.createRouter([
    ['GET', '/admin/ping', ping],
    ['GET', '/admin/state', state],
    ['GET', '/admin/events', openEvents],
    ['POST', '/admin/pair/:id/approve', resolvePairing('approve')],
    ['POST', '/admin/pair/:id/deny', resolvePairing('deny')],
    ['DELETE', '/admin/devices/:id', revoke],
    ['POST', '/admin/text', sendText],
    ['POST', '/admin/file', sendFile],
    ['GET', '/admin/files/:id', download],
    ['DELETE', '/admin/items/:id', deleteItem],
    ['POST', '/admin/history/clear', clearHistory],
  ]);

  async function handler(req, res) {
    try {
      guard(req);
      const url = new URL(req.url, 'http://localhost');
      const file = req.method === 'GET' ? files.get(url.pathname) : undefined;
      if (file) return serveFile(res, file);
      const match = route(req.method, url.pathname);
      if (!match) throw apiError('NOT_FOUND');
      await match.handler(req, res, { params: match.params, url });
    } catch (err) {
      web.sendError(res, err, log);
    }
  }

  function closeAll() {
    for (const sse of [...streams]) sse.close();
  }

  return { handler, closeAll };
}

module.exports = { createAdminApi };
