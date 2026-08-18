/**
 * createLedger.ts — the one `LedgerPort` implementation (D10).
 * `pet.ts` reaches this ONLY through its guarded dynamic import — the single
 * import site of the whole ledger module in the tree (task 8.4's grep gate);
 * `scripts/verify-trim.mjs` (task 8.6) deletes this directory and proves the
 * plugin still typechecks, tests green, and builds.
 *
 * The two mechanisms D10 calls out as easy to get wrong:
 *
 * 1. FACT IDEMPOTENCY across windowed facts. An instantaneous fact (e.g.
 *    `taskCompleted`) reappears in EVERY snapshot for up to 8 s, and
 *    `observe()` runs on every 125 ms tick — so awarding "on sight" would
 *    multi-count ~64x. Key = `${type}|${id}|${occurredAt}`; the map is
 *    keyed to each fact's `deadline`, pruned each call (expired entries
 *    drop), and PERSISTED — otherwise a pet-window reload inside the window
 *    would re-award from a cold map. This applies to FAILURES too: a
 *    `taskFailed` fact is just as repeated, and stats.failures must not
 *    inflate.
 *
 * 2. COMPANIONSHIP ACCRUAL. `activeMs` grows only while a live
 *    `sessionThinking` fact holds (`now < deadline`), by the elapsed time
 *    since the previous observe, each increment capped at ACTIVE_CAP_MS
 *    (D10's anti-idle-farming rule — see xp.ts's header for why it adds no
 *    XP, following the reference implementation).
 *
 * Zero negative feedback (D10): failures count, nothing else. No code path
 * subtracts XP or decrements a counter.
 */
import type { PetFactEntryLike, PetFactsSnapshotLike } from '../contract/facts';
import type { LedgerPort, LedgerStats, LedgerSummary } from '../contract/ledgerPort';
import {
  levelUpMemoryText,
  mediaJobMemoryText,
  pushMemory,
  taskMemoryText,
  titleMemoryText,
} from './memory';
import {
  createLedgerPersistence,
  type LedgerState,
  type PersistenceDeps,
  readLedgerState,
  type StorageLike,
} from './persist';
import { newlyUnlockedTitles } from './titles';
import {
  ACTIVE_CAP_MS,
  levelFor,
  XP_SAFE_MAX,
  xpAwardForFact,
  xpAwardForInteraction,
  xpForLevel,
} from './xp';

/** Fact types observe() counts/awards. Everything else is ignored. */
const COUNTED_FACT_TYPES = new Set([
  'taskCompleted',
  'mediaJobCompleted',
  'turnCompleted',
  'taskFailed',
  'requestError',
]);

/**
 * A per-observe stats patch. `Partial<LedgerStats>` would keep every field
 * readonly (Partial is homomorphic), but observe() ACCUMULATES into this
 * record across the snapshot's facts — so strip readonly explicitly.
 */
type StatsPatch = { -readonly [K in keyof LedgerStats]?: LedgerStats[K] };

/** D10's idempotency key — identical fact instance, identical key. */
export function factKey(entry: PetFactEntryLike): string {
  return `${entry.type}|${entry.id}|${entry.occurredAt ?? entry.since ?? ''}`;
}

/** Is a `sessionThinking` fact live right now (mirrors sense.ts's
 * `applyStateful` rule: true while `now < deadline`)? */
export function isThinking(snapshot: PetFactsSnapshotLike, now: number): boolean {
  return snapshot.facts.some(
    (entry) => entry.type === 'sessionThinking' && entry.active !== false && now < entry.deadline
  );
}

export type Ledger = LedgerPort & { dispose(): void };

/** Injectables (tests). Ambient defaults resolve lazily via typeof guards,
 * so a node-project unit test never touches browser globals. */
export interface LedgerDeps extends PersistenceDeps {
  readonly storage?: StorageLike;
  readonly now?: () => number;
}

export function createLedger(deps: LedgerDeps = {}): Ledger {
  const storage: StorageLike =
    deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined) ?? {
      getItem: () => null,
      setItem: () => {},
    };
  const now = deps.now ?? (() => globalThis.Date.now());
  const persistence = createLedgerPersistence({ ...deps, storage });

  let state: LedgerState = readLedgerState(storage);
  let observedOnce = false;
  let lastObserveAt: number | null = null;
  let wasThinking = false;

  /** Apply one commit: stats patch + xp delta + memory entries, then derive
   * titles + level-up memory, persist (debounced). The single mutation path
   * for both observe() and noteInteraction(). */
  function commit(
    xpDelta: number,
    statsPatch: StatsPatch,
    memoryTexts: ReadonlyArray<string>,
    at: number
  ): void {
    const oldLevel = levelFor(state.xp);
    const stats: LedgerStats = { ...state.stats, ...statsPatch };
    let memory = state.memory;
    for (const text of memoryTexts) memory = pushMemory(memory, { at, text });
    const unlocked = newlyUnlockedTitles(stats, state.titles);
    if (unlocked.length > 0) {
      for (const title of unlocked) {
        memory = pushMemory(memory, { at, text: titleMemoryText(title.id) });
      }
    }
    const xp = Math.min(state.xp + xpDelta, XP_SAFE_MAX);
    const level = levelFor(xp);
    if (level > oldLevel) {
      memory = pushMemory(memory, { at, text: levelUpMemoryText(level) });
    }
    state = {
      xp,
      stats,
      titles: unlocked.length > 0 ? [...state.titles, ...unlocked.map((t) => t.id)] : state.titles,
      memory,
      seen: state.seen,
      updatedAt: at,
    };
    persistence.write(state);
  }

  return {
    observe(snapshot: PetFactsSnapshotLike, t: number): void {
      // 1) prune expired seen entries (their window closed; a NEW fact
      // instance of the same id gets a new occurredAt -> new key anyway).
      const seen: Record<string, number> = {};
      for (const [key, deadline] of Object.entries(state.seen)) {
        if (deadline > t) seen[key] = deadline;
      }

      // 2) count/award each not-yet-seen fact (idempotent per factKey).
      const statsPatch: StatsPatch = {};
      const memoryTexts: string[] = [];
      let xpDelta = 0;
      for (const entry of snapshot.facts) {
        if (entry.active === false || !COUNTED_FACT_TYPES.has(entry.type)) continue;
        const key = factKey(entry);
        if (key in seen) continue;
        seen[key] = entry.deadline;
        switch (entry.type) {
          case 'taskCompleted': {
            const nth = state.stats.tasksDone + (statsPatch.tasksDone ?? 0) + 1;
            statsPatch.tasksDone = nth;
            xpDelta += xpAwardForFact('taskCompleted');
            memoryTexts.push(taskMemoryText(nth));
            break;
          }
          case 'mediaJobCompleted': {
            const nth = state.stats.mediaJobs + (statsPatch.mediaJobs ?? 0) + 1;
            statsPatch.mediaJobs = nth;
            xpDelta += xpAwardForFact('mediaJobCompleted');
            memoryTexts.push(mediaJobMemoryText(nth));
            break;
          }
          case 'turnCompleted': {
            statsPatch.turns = state.stats.turns + (statsPatch.turns ?? 0) + 1;
            xpDelta += xpAwardForFact('turnCompleted');
            // No memory entry: turns fire on every agent turn and would
            // evict the ring in a minute (memory.ts header).
            break;
          }
          case 'taskFailed':
          case 'requestError': {
            // Count ONLY. Zero negative feedback: no xp effect, no memory.
            statsPatch.failures = state.stats.failures + (statsPatch.failures ?? 0) + 1;
            break;
          }
          default:
            break;
        }
      }

      // 3) companionship accrual (capped per increment, xp.ts header).
      const thinking = isThinking(snapshot, t);
      if (lastObserveAt !== null && wasThinking) {
        const elapsed = Math.min(Math.max(0, t - lastObserveAt), ACTIVE_CAP_MS);
        statsPatch.activeMs = state.stats.activeMs + (statsPatch.activeMs ?? 0) + elapsed;
      }
      wasThinking = thinking;
      lastObserveAt = t;
      observedOnce = true;

      // 4) persist the pruned+extended seen map with this commit.
      state = { ...state, seen };
      const firstSeenPatch = state.stats.firstSeenAt === 0 ? { firstSeenAt: t } : {};
      commit(xpDelta, { ...statsPatch, ...firstSeenPatch }, memoryTexts, t);
    },

    noteInteraction(kind: string): void {
      const award = xpAwardForInteraction(kind);
      if (award === 0) return; // unrecognized kind: no-op (contract note)
      commit(award, {}, [], now());
    },

    summary(): LedgerSummary | null {
      if (!observedOnce) return null; // contract: null only before first observe
      const level = levelFor(state.xp);
      return {
        level,
        xp: state.xp,
        xpForNextLevel: xpForLevel(level + 1),
        titles: state.titles,
        stats: state.stats,
        memory: state.memory,
      };
    },

    dispose(): void {
      persistence.dispose();
    },
  };
}
