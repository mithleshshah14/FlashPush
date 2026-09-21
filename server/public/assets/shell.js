// The static page frame (sidebar, status, banner, live region). Its markup lives in index.html;
// this module only fills in icons and updates text and attributes.
import { icon } from './dom.js';
import { documentTitle, statusInfo } from './model.js';

export function createShell(doc = document) {
  const $ = (id) => doc.getElementById(id);
  const links = [...doc.querySelectorAll('.nav-link')];
  const state = { view: 'dashboard', pending: 0 };

  for (const slot of doc.querySelectorAll('[data-icon]')) slot.replaceChildren(icon(slot.dataset.icon, 20));

  function refreshTitle() {
    doc.title = documentTitle(state.view, state.pending);
  }

  return {
    main: $('main'),

    setView(view) {
      state.view = view;
      doc.body.dataset.view = view;
      for (const link of links) {
        if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      refreshTitle();
    },

    setPending(count) {
      state.pending = count;
      const badge = $('approvals-badge');
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.setAttribute('aria-label', `${count} pending`);
      refreshTitle();
    },

    setLaptop(name) {
      $('laptop-name').textContent = name;
    },

    setStatus(status) {
      const info = statusInfo(status);
      $('status-pill').dataset.tone = info.tone;
      $('status-label').textContent = info.label;
    },

    setOffline(offline) {
      $('offline-banner').hidden = !offline;
    },

    /** Speaks a message through the polite live region (used for new pairing requests). */
    announce(text) {
      const region = $('live-region');
      region.textContent = '';
      setTimeout(() => {
        region.textContent = text;
      }, 50);
    },

    /** Shows the theme the button would switch to, and calls onToggle when it is pressed. */
    bindThemeToggle(onToggle) {
      const button = $('theme-toggle');
      button.addEventListener('click', onToggle);
      return (resolved) => {
        const next = resolved === 'dark' ? 'light' : 'dark';
        button.replaceChildren(icon(next === 'light' ? 'sun' : 'moon', 18));
        button.setAttribute('aria-label', `Switch to ${next} theme`);
        button.title = `Switch to ${next} theme`;
      };
    },

    focusMain() {
      this.main.focus({ preventScroll: true });
    },
  };
}
