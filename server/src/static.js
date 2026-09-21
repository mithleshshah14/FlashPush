'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const PAGE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function walk(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`, out);
    else if (entry.isFile() && TYPES[path.extname(entry.name).toLowerCase()]) out.set(`${prefix}${entry.name}`, path.join(dir, entry.name));
  }
}

/**
 * Reads the admin UI once at start-up into a Map keyed by URL path. Requests are only ever looked up in
 * this Map, so no URL can become a file path: `index.html` is served at `/`, everything else from `assets/`.
 */
function loadPublicFiles(publicDir) {
  const files = new Map();
  const found = new Map();
  try {
    walk(path.join(publicDir, 'assets'), '/assets/', found);
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) found.set('/', index);
  } catch {
    return files; // no assets folder: nothing to serve
  }
  for (const [urlPath, file] of found) {
    const type = TYPES[path.extname(file).toLowerCase()];
    files.set(urlPath, { type, body: fs.readFileSync(file), html: type.startsWith('text/html') });
  }
  return files;
}

function serveFile(res, file) {
  res.writeHead(200, {
    'Content-Type': file.type,
    'Content-Length': file.body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...(file.html ? PAGE_HEADERS : {}),
  });
  res.end(file.body);
}

module.exports = { loadPublicFiles, serveFile };
