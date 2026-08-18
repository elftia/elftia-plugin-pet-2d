/**
 * src/packs/userPacks.ts — D6's runtime source: user-authored packs live in
 * the MAIN half's store (`<userData>/plugin-data/pet-2d/packs/`); the
 * renderer reaches them ONLY through scoped ipc (`host.ipc.invoke('packs:…')`
 * — spike-proven in both windows, ~3.9 MB payload in 153-286 ms). This module
 * is the ONE renderer-side client:
 *
 *   listUserPacks / loadUserPack  — the ipc verbs, feature-detected, NEVER
 *     throwing (`null` = unavailable/failed — distinct from `[]` = genuinely
 *     no user packs, so a failed fetch can keep the stale cache).
 *   resolvePack(id)               — the dispatch: built-in module pack |
 *     user ipc pack | fallback glyph (any doubt ⇒ glyph, the loadPack
 *     contract; both intakes share `normalizePackPayload`).
 *   rotationPool / nextPackInRotation — switch-character over built-ins ∪
 *     the live user list (built-ins first, user ids deduped against them).
 *   PACKS_REV_KEY / USER_PACKS_CACHE_KEY — the cross-window refresh
 *     protocol: the MANAGER window bumps the rev after any store mutation
 *     (save/delete/import); the pet window's `storage` listener refetches.
 *     The user list itself is cached in localStorage so a pet window booting
 *     without ipc (or while a fetch fails) still rotates over something.
 */
import type { AgentUiScopedIpc } from '@elftia/plugin-types';

import {
  type CharacterPack,
  fallbackPack,
  loadPack,
  normalizePackPayload,
  type PackModuleImporter,
} from './loadPack';
import { isKnownPackId, PACK_IDS } from './registry';

/** One `packs:list` row (mirrors the main half's PackSummary). */
export interface UserPackSummary {
  readonly id: string;
  readonly name: string;
  readonly credit: string;
  readonly license: string;
}

/** The ipc surface this module needs (tests fake it; prod passes host.ipc). */
export type PackIpc = Pick<AgentUiScopedIpc, 'invoke'>;

function isPackIpc(value: unknown): value is PackIpc {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { invoke?: unknown }).invoke === 'function'
  );
}

/** Shape-filter one list row; anything unreadable is skipped, never thrown. */
function toSummary(row: unknown): UserPackSummary | null {
  if (typeof row !== 'object' || row === null) return null;
  const { id, name, credit, license } = row as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  return {
    id,
    name: typeof name === 'string' && name !== '' ? name : id,
    credit: typeof credit === 'string' ? credit : '',
    license: typeof license === 'string' ? license : '',
  };
}

/**
 * `packs:list` — null when user packs are UNAVAILABLE (no ipc, invoke threw,
 * unrecognizable shape): the caller keeps its stale cache. `[]` means the
 * store answered and is genuinely empty.
 */
export async function listUserPacks(ipc: unknown): Promise<UserPackSummary[] | null> {
  if (!isPackIpc(ipc)) return null;
  try {
    const result: unknown = await ipc.invoke('packs:list', {});
    if (typeof result !== 'object' || result === null) return null;
    const rows = (result as { packs?: unknown }).packs;
    if (!Array.isArray(rows)) return null;
    const summaries: UserPackSummary[] = [];
    for (const row of rows) {
      const summary = toSummary(row);
      if (summary !== null) summaries.push(summary);
    }
    return summaries;
  } catch (error) {
    console.warn('[pet-2d] packs:list failed; user packs unavailable', error);
    return null;
  }
}

/**
 * `packs:load` for ONE user pack — the D6 payload (`{manifest, sheets}`)
 * pushed through the SAME `normalizePackPayload` gate module packs use (all
 * 15 states / url strings / positive-int frames / slot cross-check), so both
 * intakes trust identically or not at all. null on ANY doubt — never throws.
 */
export async function loadUserPack(ipc: unknown, id: string): Promise<CharacterPack | null> {
  if (!isPackIpc(ipc)) return null;
  try {
    const payload: unknown = await ipc.invoke('packs:load', { id });
    if (typeof payload !== 'object' || payload === null) return null;
    if ((payload as { ok?: unknown }).ok === false) return null; // not installed &c.
    return normalizePackPayload(payload);
  } catch (error) {
    console.warn(`[pet-2d] packs:load("${id}") failed; using the fallback glyph`, error);
    return null;
  }
}

export interface ResolvePackDeps {
  /** Scoped ipc (user packs); absent ⇒ user ids degrade to the glyph. */
  readonly ipc?: unknown;
  /** Test seam — production uses loadPack's default `plugin://` importer. */
  readonly importer?: PackModuleImporter;
}

/**
 * The dispatch (D6): a built-in id loads its module pack (`loadPack` —
 * already never-fails onto the glyph); anything else is a user pack via ipc;
 * any doubt lands on the fallback glyph. Both windows' every pack path
 * (boot, applyPack, PackCard) routes through here — there is no second
 * resolver.
 */
export async function resolvePack(id: string, deps: ResolvePackDeps = {}): Promise<CharacterPack> {
  if (isKnownPackId(id)) return loadPack(id, deps.importer);
  return (await loadUserPack(deps.ipc, id)) ?? fallbackPack();
}

/** The rotation pool: built-ins first, then user ids not shadowing them. */
export function rotationPool(userIds: readonly string[]): readonly string[] {
  return [...PACK_IDS, ...userIds.filter((id) => !PACK_IDS.includes(id))];
}

/** The next pack in rotation over the given pool (wraps; unknown ⇒ first). */
export function nextPackInRotation(current: string, pool: readonly string[]): string {
  if (pool.length === 0) return current;
  const index = pool.indexOf(current);
  if (index === -1) return pool[0];
  return pool[(index + 1) % pool.length];
}

// ─── The localStorage refresh protocol ─────────────────────────────────────

/** Cross-window store revision: the manager bumps; the pet refetches. */
export const PACKS_REV_KEY = 'elftia-pet-2d:packsRev:v1';
/** The cached user list (rotation survives an ipc-less boot / failed fetch). */
export const USER_PACKS_CACHE_KEY = 'elftia-pet-2d:userPacks:v1';

/** The current rev (0 when absent/unreadable — never throws). */
export function readPacksRev(storage: Storage | null | undefined): number {
  try {
    const raw = storage?.getItem(PACKS_REV_KEY);
    if (raw === null) return 0;
    const rev = Number(raw);
    return Number.isFinite(rev) && rev >= 0 ? rev : 0;
  } catch {
    return 0;
  }
}

/** Bump the rev (the manager window calls this after save/delete/import). */
export function bumpPacksRev(storage: Storage | null | undefined): void {
  try {
    // Monotonic increment, not a wall-clock stamp (fix-round F4): two
    // mutations in the same millisecond wrote an UNCHANGED value, and a
    // `storage` event only fires when the value actually changes — the pet
    // window missed the second mutation entirely. read+1 always moves.
    storage?.setItem(PACKS_REV_KEY, String(readPacksRev(storage) + 1));
  } catch {
    /* quota/private-mode — the other window just misses one refresh */
  }
}

/**
 * The same-window half of the protocol: a `storage` event NEVER fires in the
 * window that wrote the key, so the manager's own mutations (delete here,
 * studio save/import in group 6) also dispatch this in-window event. One
 * call, both channels: other windows get the rev event, this window gets the
 * custom one. `win` is a narrow structural type so node-environment tests
 * can fake it without a jsdom window.
 */
export const PACKS_CHANGED_EVENT = 'pet-2d:packs-changed';

export interface PacksChangedWindow {
  readonly localStorage: Storage;
  dispatchEvent(event: Event): boolean;
}

export function notifyPacksChanged(win: PacksChangedWindow | null | undefined): void {
  bumpPacksRev(win?.localStorage);
  try {
    win?.dispatchEvent(new Event(PACKS_CHANGED_EVENT));
  } catch {
    /* an undispatchable window just misses the in-window refresh */
  }
}

/** Cache the live list (tagged with the rev it was fetched under). */
export function cacheUserPacks(storage: Storage | null | undefined, packs: readonly UserPackSummary[]): void {
  try {
    storage?.setItem(USER_PACKS_CACHE_KEY, JSON.stringify({ rev: readPacksRev(storage), packs }));
  } catch {
    /* cache is best-effort */
  }
}

/** The cached list; corrupt/unreadable caches read as empty, never throw. */
export function readCachedUserPacks(storage: Storage | null | undefined): UserPackSummary[] {
  try {
    const raw = storage?.getItem(USER_PACKS_CACHE_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed = JSON.parse(raw) as { packs?: unknown };
    if (!Array.isArray(parsed?.packs)) return [];
    const summaries: UserPackSummary[] = [];
    for (const row of parsed.packs) {
      const summary = toSummary(row);
      if (summary !== null) summaries.push(summary);
    }
    return summaries;
  } catch {
    return [];
  }
}

/**
 * Fetch + cache + degrade: ipc unavailable/failed ⇒ the STALE CACHE stands
 * (the pet keeps rotating over what it last knew); a live answer (even
 * empty — the pack was deleted) becomes the new cache and the new truth.
 */
export async function refreshUserPacks(
  ipc: unknown,
  storage: Storage | null | undefined
): Promise<UserPackSummary[]> {
  const fresh = await listUserPacks(ipc);
  if (fresh === null) return readCachedUserPacks(storage);
  cacheUserPacks(storage, fresh);
  return fresh;
}
