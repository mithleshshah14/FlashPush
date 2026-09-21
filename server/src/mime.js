'use strict';

const path = require('node:path');

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

function mimeFromName(name) {
  return TYPES[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function isImage(mime) {
  return String(mime).startsWith('image/');
}

module.exports = { mimeFromName, isImage };
