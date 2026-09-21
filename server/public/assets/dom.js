// Small DOM toolkit. Elements are built with createElement and textContent only, so data can never become markup.
const SVG_NS = 'http://www.w3.org/2000/svg';

// 24x24 line icons, stroke = currentColor. Each entry is a list of path definitions.
const ICONS = {
  dashboard: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  chat: ['M5 4h14a1 1 0 011 1v10a1 1 0 01-1 1h-8l-5 4v-4H5a1 1 0 01-1-1V5a1 1 0 011-1z', 'M8 9h8', 'M8 12h5'],
  shield: ['M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  devices: ['M3 5h13v9H3z', 'M8 18h3', 'M17 9h4v11h-4z'],
  phone: ['M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1z', 'M11 18h2'],
  copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
  link: ['M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1', 'M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'],
  text: ['M5 6h14', 'M5 12h14', 'M5 18h9'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9.5h.01'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v5h4'],
  upload: ['M7 18a4 4 0 01-.6-7.9A6 6 0 0118 9.5 3.7 3.7 0 0117.5 18', 'M12 12v8', 'M9 14.5l3-3 3 3'],
  send: ['M4 12l16-8-6 16-3-7z'],
  download: ['M12 4v11', 'M8 11.5l4 4 4-4', 'M5 20h14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  chevron: ['M6 9l6 6 6-6'],
  clock: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'],
  info: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 11v5', 'M12 8h.01'],
  wifi: ['M3 9a14 14 0 0118 0', 'M6 12.5a9.5 9.5 0 0112 0', 'M9 16a5 5 0 016 0', 'M12 19.5h.01'],
  tailscale: ['M6 6h.01', 'M12 6h.01', 'M18 6h.01', 'M6 12h.01', 'M12 12h.01', 'M18 12h.01', 'M6 18h.01', 'M12 18h.01', 'M18 18h.01'],
  sun: ['M12 16a4 4 0 100-8 4 4 0 000 8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z'],
  broadcast: ['M12 12h.01', 'M8.5 8.5a5 5 0 000 7', 'M15.5 8.5a5 5 0 010 7', 'M5.6 5.6a9 9 0 000 12.8', 'M18.4 5.6a9 9 0 010 12.8'],
};

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) {
    svg.setAttribute(key, value);
  }
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** h('button', { class: 'btn', text: 'Save', on: { click: fn }, attrs: { type: 'button' } }, ...children) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs || {})) if (value !== undefined && value !== false) el.setAttribute(name, value === true ? '' : value);
  for (const [name, value] of Object.entries(props.dataset || {})) el.dataset[name] = value;
  for (const [name, handler] of Object.entries(props.on || {})) el.addEventListener(name, handler);
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (el) => el.replaceChildren();

/** A modal confirmation built on <dialog>: Escape cancels, focus returns to the opener. Resolves true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog', attrs: { 'aria-labelledby': 'dialog-title' } });
    const cancel = h('button', { class: 'btn btn-secondary', text: 'Cancel', attrs: { type: 'button' } });
    const confirm = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, attrs: { type: 'button' } });
    append(dialog, [h('h2', { text: title, attrs: { id: 'dialog-title' } }), h('p', { text: message }), h('div', { class: 'dialog-actions' }, cancel, confirm)]);
    cancel.addEventListener('click', () => dialog.close('cancel'));
    confirm.addEventListener('click', () => dialog.close('confirm'));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'confirm');
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

/** Copies text; falls back to a temporary textarea when the Clipboard API is unavailable. Resolves to success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'visually-hidden', attrs: { 'aria-hidden': 'true', tabindex: '-1', readonly: true } });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* copy is best effort */
    }
    area.remove();
    return ok;
  }
}
