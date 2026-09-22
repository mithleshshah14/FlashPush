// Pure helpers for the admin UI: no DOM, no network, so they can be unit-tested in Node.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VIEW_TITLES = { dashboard: 'Dashboard', approvals: 'Approvals', devices: 'Devices' };
const STATUS = {
  running: { label: 'Running', tone: 'ok' },
  starting: { label: 'Starting', tone: 'warn' },
  degraded: { label: 'Degraded', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'off' },
};

export const firewallCommand = 'powershell -ExecutionPolicy Bypass -File scripts\\allow-firewall.ps1';

export const firewallNote = ({ device, discovery }) =>
  `Opens TCP ${device} and UDP ${discovery} for the local subnet and Tailscale (100.64.0.0/10) only.`;

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const pad = (n) => String(n).padStart(2, '0');
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatRelative(ts, now) {
  if (!ts) return 'Never';
  const diff = now - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const then = new Date(ts);
  const today = new Date(now);
  const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (sameDay(then, today)) return `Today, ${clock}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(then, yesterday)) return `Yesterday, ${clock}`;
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

export function routeInfo(kind) {
  if (kind === 'lan') return { key: 'wifi', label: 'Wi-Fi' };
  if (kind === 'tailscale' || kind === 'tailscale-name') return { key: 'tailscale', label: 'Tailscale' };
  return { key: 'other', label: 'Other' };
}

export const addressText = (address) => address.name || address.ip;

export function countdown(expiresAt, now) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

/** The tab title, prefixed with the number of things waiting: pairing requests plus unread messages. */
export function documentTitle(view, pending, unread = 0) {
  const waiting = pending + unread;
  return `${waiting ? `(${waiting}) ` : ''}${VIEW_TITLES[view]} · FlashPush`;
}

export function parseRoute(hash) {
  const name = String(hash).replace(/^#\/?/, '').split('?')[0].toLowerCase();
  return name in VIEW_TITLES ? name : 'dashboard';
}

export function statusInfo(status) {
  const known = STATUS[status && status.state] || STATUS.running;
  return { ...known, reason: (status && status.reason) || '' };
}

/** The text itself when it is exactly one http(s) URL; anything else (javascript:, data:, prose) is not a link. */
export function safeUrl(text) {
  const value = String(text).trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

export function itemIcon(item) {
  if (item.kind === 'text') return safeUrl(item.text) ? 'link' : 'text';
  return String(item.mime).startsWith('image/') ? 'image' : 'file';
}

export function itemChip(item, devices) {
  const direction = item.from === 'phone' ? 'from' : 'to';
  const base = direction === 'from' ? 'From' : 'To';
  const phone = devices.length > 1 && devices.find((d) => d.deviceId === item.deviceId);
  return { direction, label: `${base} ${phone ? phone.name : 'phone'}` };
}

export function sendTarget(devices) {
  return { needsChoice: devices.length > 1, defaultId: devices.length ? devices[0].deviceId : null, disabled: devices.length === 0 };
}

export const newPendingIds = (seen, pending) => pending.filter((p) => !seen.has(p.requestId));

// ---- chat (the Messages view) ----

const clock = (ts) => {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const dayKey = (ts) => {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function dayLabel(ts, now) {
  const then = new Date(ts);
  const today = new Date(now);
  if (sameDay(then, today)) return 'Today';
  if (sameDay(then, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return 'Yesterday';
  return `${then.getDate()} ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

/**
 * One phone's text messages, oldest first, as day groups of chat bubbles. `side` is where the bubble goes
 * ('phone' on the left, 'laptop' on the right); `startsRun` is true for the first bubble of consecutive
 * messages from the same side.
 */
export function groupMessages(items, phoneId, now) {
  const texts = items.filter((item) => item.kind === 'text' && item.deviceId === phoneId).sort((a, b) => a.time - b.time);
  const groups = [];
  let previous = null;
  for (const item of texts) {
    let group = groups[groups.length - 1];
    if (!group || group.key !== dayKey(item.time)) {
      group = { key: dayKey(item.time), label: dayLabel(item.time, now), messages: [] };
      groups.push(group);
      previous = null;
    }
    const side = item.from === 'phone' ? 'phone' : 'laptop';
    const message = { id: item.id, side, text: item.text, time: item.time, clock: clock(item.time), startsRun: !previous || previous.side !== side };
    group.messages.push(message);
    previous = message;
  }
  return groups;
}

const isIncomingText = (item, phoneId) => item.kind === 'text' && item.from === 'phone' && (phoneId === undefined || item.deviceId === phoneId);

/** How many messages from the phone arrived after `lastSeen` (a timestamp). */
export const unreadCount = (items, lastSeen, phoneId) => items.filter((item) => isIncomingText(item, phoneId) && item.time > lastSeen).length;

/**
 * The in-memory "read up to" marker. `null` (first load) treats the existing history as read; while the
 * Messages view is open everything is read; otherwise the marker stays put and messages count as unread.
 */
export function nextLastSeen(items, lastSeen, viewing) {
  if (lastSeen !== null && !viewing) return lastSeen;
  const newest = items.reduce((max, item) => (isIncomingText(item) && item.time > max ? item.time : max), 0);
  return Math.max(lastSeen === null ? 0 : lastSeen, newest);
}

/** Splits text into plain and link parts. Only http(s) URLs become links; trailing punctuation stays outside them. */
export function safeLinkParts(text) {
  const source = String(text);
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = match[0].replace(/[.,;:!?)\]}]+$/, '');
    if (!safeUrl(url)) continue;
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    parts.push({ href: url, text: url });
    last = match.index + url.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}

export const phoneInitial = (name) => (String(name).trim()[0] || 'P').toUpperCase();

/** Which phone's conversation is shown: the chosen one if it still exists, else the first. */
export function chatTarget(devices, selectedId) {
  const chosen = devices.find((device) => device.deviceId === selectedId) || devices[0] || null;
  return { id: chosen ? chosen.deviceId : null, name: chosen ? chosen.name : '', needsChoice: devices.length > 1 };
}

/** What a key press in the compose box does: 'send', 'ignore' (Enter with nothing to send) or 'none' (the browser decides). */
export function composerAction(event, text, sending) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return 'none';
  return text.trim() && !sending ? 'send' : 'ignore';
}

/** The compose box grows with its lines, up to `max`. */
export const composerRows = (value, max = 6) => Math.min(max, Math.max(1, String(value).split('\n').length));

export const errorMessage = (json, fallback) => (json && json.error && json.error.message) || fallback;
