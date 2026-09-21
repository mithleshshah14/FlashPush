'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** A small public folder for tests, including files that must never be served. */
function makePublicDir(dir) {
  const write = (rel, content) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('index.html', '<!doctype html><title>FlashPush</title>');
  write('assets/app.js', 'export const x = 1;');
  write('assets/views/x.js', 'export const y = 2;');
  write('assets/app.css', 'body{}');
  write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write('assets/notes.txt', 'not an allowed type');
  write('secret.txt', 'outside assets');
  return dir;
}

module.exports = { makePublicDir };
