/**
 * memory.ts — the 8-entry memory ring (D10): a short log of
 * notable moments, newest last (the summary exposes the array; renderers
 * show the newest). Eviction is oldest-first past MEMORY_MAX.
 *
 * What earns an entry (deliberately narrower than whale-girl's log):
 * taskCompleted, mediaJobCompleted, level-ups, and title unlocks. NOT
 * turns (they fire on every agent turn — seconds apart in a chat — and
 * would evict everything else within a minute), and NEVER anything derived
 * from `taskFailed` / `requestError` — `LedgerMemoryEntry`'s contract
 * (contract/ledgerPort.ts) pins the zero-negative-feedback rule at the
 * type level: failures count a stat, nothing more.
 */
import type { LedgerMemoryEntry } from '../contract/ledgerPort';

/** The ring size (D10). Memory beyond the newest 8 entries is dropped. */
export const MEMORY_MAX = 8;

/** Append `entry` and evict oldest-first past MEMORY_MAX. Pure — returns a
 * new array, never mutates the input. */
export function pushMemory(
  entries: ReadonlyArray<LedgerMemoryEntry>,
  entry: LedgerMemoryEntry
): ReadonlyArray<LedgerMemoryEntry> {
  const next = [...entries, entry];
  return next.length > MEMORY_MAX ? next.slice(next.length - MEMORY_MAX) : next;
}

/** Human-readable texts for the events that earn entries (createLedger.ts
 * composes them with the running counters, e.g. "no. 7"). */
export function taskMemoryText(nth: number): string {
  return `Completed task (no. ${nth})`;
}

export function mediaJobMemoryText(nth: number): string {
  return `Media job finished (no. ${nth})`;
}

export function levelUpMemoryText(level: number): string {
  return `Reached level ${level}`;
}

export function titleMemoryText(id: string): string {
  return `Unlocked title: ${id}`;
}
