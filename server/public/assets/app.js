// Wiring: routing, state, live updates, theme. Each view is a factory returning { el, update(state, now), tick?(now) }.
import { getState, send, uploadFile } from './api.js';
import { confirmDialog, copyText } from './dom.js';
import { startLive } from './live.js';
import { newPendingIds, nextLastSeen, parseRoute, unreadCount } from './model.js';
import { createShell } from './shell.js';
import { createApprovals } from './views/approvals.js';
import { createDashboard } from './views/dashboard.js';
import { createDevices } from './views/devices.js';
import { createMessages } from './views/messages.js';
import { applyTheme, readTheme, resolveTheme, saveTheme } from './theme.js';

const views = { dashboard: createDashboard, messages: createMessages, approvals: createApprovals, devices: createDevices };

const shell = createShell();
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');

function storage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem() {} }; // storage blocked: the theme just is not remembered
  }
}

let themePref = readTheme(storage());
const showThemeButton = shell.bindThemeToggle(() => {
  themePref = resolveTheme(themePref, media.matches) === 'dark' ? 'light' : 'dark';
  saveTheme(storage(), themePref);
  paintTheme();
});
function paintTheme() {
  applyTheme(root, themePref, media.matches);
  showThemeButton(root.dataset.theme);
}
media.addEventListener('change', paintTheme);
paintTheme();

let state = null;
let current = null;
let currentName = null;
let seenPending = new Set();
let lastSeen = null; // in memory only: phone messages newer than this are unread (null until the first load)
let unread = 0;

/** Moves the read marker (everything is read while Messages is open) and shows how many messages are unread. */
function refreshUnread() {
  lastSeen = nextLastSeen(state.items, lastSeen, currentName === 'messages');
  const count = unreadCount(state.items, lastSeen);
  if (count > unread) shell.announce(count === 1 ? 'New message from a phone.' : `${count} unread messages.`);
  unread = count;
  shell.setUnread(count);
}

async function refresh() {
  try {
    applyState(await getState());
    shell.setOffline(false);
  } catch {
    shell.setOffline(true);
  }
}

const ctx = { send, uploadFile, confirmDialog, copyText, refresh, announce: shell.announce };

function applyState(next) {
  const firstLoad = state === null;
  state = next;
  shell.setLaptop(next.laptop.name);
  shell.setStatus(next.status);
  shell.setPending(next.pending.length);
  if (!firstLoad) {
    for (const request of newPendingIds(seenPending, next.pending)) {
      shell.announce(`${request.deviceName} wants to connect. Code ${request.sasDisplay}.`);
    }
  }
  seenPending = new Set(next.pending.map((p) => p.requestId));
  refreshUnread();
  if (current) current.update(state, Date.now());
}

function route() {
  const name = parseRoute(location.hash);
  if (name === currentName) return;
  const changing = currentName !== null;
  currentName = name;
  current = views[name](ctx);
  shell.main.replaceChildren(current.el);
  shell.setView(name);
  if (changing) shell.focusMain();
  if (state) {
    refreshUnread();
    current.update(state, Date.now());
  }
}

window.addEventListener('hashchange', route);
setInterval(() => current && current.tick && current.tick(Date.now()), 1000);
startLive({ onChange: refresh, onOnline: () => shell.setOffline(false), onOffline: () => shell.setOffline(true) });
route();
refresh();
