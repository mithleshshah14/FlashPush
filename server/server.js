'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 8765;
const DATA_DIR = path.join(__dirname, 'data');
const OUTBOX_DIR = path.join(DATA_DIR, 'outbox'); // files sent laptop -> phone
const RECEIVE_DIR =
  process.env.RECEIVE_DIR || path.join(os.homedir(), 'Downloads', 'FlashPush'); // files sent phone -> laptop
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const MAX_JSON_BYTES = 5 * 1024 * 1024;

for (const dir of [DATA_DIR, OUTBOX_DIR, RECEIVE_DIR]) fs.mkdirSync(dir, { recursive: true });

// ---------------------------------------------------------------- state

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const config = loadJson(CONFIG_FILE, {});
if (!config.token) {
  config.token = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const TOKEN = config.token;

/** @type {Array<{id:string,kind:'text'|'file',from:'phone'|'laptop',time:number,text?:string,name?:string,size?:number,path?:string}>} */
let items = loadJson(ITEMS_FILE, []).filter((it) => it.kind === 'text' || (it.path && fs.existsSync(it.path)));

function saveItems() {
  fs.writeFile(ITEMS_FILE, JSON.stringify(items), (err) => err && console.error('Could not save items:', err.message));
}

function publicItem(it) {
  const { path: _path, ...rest } = it;
  return rest;
}

const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function addItem(item) {
  items.push(item);
  saveItems();
  broadcast({ type: 'add', item: publicItem(item) });
  return item;
}

// ---------------------------------------------------------------- helpers

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

function isAuthorized(req, url) {
  const given = String(req.headers['x-token'] || url.searchParams.get('t') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFilename(name) {
  const base = path.basename(String(name).replace(/\\/g, '/'));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 200) || 'file';
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

function normalizeFrom(value) {
  return value === 'laptop' ? 'laptop' : 'phone';
}

function lanUrls() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === 'IPv4' && !nic.internal && !nic.address.startsWith('169.254.')) ips.push(nic.address);
    }
  }
  ips.sort((a, b) => rank(a) - rank(b));
  return ips.map((ip) => `http://${ip}:${PORT}/?t=${TOKEN}`);
}

// ---------------------------------------------------------------- routes

async function handleUploadFile(req, res, url) {
  let rawName;
  try {
    rawName = decodeURIComponent(req.headers['x-filename'] || url.searchParams.get('name') || 'file');
  } catch {
    return sendJson(res, 400, { error: 'Bad X-Filename header' });
  }
  const from = normalizeFrom(req.headers['x-from'] || url.searchParams.get('from'));
  const name = sanitizeFilename(rawName);
  const dest = uniquePath(from === 'phone' ? RECEIVE_DIR : OUTBOX_DIR, name);

  try {
    await pipeline(req, fs.createWriteStream(dest, { flags: 'wx' }));
  } catch (err) {
    fs.rm(dest, { force: true }, () => {});
    throw err;
  }

  const { size } = await fs.promises.stat(dest);
  const item = addItem({
    id: crypto.randomUUID(),
    kind: 'file',
    from,
    time: Date.now(),
    name: path.basename(dest),
    size,
    path: dest,
  });
  console.log(`[${from === 'phone' ? 'phone → laptop' : 'laptop → phone'}] file "${item.name}" (${size} bytes)`);
  sendJson(res, 201, publicItem(item));
}

async function handleUploadText(req, res) {
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return sendJson(res, 400, { error: 'Empty text' });
  const item = addItem({
    id: crypto.randomUUID(),
    kind: 'text',
    from: normalizeFrom(body.from),
    time: Date.now(),
    text,
  });
  console.log(`[${item.from === 'phone' ? 'phone → laptop' : 'laptop → phone'}] text (${text.length} chars)`);
  sendJson(res, 201, publicItem(item));
}

function handleDownload(req, res, url, id) {
  const item = items.find((it) => it.id === id && it.kind === 'file');
  if (!item || !fs.existsSync(item.path)) return sendText(res, 404, 'Not found');

  const ext = path.extname(item.name).toLowerCase();
  const inline = url.searchParams.get('inline') === '1' && MIME[ext];
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': item.size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.name)}`,
    'X-Content-Type-Options': 'nosniff',
  };
  res.writeHead(200, headers);
  const stream = fs.createReadStream(item.path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function handleDelete(res, id) {
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return sendJson(res, 404, { error: 'Not found' });
  const [item] = items.splice(idx, 1);
  // Only remove files we keep in the outbox; files received from the phone stay in the user's Downloads folder.
  if (item.kind === 'file' && item.path && item.path.startsWith(OUTBOX_DIR)) fs.rm(item.path, { force: true }, () => {});
  saveItems();
  broadcast({ type: 'delete', id });
  sendJson(res, 200, { ok: true });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  // The web UI: open freely from this laptop, or from anywhere with the token in the link.
  if (req.method === 'GET' && pathname === '/') {
    if (!isLoopback(req) && !isAuthorized(req, url)) {
      return sendText(res, 401, 'Scan the QR code shown on the FlashPush page on your laptop to connect.');
    }
    const html = fs.readFileSync(INDEX_HTML, 'utf8').replace('__FLASHPUSH_TOKEN__', TOKEN);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (!pathname.startsWith('/api/') && !pathname.startsWith('/files/')) return sendText(res, 404, 'Not found');
  if (!isAuthorized(req, url)) return sendJson(res, 401, { error: 'Bad or missing token' });

  if (req.method === 'GET' && pathname === '/api/ping') return sendJson(res, 200, { app: 'flashpush', ok: true });
  if (req.method === 'GET' && pathname === '/api/items') return sendJson(res, 200, items.map(publicItem));
  if (req.method === 'GET' && pathname === '/api/events') return handleEvents(req, res);
  if (req.method === 'POST' && pathname === '/api/text') return handleUploadText(req, res);
  if (req.method === 'POST' && pathname === '/api/file') return handleUploadFile(req, res, url);

  if (req.method === 'GET' && pathname === '/api/info') {
    const urls = lanUrls();
    const qr = urls.length ? await QRCode.toString(urls[0], { type: 'svg', margin: 1, width: 220 }) : '';
    return sendJson(res, 200, { urls, qr, receiveDir: RECEIVE_DIR, hostname: os.hostname() });
  }

  const fileMatch = pathname.match(/^\/files\/([\w-]+)$/);
  if (req.method === 'GET' && fileMatch) return handleDownload(req, res, url, fileMatch[1]);

  const itemMatch = pathname.match(/^\/api\/items\/([\w-]+)$/);
  if (req.method === 'DELETE' && itemMatch) return handleDelete(res, itemMatch[1]);

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    if (err.status !== 413) console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || 'Internal error' });
    else res.end();
  });
});

server.requestTimeout = 0; // large uploads over Wi-Fi can take a long time
server.headersTimeout = 60000;

server.listen(PORT, '0.0.0.0', async () => {
  const urls = lanUrls();
  console.log('\n  FlashPush is running\n');
  console.log(`  On this laptop:  http://localhost:${PORT}`);
  if (urls.length) {
    console.log('  On your phone (same Wi-Fi):');
    for (const u of urls) console.log(`    ${u}`);
    try {
      console.log('\n' + (await QRCode.toString(urls[0], { type: 'terminal', small: true })));
    } catch {
      /* QR in the terminal is a nicety only */
    }
  } else {
    console.log('  No network connection found. Connect to Wi-Fi and restart.');
  }
  console.log(`  Files from your phone are saved to: ${RECEIVE_DIR}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Set another with: set PORT=9000`);
  else console.error(err);
  process.exit(1);
});
