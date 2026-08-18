/**
 * src/manager/__tests__/studio.test.ts — group 6's gate, three layers:
 *   draft — the PURE model (empty/prefill round-trip through the REAL
 *           `fromWhaleGirlManifest` + `validateCharacterPack`, the gating
 *           normalizer, the bulk idle copy, the catalog shape guard)
 *   Studio — the six-step flow through the real component with a fake
 *           scoped ipc: pick → catalog → whale-girl offer → prefill → live
 *           problems → save (notifyPacksChanged on BOTH channels) →
 *           collision/overwrite → export note; the no-ipc degrade card
 *   page   — the manage|studio view switch
 *
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateCharacterPack } from '../../contract/characterPack';
import { PET_STATES } from '../../contract/petState';
import { pageStrings } from '../../interact/locale';
import type { PackIpc } from '../../packs/userPacks';
import { PACKS_CHANGED_EVENT, PACKS_REV_KEY } from '../../packs/userPacks';
import { fromWhaleGirlManifest } from '../../packs/whaleGirlCompat';
import { ManagerPage } from '../page';
import {
  copyIdleToUnassigned,
  draftFromManifest,
  draftToManifest,
  emptyDraft,
  normalizeSlot,
  parseCatalogResult,
} from '../studio/draft';
import { Studio } from '../studio/Studio';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TOP_DIR = 'C:/atlas';
const CHAR_DIR = 'C:/atlas/characters/whale-girl';
const PREVIEW_URI = 'data:image/png;base64,aWRsZQ==';

/** A REGISTRY-form whale-girl manifest, all 15 states, contract-valid once
 *  measured (idle 3 frames @768px, wake blink 2 frames @512px, two motion
 *  rows at frames 1, everything else single-frame loops). */
const WG_MANIFEST = {
  default: 'whale-girl',
  characters: {
    'whale-girl': {
      name: '鲸鱼娘',
      credit: 'ZipZipPipe',
      states: Object.fromEntries(
        PET_STATES.map((state) => {
          if (state === 'idle') return [state, { sheet: 'idle.png', frames: 3, fps: 8, playback: 'loop' }];
          if (state === 'wake') return [state, { sheet: 'wake.png', frames: 2, fps: 4, playback: 'blink' }];
          if (state === 'walk') return [state, { sheet: 'walk.png', frames: 1, fps: 2, playback: 'loop', motion: 'bob' }];
          if (state === 'celebrate') return [state, { sheet: 'celebrate.png', frames: 1, fps: 2, playback: 'loop', motion: 'hop' }];
          return [state, { sheet: `${state}.png`, frames: 1, fps: 2, playback: 'loop' }];
        }),
      ),
    },
  },
};

/** The catalog's measured rows for the character dir (name → px). */
const CHAR_FILES = PET_STATES.map((state) => {
  const width = state === 'idle' ? 768 : state === 'wake' ? 512 : 256;
  return { name: `${state}.png`, bytes: 1024, width, height: 256 };
});

const CATALOG_RESULT = {
  dir: TOP_DIR,
  files: [
    { name: 'manifest.json', bytes: 900, width: null, height: null },
    { name: 'notes.txt', bytes: 14, width: null, height: null },
  ],
  whaleGirl: {
    manifest: WG_MANIFEST,
    characters: [{ id: 'whale-girl', name: '鲸鱼娘', dir: CHAR_DIR, files: CHAR_FILES }],
  },
};

/** A scoped-ipc fake over per-verb handlers (unknown verbs throw). */
function fakePackIpc(handlers: Record<string, (payload?: unknown) => unknown>): PackIpc {
  return {
    invoke: (async (method: string, payload?: unknown) => {
      const handler = handlers[method];
      if (handler === undefined) throw new Error(`fake ipc: no handler for ${method}`);
      return handler(payload);
    }) as PackIpc['invoke'],
  };
}

// ─── Harness ────────────────────────────────────────────────────────────────

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

async function drain(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Sets a React-controlled <select> and fires the change event. */
function setSelect(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Sets a React-controlled <input> and fires the input event. */
function setInput(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function q(selector: string): HTMLElement {
  const el = current?.container.querySelector<HTMLElement>(selector);
  if (el === null || el === undefined) throw new Error(`missing ${selector}`);
  return el;
}

// ─── draft — the pure model ─────────────────────────────────────────────────

describe('draft — the pure model', () => {
  it('emptyDraft: every slot unassigned; draftToManifest keeps the contract shape', () => {
    const draft = emptyDraft();
    for (const state of PET_STATES) {
      expect(draft.states[state].sheet).toBe('');
    }
    const manifest = draftToManifest(draft);
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.meta?.frameSize).toBe(256);
    expect(Object.keys(manifest.states)).toHaveLength(PET_STATES.length);
  });

  it('whale-girl prefill round-trip is VALID against the measured atlas', () => {
    const draft = draftFromManifest(fromWhaleGirlManifest(WG_MANIFEST, 'whale-girl'));
    expect(draft.id).toBe('whale-girl');
    expect(draft.name).toBe('鲸鱼娘');
    expect(draft.license).toBe('MIT'); // synthesized by the adapter (D8)
    expect(draft.states.idle).toEqual({ sheet: 'idle.png', frames: 3, fps: 8, playback: 'loop', motion: null });
    expect(draft.states.walk.motion).toBe('bob');
    const measured = Object.fromEntries(CHAR_FILES.map((f) => [f.name, { width: f.width as number, height: f.height as number }]));
    expect(validateCharacterPack(draftToManifest(draft), measured)).toEqual([]);
  });

  it('copyIdleToUnassigned fills ONLY the unassigned states', () => {
    const base = emptyDraft();
    const draft: typeof base = {
      ...base,
      states: { ...base.states, idle: { ...base.states.idle, sheet: 'base.png' } },
    };
    const filled = copyIdleToUnassigned(draft);
    expect(filled.states.walk.sheet).toBe('base.png');
    expect(filled.states.idle).toBe(draft.states.idle);
    // A state the author already assigned is left alone.
    const authored: typeof base = {
      ...draft,
      states: { ...draft.states, sleep: { ...draft.states.sleep, sheet: 'sleep.png' } },
    };
    expect(copyIdleToUnassigned(authored).states.sleep.sheet).toBe('sleep.png');
  });

  it('normalizeSlot enforces the contract gating', () => {
    expect(normalizeSlot('sleep', { sheet: 'a.png', frames: 1, fps: 2, playback: 'pingpong', motion: null }).playback).toBe('loop');
    expect(normalizeSlot('sleep', { sheet: 'a.png', frames: 0, fps: 99, playback: 'loop', motion: null })).toMatchObject({ frames: 1, fps: 2 });
    expect(normalizeSlot('sleep', { sheet: 'a.png', frames: 2, fps: 2, playback: 'loop', motion: 'bob' }).motion).toBeNull();
    // The error state is the multi-frame motion exception.
    expect(normalizeSlot('error', { sheet: 'a.png', frames: 2, fps: 2, playback: 'loop', motion: 'shake' }).motion).toBe('shake');
    // pingpong is legal once frames >= 2.
    expect(normalizeSlot('sleep', { sheet: 'a.png', frames: 2, fps: 2, playback: 'pingpong', motion: null }).playback).toBe('pingpong');
  });

  it('parseCatalogResult: malformed shapes → null; the whale-girl block carries', () => {
    expect(parseCatalogResult(null)).toBeNull();
    expect(parseCatalogResult({})).toBeNull();
    expect(parseCatalogResult({ dir: 'd', files: 'no' })).toBeNull();
    expect(parseCatalogResult({ dir: 'd', files: [{ name: 1 }] })).toBeNull();
    expect(parseCatalogResult({ dir: 'd', files: [], whaleGirl: { characters: 'x' } })).toBeNull();
    const parsed = parseCatalogResult(CATALOG_RESULT);
    expect(parsed?.whaleGirl?.characters[0]).toMatchObject({ id: 'whale-girl', dir: CHAR_DIR });
    expect(parseCatalogResult({ dir: 'd', files: [] })?.whaleGirl).toBeUndefined();
  });
});

// ─── Studio — the degrade + the six-step flow ────────────────────────────────

describe('Studio — the no-ipc degrade', () => {
  it('renders the unavailable card and no pick button', async () => {
    current = await render(createElement(Studio, { strings: pageStrings('en'), ipc: null, onExit: () => {} }));
    expect(q('[data-testid="pet-manager-studio-unavailable"]').textContent).toContain('Pack Studio unavailable');
    expect(current.container.querySelector('[data-testid="pet-manager-studio-pick-dir"]')).toBeNull();
  });
});

describe('Studio — the six-step flow (fake ipc)', () => {
  /** The full happy-path harness: pick + offer accept done, ready to assert. */
  async function studioWithOfferAccepted(options: { saveResults?: unknown[] } = {}): Promise<{
    ipc: PackIpc;
    saves: unknown[];
    previews: unknown[];
    exports: unknown[];
  }> {
    const saves: unknown[] = [];
    const previews: unknown[] = [];
    const exports: unknown[] = [];
    const saveResults = options.saveResults ?? [{ ok: true, id: 'whale-girl' }];
    const ipc = fakePackIpc({
      'packs:pickSourceDir': () => ({ dir: TOP_DIR }),
      'packs:catalog': () => CATALOG_RESULT,
      'packs:previewFile': (payload) => {
        previews.push(payload);
        return { dataUri: PREVIEW_URI };
      },
      'packs:save': (payload) => {
        saves.push(payload);
        return saveResults[Math.min(saves.length - 1, saveResults.length - 1)];
      },
      'packs:export': (payload) => {
        exports.push(payload);
        return { ok: true, id: 'whale-girl', path: 'C:/out/whale-girl.petpack' };
      },
    });
    current = await render(createElement(Studio, { strings: pageStrings('en'), ipc, onExit: () => {} }));
    await act(async () => {
      q('[data-testid="pet-manager-studio-pick-dir"]').click();
    });
    await drain();
    await act(async () => {
      q('[data-testid="pet-manager-studio-wg-offer-whale-girl"]').click();
    });
    await drain();
    return { ipc, saves, previews, exports };
  }

  it('pick → catalog → offer; accepting prefills from the character dir with zero problems', async () => {
    const { previews } = await studioWithOfferAccepted();
    // The ACTIVE dir switched to the character dir (top level has no sheets).
    expect(q('[data-testid="pet-manager-studio-dir-label"]').textContent).toContain(CHAR_DIR);
    expect(q('[data-testid="pet-manager-studio-dir-label"]').textContent).toContain('15 usable sheets');
    // The prefill landed in the grid.
    expect((q('[data-testid="pet-manager-studio-slot-idle-sheet"]') as HTMLSelectElement).value).toBe('idle.png');
    // Live validation: the prefilled draft is valid → save enabled.
    expect(q('[data-testid="pet-manager-studio-problems"]').getAttribute('data-count')).toBe('0');
    expect((q('[data-testid="pet-manager-studio-save"]') as HTMLButtonElement).disabled).toBe(false);
    // The preview fetched ONE file (the idle sheet) from the character dir.
    expect(previews).toEqual([{ dir: CHAR_DIR, name: 'idle.png' }]);
    expect(q('[data-testid="pet-manager-studio-preview"]').getAttribute('data-loaded')).toBe('true');
  });

  it('save sends the draft manifest from the character dir and notifies BOTH channels', async () => {
    const { saves } = await studioWithOfferAccepted();
    const events: string[] = [];
    window.addEventListener(PACKS_CHANGED_EVENT, () => events.push(PACKS_CHANGED_EVENT));
    await act(async () => {
      q('[data-testid="pet-manager-studio-save"]').click();
    });
    await drain();
    expect(saves).toHaveLength(1);
    const payload = saves[0] as { dir: string; overwrite: boolean; manifest: { id: string; states: Record<string, unknown> } };
    expect(payload.dir).toBe(CHAR_DIR);
    expect(payload.overwrite).toBe(false);
    expect(payload.manifest.id).toBe('whale-girl');
    expect(Object.keys(payload.manifest.states)).toHaveLength(PET_STATES.length);
    // The Gallery's same-window channel + the pet's cross-window rev.
    expect(events).toEqual([PACKS_CHANGED_EVENT]);
    expect(localStorage.getItem(PACKS_REV_KEY)).not.toBeNull();
    expect(q('[data-testid="pet-manager-studio-saved-note"]').textContent).toBe('Installed as "whale-girl".');
  });

  it('export after save shows the path note', async () => {
    const { exports } = await studioWithOfferAccepted();
    await act(async () => {
      q('[data-testid="pet-manager-studio-save"]').click();
    });
    await drain();
    await act(async () => {
      q('[data-testid="pet-manager-studio-export"]').click();
    });
    await drain();
    expect(exports).toEqual([{ id: 'whale-girl' }]);
    expect(q('[data-testid="pet-manager-studio-export-note"]').textContent).toBe('Exported to C:/out/whale-girl.petpack');
  });

  it('live problems: a bad id disables save and lands in the strip', async () => {
    await studioWithOfferAccepted();
    setInput(q('[data-testid="pet-manager-studio-meta-id"]') as HTMLInputElement, 'Bad Id!');
    await drain();
    const problems = q('[data-testid="pet-manager-studio-problems"]');
    expect(problems.getAttribute('data-count')).not.toBe('0');
    expect(problems.textContent).toContain('id must match');
    expect((q('[data-testid="pet-manager-studio-save"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an "already installed" answer offers overwrite; the retry sends overwrite:true', async () => {
    const { saves } = await studioWithOfferAccepted({
      saveResults: [
        // fix-round F5: the affordance keys off the structured code, so the
        // fake must carry what the real store now stamps.
        { ok: false, code: 'already-installed', problems: ['pack "whale-girl" is already installed — replace it explicitly (overwrite)'] },
        { ok: true, id: 'whale-girl' },
      ],
    });
    await act(async () => {
      q('[data-testid="pet-manager-studio-save"]').click();
    });
    await drain();
    expect(current?.container.querySelector('[data-testid="pet-manager-studio-save-problems"]')).toBeNull();
    await act(async () => {
      q('[data-testid="pet-manager-studio-overwrite"]').click();
    });
    await drain();
    expect(saves).toHaveLength(2);
    expect((saves[1] as { overwrite: boolean }).overwrite).toBe(true);
    expect(q('[data-testid="pet-manager-studio-saved-note"]').textContent).toContain('whale-girl');
  });

  it('a failure whose MESSAGE says "already installed" but carries no code stays failed (fix-round F5)', async () => {
    // The decoupling proof: the old string-match (/already installed/)
    // surfaced an overwrite affordance for ANY problem echoing those words —
    // a hostile store answer must not be able to conjure the button.
    await studioWithOfferAccepted({
      saveResults: [
        { ok: false, problems: ['pack "whale-girl" is already installed — replace it explicitly (overwrite)'] },
      ],
    });
    await act(async () => {
      q('[data-testid="pet-manager-studio-save"]').click();
    });
    await drain();
    expect(current?.container.querySelector('[data-testid="pet-manager-studio-overwrite"]')).toBeNull();
    expect(q('[data-testid="pet-manager-studio-save-problems"]').textContent).toContain('already installed');
  });

  it('a semantic save failure lists its problems (no overwrite offer)', async () => {
    await studioWithOfferAccepted({
      saveResults: [{ ok: false, problems: ['states.sleep.sheet "sleep.png" has no measured dimensions supplied'] }],
    });
    await act(async () => {
      q('[data-testid="pet-manager-studio-save"]').click();
    });
    await drain();
    expect(q('[data-testid="pet-manager-studio-save-problems"]').textContent).toContain('sleep.png');
    expect(current?.container.querySelector('[data-testid="pet-manager-studio-overwrite"]')).toBeNull();
    expect(current?.container.querySelector('[data-testid="pet-manager-studio-saved-note"]')).toBeNull();
  });

  it('grid gating: pingpong disabled at 1 frame; motion cleared at 2 frames (except error)', async () => {
    await studioWithOfferAccepted();
    // sleep: single frame — the pingpong option is disabled in the DOM.
    const sleepPlayback = q('[data-testid="pet-manager-studio-slot-sleep-playback"]') as HTMLSelectElement;
    const pingpongOption = Array.from(sleepPlayback.options).find((o) => o.value === 'pingpong');
    expect(pingpongOption?.disabled).toBe(true);
    // Frames → 2 un-gates pingpong (and the value switch sticks).
    setInput(q('[data-testid="pet-manager-studio-slot-sleep-frames"]') as HTMLInputElement, '2');
    await drain();
    expect(Array.from(sleepPlayback.options).find((o) => o.value === 'pingpong')?.disabled).toBe(false);
    setSelect(sleepPlayback, 'pingpong');
    await drain();
    expect(sleepPlayback.value).toBe('pingpong');
    // walk prefilled with motion 'bob' at 1 frame; frames → 2 clears it.
    const walkMotion = q('[data-testid="pet-manager-studio-slot-walk-motion"]') as HTMLSelectElement;
    expect(walkMotion.value).toBe('bob');
    setInput(q('[data-testid="pet-manager-studio-slot-walk-frames"]') as HTMLInputElement, '2');
    await drain();
    expect(walkMotion.value).toBe('');
    // The error row keeps its motion even at 2 frames.
    const errorMotion = q('[data-testid="pet-manager-studio-slot-error-motion"]') as HTMLSelectElement;
    expect(errorMotion.disabled).toBe(false);
    setInput(q('[data-testid="pet-manager-studio-slot-error-frames"]') as HTMLInputElement, '2');
    await drain();
    expect(errorMotion.disabled).toBe(false);
  });

  it('copy idle → unassigned fills the sheet dropdowns live', async () => {
    await studioWithOfferAccepted();
    // The prefill assigned everything; unassign walk, then bulk-copy idle's row.
    setSelect(q('[data-testid="pet-manager-studio-slot-walk-sheet"]') as HTMLSelectElement, '');
    await drain();
    expect((q('[data-testid="pet-manager-studio-slot-walk-sheet"]') as HTMLSelectElement).value).toBe('');
    await act(async () => {
      q('[data-testid="pet-manager-studio-copy-idle"]').click();
    });
    await drain();
    expect((q('[data-testid="pet-manager-studio-slot-walk-sheet"]') as HTMLSelectElement).value).toBe('idle.png');
    // idle itself is the source — untouched.
    expect((q('[data-testid="pet-manager-studio-slot-idle-sheet"]') as HTMLSelectElement).value).toBe('idle.png');
  });
});

// ─── page — the manage|studio view switch ────────────────────────────────────

describe('ManagerPage — the manage|studio view switch', () => {
  it('open → studio (hostless: the unavailable card); back → manage', async () => {
    current = await render(createElement(ManagerPage));
    await drain();
    expect(current.container.querySelector('[data-testid="pet-manager-gallery"]')).not.toBeNull();
    await act(async () => {
      q('[data-testid="pet-manager-studio-open"]').click();
    });
    await drain();
    expect(current.container.querySelector('[data-testid="pet-manager-gallery"]')).toBeNull();
    expect(current.container.querySelector('[data-testid="pet-manager-studio"]')).not.toBeNull();
    // Hostless jsdom → the studio's no-ipc degrade (ipc comes from the host).
    expect(current.container.querySelector('[data-testid="pet-manager-studio-unavailable"]')).not.toBeNull();
    await act(async () => {
      q('[data-testid="pet-manager-studio-back"]').click();
    });
    await drain();
    expect(current.container.querySelector('[data-testid="pet-manager-gallery"]')).not.toBeNull();
    expect(current.container.querySelector('[data-testid="pet-manager-studio"]')).toBeNull();
  });
});
