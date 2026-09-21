import { clear, h, icon } from '../dom.js';
import { addressText, firewallCommand, firewallNote, formatSize, itemChip, itemIcon, safeUrl, sendTarget, statusInfo } from '../model.js';
import { copyButton, guarded, routeChip } from '../widgets.js';

const signature = (value) => JSON.stringify(value);

export function createDashboard(ctx) {
  let state = null;
  const shown = { addresses: '', items: '', phones: '' };

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
  const text = h('textarea', { class: 'field', attrs: { placeholder: 'Type text or paste a link', 'aria-label': 'Text to send', rows: 3 } });
  const sendError = h('p', { class: 'error-text', attrs: { role: 'alert' } });
  const sendButton = h('button', { class: 'btn btn-primary', attrs: { type: 'button' } }, h('span', { text: 'Send text' }), icon('send', 16));
  const noPhone = h('p', { class: 'hint', text: 'Pair a phone first: it will show up under Approvals.' });
  const fileInput = h('input', { class: 'visually-hidden', attrs: { type: 'file', multiple: true, tabindex: '-1', 'aria-hidden': 'true' } });
  const dropzone = h('button', { class: 'dropzone', attrs: { type: 'button' } }, h('span', { class: 'icon' }, icon('upload', 28)), h('span', { text: 'Drop files here or click to choose' }));
  const uploads = h('div', { class: 'uploads', attrs: { 'aria-live': 'polite' } });
  const sendCard = h('section', { class: 'card', attrs: { 'aria-labelledby': 'h-send' } },
    h('div', { class: 'card-head' }, h('h2', { text: 'Send to phone', attrs: { id: 'h-send' } })),
    target, text,
    h('div', { class: 'field-actions' }, noPhone, sendButton),
    sendError, dropzone, fileInput, uploads);

  // ---- items ----
  const itemList = h('div', { class: 'list' });
  const clearButton = h('button', { class: 'btn-link', text: 'Clear history', attrs: { type: 'button' } });
  const itemsCard = h('section', { class: 'card', attrs: { 'aria-labelledby': 'h-items' } },
    h('div', { class: 'card-head' }, h('h2', { text: 'Shared items', attrs: { id: 'h-items' } }), clearButton), itemList);

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

  sendButton.addEventListener('click', () => {
    const value = text.value;
    if (!value.trim()) return;
    guarded(sendButton, async () => {
      await ctx.send('POST', '/admin/text', { deviceId: targetId(), text: value });
      text.value = '';
      await ctx.refresh();
    }, (message) => {
      sendError.textContent = message;
    });
  });
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendButton.click();
  });

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
    const ok = await ctx.confirmDialog({ title: 'Clear history?', message: 'This removes every item from the list. Files already received stay in your Downloads folder.', confirmLabel: 'Clear history', danger: true });
    if (ok) {
      run(async () => {
        await ctx.send('POST', '/admin/history/clear', {});
        await ctx.refresh();
      });
    }
  });

  function itemRow(item, devices) {
    const chip = itemChip(item, devices);
    const url = item.kind === 'text' ? safeUrl(item.text) : null;
    const kind = itemIcon(item);
    let body;
    if (item.kind === 'text') {
      body = url
        ? h('a', { class: 'text-link', text: url, attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } })
        : h('span', { text: item.text });
    } else {
      body = h('span', {}, item.name, h('span', { class: 'row-meta', text: formatSize(item.size) }));
    }
    const lead = kind === 'image'
      ? h('img', { class: 'thumb', attrs: { src: `/admin/files/${encodeURIComponent(item.id)}?inline=1`, alt: '', width: 48, height: 48, loading: 'lazy' } })
      : h('span', { class: 'icon' }, icon(kind === 'file' ? 'file' : kind, 20));
    const actions = h('div', { class: 'row-actions' });
    if (item.kind === 'text') actions.append(copyButton(ctx, item.text));
    else actions.append(h('a', { class: 'btn btn-secondary btn-small', attrs: { href: `/admin/files/${encodeURIComponent(item.id)}`, download: item.name } }, icon('download', 16), 'Download'));
    actions.append(h('button', { class: 'btn btn-danger btn-small', attrs: { type: 'button' }, on: { click: () => run(async () => {
      await ctx.send('DELETE', `/admin/items/${encodeURIComponent(item.id)}`);
      await ctx.refresh();
    }) } }, icon('trash', 16), 'Delete'));
    return h('div', { class: 'row' }, h('span', { class: `chip chip-${chip.direction}`, text: chip.label }), lead, h('div', { class: 'row-text' }, body), actions);
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
    sendButton.disabled = phones.disabled;
    dropzone.disabled = phones.disabled;

    const itemKey = signature([next.items.map((i) => i.id), next.devices.map((d) => [d.deviceId, d.name])]);
    if (shown.items !== itemKey) {
      shown.items = itemKey;
      clear(itemList);
      if (!next.items.length) itemList.append(h('p', { class: 'empty', text: 'Nothing yet. Send something from your phone or from here.' }));
      for (const item of [...next.items].reverse()) itemList.append(itemRow(item, next.devices));
    }
    clearButton.hidden = next.items.length === 0;
  }

  return { el, update };
}
