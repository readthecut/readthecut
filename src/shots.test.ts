import { describe, expect, it } from 'vitest';
import { dailyKeys, dailyNumber, shareText } from './daily';
import { FORMAT_IDS } from './formats';
import { MAX_CUT, dist, missKind, onTable, type Difficulty } from './geometry';
import { decodeKey, encodeKey, freshKey, shotFromKey } from './links';

describe('generateShot', () => {
  for (const format of FORMAT_IDS) {
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
      it(`produces valid ${format} ${difficulty} shots`, () => {
        for (let i = 0; i < 200; i++) {
          const s = shotFromKey(freshKey(format, difficulty));
          const { objectR, cueR } = s.table.format;
          expect(onTable(s.table, s.cue, cueR)).toBe(true);
          expect(onTable(s.table, s.object, objectR)).toBe(true);
          expect(s.choices).toHaveLength(4);
          expect(s.choices[s.correctIndex]).toBe(s.correct);
          expect(s.correct.miss).toBe(0);
          expect(s.cutDeg).toBeLessThanOrEqual(s.pocket.kind === 'side' ? 45 : MAX_CUT);
          // The ghost ball touches the object ball.
          expect(dist(s.correct.ghost, s.object)).toBeCloseTo(objectR + cueR, 9);
          for (const c of s.choices) {
            if (c !== s.correct) {
              expect(c.miss).toBeGreaterThan(0);
              expect(missKind(s, c)).not.toBe('correct');
            }
          }
          expect(new Set(s.choices.map((c) => c.aimDir.toFixed(6))).size).toBe(4);
        }
      });
    }
  }
});

describe('Shot Links', () => {
  it('round-trip to the identical Shot', () => {
    const key = freshKey('uk', 'hard');
    const decoded = decodeKey(encodeKey(key))!;
    expect(decoded).toEqual(key);
    const a = shotFromKey(key);
    const b = shotFromKey(decoded);
    expect(b.cue).toEqual(a.cue);
    expect(b.choices.map((c) => c.aimDir)).toEqual(a.choices.map((c) => c.aimDir));
  });

  it('reject malformed or unknown keys', () => {
    expect(decodeKey('9.us9.m.abcdefg')).toBeNull(); // unknown generator
    expect(decodeKey('1.xx.m.abcdefg')).toBeNull();
    expect(decodeKey('1.us9.q.abcdefg')).toBeNull();
    expect(decodeKey('1.us9.m.<script>')).toBeNull();
  });

  // Pins generator v1's output. If this fails, a change altered old links: put it in a new version instead.
  it('keep generator v1 stable', () => {
    const s = shotFromKey({ version: 1, format: 'us9', difficulty: 'medium', seed: 'pinned1' });
    expect(s.cue.x).toMatchSnapshot();
    expect(s.cue.z).toMatchSnapshot();
    expect(s.correctIndex).toMatchSnapshot();
  });
});

describe('Daily', () => {
  it('numbers days from the epoch and gives everyone the same five shots', () => {
    expect(dailyNumber('2026-09-25')).toBe(1);
    expect(dailyNumber('2026-10-25')).toBe(31);
    const a = dailyKeys('2026-10-01').map((k) => shotFromKey(k).cue);
    const b = dailyKeys('2026-10-01').map((k) => shotFromKey(k).cue);
    expect(a).toHaveLength(5);
    expect(b).toEqual(a);
  });

  it('shares an emoji grid without spoilers', () => {
    expect(shareText('2026-09-26', ['correct', 'over', 'correct', 'under', 'correct'])).toBe(
      'ReadTheCut #2 · 3/5\n🟩🟧🟩🟦🟩',
    );
  });
});
