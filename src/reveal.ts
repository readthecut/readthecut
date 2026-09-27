import { STROKES } from './physics';
import { objectColour } from './scene';
import type { PlacingMarks } from './overlay';
import { MIN_TANGENT_CUT, dir, dist, stunScratch, tangentEnd, type Candidate, type Shot, type V2 } from './geometry';

const CORRECT = '#4ade80';
const WRONG = '#f87171';
const TANGENT = 'rgba(247, 245, 238, 0.7)';
export const SCRATCH = '#ffc94d';

/**
 * Draw the table top-down and return drawing helpers in table coordinates.
 * With `focus`, the view zooms to fit those points (plus padding) instead of the whole table.
 */
function topDown(canvas: HTMLCanvasElement, shot: Shot, focus?: V2[]) {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const { format, pockets } = shot.table;
  const margin = 0.12;
  let cx = 0;
  let cz = 0;
  let spanX = format.length + 2 * margin;
  let spanZ = format.width + 2 * margin;
  if (focus) {
    const pad = 0.22;
    const xs = focus.map((p) => p.x);
    const zs = focus.map((p) => p.z);
    const [x0, x1, z0, z1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
    cx = (x0 + x1) / 2;
    cz = (z0 + z1) / 2;
    spanX = x1 - x0;
    spanZ = z1 - z0;
  }
  const s = Math.min(width / spanX, height / spanZ);
  const ox = width / 2 - cx * s;
  const oy = height / 2 - cz * s;
  const px = (p: V2) => [ox + p.x * s, oy + p.z * s] as const;
  const toTable = (x: number, y: number): V2 => ({ x: (x - ox) / s, z: (y - oy) / s });

  g.fillStyle = '#15171b';
  g.fillRect(0, 0, width, height);
  // Rail and cloth.
  g.fillStyle = '#5a3320';
  g.fillRect(ox - (format.length / 2 + margin) * s, oy - (format.width / 2 + margin) * s, (format.length + 2 * margin) * s, (format.width + 2 * margin) * s);
  // Pockets before the cloth, so the cloth covers the part of each circle inside the nose line.
  g.fillStyle = '#050505';
  for (const p of pockets) {
    const [x, y] = px(p.hole);
    g.beginPath();
    g.arc(x, y, p.holeR * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#1d6b47';
  g.fillRect(ox - (format.length / 2) * s, oy - (format.width / 2) * s, format.length * s, format.width * s);

  const line = (a: V2, b: V2, colour: string, dash: number[] = [], w = 2) => {
    g.strokeStyle = colour;
    g.lineWidth = w * devicePixelRatio;
    g.setLineDash(dash.map((d) => d * devicePixelRatio));
    g.beginPath();
    g.moveTo(...px(a));
    g.lineTo(...px(b));
    g.stroke();
    g.setLineDash([]);
  };
  const ball = (p: V2, r: number, fill: string | null, stroke: string | null, dashed = true) => {
    const [x, y] = px(p);
    g.beginPath();
    g.arc(x, y, r * s, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 1.5 * devicePixelRatio;
      if (dashed) g.setLineDash([3 * devicePixelRatio, 2 * devicePixelRatio]);
      g.stroke();
      g.setLineDash([]);
    }
  };
  const obPath = (c: Candidate) => {
    const d = dist(shot.object, shot.pocket.mouth) + (c.miss > 0 ? 0.15 : 0);
    const u = dir(c.obDir);
    return { x: shot.object.x + u.x * d, z: shot.object.z + u.z * d };
  };
  return { g, s, px, toTable, line, ball, obPath };
}

/** Top-down diagram of the Shot: the correct line, the chosen line and where each sends the object ball. */
export function drawReveal(canvas: HTMLCanvasElement, shot: Shot, chosen: Candidate) {
  const { format } = shot.table;
  const { line, ball, obPath } = topDown(canvas, shot);

  // Tangent Line of the correct shot: where a stunned cue ball goes after contact.
  // Stun only: a rolling cue ball follows forward instead of taking the Tangent Line.
  if (shot.correct.cutDeg >= MIN_TANGENT_CUT && !STROKES[shot.stroke].rolling) {
    const scratch = stunScratch(shot.table, shot.correct);
    line(shot.correct.ghost, tangentEnd(shot.table, shot.correct), scratch ? SCRATCH : TANGENT, [2, 4], 1.5);
  }

  const isCorrect = chosen === shot.correct;
  if (!isCorrect) {
    line(shot.cue, chosen.ghost, WRONG, [6, 4]);
    line(shot.object, obPath(chosen), WRONG, [], 2);
    ball(chosen.ghost, format.cueR, null, WRONG);
  }
  line(shot.cue, shot.correct.ghost, CORRECT, [6, 4]);
  line(shot.object, obPath(shot.correct), CORRECT, [], 2);
  ball(shot.correct.ghost, format.cueR, null, CORRECT);
  ball(shot.cue, format.cueR, '#f7f5ee', null);
  ball(shot.object, format.objectR, objectColour(shot), null);
}

const PLACED = '#f7f5ee'; // the placed ghost ball: a see-through cue ball
const POCKET_RING = '#ffc94d';

/**
 * Ghost Ball Trainer, stage 1: top-down, zoomed to the shot. Draws the placed
 * ghost ball, the optional pocket-line aid and, after locking in, the answer.
 * Returns converters between canvas pixels and table coordinates, for dragging.
 */
export function drawPlacement(
  canvas: HTMLCanvasElement,
  shot: Shot,
  placed: Candidate,
  opts: { marks: PlacingMarks; reveal: boolean; showMine?: boolean; showCorrect?: boolean },
): { toTable: (x: number, y: number) => V2; toCanvas: (p: V2) => readonly [number, number] } {
  const { format } = shot.table;
  const { g, s, px, toTable, line, ball, obPath } = topDown(canvas, shot, [shot.cue, shot.object, shot.pocket.mouth]);

  // Ring the called pocket, as in the 3D views.
  const [hx, hy] = px(shot.pocket.hole);
  g.strokeStyle = POCKET_RING;
  g.lineWidth = 3 * devicePixelRatio;
  g.beginPath();
  g.arc(hx, hy, (shot.pocket.holeR + 0.006) * s, 0, Math.PI * 2);
  g.stroke();

  const { marks } = opts;
  if (marks.pocketLine && !opts.reveal) {
    // From the pocket through the object ball and out the far side: the ghost ball sits on this line.
    const u = dir(shot.correct.obDir);
    const beyond = { x: shot.object.x - u.x * 4 * format.objectR, z: shot.object.z - u.z * 4 * format.objectR };
    line(shot.pocket.mouth, beyond, 'rgba(247, 245, 238, 0.55)', [6, 5], 1.5);
  }
  const mine = !opts.reveal || opts.showMine !== false;
  const correct = opts.reveal && opts.showCorrect !== false;
  // While placing, the ghost ball and its aim line can each be hidden; after locking in, "yours" shows both.
  const showGhost = opts.reveal ? mine : marks.ghost;
  if (mine && marks.aimLine) line(shot.cue, placed.ghost, 'rgba(247, 245, 238, 0.8)', [6, 4]);
  if (opts.reveal && mine) line(shot.object, obPath(placed), placed.miss > 0 ? WRONG : CORRECT);
  if (correct) {
    line(shot.cue, shot.correct.ghost, 'rgba(74, 222, 128, 0.7)', [6, 4]);
    line(shot.object, obPath(shot.correct), CORRECT);
    ball(shot.correct.ghost, format.cueR, 'rgba(74, 222, 128, 0.25)', CORRECT, false);
  }
  ball(shot.cue, format.cueR, '#f7f5ee', null);
  ball(shot.object, format.objectR, objectColour(shot), null);
  if (showGhost) ball(placed.ghost, format.cueR, 'rgba(247, 245, 238, 0.35)', PLACED, false);
  if (marks.contact && !opts.reveal) {
    // The correct contact point, on the object ball's edge facing the ghost ball.
    const u = dir(shot.correct.obDir);
    const cp = { x: shot.object.x - u.x * format.objectR, z: shot.object.z - u.z * format.objectR };
    ball(cp, format.objectR * 0.3, CORRECT, null);
  }
  return { toTable, toCanvas: px };
}
