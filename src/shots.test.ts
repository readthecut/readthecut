import { describe, expect, it } from 'vitest';
import { dailyKeys, dailyNumber, shareText } from './daily';
import { FORMAT_IDS } from './formats';
import { DIFFICULTY_MAX_CUT, MAX_CUT, aimForCentres, dist, missKind, onTable, stunScratch, type Difficulty } from './geometry';
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
          expect(s.cutDeg).toBeLessThanOrEqual(DIFFICULTY_MAX_CUT[difficulty] + 1e-9);
          expect(stunScratch(s.table, s.correct)).toBeNull();
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

  // Pin each released generator's output. If one fails, a change altered old links: put it in a new version instead.
  for (const version of [1, 2]) {
    it(`keep generator v${version} stable`, () => {
      const s = shotFromKey({ version, format: 'us9', difficulty: 'medium', stroke: 'geometry', seed: 'pinned1' });
      expect(s.cue.x).toMatchSnapshot();
      expect(s.cue.z).toMatchSnapshot();
      expect(s.correctIndex).toMatchSnapshot();
    });
  }

  it('v1 still includes stun-scratch shots', () => {
    const scratches = Array.from({ length: 400 }, (_, i) =>
      shotFromKey({ version: 1, format: 'us9', difficulty: 'medium', stroke: 'geometry', seed: `v1scr${i}` }),
    ).filter((s) => stunScratch(s.table, s.correct));
    expect(scratches.length).toBeGreaterThan(0);
  });

  it('v1 still draws the full cut range on Easy', () => {
    const cuts = Array.from({ length: 300 }, (_, i) =>
      shotFromKey({ version: 1, format: 'us9', difficulty: 'easy', stroke: 'geometry', seed: `v1easy${i}` }).cutDeg,
    );
    expect(Math.max(...cuts)).toBeGreaterThan(DIFFICULTY_MAX_CUT.easy);
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

  it('switches to generator v2 from 2026-09-27 only', () => {
    expect(dailyKeys('2026-09-26').every((k) => k.version === 1)).toBe(true);
    expect(dailyKeys('2026-09-27').every((k) => k.version === 2)).toBe(true);
  });

  it('shares an emoji grid without spoilers', () => {
    expect(shareText('2026-09-26', ['correct', 'over', 'correct', 'under', 'correct'])).toBe(
      'ReadTheCut #2 · 3/5\n🟩🟧🟩🟦🟩',
    );
  });
});

describe('Throw (CIT)', () => {
  for (const stroke of ['slowStun', 'firmRoll'] as const) {
    it(`${stroke}: the correct aim pockets the ball after throw, and the thrown path is self-consistent`, () => {
      for (let i = 0; i < 200; i++) {
        const s = shotFromKey(freshKey('us9', 'hard', stroke));
        expect(s.stroke).toBe(stroke);
        expect(s.correct.miss).toBe(0);
        // Re-simulating the correct aim forward lands on the same departure direction.
        const again = aimForCentres(s.table, s.cue, s.object, s.pocket, s.window, s.correct.lineOfCentres, stroke)!;
        expect(again.obDir).toBeCloseTo(s.correct.obDir, 12);
        for (const c of s.choices) if (c !== s.correct) expect(c.miss).toBeGreaterThan(0);
        // Compensating for throw means a thinner hit: more geometric cut than the pure ghost-ball aim.
        expect(s.geometric).not.toBeNull();
        if (s.cutDeg > 1) expect(s.correct.cutDeg).toBeGreaterThan(s.geometric!.cutDeg);
        expect(s.correct.throwDeg).toBeGreaterThan(0);
        expect(s.cutDeg).toBeLessThanOrEqual(MAX_CUT + 1e-9);
      }
    });
  }

  it('slow stun throws far more than firm roll', () => {
    const avg = (stroke: 'slowStun' | 'firmRoll') => {
      let t = 0;
      for (let i = 0; i < 200; i++) t += shotFromKey({ version: 2, format: 'us9', difficulty: 'medium', stroke, seed: `thr${i}` }).correct.throwDeg;
      return t / 200;
    };
    expect(avg('slowStun')).toBeGreaterThan(3 * avg('firmRoll'));
  });

  it('Geometry shots have no throw and no geometric reference', () => {
    const s = shotFromKey(freshKey('us9', 'medium'));
    expect(s.correct.throwDeg).toBe(0);
    expect(s.geometric).toBeNull();
  });

  it('Shot Links carry the Stroke, and v1 links cannot have one', () => {
    const k = freshKey('cn', 'easy', 'slowStun');
    expect(encodeKey(k).split('.')).toHaveLength(5);
    expect(decodeKey(encodeKey(k))).toEqual(k);
    expect(encodeKey(freshKey('us9', 'easy')).split('.')).toHaveLength(4);
    expect(decodeKey('1.us9.m.s.abcdefg')).toBeNull();
    expect(decodeKey('2.us9.m.x.abcdefg')).toBeNull();
  });
});
