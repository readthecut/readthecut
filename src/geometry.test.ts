import { describe, expect, it } from 'vitest';
import { BALL_R, MAX_CUT, dist, generateShot, onTable, type Difficulty } from './geometry';

describe('generateShot', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`produces valid ${difficulty} shots`, () => {
      for (let i = 0; i < 500; i++) {
        const s = generateShot(difficulty);
        expect(onTable(s.cue)).toBe(true);
        expect(onTable(s.object)).toBe(true);
        expect(s.choices).toHaveLength(4);
        expect(s.choices[s.correctIndex]).toBe(s.correct);
        expect(s.correct.miss).toBe(0);
        expect(s.cutDeg).toBeLessThanOrEqual(s.pocket.kind === 'side' ? 45 : MAX_CUT);
        // The ghost ball touches the object ball.
        expect(dist(s.correct.ghost, s.object)).toBeCloseTo(2 * BALL_R, 9);
        for (const c of s.choices) {
          if (c !== s.correct) expect(c.miss).toBeGreaterThan(0);
        }
        const aims = new Set(s.choices.map((c) => c.aimDir.toFixed(6)));
        expect(aims.size).toBe(4);
      }
    });
  }
});
