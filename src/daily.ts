import type { FormatId } from './formats';
import type { Difficulty } from './geometry';
import type { ShotKey } from './links';

export const DAILY_SHOTS = 5;
export const DAILY_FORMAT: FormatId = 'us9';
export const DAILY_DIFFICULTY: Difficulty = 'medium';
/** Daily #1. Set to the public launch date before going live. */
export const DAILY_EPOCH = '2026-09-25';
/**
 * Generator version per Daily date range, newest last. A new generator only
 * applies from the day after it ships, so a Daily never changes mid-day.
 */
const DAILY_GENERATORS: { from: string; version: number }[] = [
  { from: DAILY_EPOCH, version: 1 },
  { from: '2026-09-28', version: 2 }, // the day after v2 went live
];

export type Outcome = 'correct' | 'over' | 'under';

const KEY = 'readthecut.daily.v1';

/** Local calendar date as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayIndex = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export const dailyNumber = (date: string) => dayIndex(date) - dayIndex(DAILY_EPOCH) + 1;

export function dailyKeys(date: string): ShotKey[] {
  const version = [...DAILY_GENERATORS].reverse().find((g) => date >= g.from)?.version ?? 1;
  return Array.from({ length: DAILY_SHOTS }, (_, i) => ({
    version,
    format: DAILY_FORMAT,
    difficulty: DAILY_DIFFICULTY,
    stroke: 'geometry' as const, // everyone plays the Daily on the same, throw-free rules
    seed: `daily${date.replaceAll('-', '')}n${i}`,
  }));
}

type Record_ = Record<string, Outcome[]>;

function load(): Record_ {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record_;
  } catch {
    return {};
  }
}

export const dailyOutcomes = (date: string): Outcome[] => load()[date] ?? [];

export function recordDaily(date: string, outcome: Outcome) {
  const all = load();
  const list = all[date] ?? [];
  if (list.length >= DAILY_SHOTS) return;
  all[date] = [...list, outcome];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable; the Daily just won't be remembered.
  }
}

export interface DailySummary {
  played: number;
  currentStreak: number;
  bestStreak: number;
  distribution: number[]; // index = correct count, 0..DAILY_SHOTS
}

export function dailySummary(date = today()): DailySummary {
  const done = Object.entries(load())
    .filter(([, o]) => o.length >= DAILY_SHOTS)
    .map(([d, o]) => ({ day: dayIndex(d), correct: o.filter((x) => x === 'correct').length }))
    .sort((a, b) => a.day - b.day);
  const distribution = Array.from({ length: DAILY_SHOTS + 1 }, () => 0);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of done) {
    distribution[d.correct]++;
    run = prev !== null && d.day === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d.day;
  }
  // The current streak survives until today is over, so count from yesterday if today isn't done yet.
  const days = new Set(done.map((d) => d.day));
  let cursor = dayIndex(date);
  if (!days.has(cursor)) cursor--;
  let current = 0;
  while (days.has(cursor)) {
    current++;
    cursor--;
  }
  return { played: done.length, currentStreak: current, bestStreak: best, distribution };
}

const EMOJI: Record<Outcome, string> = { correct: '🟩', over: '🟧', under: '🟦' };

export function shareText(date: string, outcomes: Outcome[]): string {
  const score = outcomes.filter((o) => o === 'correct').length;
  return `ReadTheCut #${dailyNumber(date)} · ${score}/${DAILY_SHOTS}\n${outcomes.map((o) => EMOJI[o]).join('')}`;
}

/** Time until local midnight, as "5h 12m". */
export function untilTomorrow(now = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
