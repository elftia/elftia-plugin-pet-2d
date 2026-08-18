/**
 * src/__tests__/petStorageBridge.test.ts — task 7.3's gate, BOTH directions
 * of the prefs `storage` bridge over jsdom `dispatchEvent(new StorageEvent())`:
 *
 *   pet window  : a storage event for `elftia-pet-2d:prefs:v1` (area =
 *                 localStorage) with a KNOWN new packId switches the sprite's
 *                 sheet live — no window recreate, no extra persist (the event
 *                 IS the manager page's write). Wrong key / wrong area /
 *                 unknown id / same id are all ignored.
 *   manager page: the same event shape moves the Gallery's selection ring.
 *
 * loadPack is mocked with distinguishable per-id sheets — the sprite's
 * background URL is the observable. (The browser contract that `storage`
 * never fires in the WRITING window is what makes the two halves safe; jsdom
 * reproduces it because we dispatch manually, exactly like a cross-window
 * write would arrive.)
 *
 * @vitest-environment jsdom
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type CharacterPackStateSlot } from '../contract/characterPack';
import type { PetFactsSnapshotLike } from '../contract/facts';
import { PET_STATES, type PetState } from '../contract/petState';
import { pageStrings } from '../interact/locale';
import { PREFS_STORAGE_KEY } from '../state/prefs';

// Distinguishable fake packs: the sheet URL embeds the id, so the sprite's
// background proves WHICH pack the stage is showing.
vi.mock('../packs/loadPack', async (importOriginal) => {
  const original = await importOriginal<typeof LoadPack>();
  return {
    ...original,
    loadPack: vi.fn(async (id: string) => fakePackFor(id)),
  };
});

import { Gallery } from '../manager/Gallery';
import type * as LoadPack from '../packs/loadPack';
import { loadPack } from '../packs/loadPack';
import { activate } from '../pet';

function fakePackFor(id: string): LoadPack.CharacterPack {
  const states: Record<string, unknown> = {};
  const sheets: Record<string, unknown> = {};
  for (const state of PET_STATES) {
    states[state] = { sheet: `${state}.png`, frames: 1, fps: 2, playback: 'loop' };
    // Base64 body: a raw SVG URL would carry quote characters that break
    // the CSS url("...") value (the sprite background silently drops to '').
    sheets[state] = { url: `data:image/png;base64,${btoa(`${id}-${state}`)}`, frames: 1 };
  }
  return {
    manifest: {
      apiVersion: 1,
      id,
      name: id,
      credit: 'test',
      license: 'CC0-1.0',
      states: states as Record<PetState, CharacterPackStateSlot>,
    },
    sheets: sheets as Record<PetState, { url: string; frames: number }>,
  };
}

/** The URL fragment `fakePackFor` embeds for (id, state). */
function sheetUrlFor(id: string, state: string): string {
  return btoa(`${id}-${state}`);
}

function fakeHost(): AgentUiHostApi {
  const runtime = {
    subscribeFacts: (_l: (s: PetFactsSnapshotLike) => void) => () => {},
    async getConfig() {
      return { enabled: true, petId: 'pet-2d', window: { width: 300, height: 300 }, presenceHidden: false };
    },
    setPointerCapture: (_inside: boolean) => {},
    startDrag: () => {},
    requestAppExit: () => {},
    async setConfig(_patch: Record<string, unknown>) {},
  };
  return {
    version: '1.53.0',
    compat: { major: 1, minor: 53 },
    react: null,
    ui: null,
    i18n: null,
    theme: null,
    ipc: null,
    petRuntime: runtime,
  } as unknown as AgentUiHostApi;
}

function firePrefsStorage(options: {
  key?: string;
  newValue?: string | null;
  area?: Storage | null;
}): void {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: options.key ?? PREFS_STORAGE_KEY,
      newValue: options.newValue ?? null,
      oldValue: null,
      storageArea: options.area === undefined ? window.localStorage : options.area,
    }),
  );
}

function spriteBackground(): string {
  const sprite = document.getElementById('pet-root')?.querySelector<HTMLElement>('.pet-sprite');
  return sprite?.style.backgroundImage ?? '';
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.mocked(loadPack).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pet window — storage event switches the pack live (task 7.1)', () => {
  it('a known new packId swaps the sprite sheet with no extra persist', async () => {
    await activate(fakeHost());
    expect(spriteBackground()).toContain(sheetUrlFor('elf-blob', 'idle'));
    expect(loadPack).toHaveBeenCalledTimes(1);

    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'tin-bot' }));
    firePrefsStorage({ newValue: JSON.stringify({ packId: 'tin-bot' }) });
    // The async load resolves on the microtask queue.
    await vi.advanceTimersByTimeAsync(0);

    expect(loadPack).toHaveBeenCalledTimes(2);
    // resolvePack forwards the (absent) importer seam as its 2nd arg.
    expect(loadPack).toHaveBeenLastCalledWith('tin-bot', undefined);
    expect(spriteBackground()).toContain(sheetUrlFor('tin-bot', 'idle'));
    // No extra persist from the pet side: the stored value is exactly what
    // the (simulated) manager page wrote — not rewritten by the pet.
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBe(JSON.stringify({ packId: 'tin-bot' }));
  });

  it('ignores a foreign key, a foreign storage area, an unknown id, and a no-op', async () => {
    await activate(fakeHost());
    expect(spriteBackground()).toContain(sheetUrlFor('elf-blob', 'idle'));

    firePrefsStorage({ key: 'some-other-key', newValue: '{}' });
    firePrefsStorage({ newValue: '{}', area: null });
    firePrefsStorage({ newValue: JSON.stringify({ packId: 'whale-girl-unknown' }) });
    firePrefsStorage({ newValue: JSON.stringify({ packId: 'elf-blob' }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(loadPack).toHaveBeenCalledTimes(1); // only the boot load
    expect(spriteBackground()).toContain(sheetUrlFor('elf-blob', 'idle'));
  });

  it('a superseding switch wins the race (out-of-order loads dropped)', async () => {
    await activate(fakeHost());
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'tin-bot' }));
    firePrefsStorage({ newValue: JSON.stringify({ packId: 'tin-bot' }) });
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'elf-blob' }));
    firePrefsStorage({ newValue: JSON.stringify({ packId: 'elf-blob' }) });
    await vi.advanceTimersByTimeAsync(0);
    // Both loads ran, but the LAST switch's pack is on stage.
    expect(loadPack).toHaveBeenCalledTimes(3);
    expect(spriteBackground()).toContain(sheetUrlFor('elf-blob', 'idle'));
  });
});

describe('manager page — storage event moves the Gallery ring (task 7.2)', () => {
  let container: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it('a pet-window write flips the ring to the new packId', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(createElement(Gallery, { strings: pageStrings('en') }));
    });
    const q = () => container?.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-tin-bot"]');
    expect(q()?.getAttribute('data-selected')).toBe('false');

    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'tin-bot' }));
    await act(async () => {
      firePrefsStorage({ newValue: JSON.stringify({ packId: 'tin-bot' }) });
    });
    expect(q()?.getAttribute('data-selected')).toBe('true');
    expect(container?.querySelector('[data-testid="pet-manager-pack-selected-badge-tin-bot"]')).not.toBeNull();
  });
});
