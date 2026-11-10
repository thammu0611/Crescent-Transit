// The theme follows the device (light or dark) unless the person picks one.
// Stored: 'system' (the default), 'light' or 'dark'.
const KEY = 'ubts.theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function savedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

const resolve = (choice) => (choice === 'system' ? (media?.matches ? 'dark' : 'light') : choice);

let current = 'system';
export function applyTheme(choice) {
  current = choice;
  document.documentElement.dataset.theme = resolve(choice);
}

// While following the device, switch as soon as the device does.
media?.addEventListener?.('change', () => { if (current === 'system') applyTheme('system'); });

export function saveTheme(choice) {
  applyTheme(choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}
