// The Messages view: a chat with one phone at a time. Text only; files and images stay on the Dashboard.
import { clear, h, icon } from '../dom.js';
import { chatTarget, composerAction, composerRows, groupMessages, phoneInitial, safeLinkParts } from '../model.js';

const signature = (value) => JSON.stringify(value);
const NEAR_BOTTOM = 48; // px from the bottom that still counts as "reading the latest messages"

export function createMessages(ctx) {
  let state = null;
  let selectedId = null;
  let sending = false;
  let forceStick = false;
  let firstRender = true;
  const rendered = { phone: null, name: '', ids: [], day: null, options: '' };

  // ---- header ----
  const picker = h('select', { class: 'field chat-picker', attrs: { 'aria-label': 'Conversation with which phone?' } });
  picker.hidden = true;
  const subtitle = h('p', { class: 'lead' });
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Messages' }), subtitle), picker);

  // ---- thread ----
  const thread = h('div', { class: 'thread', attrs: { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', tabindex: '0' } });
  const pill = h('button', { class: 'btn btn-primary btn-small new-pill', text: 'New messages', attrs: { type: 'button' } });
  pill.hidden = true;

  // ---- compose bar ----
  const box = h('textarea', { class: 'field composer-field', attrs: { rows: 1, 'aria-label': 'Message', placeholder: 'Type a message or paste a link' } });
  const status = h('span', { class: 'hint', attrs: { role: 'status' } });
  const error = h('p', { class: 'error-text', attrs: { role: 'alert' } });
  const sendButton = h('button', { class: 'btn btn-primary', attrs: { type: 'button', 'aria-label': 'Send message' } }, icon('send', 16), h('span', { text: 'Send' }));
  const composer = h('div', { class: 'composer' }, box, h('div', { class: 'composer-side' }, sendButton, status));

  const chat = h('section', { class: 'card chat', attrs: { 'aria-label': 'Conversation' } }, thread, pill, composer);
  const el = h('div', { class: 'stack' }, head, chat, error);

  // ---- behaviour ----
  const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < NEAR_BOTTOM;
  const scrollToBottom = () => {
    thread.scrollTop = thread.scrollHeight;
    pill.hidden = true;
  };
  const syncSend = () => {
    sendButton.disabled = sending || !box.value.trim() || !selectedId;
  };

  thread.addEventListener('scroll', () => {
    if (nearBottom()) pill.hidden = true;
  });
  pill.addEventListener('click', () => {
    scrollToBottom();
    box.focus();
  });
  picker.addEventListener('change', () => {
    selectedId = picker.value;
    forceStick = true;
    if (state) update(state, Date.now());
  });
  box.addEventListener('input', () => {
    box.rows = composerRows(box.value);
    syncSend();
  });
  box.addEventListener('keydown', (event) => {
    const action = composerAction(event, box.value, sending);
    if (action === 'none') return;
    event.preventDefault();
    if (action === 'send') send();
  });
  sendButton.addEventListener('click', send);

  async function send() {
    const value = box.value;
    if (!value.trim() || sending || !selectedId) return;
    sending = true;
    status.textContent = 'Sending…';
    error.textContent = '';
    syncSend();
    try {
      await ctx.send('POST', '/admin/text', { deviceId: selectedId, text: value });
      box.value = '';
      box.rows = 1;
      forceStick = true;
      await ctx.refresh();
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      sending = false;
      status.textContent = '';
      syncSend();
      box.focus();
    }
  }

  // ---- rendering ----
  function linkParts(value) {
    return safeLinkParts(value).map((part) =>
      part.href ? h('a', { class: 'text-link', text: part.text, attrs: { href: part.href, target: '_blank', rel: 'noopener noreferrer' } }) : part.text);
  }

  function messageRow(message, phoneName) {
    const mine = message.side === 'laptop';
    const copy = h('button', { class: 'icon-button msg-copy', attrs: { type: 'button', 'aria-label': 'Copy message', title: 'Copy' }, on: { click: async () => {
      ctx.announce((await ctx.copyText(message.text)) ? 'Copied' : 'Copy failed');
    } } }, icon('copy', 14));
    const bubble = h('div', { class: 'bubble' }, h('span', { class: 'visually-hidden', text: mine ? 'You: ' : `${phoneName}: ` }), ...linkParts(message.text));
    const body = h('div', { class: 'msg-body' },
      message.startsRun && !mine ? h('div', { class: 'msg-name', text: phoneName }) : null,
      h('div', { class: 'bubble-row' }, bubble, copy),
      h('div', { class: 'msg-meta', text: message.clock }));
    const lead = mine ? null : h('span', { class: `avatar${message.startsRun ? '' : ' avatar-spacer'}`, attrs: { 'aria-hidden': 'true' }, text: phoneInitial(phoneName) });
    return h('div', { class: `msg ${mine ? 'msg-laptop' : 'msg-phone'}${message.startsRun ? ' msg-first' : ''}`, dataset: { id: message.id } }, lead, body);
  }

  function addMessage(message, day, phoneName) {
    if (day.key !== rendered.day) {
      thread.append(h('div', { class: 'day-sep', attrs: { role: 'separator' } }, h('span', { text: day.label })));
      rendered.day = day.key;
    }
    thread.append(messageRow(message, phoneName));
  }

  function placeholder(content) {
    return h('div', { class: 'chat-empty' }, ...content);
  }

  function syncPicker(devices, target) {
    const options = signature(devices.map((d) => [d.deviceId, d.name]));
    if (rendered.options !== options) {
      rendered.options = options;
      clear(picker);
      for (const device of devices) picker.append(h('option', { text: device.name, attrs: { value: device.deviceId } }));
    }
    if (target.id) picker.value = target.id;
    picker.hidden = !target.needsChoice;
  }

  function update(next, now) {
    state = next;
    const target = chatTarget(next.devices, selectedId);
    selectedId = target.id;
    syncPicker(next.devices, target);
    subtitle.textContent = target.id ? `Conversation with ${target.name}` : '';
    thread.setAttribute('aria-label', target.id ? `Messages with ${target.name}` : 'Messages');
    box.disabled = !target.id;
    box.placeholder = target.id ? 'Type a message or paste a link' : 'Pair a phone first';
    syncSend();

    const flat = groupMessages(next.items, target.id, now).flatMap((day) => day.messages.map((message) => ({ message, day })));
    const ids = flat.map((entry) => entry.message.id);
    const unchanged = rendered.phone === target.id && rendered.name === target.name && signature(rendered.ids) === signature(ids);
    if (unchanged && !firstRender) return;

    const stick = firstRender || forceStick || nearBottom();
    const keepScroll = thread.scrollTop;
    const appendOnly = !firstRender && rendered.phone === target.id && rendered.name === target.name && rendered.ids.length > 0
      && rendered.ids.every((id, index) => id === ids[index]);

    thread.setAttribute('aria-live', appendOnly ? 'polite' : 'off'); // a full rebuild must not be read out again
    if (appendOnly) {
      for (const { message, day } of flat.slice(rendered.ids.length)) addMessage(message, day, target.name);
    } else {
      clear(thread);
      rendered.day = null;
      if (!target.id) {
        thread.append(placeholder(['Pair a phone first: it will show up under ', h('a', { text: 'Approvals', attrs: { href: '#/approvals' } }), '.']));
      } else if (!flat.length) {
        thread.append(placeholder(['No messages yet. Say hello!']));
      } else {
        for (const { message, day } of flat) addMessage(message, day, target.name);
      }
    }
    Object.assign(rendered, { phone: target.id, name: target.name, ids });

    if (stick) scrollToBottom();
    else if (appendOnly) pill.hidden = false;
    else thread.scrollTop = keepScroll;
    if (!appendOnly) thread.setAttribute('aria-live', 'polite');
    forceStick = false;
    firstRender = false;
  }

  return { el, update };
}
