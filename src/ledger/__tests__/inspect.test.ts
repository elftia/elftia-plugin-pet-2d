/**
 * src/ledger/__tests__/inspect.test.ts — task 8.1's gate: the PURE
 * projection over a persisted-state fixture (what readLedgerState hands it
 * after normalize). Level curve math, the newest-unlocked title, the XP bar
 * percent (with its cap), precomputed durations/relative times, and the
 * newest-first memory ordering.
 *
 * Node project (no jsdom needed — summarizeLedger touches nothing ambient;
 * the default `now` is always overridden for determinism).
 */
import { describe, expect, it } from 'vitest';

import type { LedgerPanelModel } from '../../contract/ledgerPort';
import { summarizeLedger } from '../inspect';
import { initialLedgerState, type LedgerState } from '../persist';

const NOW = 1_700_000_000_000;

/** A realistic persisted fixture: level 3, two titles, a full memory ring. */
function fixtureState(overrides: Partial<LedgerState> = {}): LedgerState {
  const memory = [];
  for (let i = 0; i < 8; i += 1) {
    // Contract order: oldest -> newest (memory.ts appends; the page reverses).
    memory.push({ at: NOW - (8 - i) * 3_600_000, text: `Event no. ${i + 1}` });
  }
  return {
    xp: 170, // levelFor(170) = 3 (L3 needs 150, L4 needs 300)
    stats: {
      tasksDone: 7,
      failures: 2,
      turns: 31,
      mediaJobs: 4,
      activeMs: 6 * 3_600_000 + 5 * 60_000, // 6h 05m — past the `regular` threshold
      firstSeenAt: NOW - 90 * 86_400_000,
    },
    titles: ['first-task', 'social'], // unlock order; newest last
    memory,
    seen: { 'taskCompleted|x|1': NOW },
    updatedAt: NOW - 120_000,
    ...overrides,
  } as LedgerState;
}

function summarize(state: LedgerState): LedgerPanelModel {
  return summarizeLedger(state, NOW);
}

describe('summarizeLedger (pure projection, task 8.1)', () => {
  it('derives level/title/xp-band from the xp curve', () => {
    const model = summarize(fixtureState());
    expect(model.level).toBe(3);
    expect(model.titleId).toBe('social'); // the NEWEST unlock, not the first
    expect(model.unlockedTitles).toEqual(['first-task', 'social']);
    expect(model.xpIntoLevel).toBe(20); // 170 - xpForLevel(3) = 170 - 150
    expect(model.xpForNextLevel).toBe(150); // xpForLevel(4) - xpForLevel(3)
    expect(model.progressPct).toBe(13); // floor(20 / 150 * 100)
    expect(model.updatedAt).toBe(NOW - 120_000);
  });

  it('zero state: level 1, empty band progress, no title, empty memory', () => {
    const model = summarize(initialLedgerState());
    expect(model.level).toBe(1);
    expect(model.titleId).toBeNull();
    expect(model.xpIntoLevel).toBe(0);
    expect(model.xpForNextLevel).toBe(50); // xpForLevel(2) - xpForLevel(1)
    expect(model.progressPct).toBe(0);
    expect(model.memory).toEqual([]);
    expect(model.activeHuman).toBe('0h 00m');
  });

  it('keeps the progress percent a sane clamped integer at XP_SAFE_MAX', () => {
    // XP_SAFE_MAX does NOT saturate the band (levelFor keeps deriving a
    // higher level) — the contract is only "integer, 0..100, no NaN".
    const model = summarize(fixtureState({ xp: 1e12 }));
    expect(Number.isInteger(model.progressPct)).toBe(true);
    expect(model.progressPct).toBeGreaterThanOrEqual(0);
    expect(model.progressPct).toBeLessThanOrEqual(100);
  });

  it('preformats activeMs as a fixed-width human duration', () => {
    const withActive = (ms: number): string =>
      summarize(fixtureState({ stats: { ...fixtureState().stats, activeMs: ms } })).activeHuman;
    expect(withActive(0)).toBe('0h 00m');
    expect(withActive(59_000)).toBe('0h 00m');
    expect(withActive(5 * 60_000)).toBe('0h 05m');
    expect(withActive(6 * 3_600_000 + 5 * 60_000)).toBe('6h 05m');
    expect(withActive(47 * 3_600_000)).toBe('47h 00m');
  });

  it('reverses the memory ring (newest first) and precomputes relative times', () => {
    const model = summarize(fixtureState());
    expect(model.memory).toHaveLength(8);
    expect(model.memory[0]?.text).toBe('Event no. 8'); // newest (last stored) first
    expect(model.memory[0]?.relative).toBe('1h ago');
    expect(model.memory[7]?.text).toBe('Event no. 1'); // oldest last
    expect(model.memory[7]?.relative).toBe('8h ago');
  });

  it('relative-time buckets: just now / m / h / d / mo', () => {
    const at = (offsetMs: number): string =>
      summarize(fixtureState({ memory: [{ at: NOW - offsetMs, text: 'x' }] })).memory[0]?.relative ?? '';
    expect(at(30_000)).toBe('just now');
    expect(at(5 * 60_000)).toBe('5m ago');
    expect(at(3 * 3_600_000)).toBe('3h ago');
    expect(at(2 * 86_400_000)).toBe('2d ago');
    expect(at(45 * 86_400_000)).toBe('1mo ago');
    expect(at(-1_000)).toBe('just now'); // a future timestamp degrades honestly
  });
});
