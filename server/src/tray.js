'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const path = require('node:path');
const { encode, createLineDecoder, clean, TRAY_ACTIONS } = require('./tray-protocol');

const TRAY_DIR = path.join(__dirname, '..', 'tray');
const MAX_TITLE = 63; // balloon title limit
const MAX_BODY = 255;
const NOTIFY_TARGETS = ['approvals', 'messages', 'items'];

/**
 * Runs the static PowerShell tray (server/tray/tray.ps1) and talks to it over JSON lines.
 * PowerShell is started with an argument array (no shell), so nothing here can be injected into a command line.
 */
function createTray({
  spawn = nodeSpawn,
  scriptPath = path.join(TRAY_DIR, 'tray.ps1'),
  iconDir = TRAY_DIR,
  onAction,
  log = () => {},
  killAfterMs = 3000,
} = {}) {
  let child = null;
  let alive = false;
  let resolveReady = () => {};
  let ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let exited = Promise.resolve();
  let lastTarget = 'approvals'; // what the most recent balloon was about

  function onMessage(message) {
    if (message.type === 'ready') resolveReady(true);
    else if (message.type === 'notification-click') onAction(lastTarget);
    else if (message.type === 'click' && TRAY_ACTIONS.includes(message.id)) onAction(message.id);
  }

  function send(message) {
    if (!alive || !child.stdin.writable) return;
    child.stdin.write(encode(message));
  }

  function start() {
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', scriptPath, '-IconDir', iconDir],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
    } catch (err) {
      log(`Tray could not start: ${err.message}`);
      resolveReady(false);
      return false;
    }
    alive = true;
    exited = new Promise((resolve) => {
      const gone = () => {
        alive = false;
        resolveReady(false); // no effect if it was already ready
        resolve();
      };
      child.on('exit', gone);
      child.on('error', (err) => {
        log(`Tray error: ${err.message}`);
        gone();
      });
    });
    child.stdin.on('error', () => {});
    const decoder = createLineDecoder(onMessage);
    child.stdout.on('data', (chunk) => decoder.push(chunk));
    return true;
  }

  const update = (model) => send({ type: 'menu', ...model });
  /** `target` says where a click on the balloon should lead: approvals (default), messages or items. */
  const notify = (title, body, target = 'approvals') => {
    lastTarget = NOTIFY_TARGETS.includes(target) ? target : 'approvals';
    send({ type: 'notify', title: clean(title, MAX_TITLE), body: clean(body, MAX_BODY) });
  };

  /** Asks the tray to remove its icon and exit; kills it if it does not comply. */
  async function stop() {
    if (alive) {
      send({ type: 'exit' });
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), killAfterMs);
      await exited;
      clearTimeout(timer);
    }
    ready = Promise.resolve(false);
  }

  return { start, update, notify, stop, whenReady: () => ready };
}

module.exports = { createTray };
