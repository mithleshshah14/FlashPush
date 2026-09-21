// Small pieces shared by more than one view.
import { h, icon } from './dom.js';
import { routeInfo } from './model.js';

/** A "Wi-Fi" / "Tailscale" pill. `kind` is an address kind from the server (lan, tailscale, ...). */
export function routeChip(kind) {
  const route = routeInfo(kind);
  const symbol = route.key === 'wifi' ? 'wifi' : route.key === 'tailscale' ? 'tailscale' : null;
  return h('span', { class: `chip chip-${route.key}` }, symbol && icon(symbol, 14), route.label);
}

/** A button that copies `text` and briefly says "Copied". */
export function copyButton(ctx, text, { label = 'Copy', small = true } = {}) {
  const button = h('button', { class: `btn btn-secondary${small ? ' btn-small' : ''}`, attrs: { type: 'button' } }, icon('copy', 16), h('span', { text: label }));
  const caption = button.querySelector('span');
  let timer = null;
  button.addEventListener('click', async () => {
    const ok = await ctx.copyText(text);
    caption.textContent = ok ? 'Copied' : 'Copy failed';
    clearTimeout(timer);
    timer = setTimeout(() => {
      caption.textContent = label;
    }, 1500);
  });
  return button;
}

/** Runs an async action, disabling `button` meanwhile; failures go to `onError` (a message string). */
export async function guarded(button, action, onError) {
  button.disabled = true;
  try {
    await action();
    onError('');
  } catch (error) {
    onError(error.message);
  } finally {
    button.disabled = false;
  }
}
