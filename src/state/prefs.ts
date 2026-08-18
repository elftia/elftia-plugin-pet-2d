/**
 * src/state/prefs.ts — D11: pet-local preferences, deliberately OUTSIDE the
 * ledger module. The selected character (`packId`) must survive the
 * ledger's deletion (D10's trim proof, task 8.6), so it lives in its own
 * storage key with its own tiny read/normalize/write module. There is no
 * host config write verb for the pet (`pet:setConfig` is deliberately
 * absent from the pet preload, child B F16) — pack selection is necessarily
 * plugin-local.
 *
 * Robustness contract: a corrupt/unreadable store degrades to EMPTY prefs
 * (default pack, default facing) — never a throw, never a blocked activate.
 */
export const PREFS_STORAGE_KEY = 'elftia-pet-2d:prefs:v1';

/** D11's stored shape. Both fields optional; unknown fields are dropped. */
export interface PetPrefs {
  /** The user's chosen pack; absent = the registry default. */
  readonly packId?: string;
  /** Facing seed (D6 `facing.ts`); absent = face left (the packs' rest pose). */
  readonly facingSeed?: number;
}

/** Keeps only known, well-typed fields — one place, so every reader agrees. */
export function normalizePrefs(raw: unknown): PetPrefs {
  if (typeof raw !== 'object' || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const prefs: { packId?: string; facingSeed?: number } = {};
  if (typeof record.packId === 'string' && record.packId !== '') prefs.packId = record.packId;
  if (typeof record.facingSeed === 'number' && Number.isFinite(record.facingSeed)) {
    prefs.facingSeed = record.facingSeed;
  }
  return prefs;
}

/** Reads + normalizes; ANY failure (quota, corrupt JSON, absent key) → `{}`. */
export function readPrefs(storage: Pick<Storage, 'getItem'>): PetPrefs {
  try {
    return normalizePrefs(JSON.parse(storage.getItem(PREFS_STORAGE_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

/** Serializes + writes immediately (also the debounce flush target). */
export function writePrefsNow(storage: Pick<Storage, 'setItem'>, prefs: PetPrefs): void {
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota/private-mode failures must never surface in the pet.
  }
}

/** Injected clock so tests drive the debounce deterministically. */
export interface PrefsTimeout {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Debounce window for pack switches (rapid menu rotation = one write). */
export const PREFS_WRITE_DEBOUNCE_MS = 500;

export interface PrefsStore {
  /** Last known prefs (the in-memory truth between debounced writes). */
  read(): PetPrefs;
  /** Sets the pack choice; persists on the debounce. */
  setPackId(packId: string): void;
  /** Writes any pending change immediately (visibilitychange → hidden). */
  flush(): void;
}

/**
 * The store `pet.ts` owns. `storage`/`timeout` injectable; production
 * defaults are the window globals. The in-memory copy is authoritative
 * between writes so a rapid switch→read never sees a stale value.
 */
export function createPrefsStore(
  options: {
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
    timeout?: PrefsTimeout;
    debounceMs?: number;
  } = {}
): PrefsStore {
  const storage = options.storage ?? localStorage;
  const timeout = options.timeout ?? {
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const debounceMs = options.debounceMs ?? PREFS_WRITE_DEBOUNCE_MS;

  let prefs = readPrefs(storage);
  let pendingHandle: unknown = null;
  let dirty = false;

  function flush(): void {
    if (pendingHandle !== null) {
      timeout.clearTimeout(pendingHandle);
      pendingHandle = null;
    }
    if (dirty) {
      writePrefsNow(storage, prefs);
      dirty = false;
    }
  }

  return {
    read() {
      return prefs;
    },
    setPackId(packId) {
      prefs = { ...prefs, packId };
      dirty = true;
      if (pendingHandle !== null) timeout.clearTimeout(pendingHandle);
      pendingHandle = timeout.setTimeout(() => {
        pendingHandle = null;
        flush();
      }, debounceMs);
    },
    flush,
  };
}
