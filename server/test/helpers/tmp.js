'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Creates a temp directory that is removed when the test finishes. */
function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashpush-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { tmpDir };
