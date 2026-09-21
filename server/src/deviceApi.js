'use strict';

const fs = require('node:fs');
const { apiError } = require('./errors');
const { createLimiter } = require('./ratelimit');
const { classifyIp } = require('./addresses');
const { saveUpload } = require('./transfers');
const web = require('./http');

const OPERATION_ID = /^[\w-]{8,64}$/;
const MAX_STREAMS_PER_DEVICE = 2;

const withoutDevice = ({ deviceId: _deviceId, ...item }) => item;

function createDeviceApi({ identity, devices, sessions, pairing, store, ops, limits, receiveDir, addresses, notify = () => {}, now = Date.now, log = console.error }) {
  const authFailures = createLimiter({ max: limits.maxFailedAuthPerMinutePerIp, windowMs: 60_000, now });
  const streams = new Map(); // deviceId -> Set<sse>
  const laptop = { id: identity.laptopId, name: identity.name };
  const routeOf = (req) => classifyIp(web.remoteAddress(req));

  // ---- authentication -------------------------------------------------------

  function assertNotBlocked(req) {
    const state = authFailures.isBlocked(web.remoteAddress(req));
    if (state.blocked) throw apiError('RATE_LIMITED', undefined, { retryAfterMs: state.retryAfterMs });
  }

  function fail(req, code) {
    authFailures.record(web.remoteAddress(req));
    return apiError(code);
  }

  function requireSession(req) {
    assertNotBlocked(req);
    const token = web.bearerToken(req);
    if (!token) throw fail(req, 'UNAUTHORIZED');
    const session = sessions.verify(token);
    if (!session) throw fail(req, 'SESSION_EXPIRED');
    devices.touch(session.deviceId, routeOf(req));
    return { deviceId: session.deviceId, token };
  }

  // ---- idempotency ----------------------------------------------------------

  async function withOperation(deviceId, req, res, work) {
    const opId = web.headerValue(req, 'x-operation-id');
    if (opId === undefined) return web.sendJson(res, 201, await work());
    if (!OPERATION_ID.test(opId)) throw apiError('BAD_REQUEST', 'X-Operation-Id must be 8-64 letters, digits, - or _.');
    const state = ops.begin(deviceId, opId);
    if (state.state === 'done') {
      req.resume();
      return web.sendJson(res, 200, state.result);
    }
    if (state.state === 'pending') {
      req.resume();
      throw apiError('RATE_LIMITED', 'This transfer is still in progress. Retry shortly.', { retryAfterMs: 1000 });
    }
    try {
      const result = await work();
      ops.complete(deviceId, opId, result);
      return web.sendJson(res, 201, result);
    } catch (err) {
      ops.fail(deviceId, opId);
      throw err;
    }
  }

  // ---- live events ----------------------------------------------------------

  function broadcast(deviceId, event, data) {
    for (const sse of streams.get(deviceId) || []) sse.send(event, data);
  }
  store.on('add', ({ item, deviceId }) => broadcast(deviceId, 'item-added', item));
  store.on('delete', ({ id, deviceId }) => broadcast(deviceId, 'item-deleted', { id }));
  sessions.on('end', ({ deviceId, reason }) => {
    const set = streams.get(deviceId);
    if (!set) return;
    for (const sse of [...set]) {
      if (reason !== 'disconnected' && reason !== 'shutdown') sse.send('expired', { reason });
      sse.close();
    }
    streams.delete(deviceId);
  });

  // ---- handlers -------------------------------------------------------------

  const hello = (req, res) => web.sendJson(res, 200, { app: 'flashpush', v: 1, laptopId: laptop.id, name: laptop.name });

  async function pairRequest(req, res) {
    const body = await web.readJson(req);
    const out = pairing.request({
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      commit: body.commit,
      remoteIp: web.remoteAddress(req),
      route: routeOf(req),
    });
    web.sendJson(res, 200, out);
  }

  async function pairReveal(req, res) {
    const body = await web.readJson(req);
    web.sendJson(res, 200, pairing.reveal({ requestId: body.requestId, np: body.np }));
  }

  function pairStatus(req, res, { params, url }) {
    const out = pairing.status({
      requestId: params.id,
      deviceId: url.searchParams.get('deviceId'),
      proof: web.headerValue(req, 'x-pair-proof'),
    });
    if (out.state === 'approved') Object.assign(out, { laptop, addresses: addresses() });
    web.sendJson(res, 200, out);
  }

  function connect(req, res) {
    assertNotBlocked(req);
    const credentials = web.deviceCredentials(req);
    if (!credentials) throw fail(req, 'UNAUTHORIZED');
    const { result } = devices.verify(credentials.deviceId, credentials.secret);
    if (result !== 'ok') throw fail(req, result === 'unknown' ? 'DEVICE_NOT_PAIRED' : 'UNAUTHORIZED');
    devices.touch(credentials.deviceId, routeOf(req));
    const session = sessions.create(credentials.deviceId);
    web.sendJson(res, 200, { sessionToken: session.token, expiresAt: session.expiresAt, laptop, addresses: addresses() });
  }

  function disconnect(req, res) {
    const { token } = requireSession(req);
    sessions.endByToken(token, 'disconnected');
    web.sendJson(res, 200, {});
  }

  function forgetSelf(req, res) {
    const { deviceId } = requireSession(req);
    devices.remove(deviceId);
    sessions.endForDevice(deviceId, 'disconnected');
    notify();
    web.sendJson(res, 200, {});
  }

  function listItems(req, res) {
    const { deviceId } = requireSession(req);
    web.sendJson(res, 200, { items: store.list(deviceId) });
  }

  function openEvents(req, res) {
    const { deviceId } = requireSession(req);
    const sse = web.openSse(req, res);
    let set = streams.get(deviceId);
    if (!set) streams.set(deviceId, (set = new Set()));
    while (set.size >= MAX_STREAMS_PER_DEVICE) {
      const oldest = set.values().next().value;
      set.delete(oldest);
      oldest.close();
    }
    set.add(sse);
    sse.onClose(() => set.delete(sse));
  }

  async function sendText(req, res) {
    const { deviceId } = requireSession(req);
    const body = await web.readJson(req, limits.maxTextBytes + 1024);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw apiError('BAD_REQUEST', 'text is required.');
    if (Buffer.byteLength(text) > limits.maxTextBytes) throw apiError('PAYLOAD_TOO_LARGE');
    await withOperation(deviceId, req, res, async () => withoutDevice(store.add({ deviceId, kind: 'text', from: 'phone', text })));
  }

  async function sendFile(req, res) {
    const { deviceId } = requireSession(req);
    let name;
    try {
      name = decodeURIComponent(web.headerValue(req, 'x-filename') || 'file');
    } catch {
      throw apiError('BAD_REQUEST', 'X-Filename is not valid URL-encoding.');
    }
    const length = Number(web.headerValue(req, 'content-length'));
    await withOperation(deviceId, req, res, async () => {
      const saved = await saveUpload({
        stream: req,
        dir: receiveDir,
        name,
        contentLength: Number.isInteger(length) ? length : undefined,
        limits,
      });
      return withoutDevice(store.add({ deviceId, kind: 'file', from: 'phone', name: saved.name, size: saved.size, path: saved.path }));
    });
  }

  function download(req, res, { params, url }) {
    const { deviceId } = requireSession(req);
    const item = store.get(params.id);
    if (!item || item.deviceId !== deviceId || item.kind !== 'file' || !fs.existsSync(item.path)) throw apiError('ITEM_NOT_FOUND');
    web.streamFile(res, item, web.canInline(item.mime, url.searchParams.get('inline') === '1'));
  }

  function deleteItem(req, res, { params }) {
    const { deviceId } = requireSession(req);
    const item = store.get(params.id);
    if (item && item.deviceId === deviceId) store.remove(params.id);
    web.sendJson(res, 200, {});
  }

  const route = web.createRouter([
    ['GET', '/v1/hello', hello],
    ['POST', '/v1/pair/request', pairRequest],
    ['POST', '/v1/pair/reveal', pairReveal],
    ['GET', '/v1/pair/status/:id', pairStatus],
    ['POST', '/v1/session', connect],
    ['DELETE', '/v1/session', disconnect],
    ['DELETE', '/v1/devices/self', forgetSelf],
    ['GET', '/v1/items', listItems],
    ['GET', '/v1/events', openEvents],
    ['POST', '/v1/text', sendText],
    ['POST', '/v1/file', sendFile],
    ['GET', '/v1/files/:id', download],
    ['DELETE', '/v1/items/:id', deleteItem],
  ]);

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const match = route(req.method, url.pathname);
      if (!match) throw apiError('NOT_FOUND');
      await match.handler(req, res, { params: match.params, url });
    } catch (err) {
      web.sendError(res, err, log);
    }
  }

  function closeAll() {
    for (const set of streams.values()) for (const sse of [...set]) sse.close();
    streams.clear();
  }

  return { handler, closeAll };
}

module.exports = { createDeviceApi };
