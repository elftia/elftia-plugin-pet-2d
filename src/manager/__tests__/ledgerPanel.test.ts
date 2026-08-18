/**
 * src/manager/__tests__/ledgerPanel.test.ts — task 8.2's gate, through the
 * REAL component (createRoot + act in jsdom). The seam is INJECTED through
 * the `loadInspect` prop (the same test-seam shape as PackCard's importer /
 * loadPack): no vi.mock on a path, so this file runs UNCHANGED inside
 * verify-trim's trimmed copy — there the component's default loader would
 * reject, but the injected loaders exercise exactly the panel logic that
 * must survive the trim.
 *
 *   - the populated panel: level chip, title chip, XP fill width, stats
 *     row, memory list — all values straight from the seam's model
 *   - the storage refresh: a `storage` event for the LEDGER key (right
 *     storageArea) re-reads through the seam; a foreign key does not
 *   - the trimmed/absent ledger: a rejecting seam renders the honest
 *     unavailable card — and STAYS degraded across storage events
 *
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerPanelModel } from '../../contract/ledgerPort';
import { pageStrings } from '../../interact/locale';
import { type LedgerInspectModule,LedgerPanel } from '../LedgerPanel';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const LEDGER_KEY = 'elftia-pet-2d:ledger:v1';

const readLedgerState = vi.fn();
const summarizeLedger = vi.fn();

function fakeModel(overrides: Partial<LedgerPanelModel> = {}): LedgerPanelModel {
  return {
    level: 3,
    titleId: 'social',
    xp: 170,
    xpIntoLevel: 20,
    xpForNextLevel: 150,
    progressPct: 13,
    stats: {
      tasksDone: 7,
      failures: 2,
      turns: 31,
      mediaJobs: 4,
      activeMs: 6 * 3_600_000,
      firstSeenAt: 0,
    },
    activeHuman: '6h 00m',
    unlockedTitles: ['first-task', 'social'],
    memory: [
      { text: 'Completed task (no. 7)', at: 1000, relative: '1h ago' },
      { text: 'Reached level 3', at: 500, relative: '3h ago' },
    ],
    updatedAt: 2000,
    ...overrides,
  };
}

/** A working seam: a fake `ledger/inspect` module backed by the mocks. */
const fakeInspect = (): LedgerInspectModule => ({
  LEDGER_STORAGE_KEY: LEDGER_KEY,
  readLedgerState,
  summarizeLedger,
});

/** The trimmed-build seam: the import itself rejects (module deleted). */
const rejectingInspect = (): Promise<LedgerInspectModule> =>
  Promise.reject(new Error('module trimmed away (verify-trim)'));

let container: HTMLElement | null = null;
let root: Root | null = null;

/** The async seam resolves on the microtask/macrotask queue — flush it
 * INSIDE act so the post-load re-render is asserted, not raced. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(loadInspect?: () => Promise<LedgerInspectModule>): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  root = r;
  await act(async () => {
    r.render(
      createElement(LedgerPanel, {
        strings: pageStrings('en'),
        loadInspect: loadInspect ?? (async () => fakeInspect()),
      }),
    );
  });
  await flush();
}

function fireStorage(key: string | null, area: Storage | null = window.localStorage): void {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue: 'next', oldValue: 'prev', storageArea: area }),
  );
}

function resetSeams(): void {
  readLedgerState.mockReset().mockReturnValue({ from: 'storage' });
  summarizeLedger.mockReset().mockReturnValue(fakeModel());
}

beforeEach(() => {
  localStorage.clear();
  resetSeams();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
  resetSeams();
});

describe('LedgerPanel — populated through the seam (task 8.2)', () => {
  it('renders level, title, XP fill, stats, and memory from the model', async () => {
    await mount();
    expect(container?.querySelector('[data-testid="pet-manager-ledger-level"]')?.textContent).toBe(
      'Level 3',
    );
    expect(container?.querySelector('[data-testid="pet-manager-ledger-title"]')?.textContent).toBe(
      'social',
    );
    const fill = container?.querySelector<HTMLElement>('[data-testid="pet-manager-ledger-xp-fill"]');
    expect(fill?.style.width).toBe('13%');
    expect(
      container?.querySelector('[data-testid="pet-manager-ledger-xp-text"]')?.textContent,
    ).toBe('20 / 150 XP');
    expect(container?.querySelector('[data-testid="pet-manager-ledger-stats"]')?.textContent).toContain('7');
    expect(container?.querySelector('[data-testid="pet-manager-ledger-memory"]')?.textContent).toContain(
      'Completed task (no. 7)',
    );
    expect(readLedgerState).toHaveBeenCalledWith(window.localStorage);
  });

  it('falls back to the no-title copy when the model has no title', async () => {
    summarizeLedger.mockReturnValue(fakeModel({ titleId: null }));
    await mount();
    expect(container?.querySelector('[data-testid="pet-manager-ledger-title"]')?.textContent).toBe(
      'No title yet',
    );
  });

  it('renders the empty-memory copy for an empty ring', async () => {
    summarizeLedger.mockReturnValue(fakeModel({ memory: [] }));
    await mount();
    expect(
      container?.querySelector('[data-testid="pet-manager-ledger-memory-empty"]')?.textContent,
    ).toBe('No memories yet');
  });

  it('re-reads on a storage event for the ledger key (right area), not for foreign keys', async () => {
    await mount();
    expect(readLedgerState).toHaveBeenCalledTimes(1);

    fireStorage('some-other-key');
    fireStorage(LEDGER_KEY, null); // wrong storageArea
    await act(async () => {});
    expect(readLedgerState).toHaveBeenCalledTimes(1); // still just the load

    summarizeLedger.mockReturnValue(fakeModel({ level: 4, titleId: 'helper' }));
    await act(async () => {
      fireStorage(LEDGER_KEY);
    });
    await flush();
    expect(readLedgerState).toHaveBeenCalledTimes(2);
    expect(summarizeLedger).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-testid="pet-manager-ledger-level"]')?.textContent).toBe(
      'Level 4',
    );
    expect(container?.querySelector('[data-testid="pet-manager-ledger-title"]')?.textContent).toBe(
      'helper',
    );
  });
});

describe('LedgerPanel — trimmed/absent ledger (task 8.2 degradation)', () => {
  it('renders the honest unavailable card and no ledger body', async () => {
    await mount(rejectingInspect);
    const card = container?.querySelector('[data-testid="pet-manager-ledger-unavailable"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Growth ledger unavailable');
    // The populated body must NOT be present — no level chip, no stats.
    expect(container?.querySelector('[data-testid="pet-manager-ledger-body"]')).toBeNull();
    expect(container?.querySelector('[data-testid="pet-manager-ledger-level"]')).toBeNull();
  });

  it('renders the zh unavailable card verbatim (verify-trim required string)', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () => {
      r.render(
        createElement(LedgerPanel, { strings: pageStrings('zh'), loadInspect: rejectingInspect }),
      );
    });
    await flush();
    expect(
      c.querySelector('[data-testid="pet-manager-ledger-unavailable"]')?.textContent,
    ).toContain('成长账本不可用（已被裁剪）');
    await act(async () => {
      r.unmount();
    });
    c.remove();
  });

  it('stays degraded across a storage event for the (unknown) ledger key', async () => {
    await mount(rejectingInspect);
    await act(async () => {
      fireStorage(LEDGER_KEY);
    });
    await flush();
    expect(container?.querySelector('[data-testid="pet-manager-ledger-unavailable"]')).not.toBeNull();
    expect(readLedgerState).not.toHaveBeenCalled();
  });
});
