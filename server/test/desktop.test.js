'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDesktop } = require('../src/desktop');

function setup() {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.unref = () => {};
    calls.push({ file, args, options });
    return child;
  };
  return { desktop: createDesktop({ spawn }), calls };
}

test('openUrl hands only a loopback admin URL to the default-browser handler, as an argument array', () => {
  const { desktop, calls } = setup();
  assert.equal(desktop.openUrl('http://127.0.0.1:8760/'), true);
  assert.deepEqual(calls[0].file, 'rundll32.exe');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'http://127.0.0.1:8760/']);
  assert.equal(calls[0].options.shell, undefined);
});

test('openUrl refuses everything that is not http://127.0.0.1:<port>', () => {
  const { desktop, calls } = setup();
  for (const bad of [
    'https://127.0.0.1:8760/',
    'http://localhost:8760/',
    'http://127.0.0.1/',
    'http://127.0.0.1.evil.example:8760/',
    'http://evil.example:8760/',
    'http://user@127.0.0.1:8760/',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'calc.exe',
    '',
    undefined,
    'http://127.0.0.1:8760/ & calc',
  ]) {
    assert.equal(desktop.openUrl(bad), false, String(bad));
  }
  assert.equal(calls.length, 0);
});

test('openFolder starts Explorer on an absolute Windows folder', () => {
  const { desktop, calls } = setup();
  assert.equal(desktop.openFolder('C:\\Users\\Me\\Downloads\\FlashPush'), true);
  assert.equal(calls[0].file, 'explorer.exe');
  assert.deepEqual(calls[0].args, ['C:\\Users\\Me\\Downloads\\FlashPush']);
});

test('openFolder refuses anything that is not a plain absolute path, so Explorer switches cannot be smuggled in', () => {
  const { desktop, calls } = setup();
  for (const bad of ['relative\\dir', '/e,C:\\', '-x', '/select,C:\\x', '', undefined, 42, 'C:\\a\nb', 'C:\\a"b']) {
    assert.equal(desktop.openFolder(bad), false, String(bad));
  }
  assert.equal(calls.length, 0);
});

test('a spawn that throws or errors does not crash the app', () => {
  const throwing = createDesktop({
    spawn: () => {
      throw new Error('EPERM');
    },
  });
  assert.equal(throwing.openUrl('http://127.0.0.1:8760/'), false);
  assert.equal(throwing.openFolder('C:\\x'), false);

  let child;
  const erroring = createDesktop({
    spawn: () => {
      child = new EventEmitter();
      child.unref = () => {};
      return child;
    },
  });
  assert.equal(erroring.openFolder('C:\\x'), true);
  child.emit('error', new Error('async failure')); // must be handled, or Node would crash
});
