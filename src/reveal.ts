import { ballColour } from './scene';
import { BALL_R, POCKETS, TABLE, dir, dist, type Candidate, type Shot, type V2 } from './geometry';

const CORRECT = '#4ade80';
const WRONG = '#f87171';

/** Top-down diagram of the Shot: the correct line, the chosen line and where each sends the object ball. */
export function drawReveal(canvas: HTMLCanvasElement, shot: Shot, chosen: Candidate) {
  const g = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const margin = 0.12;
  const s = Math.min(width / (TABLE.length + 2 * margin), height / (TABLE.width + 2 * margin));
  const ox = width / 2;
  const oy = height / 2;
  const px = (p: V2) => [ox + p.x * s, oy + p.z * s] as const;

  g.clearRect(0, 0, width, height);
  // Rail and cloth.
  g.fillStyle = '#5a3320';
  g.fillRect(ox - (TABLE.length / 2 + margin) * s, oy - (TABLE.width / 2 + margin) * s, (TABLE.length + 2 * margin) * s, (TABLE.width + 2 * margin) * s);
  g.fillStyle = '#1d6b47';
  g.fillRect(ox - (TABLE.length / 2) * s, oy - (TABLE.width / 2) * s, TABLE.length * s, TABLE.width * s);
  g.fillStyle = '#050505';
  for (const p of POCKETS) {
    const [x, y] = px(p.hole);
    g.beginPath();
    g.arc(x, y, (p.kind === 'corner' ? 0.075 : 0.07) * s, 0, Math.PI * 2);
    g.fill();
  }

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
  const ball = (p: V2, fill: string | null, stroke: string | null) => {
    const [x, y] = px(p);
    g.beginPath();
    g.arc(x, y, BALL_R * s, 0, Math.PI * 2);
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
    ball(chosen.ghost, null, WRONG);
  }
  line(shot.cue, shot.correct.ghost, CORRECT, [6, 4]);
  line(shot.object, obPath(shot.correct), CORRECT, [], 2);
  ball(shot.correct.ghost, null, CORRECT);
  ball(shot.cue, '#f7f5ee', null);
  ball(shot.object, ballColour(shot.objectNumber), null);
}
