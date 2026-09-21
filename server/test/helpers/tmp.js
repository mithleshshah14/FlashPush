'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Creates a temp directory that is removed when the test finishes. Removal retries because on Windows a
 * virus scanner or indexer can hold a freshly written file open for a moment (ENOTEMPTY / EBUSY).
 */
function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashpush-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

module.exports = { tmpDir };
