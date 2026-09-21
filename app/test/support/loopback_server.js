'use strict';

// Test-only launcher for the real laptop server (server/src/index.js, unmodified).
// It forces every listener (HTTPS device API, admin API, UDP discovery) onto 127.0.0.1 so a test run
// never opens a port on the network, uses ephemeral ports, and exits when its parent goes away.

const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const LOOPBACK = '127.0.0.1';

const patchListen = (proto) => {
  const original = proto.listen;
  proto.listen = function listen(port, _host, callback) {
    return original.call(this, port, LOOPBACK, callback);
  };
};
patchListen(https.Server.prototype);
patchListen(http.Server.prototype);

const originalBind = dgram.Socket.prototype.bind;
dgram.Socket.prototype.bind = function bind(port, _host, callback) {
  return originalBind.call(this, port, LOOPBACK, callback);
};

const { createApp } = require(path.resolve(__dirname, '../../../server/src/index.js'));

async function main() {
  const app = await createApp({
    home: process.env.FLASHPUSH_HOME,
    overrides: { ports: { device: 0, admin: 0, discovery: 0 }, receiveDir: process.env.RECEIVE_DIR },
    log: () => {},
  });
  const ports = await app.start();
  console.log(`Admin page (this laptop only): http://127.0.0.1:${ports.admin}`);
  console.log(`Phones connect over HTTPS on port ${ports.device}; discovery listens on UDP ${ports.discovery}`);

  const stop = () => app.stop().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.stdin.on('end', stop); // the test process closed our stdin (it finished or died)
  process.stdin.resume();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
