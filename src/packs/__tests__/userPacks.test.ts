/**
 * src/packs/__tests__/userPacks.test.ts — group 5's renderer-client gate
 * (node env; no DOM needed): the null-vs-[] distinction (a FAILED fetch
 * keeps the stale cache, an EMPTY one is the truth), the loadUserPack →
 * normalizePackPayload shared-shape gate, the resolvePack three-way
 * dispatch (builtin module | user ipc | glyph on any doubt), the rotation
 * math over built-ins ∪ user ids, and the rev/cache/notify protocol
 * helpers.
 */
import { describe, expect, it, vi } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { FALLBACK_PACK_ID } from '../loadPack';
import { PACK_IDS } from '../registry';
import {
  bumpPacksRev,
  cacheUserPacks,
  listUserPacks,
  loadUserPack,
  nextPackInRotation,
  notifyPacksChanged,
  PACKS_CHANGED_EVENT,
  PACKS_REV_KEY,
  type PacksChangedWindow,
  readCachedUserPacks,
  readPacksRev,
  refreshUserPacks,
  resolvePack,
  rotationPool,
  USER_PACKS_CACHE_KEY,
} from '../userPacks';

/** A scoped-ipc fake over per-verb handlers (unknown verbs throw). */
function ipcOf(handlers: Record<string, (payload?: unknown) => unknown>): unknown {
  return {
    invoke: async (method: string, payload?: unknown) => {
      const handler = handlers[method];
      if (handler === undefined) throw new Error(`fake ipc: no handler for ${method}`);
      return handler(payload);
    },
  };
}

/** The D6 packs:load payload shape ({manifest, sheets}, 15 states). */
function validPayload(id = 'user-pack-1'): { manifest: unknown; sheets: unknown } {
  const states: Record<string, unknown> = {};
  const sheets: Record<string, unknown> = {};
  for (const state of PET_STATES) {
    const frames = state === 'idle' ? 4 : 1;
    states[state] = { sheet: `${state}.png`, frames, fps: state === 'idle' ? 10 : 2, playback: 'loop' };
    sheets[state] = { url: `data:image/png;base64,${state === 'idle' ? 'aWRsZQ==' : 'eA=='}`, frames };
  }
  return {
    manifest: { apiVersion: 1, id, name: 'User Pack', credit: 'Me', license: 'MIT', states },
    sheets,
  };
}

/** A minimal Storage fake (node env has no localStorage global). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

const ROW = { id: 'user-pack-1', name: 'My Pack', credit: 'Me', license: 'MIT' };

describe('listUserPacks — null (unavailable) vs [] (genuinely empty)', () => {
  it('no ipc / non-object ipc / invoke-less ipc → null', async () => {
    expect(await listUserPacks(null)).toBeNull();
    expect(await listUserPacks(undefined)).toBeNull();
    expect(await listUserPacks({})).toBeNull();
    expect(await listUserPacks('ipc')).toBeNull();
  });

  it('a throwing invoke → null (never rejects)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await listUserPacks(ipcOf({ 'packs:list': () => {
      throw new Error('boom');
    } }))).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('unrecognizable results → null', async () => {
    expect(await listUserPacks(ipcOf({ 'packs:list': () => null }))).toBeNull();
    expect(await listUserPacks(ipcOf({ 'packs:list': () => ({}) }))).toBeNull();
    expect(await listUserPacks(ipcOf({ 'packs:list': () => ({ packs: 'nope' }) }))).toBeNull();
  });

  it('bad rows are skipped; a nameless row falls back to its id', async () => {
    const packs = await listUserPacks(
      ipcOf({
        'packs:list': () => ({
          packs: [ROW, { id: '', name: 'dropped' }, { id: 'anon' }, 'garbage', null],
        }),
      }),
    );
    expect(packs).toEqual([
      ROW,
      { id: 'anon', name: 'anon', credit: '', license: '' },
    ]);
  });

  it('an empty answer is [] — the truth, not an error', async () => {
    expect(await listUserPacks(ipcOf({ 'packs:list': () => ({ packs: [] }) }))).toEqual([]);
  });
});

describe('loadUserPack — the shared normalizePackPayload gate', () => {
  it('no ipc → null without touching anything', async () => {
    expect(await loadUserPack(null, 'user-pack-1')).toBeNull();
  });

  it('ok:false (not installed) → null', async () => {
    expect(
      await loadUserPack(ipcOf({ 'packs:load': () => ({ ok: false, problems: ['x'] }) }), 'user-pack-1'),
    ).toBeNull();
  });

  it('a valid payload → CharacterPack (idle sheet url carried through)', async () => {
    const pack = await loadUserPack(ipcOf({ 'packs:load': () => validPayload() }), 'user-pack-1');
    expect(pack?.manifest.id).toBe('user-pack-1');
    expect(pack?.sheets.idle.url).toContain('aWRsZQ==');
  });

  it('a payload normalizePackPayload rejects (frames mismatch) → null', async () => {
    const payload = validPayload() as { manifest: { states: Record<string, { frames: number }> } };
    payload.manifest.states.idle.frames = 9; // sheets.idle still says 4
    expect(await loadUserPack(ipcOf({ 'packs:load': () => payload }), 'user-pack-1')).toBeNull();
  });

  it('a throwing invoke → null (never rejects)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await loadUserPack(
        ipcOf({ 'packs:load': () => {
          throw new Error('boom');
        } }),
        'user-pack-1',
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('resolvePack — builtin module | user ipc | glyph on any doubt', () => {
  it('a known id loads its module pack (never touches ipc)', async () => {
    const importer = vi.fn(async () => ({ default: validPayload('elf-blob') }));
    const pack = await resolvePack('elf-blob', { importer, ipc: ipcOf({}) });
    expect(pack.manifest.id).toBe('elf-blob');
  });

  it('an unknown id with working ipc loads the user pack', async () => {
    const pack = await resolvePack('user-pack-1', { ipc: ipcOf({ 'packs:load': () => validPayload() }) });
    expect(pack.manifest.id).toBe('user-pack-1');
  });

  it('an unknown id without ipc → the fallback glyph', async () => {
    const pack = await resolvePack('user-pack-1', {});
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
  });

  it('an unknown id whose ipc fails → the fallback glyph', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pack = await resolvePack('user-pack-1', { ipc: ipcOf({ 'packs:load': () => {
      throw new Error('boom');
    } }) });
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
    expect(warn).toHaveBeenCalled();
  });
});

describe('rotation — built-ins first, user ids deduped', () => {
  it('rotationPool keeps built-in order and drops shadowing user ids', () => {
    expect(rotationPool(['mine', PACK_IDS[0], 'other'])).toEqual([...PACK_IDS, 'mine', 'other']);
  });

  it('nextPackInRotation steps, wraps, and repairs unknown → first', () => {
    const pool = ['a', 'b', 'c'];
    expect(nextPackInRotation('a', pool)).toBe('b');
    expect(nextPackInRotation('c', pool)).toBe('a');
    expect(nextPackInRotation('zzz', pool)).toBe('a');
    expect(nextPackInRotation('x', [])).toBe('x');
  });
});

describe('the rev/cache/notify protocol helpers', () => {
  it('readPacksRev: absent/corrupt → 0; written value round-trips', () => {
    const storage = fakeStorage();
    expect(readPacksRev(storage)).toBe(0);
    expect(readPacksRev(null)).toBe(0);
    storage.setItem(PACKS_REV_KEY, 'not-a-number');
    expect(readPacksRev(storage)).toBe(0);
    bumpPacksRev(storage);
    expect(readPacksRev(storage)).toBeGreaterThan(0);
  });

  it('bumpPacksRev is monotonic: two same-millisecond bumps both move the rev (fix-round F4)', () => {
    const storage = fakeStorage();
    bumpPacksRev(storage);
    const first = readPacksRev(storage);
    // Under the old Date.now() stamp these two landed in the same ms and the
    // second write was a NO-OP — a `storage` event only fires when the value
    // actually changes, so the pet window missed the second mutation.
    bumpPacksRev(storage);
    expect(readPacksRev(storage)).toBe(first + 1);
  });

  it('cacheUserPacks/readCachedUserPacks round-trip; corrupt caches read as []', () => {
    const storage = fakeStorage();
    expect(readCachedUserPacks(storage)).toEqual([]);
    cacheUserPacks(storage, [ROW]);
    expect(readCachedUserPacks(storage)).toEqual([ROW]);
    storage.setItem(USER_PACKS_CACHE_KEY, '{oops');
    expect(readCachedUserPacks(storage)).toEqual([]);
    storage.setItem(USER_PACKS_CACHE_KEY, JSON.stringify({ packs: [ROW, { nope: 1 }] }));
    expect(readCachedUserPacks(storage)).toEqual([ROW]);
  });

  it('refreshUserPacks: a failed fetch keeps the STALE cache; a live answer replaces it', async () => {
    const storage = fakeStorage();
    cacheUserPacks(storage, [ROW]);
    const kept = await refreshUserPacks(
      ipcOf({ 'packs:list': () => {
        throw new Error('down');
      } }),
      storage,
    );
    expect(kept).toEqual([ROW]); // stale stands
    const fresh = await refreshUserPacks(ipcOf({ 'packs:list': () => ({ packs: [] }) }), storage);
    expect(fresh).toEqual([]); // deleted = the new truth
    expect(readCachedUserPacks(storage)).toEqual([]);
  });

  it('notifyPacksChanged bumps the rev AND dispatches the in-window event', () => {
    const storage = fakeStorage();
    const dispatchEvent = vi.fn((_event: Event) => true);
    const win = { localStorage: storage, dispatchEvent } as unknown as PacksChangedWindow;
    notifyPacksChanged(win);
    expect(readPacksRev(storage)).toBeGreaterThan(0);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(PACKS_CHANGED_EVENT);
  });
});
