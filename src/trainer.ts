// Ghost Ball Trainer and Reference Pictures: the logic, kept apart from the UI.

import type { FormatId } from './formats';
import { aimForCentres, angleOf, sub, wrap, type Candidate, type Difficulty, type Shot } from './geometry';
import { shotFromKey, freshKey } from './links';

// ---------- Ghost Ball Trainer ----------

export type Stage = 1 | 2 | 3;
export const STAGES: Record<Stage, { name: string; view: string; aid: string }> = {
  1: { name: 'See it', view: 'Top-down', aid: 'The pocket line runs through the object ball. The ghost ball sits on it.' },
  2: { name: 'Stand and see it', view: 'Standing View', aid: 'The contact point is marked on the object ball.' },
  3: { name: 'Down on it', view: 'Aim View', aid: 'This is the picture you have at the table.' },
};

/** Where the placed ghost ball sits: the direction from the object ball's centre to the ghost ball's. */
export type Placement = number;

/** The correct Placement: opposite the direction the object ball must leave in. */
export const correctPlacement = (shot: Shot): Placement => shot.correct.lineOfCentres + Math.PI;

/** A neutral start: a full-ball hit, ghost ball directly between the cue ball and the object ball. */
export const startPlacement = (shot: Shot): Placement => angleOf(sub(shot.cue, shot.object));

/** The aim a Placement implies (Geometry), or null if it isn't a playable contact. */
export const aimFor = (shot: Shot, p: Placement): Candidate | null =>
  aimForCentres(shot.table, shot.cue, shot.object, shot.pocket, shot.window, p + Math.PI, 'geometry');

/** Move a Placement, but never onto an unplayable contact. */
export const movePlacement = (shot: Shot, from: Placement, to: Placement): Placement => (aimFor(shot, to) ? to : from);

export interface Assessment {
  /** How far round the object ball the ghost ball was off, in degrees. */
  errorDeg: number;
  /** The same error as distance moved by the ghost ball's centre, in mm. */
  errorMm: number;
  kind: 'exact' | 'full' | 'thin';
  /** Metres the object ball misses by from this Placement; 0 if it drops. */
  miss: number;
}

export function assess(shot: Shot, p: Placement): Assessment {
  const { objectR, cueR } = shot.table.format;
  const d = wrap(p - correctPlacement(shot));
  const aim = aimFor(shot, p)!;
  const errorDeg = (Math.abs(d) * 180) / Math.PI;
  return {
    errorDeg,
    errorMm: Math.abs(d) * (objectR + cueR) * 1000,
    kind: errorDeg < 0.05 ? 'exact' : aim.cutDeg > shot.correct.cutDeg ? 'thin' : 'full',
    miss: aim.miss,
  };
}

export const trainerShot = (format: FormatId, difficulty: Difficulty): Shot => shotFromKey(freshKey(format, difficulty));

// Help fades once the last WINDOW placements average under AID_OFF_BELOW degrees,
// and comes back if an unaided run averages over AID_BACK_ABOVE.
const WINDOW = 10;
export const AID_OFF_BELOW = 2;
const AID_BACK_ABOVE = 3;

export interface StageProgress {
  /** Errors (degrees) since the automatic help last switched on or off. */
  errors: number[];
  /** The automatic help: on until the player is accurate enough, then faded out. */
  aid: boolean;
  /** Passed: a full window without help, averaging under AID_OFF_BELOW. */
  done: boolean;
  /** Placements in a row made without any help showing, whether faded out or switched off by hand. */
  unaidedRun?: number;
}

/** Stages 1–2 start with their aid on; stage 3 has none, so it starts off. */
export const freshProgress = (aid = true): StageProgress => ({ errors: [], aid, done: false, unaidedRun: 0 });

export const recentAverage = (p: StageProgress) => {
  const last = p.errors.slice(-WINDOW);
  return last.length ? last.reduce((a, b) => a + b, 0) / last.length : null;
};

export type PlacementChange = 'aidOff' | 'aidOn' | 'passed' | null;

/**
 * Record one placement and apply the fading rules. `aided` is whether any help was
 * actually showing: a player can switch help off by hand before it fades, and those
 * placements count toward passing. Returns what changed, for the UI to announce.
 */
export function recordPlacement(
  p: StageProgress,
  errorDeg: number,
  aided = p.aid,
): { progress: StageProgress; change: PlacementChange } {
  const next: StageProgress = {
    ...p,
    errors: [...p.errors, errorDeg].slice(-2 * WINDOW),
    unaidedRun: aided ? 0 : (p.unaidedRun ?? 0) + 1,
  };
  if (next.errors.length < WINDOW) return { progress: next, change: null };
  const avg = recentAverage(next)!;
  if (!aided && next.unaidedRun! >= WINDOW && avg <= AID_OFF_BELOW && !next.done) {
    return { progress: { ...next, aid: false, done: true }, change: 'passed' };
  }
  if (aided && next.aid && avg <= AID_OFF_BELOW) {
    return { progress: { ...next, aid: false, errors: [], unaidedRun: 0 }, change: 'aidOff' };
  }
  if (!aided && !next.aid && avg > AID_BACK_ABOVE) {
    return { progress: { ...next, aid: true, errors: [], unaidedRun: 0 }, change: 'aidOn' };
  }
  return { progress: next, change: null };
}

// ---------- Reference Pictures ----------

/** How much of the object ball the ghost ball covers, seen from the cue ball. sin(cut) = 1 − overlap. */
export const OVERLAPS = [
  { label: 'Full', fraction: 1 },
  { label: '¾', fraction: 0.75 },
  { label: '½', fraction: 0.5 },
  { label: '¼', fraction: 0.25 },
  { label: '⅛', fraction: 0.125 },
] as const;

export const overlapCutDeg = (fraction: number) => (Math.asin(1 - fraction) * 180) / Math.PI;

/**
 * A Shot whose one Choice is aimed at an exact overlap. Positions come from the
 * normal generator; the aim is set so the aim line passes (R+r)·sin(cut) from
 * the object ball's centre, which is what that overlap means.
 */
export function referenceShot(format: FormatId, overlapIndex: number, rng: () => number = Math.random): Shot {
  for (let attempt = 0; attempt < 200; attempt++) {
    const base = shotFromKey(freshKey(format, 'hard'));
    const { objectR, cueR } = base.table.format;
    const toOb = sub(base.object, base.cue);
    const D = Math.hypot(toOb.x, toOb.z);
    const cut = (overlapCutDeg(OVERLAPS[overlapIndex].fraction) * Math.PI) / 180;
    const offset = (objectR + cueR) * Math.sin(cut);
    if (D < objectR + cueR + 0.1) continue;
    const aimDir = angleOf(toOb) + (rng() < 0.5 ? -1 : 1) * Math.asin(offset / D);
    // First touch along the aim line: the ghost ball's centre.
    const along = D * Math.cos(Math.asin(offset / D)) - Math.sqrt((objectR + cueR) ** 2 - offset ** 2);
    const ghost = { x: base.cue.x + Math.cos(aimDir) * along, z: base.cue.z + Math.sin(aimDir) * along };
    const aim = aimForCentres(base.table, base.cue, base.object, base.pocket, base.window, angleOf(sub(base.object, ghost)), 'geometry');
    if (!aim) continue;
    return { ...base, correct: aim, choices: [aim], correctIndex: 0, cutDeg: aim.cutDeg, geometric: null };
  }
  throw new Error('Could not build a reference shot');
}
