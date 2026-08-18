/**
 * src/__tests__/petUserPacks.test.ts — group 5's pet-window half: the pet
 * routes EVERY pack path through resolvePack (boot, the prefs storage
 * switch, the rev-driven repair), so these tests drive the two cross-window
 * events a user pack's lifecycle produces:
 *
 *   - the prefs event with a USER id → refetch FIRST, then switch (the
 *     just-saved race the manager's Gallery creates)
 *   - the PACKS_REV event after a delete → refetch, and repair to the
 *     default when the shown pack vanished (the glyph-forever alternative)
 *
 * The fake host mirrors pet.test.ts's member-exact shape; `ipc` carries a
 * per-verb fake (null in the ipc-less degrade tests). Fallback glyph =
 * `data:image/svg`; the fake user pack's idle sheet = `aWRsZQ==` — that
 * contrast is the pack-identity probe throughout.
 *
 * @vitest-environment jsdom
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PET_STATES } from '../contract/petState';
import { DEFAULT_PACK_ID } from '../packs/registry';
import { PACKS_REV_KEY, USER_PACKS_CACHE_KEY } from '../packs/userPacks';
import { activate } from '../pet';
import { PREFS_STORAGE_KEY } from '../state/prefs';

const ROW = { id: 'user-pack-1', name: 'My Pack', credit: 'Me', license: 'MIT' };

function ipcOf(handlers: Record<string, (payload?: unknown) => unknown>): unknown {
  return {
    invoke: async (method: string, payload?: unknown) => {
      const handler = handlers[method];
      if (handler === undefined) throw new Error(`fake ipc: no handler for ${method}`);
      return handler(payload);
    },
  };
}

/** The D6 packs:load payload ({manifest, sheets}, 15 states, idle 4-frame). */
function userPayload(): { manifest: unknown; sheets: unknown } {
  const states: Record<string, unknown> = {};
  const sheets: Record<string, unknown> = {};
  for (const state of PET_STATES) {
    const frames = state === 'idle' ? 4 : 1;
    states[state] = { sheet: `${state}.png`, frames, fps: state === 'idle' ? 10 : 2, playback: 'loop' };
    sheets[state] = { url: `data:image/png;base64,${state === 'idle' ? 'aWRsZQ==' : 'eA=='}`, frames };
  }
  return {
    manifest: { apiVersion: 1, id: 'user-pack-1', name: 'User Pack', credit: 'Me', license: 'MIT', states },
    sheets,
  };
}

/** A host with a controllable ipc (petRuntime is the pet.test.ts dummy). */
function createHost(ipc: unknown): AgentUiHostApi {
  return {
    version: '1.54.0',
    compat: { major: 1, minor: 51 },
    react: null,
    ui: null,
    i18n: null,
    theme: null,
    ipc,
    petRuntime: {
      subscribeFacts: () => () => {},
      async getConfig() {
        return { enabled: true, petId: 'pet-2d', window: { width: 300, height: 300 }, presenceHidden: false };
      },
      setPointerCapture: () => {},
      startDrag: () => {},
      requestAppExit: () => {},
      async setConfig() {},
    },
  } as unknown as AgentUiHostApi;
}

function sprite(): HTMLElement | null {
  return document.getElementById('pet-root')?.querySelector<HTMLElement>('.pet-sprite') ?? null;
}

function backgroundImage(): string {
  return sprite()?.style.backgroundImage ?? '';
}

/** The manager window wrote the key; the event mirrors that write. */
function switchPrefsTo(packId: string): void {
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId }));
  window.dispatchEvent(
    new StorageEvent('storage', { key: PREFS_STORAGE_KEY, storageArea: window.localStorage }),
  );
}

function dispatchRevBump(): void {
  localStorage.setItem(PACKS_REV_KEY, String(Date.now()));
  window.dispatchEvent(
    new StorageEvent('storage', { key: PACKS_REV_KEY, storageArea: window.localStorage }),
  );
}

async function drain(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('the pet window — user packs over scoped ipc (group 5)', () => {
  it('a user id in the prefs storage event: refetch FIRST, then switch (the just-saved race)', async () => {
    const rows: unknown[][] = [[ROW]];
    await activate(createHost(ipcOf({
      'packs:list': () => ({ packs: rows[0] }),
      'packs:load': () => userPayload(),
    })));
    await drain();
    expect(backgroundImage()).toContain('data:image/svg'); // glyph at boot

    switchPrefsTo('user-pack-1');
    await drain();
    expect(backgroundImage()).toContain('aWRsZQ=='); // the user pack renders
    expect(sprite()?.dataset.petState).toBe('idle');
  });

  it('ipc ABSENT: the same event degrades to keeping the current pack (no throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await activate(createHost(null));
    await drain();
    switchPrefsTo('user-pack-1');
    await drain();
    expect(backgroundImage()).toContain('data:image/svg'); // glyph stands
    expect(sprite()).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('boot with a stored user pack id renders it directly and caches the list', async () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'user-pack-1' }));
    await activate(createHost(ipcOf({
      'packs:list': () => ({ packs: [ROW] }),
      'packs:load': () => userPayload(),
    })));
    await drain();
    expect(backgroundImage()).toContain('aWRsZQ==');
    const cached = JSON.parse(localStorage.getItem(USER_PACKS_CACHE_KEY) ?? 'null') as { packs?: unknown[] } | null;
    expect(cached?.packs).toEqual([ROW]);
  });

  it('a failing boot fetch over a primed cache still mounts (D13 + stale-cache degrade)', async () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'user-pack-1' }));
    localStorage.setItem(USER_PACKS_CACHE_KEY, JSON.stringify({ rev: 1, packs: [ROW] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await activate(createHost(ipcOf({
      'packs:list': () => {
        throw new Error('list down');
      },
      'packs:load': () => {
        throw new Error('load down');
      },
    })));
    await drain();
    expect(sprite()).not.toBeNull(); // mounted, never blank
    expect(backgroundImage()).toContain('data:image/svg'); // glyph degrade
    expect(warn).toHaveBeenCalled();
  });

  it('PACKS_REV event after a delete: repair to the default when the shown pack vanished', async () => {
    const rows: unknown[][] = [[ROW]];
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'user-pack-1' }));
    await activate(createHost(ipcOf({
      'packs:list': () => ({ packs: rows[0] }),
      'packs:load': () => userPayload(),
    })));
    await drain();
    expect(backgroundImage()).toContain('aWRsZQ==');

    rows[0] = []; // the store is now empty
    dispatchRevBump();
    await drain();
    expect(backgroundImage()).toContain('data:image/svg'); // repaired
    await vi.advanceTimersByTimeAsync(600);
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBe(JSON.stringify({ packId: DEFAULT_PACK_ID }));
  });

  it('PACKS_REV event while the shown pack still exists: no repair', async () => {
    await activate(createHost(ipcOf({
      'packs:list': () => ({ packs: [ROW] }),
      'packs:load': () => userPayload(),
    })));
    await drain();
    switchPrefsTo('user-pack-1');
    await drain();
    expect(backgroundImage()).toContain('aWRsZQ==');

    dispatchRevBump(); // some OTHER pack changed
    await drain();
    expect(backgroundImage()).toContain('aWRsZQ=='); // still the user pack
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBe(JSON.stringify({ packId: 'user-pack-1' }));
  });
});
