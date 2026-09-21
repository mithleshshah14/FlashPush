import { h, icon } from '../dom.js';
import { countdown } from '../model.js';
import { guarded, routeChip } from '../widgets.js';

const INTRO = 'A phone wants to connect. Approve it only if the code matches the one on the phone.';

export function createApprovals(ctx) {
  const cards = new Map(); // requestId -> { el, expires, expiresAt }

  const grid = h('div', { class: 'approval-grid' });
  const empty = h('p', { class: 'empty', text: 'No phone is asking to connect. When one does, its code appears here.' });
  const el = h('div', {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Approvals' }), h('p', { class: 'lead', text: INTRO }))),
    empty, grid,
    h('div', { class: 'notice' }, icon('info', 20), h('span', { text: 'Only approve phones you recognise. Approving lets the phone send and receive files with this laptop.' })));

  function buildCard(request, devices) {
    const known = devices.find((d) => d.deviceId === request.deviceId);
    const error = h('p', { class: 'error-text', attrs: { role: 'alert' } });
    const expires = h('span');
    const approve = h('button', { class: 'btn btn-primary', text: 'Approve', attrs: { type: 'button' } });
    const deny = h('button', { class: 'btn btn-danger', text: 'Deny', attrs: { type: 'button' } });
    const decide = (button, path) => () => guarded(button, async () => {
      approve.disabled = deny.disabled = true;
      try {
        await ctx.send('POST', `/admin/pair/${encodeURIComponent(request.requestId)}/${path}`);
      } finally {
        approve.disabled = deny.disabled = false;
      }
      await ctx.refresh();
    }, (message) => {
      error.textContent = message;
    });
    approve.addEventListener('click', decide(approve, 'approve'));
    deny.addEventListener('click', decide(deny, 'deny'));

    const card = h('section', { class: 'card approval', attrs: { 'aria-label': `Pairing request from ${request.deviceName}` } },
      h('div', { class: 'approval-head' },
        h('div', {},
          request.isRepair && h('span', { class: 'chip chip-repair', text: `Re-pair of ${known ? known.name : request.deviceName}` }),
          h('h2', { text: request.deviceName }),
          h('p', { class: 'approval-ip', text: request.remoteIp })),
        routeChip(request.route)),
      h('div', { class: 'pair-box' },
        h('div', { class: 'pair-label', text: 'Pairing code' }),
        h('div', { class: 'pair-code', text: request.sasDisplay, attrs: { 'aria-label': `Code ${request.sasDisplay.split('').join(' ')}` } }),
        h('div', { class: 'pair-expiry' }, icon('clock', 16), expires)),
      error,
      h('div', { class: 'approval-actions' }, approve, deny));
    return { el: card, expires, expiresAt: request.expiresAt };
  }

  function paintExpiry(card, now) {
    card.expires.textContent = `Expires in ${countdown(card.expiresAt, now)}`;
  }

  function update(state, now) {
    const ids = new Set(state.pending.map((p) => p.requestId));
    for (const [id, card] of cards) {
      if (!ids.has(id)) {
        card.el.remove();
        cards.delete(id);
      }
    }
    for (const request of state.pending) {
      if (cards.has(request.requestId)) continue;
      const card = buildCard(request, state.devices);
      cards.set(request.requestId, card);
      grid.append(card.el);
    }
    for (const card of cards.values()) paintExpiry(card, now);
    empty.hidden = cards.size > 0;
  }

  const tick = (now) => cards.forEach((card) => paintExpiry(card, now));

  return { el, update, tick };
}
