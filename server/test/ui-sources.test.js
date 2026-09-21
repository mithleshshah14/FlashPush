'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPublicFiles } = require('../src/static');

const PUBLIC = path.join(__dirname, '..', 'public');

function clientScripts() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(PUBLIC, 'assets'));
  return out;
}

test('client code never builds HTML from strings or evaluates code', () => {
  const banned = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\s*\(\s*['"`]/;
  for (const file of clientScripts()) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, banned, path.relative(PUBLIC, file));
  }
});

test('client code makes no requests outside this server', () => {
  for (const file of clientScripts()) {
    const source = fs.readFileSync(file, 'utf8');
    const withoutNamespace = source.replace('http://www.w3.org/2000/svg', ''); // an XML namespace id, not a request
    assert.doesNotMatch(withoutNamespace, /https?:\/\/(?!127\.0\.0\.1|localhost)[\w.-]+\.\w+/, `${path.relative(PUBLIC, file)} mentions an external URL`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(PUBLIC, 'assets', 'app.css'), 'utf8'), /url\(\s*['"]?https?:|@import/i);
});

test('index.html has no inline script, style, style attribute or event handler', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script>');
  assert.doesNotMatch(html, /<style/i, 'inline <style>');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'style attribute');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i, 'external reference');
});

test('every local file referenced by index.html is in the served allowlist', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const files = loadPublicFiles(PUBLIC);
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"#]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 3, 'stylesheet, script and icon are referenced');
  for (const ref of refs) assert.ok(files.has(`/${ref.replace(/^\//, '')}`), `${ref} is not served`);
});

test('every ES module import inside assets resolves to a served file', () => {
  const files = loadPublicFiles(PUBLIC);
  for (const file of clientScripts()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = path.posix.normalize(path.posix.join('/assets', path.relative(path.join(PUBLIC, 'assets'), path.dirname(file)).split(path.sep).join('/'), spec));
      assert.ok(files.has(target), `${path.relative(PUBLIC, file)} imports ${spec} -> ${target}`);
    }
  }
});
