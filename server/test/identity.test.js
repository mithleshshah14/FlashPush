'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadConfig } = require('../src/config');
const { loadIdentity } = require('../src/identity');
const { isUuid } = require('../src/validate');
const { tmpDir } = require('./helpers/tmp');

test('creates a UUID identity named after the hostname, then reuses it', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  const first = loadIdentity(paths, { hostname: 'MITHLESH-PC' });
  assert.equal(isUuid(first.laptopId), true);
  assert.equal(first.name, 'MITHLESH-PC');
  const second = loadIdentity(paths, { hostname: 'SOMETHING-ELSE' });
  assert.deepEqual(second, first);
});

test('a hostname with control characters is cleaned', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  assert.equal(loadIdentity(paths, { hostname: 'My\nPC' }).name, 'My PC');
});

test('an invalid identity file is an error, never silently replaced', (t) => {
  const { paths } = loadConfig({ home: tmpDir(t) });
  fs.writeFileSync(paths.identity, JSON.stringify({ laptopId: 'nope' }));
  assert.throws(() => loadIdentity(paths, { hostname: 'x' }), /identity\.json/);
});
