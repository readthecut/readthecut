import { objectColour } from './scene';
import { dir, dist, type Candidate, type Shot, type V2 } from './geometry';

const CORRECT = '#4ade80';
const WRONG = '#f87171';

/** Top-down diagram of the Shot: the correct line, the chosen line and where each sends the object ball. */
export function drawReveal(canvas: HTMLCanvasElement, shot: Shot, chosen: Candidate) {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const { format, pockets } = shot.table;
  const margin = 0.12;
  const s = Math.min(width / (format.length + 2 * margin), height / (format.width + 2 * margin));
  const ox = width / 2;
  const oy = height / 2;
  const px = (p: V2) => [ox + p.x * s, oy + p.z * s] as const;

  g.clearRect(0, 0, width, height);
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
  const ball = (p: V2, r: number, fill: string | null, stroke: string | null) => {
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
      g.setLineDash([3 * devicePixelRatio, 2 * devicePixelRatio]);
      g.stroke();
      g.setLineDash([]);
    }
  };
  const obPath = (c: Candidate) => {
    const d = dist(shot.object, shot.pocket.mouth) + (c.miss > 0 ? 0.15 : 0);
    const u = dir(c.obDir);
    return { x: shot.object.x + u.x * d, z: shot.object.z + u.z * d };
  };

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
