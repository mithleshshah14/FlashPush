'use strict';

const assert = require('node:assert/strict');

/** Asserts fn throws an ApiError with the given code. */
function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `expected error code ${code}, got ${err.code} (${err.message})`);
    return true;
  });
}

module.exports = { throwsCode };
