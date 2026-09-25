// Table-plane geometry. Coordinates are metres on the cloth, origin at the
// table centre: x along the length, z along the width (matches three.js XZ).

import { FORMATS, type FormatId, type TableFormat } from './formats';
import type { Rng } from './rng';

export interface V2 {
  x: number;
  z: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Pocket {
  kind: 'corner' | 'side';
  jaws: [V2, V2];
  mouth: V2; // midpoint between the jaws
  hole: V2; // visual centre of the pocket opening
  holeR: number; // visual radius of the opening
}

/** A Table Format with its pockets laid out. */
export interface Table {
  format: TableFormat;
  halfL: number;
  halfW: number;
  pockets: Pocket[];
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
  table: Table;
  cue: V2;
  object: V2;
  objectNumber: number; // 1–15; UK tables map it to red, yellow or black
  objectSpin: [number, number, number]; // rotation of the object ball, for looks only
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

const tables = new Map<FormatId, Table>();

export function tableFor(id: FormatId): Table {
  let t = tables.get(id);
  if (t) return t;
  const format = FORMATS[id];
  const halfL = format.length / 2;
  const halfW = format.width / 2;
  const pockets: Pocket[] = [];
  const a = format.cornerMouth / Math.SQRT2; // jaw distance from the corner along each rail
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const jaws: [V2, V2] = [v(sx * (halfL - a), sz * halfW), v(sx * halfL, sz * (halfW - a))];
      pockets.push({
        kind: 'corner',
        jaws,
        mouth: scale(add(jaws[0], jaws[1]), 0.5),
        hole: v(sx * (halfL + 0.19 * a), sz * (halfW + 0.19 * a)),
        holeR: 0.93 * a,
      });
    }
  }
  const s = format.sideMouth / 2;
  for (const sz of [-1, 1]) {
    const jaws: [V2, V2] = [v(-s, sz * halfW), v(s, sz * halfW)];
    pockets.push({ kind: 'side', jaws, mouth: v(0, sz * halfW), hole: v(0, sz * (halfW + 0.63 * s)), holeR: 1.1 * s });
  }
  t = { format, halfL, halfW, pockets };
  tables.set(id, t);
  return t;
}

export function onTable(table: Table, p: V2, r: number): boolean {
  const margin = r + 0.01;
  return Math.abs(p.x) <= table.halfL - margin && Math.abs(p.z) <= table.halfW - margin;
}

/**
 * Directions from `ob` whose path clears both jaws by a ball radius, i.e. the
 * ball drops. Returned angles are unwrapped so that lo < hi.
 */
export function pocketWindow(ob: V2, pocket: Pocket, r: number): Window | null {
  let [j1, j2] = pocket.jaws;
  let p1 = angleOf(sub(j1, ob));
  let p2 = angleOf(sub(j2, ob));
  if (wrap(p2 - p1) < 0) {
    [j1, j2] = [j2, j1];
    [p1, p2] = [p2, p1];
  }
  const d1 = dist(j1, ob);
  const d2 = dist(j2, ob);
  if (d1 <= r || d2 <= r) return null;
  const lo = p1 + Math.asin(r / d1);
  const hi = p1 + wrap(p2 - p1) - Math.asin(r / d2);
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
export function candidateFor(
  table: Table,
  cue: V2,
  ob: V2,
  pocket: Pocket,
  win: Window,
  obDir: number,
): Candidate | null {
  const { objectR, cueR } = table.format;
  const u = dir(obDir);
  const ghost = sub(ob, scale(u, objectR + cueR));
  const travel = sub(ghost, cue);
  if (len(travel) < 0.05) return null;
  const aimDir = angleOf(travel);
  const cutDeg = (Math.abs(wrap(obDir - aimDir)) * 180) / Math.PI;
  if (cutDeg > 85) return null; // the cue ball would clip the object ball first or barely touch it
  return { obDir, ghost, aimDir, cutDeg, miss: missDistance(ob, pocket, win, obDir) };
}

/** Which way a Choice misses: an overcut hits too thin, an undercut too full. */
export function missKind(shot: Shot, c: Candidate): 'correct' | 'over' | 'under' {
  if (c === shot.correct) return 'correct';
  return c.cutDeg > shot.correct.cutDeg ? 'over' : 'under';
}

// ---------- shot generation ----------

const between = (rng: Rng, a: number, b: number) => a + (b - a) * rng();

/** Distance past the window edge for the closest Distractor, and the spacing of the rest, in object-ball radii. */
const DISTRACTOR_SPREAD: Record<Difficulty, { near: number; step: number }> = {
  easy: { near: 2, step: 3 },
  medium: { near: 1, step: 2 },
  hard: { near: 0.4, step: 1.4 },
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
  table: Table,
  cue: V2,
  ob: V2,
  pocket: Pocket,
  win: Window,
  difficulty: Difficulty,
): Candidate[] | null {
  const r = table.format.objectR;
  const { near, step } = DISTRACTOR_SPREAD[difficulty];
  const d = dist(ob, pocket.mouth);
  const out: Candidate[] = [];
  for (let i = 0; i < 3; i++) {
    const m = (near + i * step) * r;
    const offset = Math.atan(m / d);
    const first = rng() < 0.5 ? -1 : 1;
    let made: Candidate | null = null;
    for (const side of [first, -first]) {
      const obDir = side < 0 ? win.lo - offset : win.hi + offset;
      made = candidateFor(table, cue, ob, pocket, win, obDir);
      if (made) break;
    }
    if (!made) return null;
    out.push(made);
  }
  return out;
}

/**
 * Generator version 1. Frozen: shared Shot links and past Daily Shots replay
 * through this exact code (see docs/adr/0001). Changes go in a new version.
 */
function generateShotV1(formatId: FormatId, difficulty: Difficulty, rng: Rng): Shot {
  const table = tableFor(formatId);
  const { objectR, cueR } = table.format;
  for (let attempt = 0; attempt < 5000; attempt++) {
    const pocket = table.pockets[Math.floor(rng() * table.pockets.length)];
    const ob = v(between(rng, -table.halfL, table.halfL), between(rng, -table.halfW, table.halfW));
    if (!onTable(table, ob, objectR)) continue;
    const toPocket = dist(ob, pocket.mouth);
    if (toPocket < 0.2 || toPocket > 2) continue;
    const win = pocketWindow(ob, pocket, objectR);
    // Require a window of at least ~1cm at the mouth, so the shot is genuinely makeable.
    if (!win || (win.hi - win.lo) * toPocket < 0.01) continue;

    const maxCut = pocket.kind === 'side' ? MAX_SIDE_CUT : MAX_CUT;
    // Pick a band first so every Cut Angle Band gets practised evenly.
    const bands = Math.ceil(maxCut / BAND_SIZE);
    const band = Math.floor(rng() * bands);
    const cutDeg = Math.min(maxCut, between(rng, band * BAND_SIZE, (band + 1) * BAND_SIZE));

    const obDir = (win.lo + win.hi) / 2;
    const ghost = sub(ob, scale(dir(obDir), objectR + cueR));
    const side = rng() < 0.5 ? -1 : 1;
    const aimDir = obDir + (side * cutDeg * Math.PI) / 180;
    const cue = sub(ghost, scale(dir(aimDir), between(rng, 0.3, 2)));
    if (!onTable(table, cue, cueR)) continue;

    const correct = candidateFor(table, cue, ob, pocket, win, obDir);
    if (!correct) continue;
    const distractors = makeDistractors(rng, table, cue, ob, pocket, win, difficulty);
    if (!distractors) continue;

    const choices = [correct, ...distractors];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return {
      table,
      cue,
      object: ob,
      objectNumber: 1 + Math.floor(rng() * 15),
      objectSpin: [rng() * 0.8 - 0.4, rng() * Math.PI * 2, rng() * 0.8 - 0.4],
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

export const GENERATORS: Record<number, (f: FormatId, d: Difficulty, rng: Rng) => Shot> = {
  1: generateShotV1,
};
export const CURRENT_GENERATOR = 1;

export function generateShot(formatId: FormatId, difficulty: Difficulty, rng: Rng, version = CURRENT_GENERATOR): Shot {
  const gen = GENERATORS[version];
  if (!gen) throw new Error(`Unknown generator version ${version}`);
  return gen(formatId, difficulty, rng);
}
