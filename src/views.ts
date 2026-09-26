// Canvases showing a rendered view, kept at their on-screen resolution.

/** A view on screen, re-rendered whenever its display size changes. */
export interface View {
  canvas: HTMLCanvasElement;
  aspect: number;
  render: (c: HTMLCanvasElement) => void;
}

let views: View[] = [];

const MAX_RENDER_WIDTH = 3200;

/** Backing-store width for a canvas shown `cssWidth` px wide: device pixels, with a floor for 1x screens. */
const renderWidth = (cssWidth: number) =>
  Math.min(MAX_RENDER_WIDTH, Math.round(cssWidth * Math.max(devicePixelRatio || 1, 1.5)));

export function paint(view: View, cssWidth = view.canvas.clientWidth) {
  const w = renderWidth(cssWidth);
  if (!w) return; // not laid out (e.g. hidden)
  const hgt = Math.round(w / view.aspect);
  if (view.canvas.width === w && view.canvas.height === hgt && view.canvas.dataset.painted) return;
  view.canvas.width = w;
  view.canvas.height = hgt;
  view.canvas.dataset.painted = '1';
  view.render(view.canvas);
}

/** Force a re-render even when the size is unchanged, e.g. because the scene changed. */
export function repaint(view: View) {
  delete view.canvas.dataset.painted;
  paint(view);
}

export function addView(canvas: HTMLCanvasElement, aspect: number, render: (c: HTMLCanvasElement) => void): View {
  const view = { canvas, aspect, render };
  views.push(view);
  paint(view);
  return view;
}

/** Forget the current screen's views, before building a new screen. */
export const resetViews = () => {
  views = [];
};

/** Re-render views at their current size (after a resize), or force all of them. */
export const paintAll = () => views.forEach((v) => paint(v));
export const repaintAll = () => views.forEach(repaint);

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(paintAll, 150);
});
