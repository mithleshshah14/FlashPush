'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { apiError } = require('./errors');
const { isInside } = require('./store');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Reduces anything a client sends to a safe, non-empty file name (never a path). */
function sanitizeFilename(name, max = 200) {
  const slashed = String(name ?? '').replace(/\\/g, '/');
  let base = slashed.slice(slashed.lastIndexOf('/') + 1); // basename: drops ../, absolute, drive and UNC prefixes
  base = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (RESERVED.test(base)) base = `_${base}`;
  if (base.length > max) {
    const ext = path.extname(base).slice(0, 20);
    base = base.slice(0, max - ext.length) + ext;
  }
  return base || 'file';
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

async function defaultFreeBytes(dir) {
  const s = await fs.promises.statfs(dir);
  return s.bavail * s.bsize;
}

/**
 * Streams an upload into `dir` as a .part file and renames it on success.
 * The final name is chosen synchronously right before the rename, so two uploads of the same name cannot collide.
 */
async function saveUpload({ stream, dir, name, contentLength, limits, usedBytes = 0, checkQuota = false, freeBytes = defaultFreeBytes }) {
  if (!Number.isInteger(contentLength) || contentLength < 0) throw apiError('BAD_REQUEST', 'Content-Length is required.');
  if (contentLength > limits.maxFileBytes) throw apiError('PAYLOAD_TOO_LARGE');
  if (checkQuota && usedBytes + contentLength > limits.maxOutboxBytes) throw apiError('STORAGE_QUOTA');
  fs.mkdirSync(dir, { recursive: true });
  if ((await freeBytes(dir)) - contentLength < limits.minFreeDiskBytes) throw apiError('INSUFFICIENT_STORAGE');

  const safeName = sanitizeFilename(name, limits.maxFilenameLength);
  const part = path.join(dir, `${safeName}.${crypto.randomBytes(4).toString('hex')}.part`);
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(received > contentLength ? new Error('more bytes than Content-Length') : null, chunk);
    },
  });

  try {
    await pipeline(stream, counter, fs.createWriteStream(part, { flags: 'wx' }));
    if (received !== contentLength) throw new Error('fewer bytes than Content-Length');
    const finalPath = uniquePath(dir, safeName);
    if (!isInside(dir, finalPath)) throw new Error('path escaped the target folder');
    fs.renameSync(part, finalPath);
    return { path: finalPath, name: path.basename(finalPath), size: received };
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err.code && err.status ? err : apiError('BAD_REQUEST', 'The upload was interrupted or its size did not match.');
  }
}

/** Removes .part files left behind by a crash. */
function sweepPartFiles(dir) {
  let removed = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.part')) {
        fs.rmSync(path.join(dir, file), { force: true });
        removed++;
      }
    }
  } catch {
    /* folder does not exist yet */
  }
  return removed;
}

module.exports = { sanitizeFilename, saveUpload, sweepPartFiles };
