import { DEFAULT_FORMAT, isFormatId, type FormatId } from './formats';
import { BAND_COUNT, type Difficulty } from './geometry';

export interface BandStats {
  attempts: number;
  correct: number;
  totalMs: number;
}

/** Stats for one Table Format. */
export interface FormatStats {
  bands: BandStats[];
  bestSet: Partial<Record<Difficulty, number>>;
}

export type Stats = Partial<Record<FormatId, FormatStats>>;

const STATS_KEY = 'readthecut.stats.v2';
const STATS_V1_KEY = 'readthecut.stats.v1'; // one table of stats, all US 9ft
const DIFFICULTY_KEY = 'readthecut.difficulty';
const FORMAT_KEY = 'readthecut.format';
// Keys from before the rename, read once so existing stats carry over.
const LEGACY_KEYS: Record<string, string> = {
  [STATS_V1_KEY]: 'tightsight.stats.v1',
  [DIFFICULTY_KEY]: 'tightsight.difficulty',
};

function read(key: string): string | null {
  const value = localStorage.getItem(key);
  if (value !== null || !LEGACY_KEYS[key]) return value;
  const legacy = localStorage.getItem(LEGACY_KEYS[key]);
  if (legacy !== null) {
    localStorage.setItem(key, legacy);
    localStorage.removeItem(LEGACY_KEYS[key]);
  }
  return legacy;
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode); settings and stats just won't persist.
  }
};

export const emptyFormatStats = (): FormatStats => ({
  bands: Array.from({ length: BAND_COUNT }, () => ({ attempts: 0, correct: 0, totalMs: 0 })),
  bestSet: {},
});

const valid = (s: FormatStats | undefined): s is FormatStats => s?.bands?.length === BAND_COUNT;

export function loadStats(): Stats {
  try {
    const raw = read(STATS_KEY);
    if (raw) return JSON.parse(raw) as Stats;
    const v1 = read(STATS_V1_KEY);
    if (v1) {
      const old = JSON.parse(v1) as FormatStats;
      const migrated: Stats = valid(old) ? { [DEFAULT_FORMAT]: old } : {};
      saveStats(migrated);
      localStorage.removeItem(STATS_V1_KEY);
      return migrated;
    }
  } catch {
    // fall through
  }
  return {};
}

/** The stats for one format, created on first use. */
export function statsFor(stats: Stats, format: FormatId): FormatStats {
  const s = stats[format];
  if (valid(s)) return s;
  return (stats[format] = emptyFormatStats());
}

export const saveStats = (stats: Stats) => write(STATS_KEY, JSON.stringify(stats));

export function resetStats(stats: Stats, format: FormatId) {
  stats[format] = emptyFormatStats();
  saveStats(stats);
}

export function loadDifficulty(): Difficulty {
  try {
    const d = read(DIFFICULTY_KEY);
    if (d === 'easy' || d === 'medium' || d === 'hard') return d;
  } catch {
    // fall through
  }
  return 'medium';
}

export const saveDifficulty = (d: Difficulty) => write(DIFFICULTY_KEY, d);

export function loadFormat(): FormatId {
  try {
    const f = localStorage.getItem(FORMAT_KEY);
    if (isFormatId(f)) return f;
  } catch {
    // fall through
  }
  return DEFAULT_FORMAT;
}

export const saveFormat = (f: FormatId) => write(FORMAT_KEY, f);
