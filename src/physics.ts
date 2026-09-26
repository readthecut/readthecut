// Cut-induced throw (CIT), after Alciatore, TP A.14 "The effects of cut angle,
// speed, and spin on object ball throw" (drdavepoolinfo.com). No sidespin.

/** How the cue ball arrives at the object ball. Geometry means no throw at all. */
export type Stroke = 'geometry' | 'slowStun' | 'firmRoll';

export interface StrokeSpec {
  name: string;
  /** Cue ball speed at contact, m/s. */
  speed: number;
  /** Natural roll (topspin ω = v/R) at contact, versus stun (no spin). */
  rolling: boolean;
}

// TP A.14's reference speeds: slow 1 mph, fast 7 mph.
export const STROKES: Record<Stroke, StrokeSpec> = {
  geometry: { name: 'Geometry', speed: 0, rolling: false },
  slowStun: { name: 'Slow stun', speed: 0.447, rolling: false },
  firmRoll: { name: 'Firm roll', speed: 3.129, rolling: true },
};

export const STROKE_IDS = Object.keys(STROKES) as Stroke[];
export const isStroke = (s: unknown): s is Stroke => typeof s === 'string' && s in STROKES;

/** Ball-ball friction vs sliding speed (m/s): TP A.14's fit to Marlow's data, μ = a + b·e^(−c·v). */
export const ballFriction = (vRel: number) => 9.951e-3 + 0.108 * Math.exp(-1.088 * vRel);

/**
 * Throw angle (radians) for a cut angle `phi` (radians), cue ball speed `v`
 * and topspin surface speed `rollSpeed` = R·ωx (v for natural roll, 0 for stun).
 * TP A.14 Eqs. 15–17 with ωz = 0: friction-limited, and capped at 1/7 where
 * sliding stops during the impact.
 */
export function throwAngle(phi: number, v: number, rollSpeed: number): number {
  const tangential = v * Math.sin(phi);
  const normal = v * Math.cos(phi);
  const vRel = Math.hypot(tangential, rollSpeed * Math.cos(phi));
  if (vRel === 0 || normal <= 0) return 0;
  const k = Math.min((ballFriction(vRel) * normal) / vRel, 1 / 7);
  return Math.atan((k * tangential) / normal);
}

/** Throw (radians) for a Stroke at cut angle `phi`. */
export function strokeThrow(stroke: Stroke, phi: number): number {
  const s = STROKES[stroke];
  if (stroke === 'geometry') return 0;
  return throwAngle(phi, s.speed, s.rolling ? s.speed : 0);
}
