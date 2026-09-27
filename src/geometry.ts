// Table-plane geometry. Coordinates are metres on the cloth, origin at the
// table centre: x along the length, z along the width (matches three.js XZ).

import { FORMATS, type FormatId, type TableFormat } from './formats';
import { strokeThrow, type Stroke } from './physics';
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
  /** Where each facing meets the back of the cushion, in the same order as `jaws`. Visual only. */
  throat: [V2, V2];
  hole: V2; // visual centre of the drop hole, just behind the throat
  holeR: number; // visual radius of the drop hole
}

/** Cushion depth, nose to rail (about 2"). Visual only. */
export const CUSHION_W = 0.05;

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
  obDir: number; // direction the object ball actually leaves in, after any throw
  lineOfCentres: number; // direction from the ghost ball through the object ball at contact
  ghost: V2;
  aimDir: number; // direction the cue ball is sent in
  cutDeg: number; // geometric cut: between the aim and the line of centres
  throwDeg: number; // how far throw turns the object ball off the line of centres
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
  stroke: Stroke;
  correct: Candidate;
  /** With throw: the pure ghost-ball aim at the pocket, and what throw does to it. Null for Geometry. */
  geometric: Candidate | null;
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
  // How far each facing leans toward the pocket over the cushion's depth.
  const lean = (facingDeg: number) => CUSHION_W * Math.tan(((facingDeg - 90) * Math.PI) / 180);
  /** The drop hole sits just behind the throat, a little wider than it. */
  const holeBehind = (throat: [V2, V2], outward: V2) => {
    const mid = scale(add(throat[0], throat[1]), 0.5);
    return { hole: add(mid, scale(outward, 0.02)), holeR: dist(throat[0], throat[1]) / 2 + 0.002 };
  };
  const a = format.cornerMouth / Math.SQRT2; // jaw distance from the corner along each rail
  const fc = lean(format.cornerFacingDeg);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const jaws: [V2, V2] = [v(sx * (halfL - a), sz * halfW), v(sx * halfL, sz * (halfW - a))];
      const throat: [V2, V2] = [
        v(sx * (halfL - a + fc), sz * (halfW + CUSHION_W)),
        v(sx * (halfL + CUSHION_W), sz * (halfW - a + fc)),
      ];
      pockets.push({
        kind: 'corner',
        jaws,
        mouth: scale(add(jaws[0], jaws[1]), 0.5),
        throat,
        ...holeBehind(throat, v(sx * Math.SQRT1_2, sz * Math.SQRT1_2)),
      });
    }
  }
  const s = format.sideMouth / 2;
  const fs = lean(format.sideFacingDeg);
  for (const sz of [-1, 1]) {
    const jaws: [V2, V2] = [v(-s, sz * halfW), v(s, sz * halfW)];
    const throat: [V2, V2] = [v(-(s - fs), sz * (halfW + CUSHION_W)), v(s - fs, sz * (halfW + CUSHION_W))];
    pockets.push({ kind: 'side', jaws, mouth: v(0, sz * halfW), throat, ...holeBehind(throat, v(0, sz)) });
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

/**
 * The aim whose contact has line of centres `centres`, and where throw then
 * sends the object ball. Null if the cut is unplayable.
 */
export function aimForCentres(
  table: Table,
  cue: V2,
  ob: V2,
  pocket: Pocket,
  win: Window,
  centres: number,
  stroke: Stroke,
): Candidate | null {
  const { objectR, cueR } = table.format;
  const ghost = sub(ob, scale(dir(centres), objectR + cueR));
  const travel = sub(ghost, cue);
  if (len(travel) < 0.05) return null;
  const aimDir = angleOf(travel);
  const signedCut = wrap(centres - aimDir);
  const cutDeg = (Math.abs(signedCut) * 180) / Math.PI;
  if (cutDeg > 85) return null; // the cue ball would clip the object ball first or barely touch it
  // Throw turns the object ball off the line of centres, toward the cue ball's direction of travel.
  const thr = strokeThrow(stroke, Math.abs(signedCut));
  const obDir = thr ? centres - Math.sign(signedCut) * thr : centres;
  return {
    obDir,
    lineOfCentres: centres,
    ghost,
    aimDir,
    cutDeg,
    throwDeg: (thr * 180) / Math.PI,
    miss: missDistance(ob, pocket, win, obDir),
  };
}

/**
 * The aim that sends the object ball along `obDir` after throw, or null if the
 * cut is unplayable. Throw depends on the cut, which depends on the aim, so
 * this solves for the line of centres by fixed-point iteration (throw is a few
 * degrees and smooth, so it converges in a handful of steps).
 */
export function candidateFor(
  table: Table,
  cue: V2,
  ob: V2,
  pocket: Pocket,
  win: Window,
  obDir: number,
  stroke: Stroke = 'geometry',
): Candidate | null {
  let centres = obDir;
  for (let i = 0; i < 60; i++) {
    const c = aimForCentres(table, cue, ob, pocket, win, centres, stroke);
    if (!c) return null;
    const error = wrap(obDir - c.obDir);
    if (Math.abs(error) < 1e-13) return { ...c, obDir };
    centres += error;
  }
  return null;
}

/** Which way a Choice misses: an overcut hits too thin, an undercut too full. */
export function missKind(shot: Shot, c: Candidate): 'correct' | 'over' | 'under' {
  if (c === shot.correct) return 'correct';
  return c.cutDeg > shot.correct.cutDeg ? 'over' : 'under';
}

// ---------- cue ball after contact ----------

/** Below this cut, a stunned cue ball all but stops dead, so its Tangent Line doesn't matter. */
export const MIN_TANGENT_CUT = 5;

/** Direction of the Tangent Line: where a stunned cue ball goes after contact, 90° off the object ball's path. */
export function tangentDir(c: Candidate): number {
  const side = Math.sign(wrap(c.aimDir - c.lineOfCentres)) || 1;
  return c.lineOfCentres + (side * Math.PI) / 2;
}

/** The pocket a stunned cue ball would roll straight into after `c`'s contact, if any. */
export function stunScratch(table: Table, c: Candidate): Pocket | null {
  if (c.cutDeg < MIN_TANGENT_CUT) return null;
  const t = tangentDir(c);
  for (const p of table.pockets) {
    const w = pocketWindow(c.ghost, p, table.format.cueR);
    if (!w) continue;
    const centre = (w.lo + w.hi) / 2;
    const a = centre + wrap(t - centre);
    if (a >= w.lo && a <= w.hi) return p;
  }
  return null;
}

/** Where the Tangent Line ends: the pocket it drops into, or the first cushion it reaches. */
export function tangentEnd(table: Table, c: Candidate): V2 {
  const p = stunScratch(table, c);
  if (p) return p.mouth;
  const u = dir(tangentDir(c));
  const r = table.format.cueR;
  const tx = u.x > 0 ? (table.halfL - r - c.ghost.x) / u.x : u.x < 0 ? (-table.halfL + r - c.ghost.x) / u.x : Infinity;
  const tz = u.z > 0 ? (table.halfW - r - c.ghost.z) / u.z : u.z < 0 ? (-table.halfW + r - c.ghost.z) / u.z : Infinity;
  return add(c.ghost, scale(u, Math.max(0, Math.min(tx, tz))));
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
  stroke: Stroke,
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
      made = candidateFor(table, cue, ob, pocket, win, obDir, stroke);
      if (made) break;
    }
    if (!made) return null;
    out.push(made);
  }
  return out;
}

/** What distinguishes one generator version from another. */
interface Rules {
  /** Highest Cut Angle drawn, for a Difficulty and pocket kind. */
  maxCut: (difficulty: Difficulty, kind: Pocket['kind']) => number;
  /** Skip shots whose stunned cue ball would scratch along the Tangent Line. */
  rejectStunScratch: boolean;
}

const tableMaxCut = (kind: Pocket['kind']) => (kind === 'side' ? MAX_SIDE_CUT : MAX_CUT);

/** Generator v2 onward: Difficulty also limits the Cut Angle, so Easy stays close to straight. */
export const DIFFICULTY_MAX_CUT: Record<Difficulty, number> = { easy: 30, medium: 60, hard: MAX_CUT };

/**
 * Shared body of every generator version. Each released version is frozen:
 * Shot Links and past Dailies replay through it (see docs/adr/0001), and the
 * `keep generator v… stable` tests pin its output. Changes go in a new version.
 */
function buildShot(formatId: FormatId, difficulty: Difficulty, stroke: Stroke, rng: Rng, rules: Rules): Shot {
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

    const maxCut = rules.maxCut(difficulty, pocket.kind);
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

    const correct = candidateFor(table, cue, ob, pocket, win, obDir, stroke);
    if (!correct) continue;
    // Compensating for throw means cutting a little more; keep that inside the Difficulty's cap.
    if (stroke !== 'geometry' && correct.cutDeg > maxCut) continue;
    if (rules.rejectStunScratch && stunScratch(table, correct)) continue;
    const distractors = makeDistractors(rng, table, cue, ob, pocket, win, difficulty, stroke);
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
      stroke,
      correct,
      geometric: stroke === 'geometry' ? null : aimForCentres(table, cue, ob, pocket, win, obDir, stroke),
      choices,
      correctIndex: choices.indexOf(correct),
      cutDeg: correct.cutDeg,
    };
  }
  throw new Error('Could not generate a shot');
}

export const GENERATORS: Record<number, (f: FormatId, d: Difficulty, rng: Rng, stroke: Stroke) => Shot> = {
  // v1: every Difficulty draws the full Cut Angle range. Geometry only.
  1: (f, d, rng) => buildShot(f, d, 'geometry', rng, { maxCut: (_, kind) => tableMaxCut(kind), rejectStunScratch: false }),
  // v2: Difficulty caps the Cut Angle (Easy 30°, Medium 60°, Hard 75°), and no stun-shot scratches.
  // Also the first with throw: the Stroke decides which aim is correct.
  2: (f, d, rng, stroke) =>
    buildShot(f, d, stroke, rng, {
      maxCut: (diff, kind) => Math.min(DIFFICULTY_MAX_CUT[diff], tableMaxCut(kind)),
      rejectStunScratch: true,
    }),
};
export const CURRENT_GENERATOR = 2;

/** Oldest generator version that supports throw. */
export const FIRST_THROW_GENERATOR = 2;

export function generateShot(
  formatId: FormatId,
  difficulty: Difficulty,
  rng: Rng,
  version = CURRENT_GENERATOR,
  stroke: Stroke = 'geometry',
): Shot {
  const gen = GENERATORS[version];
  if (!gen) throw new Error(`Unknown generator version ${version}`);
  if (stroke !== 'geometry' && version < FIRST_THROW_GENERATOR) throw new Error(`Generator v${version} has no throw`);
  return gen(formatId, difficulty, rng, stroke);
}
