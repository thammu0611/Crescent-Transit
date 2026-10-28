// One guard for every form: a second submit of the same form within a moment
// (a double click or a double Enter) is ignored, and its submit button shows as
// busy meanwhile. Forms' own handlers are untouched; a real resubmission a
// little later goes through as before.
const WINDOW_MS = 800;

export function installSubmitGuard() {
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const now = Date.now();
    if (now - Number(form.dataset.submittedAt || 0) < WINDOW_MS) {
      // Runs before React's handler (capture phase on the document).
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    form.dataset.submittedAt = String(now);
    const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type])')];
    for (const b of buttons) b.setAttribute('aria-busy', 'true');
    setTimeout(() => { for (const b of buttons) b.removeAttribute('aria-busy'); }, WINDOW_MS);
  }, true);
}
