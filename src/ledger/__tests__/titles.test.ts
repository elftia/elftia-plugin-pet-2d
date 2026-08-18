/**
 * titles.test.ts — task 8.5: each of the six titles unlocks at exactly its
 * documented threshold, and the derivation is idempotent.
 */
import { describe, expect, it } from 'vitest';

import type { LedgerStats } from '../../contract/ledgerPort';
import { newlyUnlockedTitles, REGULAR_ACTIVE_MS, TITLES } from '../titles';

function statsWith(patch: Partial<LedgerStats> = {}): LedgerStats {
  return {
    tasksDone: 0,
    failures: 0,
    turns: 0,
    mediaJobs: 0,
    activeMs: 0,
    firstSeenAt: 1,
    ...patch,
  };
}

function unlockIds(stats: LedgerStats, already: string[] = []): string[] {
  return newlyUnlockedTitles(stats, already).map((title) => title.id);
}

describe('the closed title set', () => {
  it('has exactly six titles', () => {
    expect(TITLES).toHaveLength(6);
  });

  it('first-task at >=1 completed task', () => {
    expect(unlockIds(statsWith({ tasksDone: 0 }))).toEqual([]);
    expect(unlockIds(statsWith({ tasksDone: 1 }))).toEqual(['first-task']);
  });

  it('helper at >=20 completed tasks (first-task unlocks alongside)', () => {
    expect(unlockIds(statsWith({ tasksDone: 19 }))).toEqual(['first-task']);
    expect(unlockIds(statsWith({ tasksDone: 20 }))).toEqual(['first-task', 'helper']);
  });

  it('veteran at >=100 completed tasks', () => {
    expect(unlockIds(statsWith({ tasksDone: 100 }))).toContain('veteran');
  });

  it('regular at >=6h accumulated companionship (the exact boundary)', () => {
    expect(unlockIds(statsWith({ activeMs: REGULAR_ACTIVE_MS - 1 }))).toEqual([]);
    expect(unlockIds(statsWith({ activeMs: REGULAR_ACTIVE_MS }))).toEqual(['regular']);
    expect(REGULAR_ACTIVE_MS).toBe(6 * 3_600_000);
  });

  it('resilient at >=5 failures — the only failure-positive effect', () => {
    expect(unlockIds(statsWith({ failures: 4 }))).toEqual([]);
    expect(unlockIds(statsWith({ failures: 5 }))).toEqual(['resilient']);
  });

  it("social at >=10 turns (Elftia's stand-in for whale-girl sessions)", () => {
    expect(unlockIds(statsWith({ turns: 9 }))).toEqual([]);
    expect(unlockIds(statsWith({ turns: 10 }))).toEqual(['social']);
  });

  it('is idempotent — already-unlocked ids are never re-returned', () => {
    expect(unlockIds(statsWith({ tasksDone: 1 }), ['first-task'])).toEqual([]);
    expect(unlockIds(statsWith({ tasksDone: 20 }), ['first-task', 'helper'])).toEqual([]);
  });
});
