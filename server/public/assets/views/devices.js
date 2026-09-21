import { clear, h, icon } from '../dom.js';
import { formatRelative } from '../model.js';
import { routeChip } from '../widgets.js';

export function createDevices(ctx) {
  let seen = [];
  const body = h('tbody');
  const empty = h('p', { class: 'empty', text: 'No phones paired yet. A phone that asks to connect shows up under Approvals.' });
  const count = h('span', { class: 'mono-note' });
  const table = h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, ...['Phone', 'Route', 'Last seen', 'Status', 'Action'].map((title) => h('th', { text: title, attrs: { scope: 'col' } })))),
      body));

  const el = h('div', {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Devices' }), h('p', { class: 'lead', text: 'Phones approved to send and receive files with this laptop.' }))),
    empty, table,
    h('div', { class: 'table-foot' },
      h('span', { class: 'conn' }, icon('info', 18), 'Revoking removes the phone immediately. It has to be approved again to reconnect.'),
      count));

  async function revoke(device) {
    const ok = await ctx.confirmDialog({
      title: `Revoke ${device.name}?`,
      message: 'It will be disconnected now and has to be approved again to reconnect.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.send('DELETE', `/admin/devices/${encodeURIComponent(device.deviceId)}`);
      await ctx.refresh();
    } catch (error) {
      ctx.announce(error.message);
    }
  }

  function row(device, now) {
    const lastSeen = h('td', { attrs: { 'data-label': 'Last seen' }, text: formatRelative(device.lastSeen, now) });
    lastSeen.dataset.ts = String(device.lastSeen || '');
    const revokeButton = h('button', { class: 'btn btn-danger btn-small', text: 'Revoke', attrs: { type: 'button', 'aria-label': `Revoke ${device.name}` }, on: { click: () => revoke(device) } });
    return h('tr', {},
      h('td', { class: 'cell-phone', attrs: { 'data-label': 'Phone' } }, h('div', { class: 'phone-cell' }, h('span', { class: 'icon' }, icon('phone', 20)), device.name)),
      h('td', { attrs: { 'data-label': 'Route' } }, device.lastRoute ? h('div', { class: 'route-cell' }, routeChip(device.lastRoute)) : '–'),
      lastSeen,
      h('td', { attrs: { 'data-label': 'Status' } }, h('span', { class: 'conn', dataset: { on: String(device.connected) } }, h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), device.connected ? 'Connected' : 'Not connected')),
      h('td', { class: 'cell-action', attrs: { 'data-label': 'Action' } }, revokeButton));
  }

  function update(state, now) {
    const key = JSON.stringify(state.devices.map((d) => [d.deviceId, d.name, d.connected, d.lastRoute, d.lastSeen]));
    empty.hidden = state.devices.length > 0;
    table.hidden = state.devices.length === 0;
    count.textContent = `${state.devices.length} paired`;
    if (key === seen.key) return;
    seen = Object.assign([], { key });
    clear(body);
    for (const device of state.devices) body.append(row(device, now));
  }

  /** Keeps "Just now" / "3 min ago" honest without rebuilding the rows. */
  const tick = (now) => {
    for (const cell of body.querySelectorAll('td[data-ts]')) cell.textContent = formatRelative(Number(cell.dataset.ts) || null, now);
  };

  return { el, update, tick };
}
