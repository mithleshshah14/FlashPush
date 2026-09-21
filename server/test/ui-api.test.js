'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'assets', name)).href);

function stubFetch(t, responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = responder(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test('getState fetches /admin/state without the write header', async (t) => {
  const { getState } = await load('api.js');
  const calls = stubFetch(t, () => ({ body: { laptop: { name: 'X' } } }));
  assert.deepEqual(await getState(), { laptop: { name: 'X' } });
  assert.equal(calls[0].url, '/admin/state');
  assert.equal(calls[0].init.method, undefined);
});

test('getState rejects with the envelope message on an error', async (t) => {
  const { getState } = await load('api.js');
  stubFetch(t, () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'Unexpected Host header.' } } }));
  await assert.rejects(getState(), /Unexpected Host header\./);
});

test('send adds the admin header and JSON, and unwraps the result', async (t) => {
  const { send } = await load('api.js');
  const calls = stubFetch(t, () => ({ status: 201, body: { id: 'i1' } }));
  assert.deepEqual(await send('POST', '/admin/text', { text: 'hi' }), { id: 'i1' });
  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-FlashPush-Admin'], '1');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"text":"hi"}');
});

test('send without a body has no content type; DELETE still carries the header', async (t) => {
  const { send } = await load('api.js');
  const calls = stubFetch(t, () => ({ body: {} }));
  await send('DELETE', '/admin/items/x');
  assert.equal(calls[0].init.headers['X-FlashPush-Admin'], '1');
  assert.equal('Content-Type' in calls[0].init.headers, false);
  assert.equal(calls[0].init.body, undefined);
});

test('send rejects with the server message, or a fallback when the body is not an envelope', async (t) => {
  const { send } = await load('api.js');
  stubFetch(t, () => ({ status: 404, body: { error: { code: 'PAIR_NOT_FOUND', message: 'Pairing request not found.' } } }));
  await assert.rejects(send('POST', '/admin/pair/x/approve'), /Pairing request not found\./);
  stubFetch(t, () => ({ status: 500, body: null }));
  await assert.rejects(send('POST', '/admin/pair/x/approve'), /Something went wrong/);
});

class FakeXhr {
  static last = null;
  constructor() {
    this.headers = {};
    this.upload = {};
    FakeXhr.last = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  send(body) {
    this.body = body;
  }
}

test('uploadFile sends the file with encoded name, device and admin header, and reports progress', async (t) => {
  const { uploadFile } = await load('api.js');
  globalThis.XMLHttpRequest = FakeXhr;
  t.after(() => delete globalThis.XMLHttpRequest);
  const file = { name: 'a b é.txt', size: 100 };
  const seen = [];
  const promise = uploadFile({ file, deviceId: 'dev-1', onProgress: (f) => seen.push(f) });
  const xhr = FakeXhr.last;
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/admin/file');
  assert.equal(xhr.headers['X-Filename'], encodeURIComponent('a b é.txt'));
  assert.equal(xhr.headers['X-Device-Id'], 'dev-1');
  assert.equal(xhr.headers['X-FlashPush-Admin'], '1');
  assert.equal(xhr.body, file);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
  xhr.upload.onprogress({ lengthComputable: false });
  xhr.status = 201;
  xhr.responseText = '{"id":"item-1"}';
  xhr.onload();
  assert.deepEqual(seen, [0.25]);
  assert.deepEqual(await promise, { id: 'item-1' });
});

test('uploadFile without a device omits the header, and failures reject with the server message', async (t) => {
  const { uploadFile } = await load('api.js');
  globalThis.XMLHttpRequest = FakeXhr;
  t.after(() => delete globalThis.XMLHttpRequest);
  const promise = uploadFile({ file: { name: 'x' }, onProgress() {} });
  const xhr = FakeXhr.last;
  assert.equal('X-Device-Id' in xhr.headers, false);
  xhr.status = 507;
  xhr.responseText = '{"error":{"code":"STORAGE_QUOTA","message":"The storage limit has been reached."}}';
  xhr.onload();
  await assert.rejects(promise, /storage limit/);
  const second = uploadFile({ file: { name: 'y' }, onProgress() {} });
  FakeXhr.last.onerror();
  await assert.rejects(second, /Could not reach FlashPush/);
});

const throwingStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

test('theme: reads saved values, tolerates blocked storage, resolves system by the media query', async () => {
  const { readTheme, saveTheme, resolveTheme } = await load('theme.js');
  assert.equal(readTheme({ getItem: () => 'dark' }), 'dark');
  assert.equal(readTheme({ getItem: () => 'purple' }), 'system');
  assert.equal(readTheme({ getItem: () => null }), 'system');
  assert.equal(readTheme(throwingStorage), 'system');
  assert.doesNotThrow(() => saveTheme(throwingStorage, 'light'));
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
});

test('theme: saveTheme stores, applyTheme sets the attribute on the root', async () => {
  const { saveTheme, applyTheme } = await load('theme.js');
  const saved = {};
  saveTheme({ setItem: (k, v) => { saved[k] = v; } }, 'dark');
  assert.deepEqual(saved, { 'flashpush-theme': 'dark' });
  const root = { dataset: {} };
  applyTheme(root, 'dark', false);
  assert.equal(root.dataset.theme, 'dark');
  applyTheme(root, 'system', true);
  assert.equal(root.dataset.theme, 'dark');
});

class FakeEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    FakeEventSource.last = this;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  close() {
    this.closed = true;
  }
}

test('live: open reports online then refreshes, error reports offline once, changed refreshes, stop closes', async (t) => {
  const { startLive } = await load('live.js');
  globalThis.EventSource = FakeEventSource;
  t.after(() => delete globalThis.EventSource);
  const log = [];
  const live = startLive({ onChange: () => log.push('change'), onOnline: () => log.push('online'), onOffline: () => log.push('offline'), retryMs: 3600_000 });
  const es = FakeEventSource.last;
  assert.equal(es.url, '/admin/events');
  es.onopen();
  es.listeners.changed();
  es.onerror();
  es.onerror();
  es.onopen();
  assert.deepEqual(log, ['online', 'change', 'change', 'offline', 'online', 'change']);
  live.stop();
  assert.equal(es.closed, true);
});
