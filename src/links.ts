import { isFormatId, type FormatId } from './formats';
import { CURRENT_GENERATOR, FIRST_THROW_GENERATOR, GENERATORS, generateShot, type Difficulty, type Shot } from './geometry';
import type { Stroke } from './physics';
import { newSeed, rngFrom } from './rng';

/** Everything needed to rebuild one Shot exactly. */
export interface ShotKey {
  version: number;
  format: FormatId;
  difficulty: Difficulty;
  stroke: Stroke;
  seed: string;
}

const DIFF_CODE: Record<Difficulty, string> = { easy: 'e', medium: 'm', hard: 'h' };
const CODE_DIFF: Record<string, Difficulty> = { e: 'easy', m: 'medium', h: 'hard' };
// Geometry has no code, so Geometry links keep their original four-part form.
const STROKE_CODE: Record<Exclude<Stroke, 'geometry'>, string> = { slowStun: 's', firmRoll: 'r' };
const CODE_STROKE: Record<string, Stroke> = { s: 'slowStun', r: 'firmRoll' };

export const freshKey = (format: FormatId, difficulty: Difficulty, stroke: Stroke = 'geometry'): ShotKey => ({
  version: CURRENT_GENERATOR,
  format,
  difficulty,
  stroke,
  seed: newSeed(),
});

export const shotFromKey = (k: ShotKey): Shot =>
  generateShot(k.format, k.difficulty, rngFrom(k.seed), k.version, k.stroke);

/**
 * `2.us9.m.8Kx2Qab` (Geometry) or `2.us9.m.s.8Kx2Qab` (with a Stroke):
 * generator version, format, difficulty, [stroke,] seed.
 */
export const encodeKey = (k: ShotKey) =>
  [k.version, k.format, DIFF_CODE[k.difficulty], ...(k.stroke === 'geometry' ? [] : [STROKE_CODE[k.stroke]]), k.seed].join('.');

export function decodeKey(s: string): ShotKey | null {
  const parts = s.split('.');
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [v, format, d] = parts;
  const seed = parts[parts.length - 1];
  const stroke = parts.length === 5 ? CODE_STROKE[parts[3]] : 'geometry';
  const version = Number(v);
  if (!GENERATORS[version] || !isFormatId(format) || !CODE_DIFF[d] || !stroke || !/^[A-Za-z0-9]{4,16}$/.test(seed)) return null;
  if (stroke !== 'geometry' && version < FIRST_THROW_GENERATOR) return null;
  return { version, format, difficulty: CODE_DIFF[d], stroke, seed };
}

export const siteUrl = () => location.origin + location.pathname;

export const shotLink = (k: ShotKey) => `${siteUrl()}#s=${encodeKey(k)}`;

/** The Shot Link in the current URL, if any. */
export function keyFromLocation(): ShotKey | null {
  const m = /[#&]s=([^&]+)/.exec(location.hash);
  return m ? decodeKey(decodeURIComponent(m[1])) : null;
}

/** Native share sheet where available, clipboard otherwise. Resolves to what happened. */
export async function share(text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  const payload = url ? { text, url } : { text };
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share(payload);
      return 'shared';
    } catch {
      // cancelled or unsupported; fall back to copying
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
