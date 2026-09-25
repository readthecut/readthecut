import { BAND_COUNT, type Difficulty } from './geometry';

export interface BandStats {
  attempts: number;
  correct: number;
  totalMs: number;
}

export interface Stats {
  bands: BandStats[];
  bestSet: Partial<Record<Difficulty, number>>;
}

const STATS_KEY = 'tightsight.stats.v1';
const DIFFICULTY_KEY = 'tightsight.difficulty';

const empty = (): Stats => ({
  bands: Array.from({ length: BAND_COUNT }, () => ({ attempts: 0, correct: 0, totalMs: 0 })),
  bestSet: {},
});

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Stats;
    if (parsed.bands?.length !== BAND_COUNT) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Storage unavailable (private mode); stats just won't persist.
  }
}

export function resetStats(): Stats {
  const s = empty();
  saveStats(s);
  return s;
}

export function loadDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY);
    if (d === 'easy' || d === 'medium' || d === 'hard') return d;
  } catch {
    // fall through
  }
  return 'medium';
}

export function saveDifficulty(d: Difficulty) {
  try {
    localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    // ignore
  }
}
