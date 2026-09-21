'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('./fsutil');
const { mimeFromName } = require('./mime');

function isInside(dir, target) {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function publicItem(item, withDevice) {
  const { id, kind, from, time, text, name, size, mime } = item;
  const view = { id, kind, from, time };
  if (kind === 'text') view.text = text;
  else Object.assign(view, { name, size, mime });
  if (withDevice) view.deviceId = item.deviceId;
  return view;
}

/** Shared history, but every entry belongs to one phone (`deviceId`). */
class ItemStore extends EventEmitter {
  constructor({ file, outboxDir, limits, now = Date.now }) {
    super();
    this.file = file;
    this.outboxDir = outboxDir;
    this.limits = limits;
    this.now = now;
    const saved = readJson(file, []);
    this.items = saved.filter((it) => it.kind === 'text' || (it.path && fs.existsSync(it.path)));
  }

  _save() {
    writeJsonAtomic(this.file, this.items);
  }

  /** Only laptop-to-phone files live in the outbox; received files stay in the user's folder. */
  _dispose(item) {
    if (item.kind === 'file' && item.path && isInside(this.outboxDir, item.path)) fs.rmSync(item.path, { force: true });
  }

  add({ deviceId, kind, from, text, name, size, path: filePath }) {
    const item = { id: crypto.randomUUID(), deviceId, kind, from, time: this.now() };
    if (kind === 'text') item.text = text;
    else Object.assign(item, { name, size, path: filePath, mime: mimeFromName(name) });
    this.items.push(item);
    while (this.items.length > this.limits.maxHistory) this._dispose(this.items.shift());
    this._save();
    this.emit('add', { item: publicItem(item), deviceId });
    return publicItem(item, true);
  }

  list(deviceId) {
    const mine = deviceId === undefined ? this.items : this.items.filter((it) => it.deviceId === deviceId);
    return mine.map((it) => publicItem(it, deviceId === undefined));
  }

  get(id) {
    return this.items.find((it) => it.id === id) || null;
  }

  remove(id) {
    const index = this.items.findIndex((it) => it.id === id);
    if (index === -1) return false;
    const [item] = this.items.splice(index, 1);
    this._dispose(item);
    this._save();
    this.emit('delete', { id, deviceId: item.deviceId });
    return true;
  }

  clear(deviceId) {
    const doomed = this.items.filter((it) => deviceId === undefined || it.deviceId === deviceId);
    for (const item of doomed) this.remove(item.id);
    return doomed.length;
  }

  outboxBytes() {
    return this.items.reduce((sum, it) => sum + (it.kind === 'file' && it.from === 'laptop' ? it.size || 0 : 0), 0);
  }
}

module.exports = { ItemStore, isInside };
