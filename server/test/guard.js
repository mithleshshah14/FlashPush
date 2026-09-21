'use strict';

/**
 * Antivirus safety guard for the test suite (loaded by `npm test` through `node --import`).
 *
 * Security software reacts to node.exe launching PowerShell, VBS host scripts, netsh and similar tools.
 * Tests must never do that: they test pure logic with an injected fake `spawn`, and anything that needs
 * the real script is a manual step (docs/dev-safety.md). This makes a violation fail loudly instead of
 * starting the program.
 *
 * Deliberate override for a human at a terminal: FLASHPUSH_ALLOW_SCRIPTS=1.
 */

const childProcess = require('node:child_process');
const { promisify } = require('node:util');

const BLOCKED = /\b(powershell|pwsh|wscript|cscript|mshta|netsh|schtasks|regsvr32|rundll32|certutil|bitsadmin|msiexec)(\.exe)?\b/i;
const INSTALLED = Symbol.for('flashpush.testGuard');
const METHODS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'];

/** The blocked program a call would start, or null. Looks at the command and its argument list. */
function findBlocked(command, args) {
  const text = [command, ...(Array.isArray(args) ? args : [])].filter((part) => typeof part === 'string').join(' ');
  const match = BLOCKED.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/** An Error describing the violation, or null when the call is fine. */
function violation(command, args) {
  const blocked = findBlocked(command, args);
  if (!blocked || process.env.FLASHPUSH_ALLOW_SCRIPTS) return null;
  return new Error(
    `Tests must not run "${blocked}" (antivirus safety guard). Test the pure logic with an injected fake spawn, ` +
      'and run the real script by hand (see docs/dev-safety.md).',
  );
}

function install(target = childProcess) {
  if (target[INSTALLED]) return;
  for (const name of METHODS) {
    const original = target[name];
    const guarded = function (...params) {
      const error = violation(params[0], params[1]);
      if (error) throw error;
      return original.apply(this, params);
    };
    // util.promisify(execFile) uses its own implementation, which would bypass the wrapper above;
    // promise callers get a rejected promise rather than a synchronous throw.
    const custom = original[promisify.custom];
    if (custom) {
      guarded[promisify.custom] = function (...params) {
        const error = violation(params[0], params[1]);
        return error ? Promise.reject(error) : custom.apply(this, params);
      };
    }
    target[name] = guarded;
  }
  target[INSTALLED] = true;
}

install();

module.exports = { findBlocked, install };
