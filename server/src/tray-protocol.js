'use strict';

/**
 * Newline-delimited JSON between Node and the PowerShell tray, plus the menu model.
 * Node -> tray: { type: 'menu', icon, tooltip, items } · { type: 'notify', title, body } · { type: 'exit' }
 * Tray -> Node: { type: 'ready' } · { type: 'click', id } · { type: 'notification-click' }
 * Everything is display text or a fixed id; nothing in a message is ever executed.
 */

/** The menu ids the tray may send back in a `click`. */
const TRAY_ACTIONS = Object.freeze(['open', 'approvals', 'devices', 'files', 'autostart', 'stop']);

const MAX_LINE = 64 * 1024;
const MAX_LABEL = 100;
const MAX_TOOLTIP = 63; // NotifyIcon.Text limit

const encode = (message) => `${JSON.stringify(message)}\n`;

/** Reassembles lines from arbitrary chunks. Blank, invalid, non-object and oversize lines are ignored. */
function createLineDecoder(onMessage, maxLine = MAX_LINE) {
  let buffer = '';
  let skipping = false; // inside an oversize line: discard until its newline

  function handle(line) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) onMessage(value);
  }

  function push(chunk) {
    buffer += chunk.toString('utf8');
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end === -1) break;
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (skipping) skipping = false;
      else if (line) handle(line);
    }
    if (buffer.length > maxLine) {
      buffer = '';
      skipping = true;
    }
  }

  return { push };
}

const clean = (text, max) =>
  String(text ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const STATE_LABEL = { starting: 'Starting', running: 'Running', degraded: 'Degraded', stopped: 'Stopped' };
const STATE_ICON = { running: 'running', degraded: 'degraded' }; // starting and stopped use the neutral icon

function buildMenu({ status, pendingCount, autostart }) {
  const state = STATE_LABEL[status.state] ? status.state : 'stopped';
  const reason = state === 'degraded' && status.reason ? ` - ${clean(status.reason, MAX_LABEL)}` : '';
  const pending = Number.isFinite(pendingCount) && pendingCount > 0 ? Math.floor(pendingCount) : 0;

  const items = [
    { id: 'status', label: `FlashPush: ${STATE_LABEL[state]}${reason}`, enabled: false },
    { separator: true },
    { id: 'open', label: 'Open FlashPush' },
  ];
  if (pending > 0) items.push({ id: 'approvals', label: `Pending approvals (${pending})` });
  items.push(
    { id: 'devices', label: 'Paired devices' },
    { id: 'files', label: 'Open received files' },
    { separator: true },
    { id: 'autostart', label: 'Start with Windows', checked: Boolean(autostart) },
    { id: 'stop', label: 'Stop FlashPush' },
  );

  return {
    icon: STATE_ICON[state] || 'stopped',
    tooltip: clean(`FlashPush: ${STATE_LABEL[state]}${reason}`, MAX_TOOLTIP),
    items,
  };
}

module.exports = { encode, createLineDecoder, buildMenu, clean, TRAY_ACTIONS };
