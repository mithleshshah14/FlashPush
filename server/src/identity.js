'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('./fsutil');
const { isUuid, cleanName } = require('./validate');

/** The laptop's permanent identity: a UUID plus a display name (the hostname by default). */
function loadIdentity(paths, { hostname = os.hostname() } = {}) {
  const existing = readJson(paths.identity, null);
  if (existing !== null) {
    if (!existing || !isUuid(existing.laptopId)) {
      throw new Error(
        `${paths.identity} is invalid. Delete it to create a new laptop identity (paired phones will need to pair again).`,
      );
    }
    return { laptopId: existing.laptopId, name: cleanName(existing.name) || cleanName(hostname) || 'Laptop' };
  }
  const identity = { laptopId: crypto.randomUUID(), name: cleanName(hostname) || 'Laptop' };
  writeJsonAtomic(paths.identity, identity, { mode: 0o644 });
  return identity;
}

module.exports = { loadIdentity };
