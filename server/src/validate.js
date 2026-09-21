'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Display names come from other devices: strip control characters, collapse whitespace, cap length. */
function cleanName(value, max = 64) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

module.exports = { isUuid, cleanName };
