import { clear, h, icon } from '../dom.js';
import { addressText, firewallCommand, firewallNote, formatSize, groupMessages, itemChip, itemIcon, sendTarget, statusInfo } from '../model.js';
import { copyButton, routeChip } from '../widgets.js';
import { daySeparator, messageRow } from './messages.js';

const signature = (value) => JSON.stringify(value);
const TABS = [
  { id: 'messages', label: 'Messages', icon: 'chat' },
  { id: 'images', label: 'Images', icon: 'image' },
  { id: 'files', label: 'Files', icon: 'file' },
];

export function createDashboard(ctx) {
  let state = null;
  let selectedDeviceId = null;
  let activeTab = 'messages';
  const shown = { addresses: '', phones: '', pane: '' };

  // ---- header ----
  const pillLabel = h('span');
  const pill = h('span', { class: 'status-pill' }, h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), pillLabel);
  const reason = h('p', { class: 'lead', attrs: { role: 'status' } });
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Dashboard' }), reason), pill);

  // ---- addresses ----
  const addressList = h('div', { class: 'list' });
  const listening = h('span');
  const addressesCard = h('section', { class: 'card', attrs: { 'aria-labelledby': 'h-addresses' } },
    h('div', { class: 'card-head' }, h('h2', { text: 'Addresses', attrs: { id: 'h-addresses' } })),
    h('p', { class: 'card-note', text: 'Your phone can reach this laptop at' }),
    addressList,
    h('div', { class: 'card-foot' }, icon('broadcast', 18), listening));

  // ---- send ----
  const target = h('select', { class: 'field', attrs: { 'aria-label': 'Send to which phone?' } });
  target.hidden = true;
  const noPhone = h('p', { class: 'hint', text: 'Pair a phone first: it will show up under Approvals.' });
  const fileInput = h('input', { class: 'visually-hidden', attrs: { type: 'file', multiple: true, tabindex: '-1', 'aria-hidden': 'true' } });
  const dropzone = h('button', { class: 'dropzone', attrs: { type: 'button' } }, h('span', { class: 'icon' }, icon('upload', 28)), h('span', { text: 'Drop files here or click to choose' }));
  const uploads = h('div', { class: 'uploads', attrs: { 'aria-live': 'polite' } });
  const sendCard = h('section', { class: 'card', attrs: { 'aria-labelledby': 'h-send' } },
    h('div', { class: 'card-head' }, h('h2', { text: 'Send to phone', attrs: { id: 'h-send' } }), h('a', { class: 'btn-link', text: 'Open Messages', attrs: { href: '#/messages' } })),
    h('p', { class: 'card-note', text: 'Drop files or images here. To write a message, open Messages.' }),
    target, noPhone, dropzone, fileInput, uploads);

  // ---- devices: click one to see its Messages / Images / Files ----
  const itemsTitle = h('h2', { text: 'Devices', attrs: { id: 'h-items' } });
  const clearButton = h('button', { class: 'btn-link', text: 'Clear history', attrs: { type: 'button' } });
  const pane = h('div', {});
  const itemsCard = h('section', { class: 'card', attrs: { 'aria-labelledby': 'h-items' } },
    h('div', { class: 'card-head' }, itemsTitle, clearButton), pane);

  // ---- firewall help ----
  const command = h('div', { class: 'code-row' }, h('code', { text: firewallCommand }), copyButton(ctx, firewallCommand));
  const firewallText = h('p', { class: 'mono-note' });
  const reachText = h('p', { class: 'hint' });
  const help = h('details', { class: 'panel' },
    h('summary', {}, h('span', { class: 'icon' }, icon('shield', 22)), "Can't connect from your phone?", h('span', { class: 'chev' }, icon('chevron', 20))),
    h('div', { class: 'panel-body' }, h('p', { text: 'Allow FlashPush through Windows Firewall (run once as administrator):' }), command, firewallText, reachText));

  const el = h('div', { class: 'stack' }, head, h('div', { class: 'grid-2' }, addressesCard, sendCard), itemsCard, help);

  // ---- behaviour ----
  const run = (action) => action().catch((error) => ctx.announce(error.message));
  const targetId = () => (target.hidden ? sendTarget(state.devices).defaultId : target.value);

  function startUpload(file) {
    const name = h('span', { text: file.name });
    const percent = h('span', { class: 'hint', text: '0%' });
    const bar = h('progress', { attrs: { max: 1, value: 0, 'aria-label': `Uploading ${file.name}` } });
    const row = h('div', { class: 'upload' }, name, percent, bar);
    uploads.append(row);
    ctx.uploadFile({ file, deviceId: targetId(), onProgress: (fraction) => {
      bar.value = fraction;
      percent.textContent = `${Math.round(fraction * 100)}%`;
    } }).then(() => {
      row.remove();
      return ctx.refresh();
    }).catch((error) => {
      bar.remove();
      percent.remove();
      const dismiss = h('button', { class: 'btn-link', text: 'Dismiss', attrs: { type: 'button' }, on: { click: () => row.remove() } });
      row.append(h('span', { class: 'error-text', text: error.message, attrs: { role: 'alert' } }), dismiss);
    });
  }
  const startAll = (files) => [...files].forEach(startUpload);
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    startAll(fileInput.files);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.dataset.over = 'true';
  });
  dropzone.addEventListener('dragleave', () => {
    delete dropzone.dataset.over;
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    delete dropzone.dataset.over;
    if (!dropzone.disabled) startAll(event.dataTransfer.files);
  });

  clearButton.addEventListener('click', async () => {
    const ok = await ctx.confirmDialog({ title: 'Clear history?', message: 'This removes every message, image and file from the lists. Files already received stay in your Downloads folder.', confirmLabel: 'Clear history', danger: true });
    if (ok) {
      run(async () => {
        await ctx.send('POST', '/admin/history/clear', {});
        await ctx.refresh();
      });
    }
  });

  function itemRow(item, devices) {
    const chip = itemChip(item, devices);
    const body = h('span', {}, item.name, h('span', { class: 'row-meta', text: formatSize(item.size) }));
    const lead = itemIcon(item) === 'image'
      ? h('img', { class: 'thumb', attrs: { src: `/admin/files/${encodeURIComponent(item.id)}?inline=1`, alt: '', width: 48, height: 48, loading: 'lazy' } })
      : h('span', { class: 'icon' }, icon('file', 20));
    const actions = h('div', { class: 'row-actions' },
      h('a', { class: 'btn btn-secondary btn-small', attrs: { href: `/admin/files/${encodeURIComponent(item.id)}`, download: item.name } }, icon('download', 16), 'Download'),
      h('button', { class: 'btn btn-danger btn-small', attrs: { type: 'button' }, on: { click: () => run(async () => {
        await ctx.send('DELETE', `/admin/items/${encodeURIComponent(item.id)}`);
        await ctx.refresh();
      }) } }, icon('trash', 16), 'Delete'));
    return h('div', { class: 'row' }, h('span', { class: `chip chip-${chip.direction}`, text: chip.label }), lead, h('div', { class: 'row-text' }, body), actions);
  }

  function deviceRow(device) {
    return h('button', { class: 'row device-row', attrs: { type: 'button', 'aria-label': `Open ${device.name}` }, on: { click: () => selectDevice(device.deviceId) } },
      h('span', { class: 'phone-cell' }, h('span', { class: 'icon' }, icon('phone', 20)), device.name),
      h('span', { class: 'conn', dataset: { on: String(device.connected) } }, h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), device.connected ? 'Connected' : 'Not connected'),
      icon('chevron', 18));
  }

  function tabBar() {
    return h('div', { class: 'tabbar', attrs: { role: 'tablist' } },
      ...TABS.map((tab) => h('button', {
        class: 'tab-btn',
        attrs: { type: 'button', role: 'tab', 'aria-current': activeTab === tab.id ? 'page' : undefined },
        on: { click: () => selectTab(tab.id) },
      }, icon(tab.icon, 16), tab.label)));
  }

  function tabContent(device) {
    if (activeTab === 'messages') {
      const groups = groupMessages(state.items, device.deviceId, Date.now());
      if (!groups.length) return h('p', { class: 'empty', text: 'No messages yet.' });
      const thread = h('div', { class: 'thread detail-thread' });
      for (const group of groups) {
        thread.append(daySeparator(group.label));
        for (const message of group.messages) thread.append(messageRow(ctx, message, device.name));
      }
      return thread;
    }
    const wantImage = activeTab === 'images';
    const items = state.items.filter((item) => item.deviceId === device.deviceId && item.kind === 'file' && (itemIcon(item) === 'image') === wantImage);
    if (!items.length) return h('p', { class: 'empty', text: wantImage ? 'No images yet.' : 'No files yet.' });
    const list = h('div', { class: 'list' });
    for (const item of [...items].reverse()) list.append(itemRow(item, [device]));
    return list;
  }

  const paneKey = () => signature([selectedDeviceId, activeTab, state.devices.map((d) => [d.deviceId, d.name, d.connected]), state.items.map((i) => i.id)]);

  function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    activeTab = 'messages';
    renderPane();
    shown.pane = paneKey();
  }

  function selectTab(tabId) {
    activeTab = tabId;
    renderPane();
    shown.pane = paneKey();
  }

  function renderPane() {
    const device = state.devices.find((d) => d.deviceId === selectedDeviceId);
    if (!device) {
      selectedDeviceId = null;
      itemsTitle.textContent = 'Devices';
      clearButton.hidden = state.items.length === 0;
      clear(pane);
      if (!state.devices.length) {
        pane.append(h('p', { class: 'empty', text: 'No phones paired yet. Pair one from your phone.' }));
        return;
      }
      const list = h('div', { class: 'list' });
      for (const item of state.devices) list.append(deviceRow(item));
      pane.append(list);
      return;
    }
    itemsTitle.textContent = device.name;
    clearButton.hidden = true;
    clear(pane);
    const back = h('button', { class: 'btn-link back-btn', attrs: { type: 'button' }, on: { click: () => selectDevice(null) } }, icon('chevron', 18), 'Devices');
    pane.append(h('div', { class: 'detail-head' }, back), tabBar(), tabContent(device));
  }

  function update(next) {
    state = next;
    const info = statusInfo(next.status);
    pill.dataset.tone = info.tone;
    pillLabel.textContent = info.label;
    reason.textContent = info.reason;
    reason.hidden = !info.reason;
    if (info.reason) reason.dataset.tone = info.tone;

    const addressKey = signature([next.addresses, next.ports.device]);
    if (shown.addresses !== addressKey) {
      shown.addresses = addressKey;
      clear(addressList);
      if (!next.addresses.length) addressList.append(h('p', { class: 'empty', text: 'No network found. Connect this laptop to Wi-Fi or Tailscale.' }));
      for (const address of next.addresses) {
        const value = addressText(address);
        addressList.append(h('div', { class: 'row' }, routeChip(address.kind), h('span', { class: 'row-text mono', text: value }), copyButton(ctx, value, { label: 'Copy' })));
      }
      listening.textContent = `Listening on port ${next.ports.device}`;
      firewallText.textContent = firewallNote(next.ports);
      reachText.textContent = next.addresses.length
        ? `Your phone should reach this laptop at ${next.addresses.map(addressText).join(', ')} on port ${next.ports.device}.`
        : 'This laptop has no network address right now.';
    }

    const phones = sendTarget(next.devices);
    const phoneKey = signature(next.devices.map((d) => [d.deviceId, d.name]));
    if (shown.phones !== phoneKey) {
      shown.phones = phoneKey;
      const chosen = target.value;
      clear(target);
      for (const device of next.devices) target.append(h('option', { text: device.name, attrs: { value: device.deviceId } }));
      if (next.devices.some((d) => d.deviceId === chosen)) target.value = chosen;
    }
    target.hidden = !phones.needsChoice;
    noPhone.hidden = !phones.disabled;
    dropzone.disabled = phones.disabled;

    const key = paneKey();
    if (shown.pane !== key) {
      shown.pane = key;
      renderPane();
    }
  }

  return { el, update };
}
