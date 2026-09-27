// Browser full screen for desktop, shared by every screen that shows a view.

import { paintAll } from './views';

/** Desktop only: phones already fill the screen, and their full-screen support is patchy. */
export const canFullscreen = document.fullscreenEnabled && matchMedia('(pointer: fine)').matches;

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

/** The header button, or nothing where full screen isn't offered. */
export const fullscreenButton = () =>
  canFullscreen ? '<button class="link" data-fullscreen title="Full screen (F)"></button>' : '';

/** Bring every full-screen button's label, and the page's layout class, in line with the current state. */
export function syncFullscreen() {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen', on);
  document.querySelectorAll<HTMLButtonElement>('[data-fullscreen]').forEach((b) => {
    b.textContent = on ? 'Exit full screen' : 'Full screen';
    b.setAttribute('aria-pressed', String(on));
  });
}

/** Wire up the button(s) in a freshly built screen. */
export function bindFullscreen(root: ParentNode) {
  root.querySelectorAll('[data-fullscreen]').forEach((b) => b.addEventListener('click', toggleFullscreen));
  syncFullscreen();
}

/** The F shortcut, for a screen's own key handler. Returns true if it handled the key. */
export function fullscreenKey(e: KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== 'f' || !canFullscreen || e.metaKey || e.ctrlKey || e.altKey) return false;
  toggleFullscreen();
  return true;
}

document.addEventListener('fullscreenchange', () => {
  syncFullscreen();
  // The layout grows or shrinks, so re-render every view at its new size.
  requestAnimationFrame(paintAll);
});
