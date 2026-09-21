'use strict';

const path = require('node:path');
const { loadConfig } = require('./config');
const { createApp } = require('./index');
const { readTailscaleName } = require('./addresses');
const { installAutostart, uninstallAutostart, autostartStatus } = require('./autostart');
const { createTray } = require('./tray');
const { createDesktop } = require('./desktop');
const { findRunningInstance } = require('./singleInstance');
const { attachTray } = require('./shell');

const USAGE = `Usage: node src/cli.js [--no-tray]
       node src/cli.js --install-autostart | --uninstall-autostart | --status | --help`;

const COMMANDS = {
  '--install-autostart': 'install-autostart',
  '--uninstall-autostart': 'uninstall-autostart',
  '--status': 'status',
  '--help': 'help',
};

/** Unknown options are an error, never guessed. */
function parseArgs(argv) {
  const options = { command: 'run', tray: true };
  let noTray = false;
  for (const arg of argv) {
    if (arg === '--no-tray') noTray = true;
    else if (COMMANDS[arg]) {
      if (options.command !== 'run') throw new Error('Use only one command at a time.');
      options.command = COMMANDS[arg];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (noTray) {
    if (options.command !== 'run') throw new Error('--no-tray only applies when starting FlashPush.');
    options.tray = false;
  }
  return options;
}

/** install / uninstall / status for "Start with Windows". Returns the process exit code. */
function runCommand(command, { paths, appData, log = console.log }) {
  try {
    if (command === 'install-autostart') {
      installAutostart({ ...paths, appData });
      log('Start with Windows is on: FlashPush will start hidden the next time you sign in.');
    } else if (command === 'uninstall-autostart') {
      uninstallAutostart({ appData });
      log('Start with Windows is off.');
    } else {
      log(`Start with Windows: ${autostartStatus({ appData }).enabled ? 'on' : 'off'}`);
    }
    return 0;
  } catch (err) {
    log(err.message);
    return 1;
  }
}

/** Starts the app (tolerating a taken port), then the tray. Returns the idempotent `shutdown`. */
async function runApp({ app, createTrayFn, desktop, autostart, log, exit }) {
  await app.start({ tolerant: true });
  const { admin } = app.ports();
  const adminUrl = `http://127.0.0.1:${admin}/`;
  const status = app.lifecycle.status();
  log(`FlashPush is ${status.state === 'degraded' ? 'running with a problem' : 'running'}. Admin page (this laptop only): ${adminUrl}`);
  if (status.reason) log(`  ${status.reason}`);

  let tray = null;
  let shell = null;
  let stopping = null;

  function shutdown() {
    stopping ??= (async () => {
      shell?.detach();
      await app.stop();
      await tray?.stop();
    })();
    return stopping;
  }

  if (createTrayFn) {
    tray = createTrayFn((id) => shell?.onAction(id));
    if (tray.start()) {
      let exiting = false;
      const stopAndExit = () => {
        if (exiting) return; // a second click while stopping does nothing
        exiting = true;
        shutdown().then(() => exit(0));
      };
      shell = attachTray({ app, tray, autostart, desktop, adminUrl, onStop: stopAndExit, log });
    } else {
      log('The tray icon could not start; FlashPush keeps running without it.');
      tray = null;
    }
  }
  return { shutdown };
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (options.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (options.command !== 'run') {
    const paths = { nodeExe: process.execPath, script: __filename, workDir: path.join(__dirname, '..') };
    return runCommand(options.command, { paths });
  }

  const desktop = createDesktop();
  const adminPort = loadConfig().ports.admin;
  if (await findRunningInstance(adminPort)) {
    console.log('FlashPush is already running: opening its page.');
    desktop.openUrl(`http://127.0.0.1:${adminPort}/`);
    return 0;
  }

  const app = await createApp({ readTailscaleName });
  const useTray = options.tray && process.platform === 'win32';
  const { shutdown } = await runApp({
    app,
    createTrayFn: useTray ? (onAction) => createTray({ onAction, log: console.log }) : null,
    desktop,
    autostart: {
      isEnabled: () => autostartStatus({}).enabled,
      set: (on) => (on ? installAutostart({ nodeExe: process.execPath, script: __filename, workDir: path.join(__dirname, '..') }) : uninstallAutostart({})),
    },
    log: console.log,
    exit: process.exit,
  });
  console.log(`  Phones connect over HTTPS on port ${app.ports().device}; received files go to ${app.config.receiveDir}`);
  const stop = () => shutdown().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return undefined; // keep running
}

if (require.main === module) {
  main().then(
    (code) => {
      if (typeof code === 'number') process.exit(code);
    },
    (err) => {
      console.error(`FlashPush could not start: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { parseArgs, runCommand, runApp, main };
