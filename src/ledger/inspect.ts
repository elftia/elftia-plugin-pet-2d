/**
 * src/ledger/inspect.ts — D6⑤'s read-side seam for the manager page: a PURE
 * projection of a persisted `LedgerState` into the render model
 * (`LedgerPanelModel`, defined in the contract tree so the page still
 * typechecks in the trimmed build). The page composes `readLedgerState()` +
 * `summarizeLedger()` behind ONE guarded dynamic import of this module —
 * the same seam shape pet.ts uses for `createLedger` — so the whole ledger
 * (this file included) is deletable (D8/D10's trim proof).
 *
 * No DOM, no storage access, no clock reads except the injectable `now`.
 * Everything derives through the ledger's OWN pure parts (`xp.ts`'s curve,
 * `titles.ts`'s closed set) — the alternative (parsing the raw JSON inline
 * in the page) would duplicate normalize/derive logic, exactly the drift
 * child C's contracts exist to prevent.
 *
 * Text language: English, matching `memory.ts`'s entry texts — the ledger's
 * CONTENT language is English by design (D10); the page chrome around it is
 * locale-resolved separately.
 */
import type { LedgerMemoryItemView,LedgerPanelModel } from '../contract/ledgerPort';

// Re-exported so the page's single seam yields everything it needs — the
// reader, the storage key (for the storage-event filter), and the projector.
export { LEDGER_STORAGE_KEY,readLedgerState } from './persist';
import type { LedgerState } from './persist';
import { levelFor, xpForLevel } from './xp';

/** Compact fixed-width minutes form, e.g. `6h 05m` (0 → `0h 00m`). */
function formatActive(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** English relative time — mirrors the memory texts' language (D10). */
function formatRelative(now: number, at: number): string {
  const diff = now - at;
  if (!Number.isFinite(diff) || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Pure projection (task 8.1). `now` injectable for deterministic tests; the
 * model precomputes every display shape (percent, duration, relative times)
 * so the panel never computes — it only renders.
 */
export function summarizeLedger(state: LedgerState, now: number = Date.now()): LedgerPanelModel {
  const level = levelFor(state.xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const band = next - base;
  const into = Math.max(0, state.xp - base);
  const progressPct = band > 0 ? Math.min(100, Math.floor((into / band) * 100)) : 100;

  // The display title is the NEWEST unlock (the persisted array appends in
  // unlock order; TITLES' own order is just the unlock-display order).
  const unlocked = state.titles;
  const titleId = unlocked.length > 0 ? unlocked[unlocked.length - 1] : null;

  const memory: LedgerMemoryItemView[] = [];
  for (let i = state.memory.length - 1; i >= 0; i -= 1) {
    const entry = state.memory[i];
    memory.push({ text: entry.text, at: entry.at, relative: formatRelative(now, entry.at) });
  }

  return {
    level,
    titleId,
    xp: state.xp,
    xpIntoLevel: into,
    xpForNextLevel: band,
    progressPct,
    stats: state.stats,
    activeHuman: formatActive(state.stats.activeMs),
    unlockedTitles: unlocked,
    memory,
    updatedAt: state.updatedAt,
  };
}
