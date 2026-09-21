// Light / dark / system. Storage can be blocked (private windows, policies), so it is never trusted.
const KEY = 'flashpush-theme';
const CHOICES = ['light', 'dark', 'system'];

export function readTheme(storage) {
  try {
    const value = storage.getItem(KEY);
    return CHOICES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(storage, value) {
  try {
    storage.setItem(KEY, value);
  } catch {
    /* the choice just will not be remembered */
  }
}

export const resolveTheme = (pref, prefersDark) => (pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref);

export function applyTheme(root, pref, prefersDark) {
  root.dataset.theme = resolveTheme(pref, prefersDark);
}
