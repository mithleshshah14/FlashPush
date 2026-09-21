'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const path = require('node:path');

// Only the local admin page may be opened in the browser.
const ADMIN_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}(\/[^\s"<>|^&]*)?$/;

/**
 * Opens things for the tray. Every program is started with an argument array (never through a shell),
 * and the URL / folder are validated first, so nothing typed into a menu or arriving over the network
 * can turn into a command.
 */
function createDesktop({ spawn = nodeSpawn } = {}) {
  function launch(file, args) {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => {}); // an async spawn failure must not crash the server
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  /** Opens `http://127.0.0.1:<port>/...` in the default browser. */
  function openUrl(url) {
    if (typeof url !== 'string' || !ADMIN_URL.test(url)) return false;
    return launch('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  }

  /** Opens an absolute Windows folder in Explorer. */
  function openFolder(dir) {
    const plain = typeof dir === 'string' && path.win32.isAbsolute(dir) && /^[A-Za-z]:\\/.test(dir) && !/["\x00-\x1f]/.test(dir);
    return plain ? launch('explorer.exe', [dir]) : false;
  }

  return { openUrl, openFolder };
}

module.exports = { createDesktop };
