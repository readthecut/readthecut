// Table-plane geometry. Coordinates are metres on the cloth, origin at the
// table centre: x along the length, z along the width (matches three.js XZ).

export interface V2 {
  x: number;
  z: number;
}

export const TABLE = { length: 2.54, width: 1.27 }; // 9ft playing surface, cushion nose to nose
export const BALL_R = 0.028575; // 2¼" balls
const CORNER_MOUTH = 0.1143; // 4½"
const SIDE_MOUTH = 0.127; // 5"
const HALF_L = TABLE.length / 2;
const HALF_W = TABLE.width / 2;

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Pocket {
  kind: 'corner' | 'side';
  jaws: [V2, V2];
  mouth: V2; // midpoint between the jaws
  hole: V2; // visual centre of the pocket opening
}

/** Range of object-ball directions (radians) that pocket the ball. */
export interface Window {
  lo: number;
  hi: number;
}

export interface Candidate {
  obDir: number; // direction the object ball leaves in
  ghost: V2;
  aimDir: number; // direction the cue ball is sent in
  cutDeg: number;
  miss: number; // metres outside the pocket window at the mouth; 0 = pocketed
}

export interface Shot {
  cue: V2;
  object: V2;
  objectNumber: number;
  pocket: Pocket;
  window: Window;
  correct: Candidate;
  choices: Candidate[]; // four, shuffled; includes `correct`
  correctIndex: number;
  cutDeg: number;
}

// ---------- vectors ----------

export const v = (x: number, z: number): V2 => ({ x, z });
export const add = (a: V2, b: V2): V2 => v(a.x + b.x, a.z + b.z);
export const sub = (a: V2, b: V2): V2 => v(a.x - b.x, a.z - b.z);
export const scale = (a: V2, s: number): V2 => v(a.x * s, a.z * s);
export const len = (a: V2): number => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2): number => len(sub(a, b));
export const dir = (angle: number): V2 => v(Math.cos(angle), Math.sin(angle));
export const angleOf = (a: V2): number => Math.atan2(a.z, a.x);

/** Wrap to (-π, π]. */
export function wrap(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

// ---------- table ----------

export const POCKETS: Pocket[] = (() => {
  const a = CORNER_MOUTH / Math.SQRT2;
  const list: Pocket[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const jaws: [V2, V2] = [v(sx * (HALF_L - a), sz * HALF_W), v(sx * HALF_L, sz * (HALF_W - a))];
      list.push({
        kind: 'corner',
        jaws,
        mouth: scale(add(jaws[0], jaws[1]), 0.5),
        hole: v(sx * (HALF_L + 0.015), sz * (HALF_W + 0.015)),
      });
    }
  }
  for (const sz of [-1, 1]) {
    const jaws: [V2, V2] = [v(-SIDE_MOUTH / 2, sz * HALF_W), v(SIDE_MOUTH / 2, sz * HALF_W)];
    list.push({ kind: 'side', jaws, mouth: v(0, sz * HALF_W), hole: v(0, sz * (HALF_W + 0.04)) });
  }
  return list;
})();

export function onTable(p: V2, margin = BALL_R + 0.01): boolean {
  return Math.abs(p.x) <= HALF_L - margin && Math.abs(p.z) <= HALF_W - margin;
}

/**
 * Directions from `ob` whose path clears both jaws by a ball radius, i.e. the
 * ball drops. Returned angles are unwrapped so that lo < hi.
 */
export function pocketWindow(ob: V2, pocket: Pocket): Window | null {
  let [j1, j2] = pocket.jaws;
  let p1 = angleOf(sub(j1, ob));
  let p2 = angleOf(sub(j2, ob));
  if (wrap(p2 - p1) < 0) {
    [j1, j2] = [j2, j1];
    [p1, p2] = [p2, p1];
  }
  const d1 = dist(j1, ob);
  const d2 = dist(j2, ob);
  if (d1 <= BALL_R || d2 <= BALL_R) return null;
  const lo = p1 + Math.asin(BALL_R / d1);
  const hi = p1 + wrap(p2 - p1) - Math.asin(BALL_R / d2);
  return hi > lo ? { lo, hi } : null;
}

/** Lateral distance (m) outside the window at the pocket mouth; 0 if pocketed. */
export function missDistance(ob: V2, pocket: Pocket, win: Window, obDir: number): number {
  const d = dist(ob, pocket.mouth);
  const centre = (win.lo + win.hi) / 2;
  const a = centre + wrap(obDir - centre);
  if (a < win.lo) return d * Math.tan(win.lo - a);
  if (a > win.hi) return d * Math.tan(a - win.hi);
  return 0;
}

/** Build the cue-ball aim that sends the object ball along `obDir`, or null if the cut is unplayable. */
export function candidateFor(cue: V2, ob: V2, pocket: Pocket, win: Window, obDir: number): Candidate | null {
  const u = dir(obDir);
  const ghost = sub(ob, scale(u, 2 * BALL_R));
  const travel = sub(ghost, cue);
  if (len(travel) < 0.05) return null;
  const aimDir = angleOf(travel);
  const cutDeg = (Math.abs(wrap(obDir - aimDir)) * 180) / Math.PI;
  if (cutDeg > 85) return null; // the cue ball would clip the object ball first or barely touch it
  return { obDir, ghost, aimDir, cutDeg, miss: missDistance(ob, pocket, win, obDir) };
}

// ---------- shot generation ----------

type Rng = () => number;
const between = (rng: Rng, a: number, b: number) => a + (b - a) * rng();

/** Distance past the window edge for the closest Distractor, and the spacing of the rest. */
const DISTRACTOR_SPREAD: Record<Difficulty, { near: number; step: number }> = {
  easy: { near: 2 * BALL_R, step: 3 * BALL_R },
  medium: { near: BALL_R, step: 2 * BALL_R },
  hard: { near: 0.4 * BALL_R, step: 1.4 * BALL_R },
};

export const MAX_CUT = 75;
const MAX_SIDE_CUT = 45;
export const BAND_SIZE = 15;
export const BAND_COUNT = MAX_CUT / BAND_SIZE;

export function bandOf(cutDeg: number): number {
  return Math.min(BAND_COUNT - 1, Math.floor(cutDeg / BAND_SIZE));
}

function makeDistractors(
  rng: Rng,
  cue: V2,
  ob: V2,
  pocket: Pocket,
  win: Window,
  difficulty: Difficulty,
): Candidate[] | null {
  const { near, step } = DISTRACTOR_SPREAD[difficulty];
  const d = dist(ob, pocket.mouth);
  const out: Candidate[] = [];
  for (let i = 0; i < 3; i++) {
    const m = near + i * step;
    const offset = Math.atan(m / d);
    const first = rng() < 0.5 ? -1 : 1;
    let made: Candidate | null = null;
    for (const side of [first, -first]) {
      const obDir = side < 0 ? win.lo - offset : win.hi + offset;
      made = candidateFor(cue, ob, pocket, win, obDir);
      if (made) break;
    }
    if (!made) return null;
    out.push(made);
  }
  return out;
}

export function generateShot(difficulty: Difficulty, rng: Rng = Math.random): Shot {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const pocket = POCKETS[Math.floor(rng() * POCKETS.length)];
    const ob = v(between(rng, -HALF_L, HALF_L), between(rng, -HALF_W, HALF_W));
    if (!onTable(ob)) continue;
    const toPocket = dist(ob, pocket.mouth);
    if (toPocket < 0.2 || toPocket > 2) continue;
    const win = pocketWindow(ob, pocket);
    // Require a window of at least ~1cm at the mouth, so the shot is genuinely makeable.
    if (!win || (win.hi - win.lo) * toPocket < 0.01) continue;

    const maxCut = pocket.kind === 'side' ? MAX_SIDE_CUT : MAX_CUT;
    // Pick a band first so every Cut Angle Band gets practised evenly.
    const bands = Math.ceil(maxCut / BAND_SIZE);
    const band = Math.floor(rng() * bands);
    const cutDeg = Math.min(maxCut, between(rng, band * BAND_SIZE, (band + 1) * BAND_SIZE));

    const obDir = (win.lo + win.hi) / 2;
    const ghost = sub(ob, scale(dir(obDir), 2 * BALL_R));
    const side = rng() < 0.5 ? -1 : 1;
    const aimDir = obDir + (side * cutDeg * Math.PI) / 180;
    const cue = sub(ghost, scale(dir(aimDir), between(rng, 0.3, 2)));
    if (!onTable(cue)) continue;

    const correct = candidateFor(cue, ob, pocket, win, obDir);
    if (!correct) continue;
    const distractors = makeDistractors(rng, cue, ob, pocket, win, difficulty);
    if (!distractors) continue;

    const choices = [correct, ...distractors];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return {
      cue,
      object: ob,
      objectNumber: 1 + Math.floor(rng() * 15),
      pocket,
      window: win,
      correct,
      choices,
      correctIndex: choices.indexOf(correct),
      cutDeg: correct.cutDeg,
    };
  }
  throw new Error('Could not generate a shot');
}
