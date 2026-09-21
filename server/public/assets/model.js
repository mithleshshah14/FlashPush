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

export const documentTitle = (view, pending) => `${pending ? `(${pending}) ` : ''}${VIEW_TITLES[view]} · FlashPush`;

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

export const errorMessage = (json, fallback) => (json && json.error && json.error.message) || fallback;
