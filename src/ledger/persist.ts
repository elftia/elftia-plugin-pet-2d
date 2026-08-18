/**
 * persist.ts — D10 durability: `localStorage` under the pet
 * window's origin, normalized on read (level NEVER read — it is recomputed
 * from xp; unknown fields dropped), writes debounced <= 1 s and flushed on
 * `visibilitychange`->hidden + `pagehide`.
 *
 * WHY own listeners (and not pet.ts calling a flush verb): the pet window is
 * destroyed on switch-off/quit with NO unload ceremony, so the persistence
 * layer owns its teardown hooks itself — `pet.ts`'s visibility handler only
 * flushes prefs; this module registers its own pair for the ledger.
 * `LedgerPort` deliberately exposes no flush verb (nothing outside the
 * ledger may reach into its durability).
 *
 * Why localStorage and not a host verb (D10's ruling): `host.services.storage`
 * would require a `contributes.main` half (a third code entry + checksum +
 * manifest dependency — destroying trimmability), and no IPC verb exists.
 * Caveat (documented in docs/limitations.md): storage is keyed to the pet
 * window's origin — dev (`http://localhost:5173`-style) and packaged
 * (`app://bundle`) are DIFFERENT origins and the ledger does not migrate.
 *
 * All ambient dependencies (storage/timeout/document/window) are injectable
 * with lazy `typeof` defaults, so the unit tests (node project, no jsdom)
 * drive everything with fakes and nothing at module scope can crash.
 */
import type { LedgerMemoryEntry, LedgerStats } from '../contract/ledgerPort';
import { MEMORY_MAX } from './memory';
import { TITLES } from './titles';
import { XP_SAFE_MAX } from './xp';

export const LEDGER_STORAGE_KEY = 'elftia-pet-2d:ledger:v1';
/** D10: writes are debounced <= 1 s. */
export const LEDGER_WRITE_DEBOUNCE_MS = 1_000;

/**
 * The persisted shape. `seen` is D10's idempotency map (fact key -> the
 * deadline it was keyed to) — PERSISTED so a pet-window reload inside an
 * 8 s windowed fact's life does not re-award it. `level` is absent by
 * design: it is always `levelFor(xp)`.
 */
export interface LedgerState {
  readonly xp: number;
  readonly stats: LedgerStats;
  readonly titles: ReadonlyArray<string>;
  readonly memory: ReadonlyArray<LedgerMemoryEntry>;
  readonly seen: Readonly<Record<string, number>>;
  readonly updatedAt: number;
}

/** A fresh state — what normalize falls back to on any doubt. */
export function initialLedgerState(): LedgerState {
  return {
    xp: 0,
    stats: { tasksDone: 0, failures: 0, turns: 0, mediaJobs: 0, activeMs: 0, firstSeenAt: 0 },
    titles: [],
    memory: [],
    seen: {},
    updatedAt: 0,
  };
}

function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, n);
}

function clampXp(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(Math.max(0, n), XP_SAFE_MAX);
}

const KNOWN_TITLE_IDS = new Set(TITLES.map((t) => t.id));

function normalizeTitles(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && KNOWN_TITLE_IDS.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizeMemory(raw: unknown): ReadonlyArray<LedgerMemoryEntry> {
  if (!Array.isArray(raw)) return [];
  const entries: LedgerMemoryEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const at = (item as { at?: unknown }).at;
    const text = (item as { text?: unknown }).text;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue;
    if (typeof text !== 'string' || text.length === 0) continue;
    entries.push({ at, text });
  }
  return entries.length > MEMORY_MAX ? entries.slice(entries.length - MEMORY_MAX) : entries;
}

function normalizeSeen(raw: unknown): Readonly<Record<string, number>> {
  if (typeof raw !== 'object' || raw === null) return {};
  const seen: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) seen[key] = value;
  }
  return seen;
}

/**
 * Normalize on read (D10): every field defensively re-typed and clamped,
 * unknown fields dropped, titles filtered to the closed set, memory capped,
 * level recomputed (never read). Anything structurally wrong degrades to
 * the initial state of THAT field, never a throw.
 */
export function normalizeLedgerState(raw: unknown): LedgerState {
  if (typeof raw !== 'object' || raw === null) return initialLedgerState();
  const record = raw as Record<string, unknown>;
  const rawStats = typeof record.stats === 'object' && record.stats !== null
    ? (record.stats as Record<string, unknown>)
    : {};
  const stats: LedgerStats = {
    tasksDone: clampCount(rawStats.tasksDone),
    failures: clampCount(rawStats.failures),
    turns: clampCount(rawStats.turns),
    mediaJobs: clampCount(rawStats.mediaJobs),
    activeMs: clampCount(rawStats.activeMs),
    firstSeenAt: clampCount(rawStats.firstSeenAt),
  };
  return {
    xp: clampXp(record.xp),
    stats,
    titles: normalizeTitles(record.titles),
    memory: normalizeMemory(record.memory),
    seen: normalizeSeen(record.seen),
    updatedAt: clampCount(record.updatedAt),
  };
}

/** Minimal storage surface (a subset of DOM `Storage` — enough to inject). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TimeoutLike {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Read + parse + normalize; corrupt JSON or a missing key = fresh state. */
export function readLedgerState(storage: StorageLike): LedgerState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LEDGER_STORAGE_KEY);
  } catch {
    return initialLedgerState();
  }
  if (raw === null) return initialLedgerState();
  try {
    return normalizeLedgerState(JSON.parse(raw));
  } catch {
    return initialLedgerState();
  }
}

/** Immediate write; never throws (quota/private-mode is swallowed). */
export function writeLedgerNow(storage: StorageLike, state: LedgerState): void {
  try {
    storage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Durability is best-effort at this layer; the in-memory ledger is the
    // source of truth for the session either way.
  }
}

export interface LedgerPersistence {
  /** Debounced write; <= LEDGER_WRITE_DEBOUNCE_MS after the last call. */
  write(state: LedgerState): void;
  /** Immediate write of anything pending (cancels the debounce timer). */
  flush(): void;
  /** Tear down listeners + timer (tests; a future deactivate verb). */
  dispose(): void;
}

export interface PersistenceDeps {
  readonly storage?: StorageLike;
  readonly timeout?: TimeoutLike;
  readonly documentRef?: { addEventListener(type: string, listener: () => void): unknown; removeEventListener(type: string, listener: () => void): unknown; readonly visibilityState?: string };
  readonly windowRef?: { addEventListener(type: string, listener: () => void): unknown; removeEventListener(type: string, listener: () => void): unknown };
  readonly debounceMs?: number;
}

/**
 * The debounced writer + its OWN teardown hooks (visibilitychange->hidden
 * and pagehide both flush; see the file header for why that lives here and
 * not in pet.ts). Callers hand `readLedgerState` its storage.
 */
export function createLedgerPersistence(deps: PersistenceDeps = {}): LedgerPersistence {
  const storage: StorageLike =
    deps.storage ??
    (typeof localStorage !== 'undefined' ? localStorage : memoryBackedStorage());
  const timeout: TimeoutLike =
    deps.timeout ?? { setTimeout: (h, ms) => globalThis.setTimeout(h, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) };
  const debounceMs = deps.debounceMs ?? LEDGER_WRITE_DEBOUNCE_MS;
  const documentRef = deps.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
  const windowRef = deps.windowRef ?? (typeof window !== 'undefined' ? window : undefined);

  let pending: LedgerState | null = null;
  let timer: unknown = null;

  function writeNow(): void {
    if (timer !== null) {
      timeout.clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      writeLedgerNow(storage, pending);
      pending = null;
    }
  }

  const onHidden = (): void => {
    if (documentRef?.visibilityState === 'hidden') writeNow();
  };
  const onPageHide = (): void => writeNow();

  documentRef?.addEventListener('visibilitychange', onHidden);
  windowRef?.addEventListener('pagehide', onPageHide);

  return {
    write(state: LedgerState): void {
      pending = state;
      if (timer === null) {
        timer = timeout.setTimeout(writeNow, debounceMs);
      }
    },
    flush: writeNow,
    dispose(): void {
      if (timer !== null) timeout.clearTimeout(timer);
      timer = null;
      pending = null;
      documentRef?.removeEventListener('visibilitychange', onHidden);
      windowRef?.removeEventListener('pagehide', onPageHide);
    },
  };
}

/** Last-resort storage for a host with no localStorage at all: the session
 * keeps the ledger in memory and persistence becomes a no-op sink. */
function memoryBackedStorage(): StorageLike {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}
