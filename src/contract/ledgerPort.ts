/**
 * src/contract/ledgerPort.ts — the D10 seam: `LedgerPort` and its
 * supporting types live OUTSIDE the ledger module on purpose. `src/pet.ts`
 * (the activate() entry, Group 7) depends only on this file, never on
 * anything under the ledger directory directly — so the entire ledger
 * module can be
 * `rm -rf`'d with exactly one import site breaking (`pet.ts`'s optional
 * `import('./ledger/createLedger')`). `scripts/verify-trim.mjs` (Group 8)
 * proves this by doing exactly that deletion and checking the build still
 * succeeds once the one call site is stubbed to `undefined`.
 *
 * A pet with no ledger is not a degraded pet: XP/titles/memory are 100%
 * cosmetic flavor on top of the facts→state loop, which works identically
 * with or without a `LedgerPort` present (D10's framing — "companionship
 * bookkeeping, never gameplay-gating").
 */
import type { PetFactsSnapshotLike } from './facts';

/** One of the eight companionship-affecting interaction kinds `pet.ts`
 * (Group 7) reports on user action — feeding, play, drag/drop, wake-tap,
 * etc. Kept as `string` rather than a closed union here: the exact kind
 * vocabulary is an interaction-layer concern (Group 7's `pointer.ts` /
 * `menu.ts`), and `LedgerPort` should not need editing when that vocabulary
 * grows — only `xp.ts`'s award table (Group 8) needs to recognize a new
 * kind for it to start earning XP; an unrecognized kind is simply a no-op
 * award, matching `isKnownPetFactType`'s "unknown degrades to nothing"
 * discipline in `facts.ts`. */
export type LedgerInteractionKind = string;

/** Running counters `summary()` exposes (D10). Never negative, never reset —
 * `activeMs` is companionship time accrued specifically while `sensing.
 * thinking` is true, capped at 5 real minutes per snapshot-observe
 * increment (D10's anti-idle-farming rule). */
export interface LedgerStats {
  readonly tasksDone: number;
  readonly failures: number;
  readonly turns: number;
  readonly mediaJobs: number;
  readonly activeMs: number;
  readonly firstSeenAt: number;
}

/** One entry in the 8-slot memory ring (D10) — a short, human-readable
 * record of a notable moment ("first taskCompleted", a title unlocked,
 * etc.). The ring is ordered OLDEST → NEWEST (`ledger/memory.ts` appends;
 * eviction drops the oldest past 8) — renderers show the newest. Zero
 * negative feedback: nothing derived from `taskFailed` / `requestError`
 * ever produces a memory entry. */
export interface LedgerMemoryEntry {
  readonly at: number;
  readonly text: string;
}

/** Read-only projection `pet.ts` / the menu (Group 7) render. `null` before
 * the ledger has observed its first snapshot (or when no `LedgerPort` is
 * wired at all — the caller never calls `summary()` in that case). */
export interface LedgerSummary {
  readonly level: number;
  readonly xp: number;
  /** XP needed to reach `level + 1`, per `xpForLevel` (D10:
   * `50 * L * (L - 1) / 2`). */
  readonly xpForNextLevel: number;
  readonly titles: ReadonlyArray<string>;
  readonly stats: LedgerStats;
  readonly memory: ReadonlyArray<LedgerMemoryEntry>;
}

/**
 * One memory row as the MANAGER PAGE renders it (D6⑤): the ledger's own
 * entry plus its precomputed relative timestamp. Defined here — not in
 * `src/ledger/inspect.ts` — so the page can `import type` it and still
 * typecheck in the TRIMMED build (src/ledger is deleted there; the contract
 * tree survives). Same meeting-point trick as {@link LedgerSummary}.
 */
export interface LedgerMemoryItemView {
  readonly text: string;
  readonly at: number;
  /** Precomputed against the summarize-time clock, e.g. "5m ago". */
  readonly relative: string;
}

/**
 * The manager page's ledger panel model (D6⑤): `summarizeLedger()` in
 * `src/ledger/inspect.ts` produces it from a persisted `LedgerState`; the
 * panel renders it without computing anything. Everything display-shaped
 * (percent, human durations, relative times) is PRECOMPUTED so the panel
 * stays dumb and the pure projection stays unit-testable in isolation.
 */
export interface LedgerPanelModel {
  /** `levelFor(xp)` — recomputed, never read from storage (D10). */
  readonly level: number;
  /** The newest unlocked title id, or `null` before the first unlock. */
  readonly titleId: string | null;
  readonly xp: number;
  /** XP progress within the CURRENT level band. */
  readonly xpIntoLevel: number;
  /** Width of the current level band (`xpForLevel(level+1) - xpForLevel(level)`). */
  readonly xpForNextLevel: number;
  /** Integer 0..100 — the XP bar's fill percentage. */
  readonly progressPct: number;
  readonly stats: LedgerStats;
  /** `stats.activeMs` preformatted, e.g. "6h 05m". */
  readonly activeHuman: string;
  readonly unlockedTitles: ReadonlyArray<string>;
  /** Newest first (the ring stores oldest -> newest; the page shows the newest). */
  readonly memory: ReadonlyArray<LedgerMemoryItemView>;
  readonly updatedAt: number;
}

/**
 * The full port (D10). Exactly three methods — `pet.ts` never reaches past
 * this interface into the ledger's internals.
 */
export interface LedgerPort {
  /** Called once per facts-poll tick (D13's cadence) with the latest
   * snapshot and the current time; awards XP for newly-active facts
   * (idempotent per `${type}|${id}|${occurredAt}`, keyed to `deadline` so a
   * re-observed-after-expiry fact with the same id can award again) and
   * accrues `activeMs` while `sensing.thinking` holds. */
  observe(snapshot: PetFactsSnapshotLike, now: number): void;
  /** Called on a direct user interaction (feed/play/pet-tap/etc, Group 7);
   * awards companionship XP independent of the facts stream. */
  noteInteraction(kind: LedgerInteractionKind): void;
  /** Pure read. `null` only before the first `observe()` call. */
  summary(): LedgerSummary | null;
}
