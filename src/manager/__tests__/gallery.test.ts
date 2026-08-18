/**
 * src/manager/__tests__/gallery.test.ts — task 6.2's gate, through the REAL
 * components (createRoot + act in jsdom):
 *   - geometry at the preview scale: backgroundSize/Position computed by the
 *     same sheetGeometry math the pet window uses, at 128px, observable
 *     through data-frame as the setTimeout chain steps at the slot's fps
 *   - the selection write: clicking a card goes through prefs.ts's own store
 *     (same module/key/debounce as the pet window — no parallel writer), the
 *     localStorage write landing after the debounce window
 *   - the fallback card: a failing pack load NEVER blanks the card — the
 *     fallback glyph pack renders, marked data-fallback
 *
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { pageStrings } from '../../interact/locale';
import type { PackModuleImporter } from '../../packs/loadPack';
import { PREFS_STORAGE_KEY } from '../../state/prefs';
import { Gallery } from '../Gallery';
import { PACK_PREVIEW_PX, PackCard } from '../PackCard';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** A full 15-state pack module shape loadPack accepts (idle 4-frame loop). */
function fakePackModule(
  options: { frames?: number; fps?: number; playback?: 'loop' | 'pingpong' | 'once' | 'blink' } = {}
): { default: unknown } {
  const frames = options.frames ?? 4;
  const fps = options.fps ?? 10;
  const playback = options.playback ?? 'loop';
  const states: Record<string, unknown> = {};
  const sheets: Record<string, unknown> = {};
  for (const state of PET_STATES) {
    const isIdle = state === 'idle';
    const f = isIdle ? frames : 1;
    states[state] = {
      sheet: `${state}.png`,
      frames: f,
      fps: isIdle ? fps : 2,
      playback: isIdle ? playback : 'loop',
    };
    sheets[state] = { url: `data:image/png;base64,${state === 'idle' ? 'aWRsZQ==' : 'eA=='}`, frames: f };
  }
  return {
    default: {
      manifest: {
        apiVersion: 1,
        id: 'fake-pack',
        name: 'Fake Pack',
        credit: 'Artist X',
        license: 'CC-BY-4.0',
        states,
      },
      sheets,
    },
  };
}

interface Rendered {
  container: HTMLElement;
  root: Root;
}

async function render(element: ReturnType<typeof createElement>): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

let current: Rendered | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(async () => {
  if (current !== null) {
    await act(async () => {
      current?.root.unmount();
    });
    current.container.remove();
    current = null;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PackCard — preview geometry at the 128px scale (task 6.2 gate)', () => {
  it('backgroundSize stretches the strip; frame 0 sits at 0px', async () => {
    const importer: PackModuleImporter = vi.fn(async () => fakePackModule({ frames: 4, fps: 10 }));
    current = await render(
      createElement(PackCard, {
        id: 'fake-pack',
        strings: pageStrings('en'),
        selected: false,
        onSelect: () => {},
        importer,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const preview = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-preview-fake-pack"]');
    expect(preview).not.toBeNull();
    expect(preview?.style.width).toBe(`${PACK_PREVIEW_PX}px`);
    expect(preview?.style.backgroundSize).toBe(`${4 * PACK_PREVIEW_PX}px ${PACK_PREVIEW_PX}px`);
    // jsdom normalizes the zero Y length: '0px 0' reads back '0px 0px'.
    expect(preview?.style.backgroundPosition).toBe('0px 0px');
    expect(preview?.getAttribute('data-frame')).toBe('0');
  });

  it('steps data-frame + backgroundPosition at the slot fps (setTimeout chain)', async () => {
    const importer: PackModuleImporter = vi.fn(async () => fakePackModule({ frames: 4, fps: 10 }));
    current = await render(
      createElement(PackCard, {
        id: 'fake-pack',
        strings: pageStrings('en'),
        selected: false,
        onSelect: () => {},
        importer,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const preview = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-preview-fake-pack"]');
    expect(preview?.getAttribute('data-frame')).toBe('1');
    expect(preview?.style.backgroundPosition).toBe(`-${PACK_PREVIEW_PX}px 0px`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(preview?.getAttribute('data-frame')).toBe('2');
  });

  it('blink playback previews the pingpong blink walk (rest, then 0..N-1..0)', async () => {
    // 3 frames, fps 10 -> blinkPeriod 4, cycle 16 ticks (12 rest + the walk).
    const importer: PackModuleImporter = vi.fn(async () =>
      fakePackModule({ frames: 3, fps: 10, playback: 'blink' })
    );
    current = await render(
      createElement(PackCard, {
        id: 'fake-pack',
        strings: pageStrings('en'),
        selected: false,
        onSelect: () => {},
        importer,
      }),
    );
    const preview = () =>
      current?.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-preview-fake-pack"]');
    // Rest phase: ticks 0-11 hold frame 0.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(preview()?.getAttribute('data-frame')).toBe('0');
    // Blink walk: tick 13 -> blinkTick 1 -> frame 1; tick 14 -> frame 2.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(preview()?.getAttribute('data-frame')).toBe('1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(preview()?.getAttribute('data-frame')).toBe('2');
  });

  it('caption carries manifest name/credit/license + the state count', async () => {
    const importer: PackModuleImporter = vi.fn(async () => fakePackModule());
    current = await render(
      createElement(PackCard, {
        id: 'fake-pack',
        strings: pageStrings('en'),
        selected: false,
        onSelect: () => {},
        importer,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const text = current.container.textContent ?? '';
    expect(text).toContain('Fake Pack');
    expect(text).toContain('Artist X');
    expect(text).toContain('CC-BY-4.0');
    expect(text).toContain(`${PET_STATES.length} states`);
  });
});

describe('PackCard — the fallback contract (never a blank card)', () => {
  it('a failing load degrades to the glyph pack, marked data-fallback', async () => {
    // A rejecting importer is the contract loadPack's catch guards: network /
    // protocol failure, a corrupt module, a shape mismatch — all land on the
    // glyph. (The default plugin:// importer also rejects under jsdom, but on
    // real-fs timing that fake timers cannot drain deterministically.)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importer: PackModuleImporter = vi.fn(async () => {
      throw new Error('simulated load failure');
    });
    current = await render(
      createElement(PackCard, {
        id: 'elf-blob',
        strings: pageStrings('en'),
        selected: false,
        onSelect: () => {},
        importer,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const card = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-elf-blob"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-fallback')).toBe('true');
    const preview = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-preview-elf-blob"]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('data-frame')).toBe('0');
    expect(current.container.textContent).toContain('Fallback');
    expect(warn).toHaveBeenCalled();
  });
});

describe('Gallery — selection writes through prefs.ts (no parallel writer)', () => {
  it('clicking a card moves the ring and persists after the debounce', async () => {
    current = await render(createElement(Gallery, { strings: pageStrings('en') }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const blob = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-elf-blob"]');
    const tin = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-tin-bot"]');
    expect(blob?.getAttribute('data-selected')).toBe('true');
    expect(tin?.getAttribute('data-selected')).toBe('false');
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();

    await act(async () => {
      tin?.click();
    });
    expect(tin?.getAttribute('data-selected')).toBe('true');
    expect(blob?.getAttribute('data-selected')).toBe('false');
    // Debounced: not yet persisted at click time…
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
    // …lands after the prefs debounce window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBe(JSON.stringify({ packId: 'tin-bot' }));
  });

  it('pagehide flushes a pending selection before the debounce window elapses', async () => {
    current = await render(createElement(Gallery, { strings: pageStrings('en') }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const tin = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-tin-bot"]');
    await act(async () => {
      tin?.click();
    });
    // Still pending — the debounce has not elapsed…
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
    // …but the tab-hide/pagehide flush writes it synchronously (the fix-round
    // L1 gate: fake timers never fire the debounce here, so ONLY the flush
    // listener can have written).
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBe(JSON.stringify({ packId: 'tin-bot' }));
  });

  it('the ring initializes from the stored prefs (registry default when absent)', async () => {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ packId: 'tin-bot' }));
    current = await render(createElement(Gallery, { strings: pageStrings('en') }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const tin = current.container.querySelector<HTMLElement>('[data-testid="pet-manager-pack-card-tin-bot"]');
    expect(tin?.getAttribute('data-selected')).toBe('true');
    expect(tin?.querySelector('[data-testid="pet-manager-pack-selected-badge-tin-bot"]')).not.toBeNull();
  });
});
