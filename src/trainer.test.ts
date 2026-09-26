import { describe, expect, it } from 'vitest';
import {
  AID_OFF_BELOW,
  OVERLAPS,
  assess,
  correctPlacement,
  freshProgress,
  movePlacement,
  overlapCutDeg,
  recordPlacement,
  referenceShot,
  startPlacement,
  trainerShot,
} from './trainer';

describe('Ghost Ball Trainer scoring', () => {
  it('the correct placement is exact and pockets the ball', () => {
    for (let i = 0; i < 100; i++) {
      const s = trainerShot('us9', 'medium');
      const a = assess(s, correctPlacement(s));
      expect(a.errorDeg).toBeLessThan(1e-9);
      expect(a.kind).toBe('exact');
      expect(a.miss).toBe(0);
    }
  });

  it('errors are measured round the object ball, and name the right direction', () => {
    const s = trainerShot('us9', 'hard');
    const { objectR, cueR } = s.table.format;
    const step = (2 * Math.PI) / 180; // 2°
    const a = assess(s, correctPlacement(s) + step);
    const b = assess(s, correctPlacement(s) - step);
    expect(a.errorDeg).toBeCloseTo(2, 9);
    expect(a.errorMm).toBeCloseTo(step * (objectR + cueR) * 1000, 9);
    // Moving round the ball one way is thinner, the other fuller.
    expect(new Set([a.kind, b.kind])).toEqual(new Set(['thin', 'full']));
  });

  it('the start is a full-ball hit, and moves never leave the playable arc', () => {
    const s = trainerShot('us9', 'medium');
    expect(assess(s, startPlacement(s)).kind).not.toBe('exact');
    const behind = startPlacement(s) + Math.PI; // far side of the object ball: unplayable
    expect(movePlacement(s, startPlacement(s), behind)).toBe(startPlacement(s));
  });
});

describe('help fading', () => {
  it('turns the aid off after a good window, then passes after an unaided one', () => {
    let p = freshProgress();
    const changes: (string | null)[] = [];
    for (let i = 0; i < 20; i++) {
      const r = recordPlacement(p, AID_OFF_BELOW / 2);
      p = r.progress;
      changes.push(r.change);
    }
    expect(changes[9]).toBe('aidOff');
    expect(changes[19]).toBe('passed');
    expect(p.done).toBe(true);
    expect(p.aid).toBe(false);
  });

  it('brings the aid back after a poor unaided window', () => {
    let p = { ...freshProgress(), aid: false };
    let change: string | null = null;
    for (let i = 0; i < 10; i++) ({ progress: p, change } = recordPlacement(p, 5));
    expect(change).toBe('aidOn');
    expect(p.aid).toBe(true);
  });
});

describe('Reference Pictures', () => {
  it('overlap fractions map to the standard cut angles', () => {
    expect(overlapCutDeg(1)).toBeCloseTo(0, 9);
    expect(overlapCutDeg(0.5)).toBeCloseTo(30, 9);
    expect(overlapCutDeg(0.75)).toBeCloseTo(14.4775, 3);
    expect(overlapCutDeg(0.25)).toBeCloseTo(48.5904, 3);
    expect(overlapCutDeg(0.125)).toBeCloseTo(61.045, 3);
  });

  it('builds an aim at exactly the requested overlap', () => {
    OVERLAPS.forEach((o, i) => {
      for (let k = 0; k < 20; k++) {
        const s = referenceShot('us9', i);
        expect(s.correct.cutDeg).toBeCloseTo(overlapCutDeg(o.fraction), 6);
      }
    });
  });
});
