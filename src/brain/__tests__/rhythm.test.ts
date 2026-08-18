/**
 * src/brain/__tests__/rhythm.test.ts — task 4.5f: the rhythm schedulers are
 * pure and deterministic under an injected random source. Two flavors:
 *   - exact-arithmetic cases with a stepped fake (`0`, `0.5`, near-`1`) so
 *     the `minMs + r * (maxMs - minMs)` mapping is pinned at both ends;
 *   - a tiny seeded PRNG (mulberry32) proving same-seed reproducibility and
 *     that every rolled value lands inside its TIMINGS range — the property
 *     Group 7's composition actually relies on.
 */
import { describe, expect, it } from 'vitest';

import { nextBlinkAt, nextFacingTurnAt, nextStrollAt, nextWorkingInterlude } from '../rhythm';
import { TIMINGS } from '../timings';

/** Deterministic stepped sequence: returns the i-th value on the i-th call. */
function stepped(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

/** mulberry32 — a 32-bit seeded PRNG, small enough to define inline; returns
 * [0, 1) like `Math.random` (rhythm.ts's `RandomSource` contract). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = 1_000_000;

describe('exact roll arithmetic (stepped random)', () => {
  it('r=0 rolls the range minimum', () => {
    expect(nextBlinkAt(NOW, stepped(0))).toBe(NOW + 2000);
    expect(nextStrollAt(NOW, stepped(0))).toBe(NOW + TIMINGS.strollIntervalMs.minMs);
    expect(nextFacingTurnAt(NOW, stepped(0))).toBe(NOW + TIMINGS.facingTurnMs.minMs);
    const interlude = nextWorkingInterlude(NOW, stepped(0, 0));
    expect(interlude.triggerAt).toBe(NOW + TIMINGS.workingInterlude.triggerMs.minMs);
    expect(interlude.durationMs).toBe(TIMINGS.workingInterlude.durationMs.minMs);
  });

  it('r=0.5 rolls the range midpoint', () => {
    const mid = (range: { minMs: number; maxMs: number }) =>
      range.minMs + (range.maxMs - range.minMs) / 2;
    expect(nextBlinkAt(NOW, stepped(0.5))).toBe(NOW + mid({ minMs: 2000, maxMs: 6000 }));
    expect(nextStrollAt(NOW, stepped(0.5))).toBe(NOW + mid(TIMINGS.strollIntervalMs));
    expect(nextFacingTurnAt(NOW, stepped(0.5))).toBe(NOW + mid(TIMINGS.facingTurnMs));
  });

  it('r approaching 1 stays strictly below the range maximum ([0,1) contract)', () => {
    const r = 0.999_999;
    expect(nextStrollAt(NOW, stepped(r))).toBeLessThan(NOW + TIMINGS.strollIntervalMs.maxMs);
    expect(nextFacingTurnAt(NOW, stepped(r))).toBeLessThan(NOW + TIMINGS.facingTurnMs.maxMs);
    expect(nextBlinkAt(NOW, stepped(r))).toBeLessThan(NOW + 6000);
  });

  it('nextWorkingInterlude consumes trigger and duration rolls in that order', () => {
    // First call rolls triggerAt, second rolls durationMs (rhythm.ts contract
    // the Group 7 scheduler depends on: one call = two draws).
    const plan = nextWorkingInterlude(NOW, stepped(0, 1 - 1e-9));
    expect(plan.triggerAt).toBe(NOW + TIMINGS.workingInterlude.triggerMs.minMs);
    expect(plan.durationMs).toBeLessThan(TIMINGS.workingInterlude.durationMs.maxMs);
    expect(plan.durationMs).toBeGreaterThan(TIMINGS.workingInterlude.durationMs.maxMs - 1);
  });
});

describe('seeded determinism (mulberry32)', () => {
  it('same seed reproduces the exact same schedule sequence', () => {
    const draw = (random: () => number) =>
      Array.from({ length: 8 }, (_, i) => ({
        blink: nextBlinkAt(NOW + i, random),
        stroll: nextStrollAt(NOW + i, random),
        facing: nextFacingTurnAt(NOW + i, random),
        interlude: nextWorkingInterlude(NOW + i, random),
      }));
    expect(draw(mulberry32(42))).toEqual(draw(mulberry32(42)));
    expect(draw(mulberry32(42))).not.toEqual(draw(mulberry32(43)));
  });

  it('every rolled value lands inside its TIMINGS range across 500 draws', () => {
    const random = mulberry32(20260818);
    for (let i = 0; i < 500; i++) {
      const blinkDelay = nextBlinkAt(NOW, random) - NOW;
      expect(blinkDelay).toBeGreaterThanOrEqual(2000);
      expect(blinkDelay).toBeLessThan(6000);

      const strollDelay = nextStrollAt(NOW, random) - NOW;
      expect(strollDelay).toBeGreaterThanOrEqual(TIMINGS.strollIntervalMs.minMs);
      expect(strollDelay).toBeLessThan(TIMINGS.strollIntervalMs.maxMs);

      const facingDelay = nextFacingTurnAt(NOW, random) - NOW;
      expect(facingDelay).toBeGreaterThanOrEqual(TIMINGS.facingTurnMs.minMs);
      expect(facingDelay).toBeLessThan(TIMINGS.facingTurnMs.maxMs);

      const { triggerAt, durationMs } = nextWorkingInterlude(NOW, random);
      const triggerDelay = triggerAt - NOW;
      expect(triggerDelay).toBeGreaterThanOrEqual(TIMINGS.workingInterlude.triggerMs.minMs);
      expect(triggerDelay).toBeLessThan(TIMINGS.workingInterlude.triggerMs.maxMs);
      expect(durationMs).toBeGreaterThanOrEqual(TIMINGS.workingInterlude.durationMs.minMs);
      expect(durationMs).toBeLessThan(TIMINGS.workingInterlude.durationMs.maxMs);
    }
  });
});
