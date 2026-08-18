/**
 * xp.test.ts — task 8.5: level derivation + the O(1) inverse, and D10's
 * award tables pinned to their numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_CAP_MS,
  levelFor,
  MEDIA_JOB_XP,
  TASK_XP,
  TURN_XP,
  XP_SAFE_MAX,
  xpAwardForFact,
  xpAwardForInteraction,
  xpForLevel,
} from '../xp';

describe('xpForLevel — 50·L·(L−1)/2 (the triangular curve)', () => {
  it('matches the documented values', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(3)).toBe(150);
    expect(xpForLevel(4)).toBe(300);
    expect(xpForLevel(10)).toBe(2250);
  });
});

describe('levelFor — the O(1) inverse', () => {
  it('is exact at the level boundaries', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(49)).toBe(1);
    expect(levelFor(50)).toBe(2);
    expect(levelFor(149)).toBe(2);
    expect(levelFor(150)).toBe(3);
  });

  it('round-trips levelFor(xpForLevel(L)) === L for the first 50 levels', () => {
    for (let level = 1; level <= 50; level += 1) {
      expect(levelFor(xpForLevel(level))).toBe(level);
    }
  });

  it('clamps at XP_SAFE_MAX instead of overflowing to Infinity', () => {
    const atCap = levelFor(XP_SAFE_MAX);
    expect(Number.isFinite(atCap)).toBe(true);
    expect(levelFor(Number.POSITIVE_INFINITY)).toBe(atCap);
    expect(levelFor(-5)).toBe(1); // negative garbage never yields level 0
  });
});

describe('award tables (D10)', () => {
  it('fact table: +10 / +5 / +2, everything else awards nothing', () => {
    expect(TASK_XP).toBe(10);
    expect(MEDIA_JOB_XP).toBe(5);
    expect(TURN_XP).toBe(2);
    expect(xpAwardForFact('taskCompleted')).toBe(10);
    expect(xpAwardForFact('mediaJobCompleted')).toBe(5);
    expect(xpAwardForFact('turnCompleted')).toBe(2);
    // Zero negative feedback AND zero sympathy xp:
    expect(xpAwardForFact('taskFailed')).toBe(0);
    expect(xpAwardForFact('requestError')).toBe(0);
    expect(xpAwardForFact('sessionThinking')).toBe(0);
    expect(xpAwardForFact('sessionWaitingApproval')).toBe(0);
    expect(xpAwardForFact('appLifecycle')).toBe(0);
    // A future unknown fact type degrades to nothing:
    expect(xpAwardForFact('some-future-type')).toBe(0);
  });

  it('interaction table: the four Group-7 kinds award 1, unknown kinds no-op', () => {
    for (const kind of ['feed', 'play', 'drag', 'switchCharacter']) {
      expect(xpAwardForInteraction(kind)).toBe(1);
    }
    expect(xpAwardForInteraction('timeTravel')).toBe(0);
  });

  it('ACTIVE_CAP_MS is the documented 5-minute single-increment cap', () => {
    expect(ACTIVE_CAP_MS).toBe(300_000);
  });
});
