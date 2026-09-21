'use strict';

const fs = require('node:fs');
const { apiError, envelope, ApiError } = require('./errors');
const { isImage } = require('./mime');

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

/** The one exit for every error: documented JSON envelope, nothing internal leaks. */
function sendError(res, err, log = console.error) {
  const known = err instanceof ApiError;
  if (!known) log(err);
  if (res.headersSent) return res.destroy();
  const e = known ? err : apiError('INTERNAL');
  const headers = e.retryAfterMs !== undefined ? { 'Retry-After': String(Math.max(1, Math.ceil(e.retryAfterMs / 1000))) } : {};
  sendJson(res, e.status, envelope(e), headers);
}

/** Reads a JSON object body. Always drains the request so the client still gets a response. */
function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > maxBytes) {
      req.resume();
      return reject(apiError('PAYLOAD_TOO_LARGE'));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > maxBytes) return reject(apiError('PAYLOAD_TOO_LARGE'));
      if (!size) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(apiError('BAD_REQUEST', 'The body must be a JSON object.'));
      }
    });
  });
}

const remoteAddress = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req) {
  const match = /^Bearer ([\w-]+)$/.exec(headerValue(req, 'authorization') || '');
  return match ? match[1] : null;
}

function deviceCredentials(req) {
  const match = /^Device ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([\w-]+)$/.exec(headerValue(req, 'authorization') || '');
  return match ? { deviceId: match[1], secret: match[2] } : null;
}

/** routes: [[method, '/v1/items/:id', handler], ...] → (method, pathname) => { handler, params } | null */
function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => ({
    method,
    handler,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`),
  }));
  return (method, pathname) => {
    for (const route of compiled) {
      const match = route.method === method && route.regex.exec(pathname);
      if (match) return { handler: route.handler, params: { ...match.groups } };
    }
    return null;
  };
}

/** Server-sent events: named events with JSON data and a comment heartbeat. */
function openSse(req, res, { heartbeatMs = 25_000 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const timer = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
  res.on('close', () => clearInterval(timer));
  return {
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      clearInterval(timer);
      if (!res.writableEnded) res.end();
    },
    onClose: (fn) => res.on('close', fn),
  };
}

/** Inline display is allowed only for raster images: an SVG can carry script. */
const canInline = (mime, wanted) => Boolean(wanted) && isImage(mime) && mime !== 'image/svg+xml';

function streamFile(res, { path: filePath, name, mime }, inline) {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': fs.statSync(filePath).size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

module.exports = { sendJson, sendError, readJson, remoteAddress, headerValue, bearerToken, deviceCredentials, createRouter, openSse, canInline, streamFile };
