import { describe, expect, it } from 'vitest';
import { throwAngle } from './physics';

const deg = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const SLOW = 0.447; // 1 mph
const MEDIUM = 1.341; // 3 mph
const FAST = 3.129; // 7 mph

// Checkpoints read off the throw-vs-cut-angle plots in Alciatore's TP A.14.
describe('cut-induced throw matches TP A.14', () => {
  it('stun: kinematic limit at small cuts, independent of speed', () => {
    for (const v of [SLOW, MEDIUM, FAST]) {
      // Below the peak, throw = atan(tan(φ)/7).
      expect(toDeg(throwAngle(deg(10), v, 0))).toBeCloseTo(toDeg(Math.atan(Math.tan(deg(10)) / 7)), 6);
    }
  });

  it('stun: slow peaks near 5.3° around a 33° cut, fast peaks near 2.6° around 18°', () => {
    const peak = (v: number) => {
      let best = { at: 0, throwDeg: 0 };
      for (let d = 1; d < 89; d += 0.25) {
        const t = toDeg(throwAngle(deg(d), v, 0));
        if (t > best.throwDeg) best = { at: d, throwDeg: t };
      }
      return best;
    };
    const slow = peak(SLOW);
    expect(slow.throwDeg).toBeGreaterThan(5.1);
    expect(slow.throwDeg).toBeLessThan(5.5);
    expect(slow.at).toBeGreaterThan(30);
    expect(slow.at).toBeLessThan(36);
    const fast = peak(FAST);
    expect(fast.throwDeg).toBeGreaterThan(2.45);
    expect(fast.throwDeg).toBeLessThan(2.8);
    expect(fast.at).toBeGreaterThan(16);
    expect(fast.at).toBeLessThan(21);
  });

  it('stun and roll level off to the same values at thin cuts', () => {
    // Plots end near 4.35° (slow), 2.0° (medium) and 0.8° (fast) at 90°.
    for (const [v, expected] of [
      [SLOW, 4.35],
      [MEDIUM, 2.0],
      [FAST, 0.8],
    ] as const) {
      expect(toDeg(throwAngle(deg(89), v, 0))).toBeCloseTo(expected, 0);
      expect(toDeg(throwAngle(deg(89), v, v))).toBeCloseTo(expected, 0);
    }
  });

  it('roll: throw grows with cut angle and stays under 1° for a firm roll', () => {
    let prev = 0;
    for (let d = 5; d <= 85; d += 5) {
      const t = toDeg(throwAngle(deg(d), FAST, FAST));
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeLessThan(1);
      prev = t;
    }
  });

  it('no cut, no throw', () => {
    expect(throwAngle(0, SLOW, 0)).toBe(0);
    expect(throwAngle(0, FAST, FAST)).toBe(0);
  });
});
