import { isFormatId, type FormatId } from './formats';
import { CURRENT_GENERATOR, GENERATORS, generateShot, type Difficulty, type Shot } from './geometry';
import { newSeed, rngFrom } from './rng';

/** Everything needed to rebuild one Shot exactly. */
export interface ShotKey {
  version: number;
  format: FormatId;
  difficulty: Difficulty;
  seed: string;
}

const DIFF_CODE: Record<Difficulty, string> = { easy: 'e', medium: 'm', hard: 'h' };
const CODE_DIFF: Record<string, Difficulty> = { e: 'easy', m: 'medium', h: 'hard' };

export const freshKey = (format: FormatId, difficulty: Difficulty): ShotKey => ({
  version: CURRENT_GENERATOR,
  format,
  difficulty,
  seed: newSeed(),
});

export const shotFromKey = (k: ShotKey): Shot => generateShot(k.format, k.difficulty, rngFrom(k.seed), k.version);

/** `1.us9.m.8Kx2Qab`: generator version, format, difficulty, seed. */
export const encodeKey = (k: ShotKey) => `${k.version}.${k.format}.${DIFF_CODE[k.difficulty]}.${k.seed}`;

export function decodeKey(s: string): ShotKey | null {
  const [v, format, d, seed] = s.split('.');
  const version = Number(v);
  if (!GENERATORS[version] || !isFormatId(format) || !CODE_DIFF[d] || !/^[A-Za-z0-9]{4,16}$/.test(seed ?? '')) return null;
  return { version, format, difficulty: CODE_DIFF[d], seed };
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
