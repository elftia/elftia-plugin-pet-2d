/**
 * titles.ts — the six-title closed set (D10), derived IDEMPOTENTLY
 * from stats on every commit: a title is unlocked when its predicate first
 * holds, and once unlocked it can never lock again (stats are monotonic by
 * construction — zero negative feedback means nothing ever decreases).
 *
 * Adapted from whale-girl's TITLES table (growth-system.md 成就系统): the
 * three task milestones and the two "failure/regular" titles carry over
 * verbatim; `social` re-targets whale-girl's ">=10 sessions" at Elftia's
 * `turns` counter, the closest companionship counter Elftia's facts expose
 * (Elftia has no session-count fact). `resilient` is the one place failure
 * turns positive — it is the ONLY failure-derived effect beyond the counter.
 *
 * Adding a title means editing THIS closed set (and its threshold test);
 * persisted ids not in the set are dropped on read (persist.ts normalize).
 */
import type { LedgerStats } from '../contract/ledgerPort';

/** 6 hours of accumulated companionship, in ms (the `regular` threshold). */
export const REGULAR_ACTIVE_MS = 6 * 3_600_000;

export interface TitleDef {
  readonly id: string;
  readonly when: (stats: LedgerStats) => boolean;
}

/** The closed set. Order = unlock-display order, not priority. */
export const TITLES: ReadonlyArray<TitleDef> = [
  { id: 'first-task', when: (s) => s.tasksDone >= 1 },
  { id: 'helper', when: (s) => s.tasksDone >= 20 },
  { id: 'veteran', when: (s) => s.tasksDone >= 100 },
  { id: 'regular', when: (s) => s.activeMs >= REGULAR_ACTIVE_MS },
  { id: 'resilient', when: (s) => s.failures >= 5 },
  { id: 'social', when: (s) => s.turns >= 10 },
];

/** Titles whose predicate holds for `stats` but that are not yet in
 * `unlockedIds` — the newly-unlocked set for one commit. Pure. */
export function newlyUnlockedTitles(
  stats: LedgerStats,
  unlockedIds: ReadonlyArray<string>
): ReadonlyArray<TitleDef> {
  return TITLES.filter((title) => !unlockedIds.includes(title.id) && title.when(stats));
}
