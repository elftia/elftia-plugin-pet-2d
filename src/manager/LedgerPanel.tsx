/**
 * src/manager/LedgerPanel.tsx — section 5's body (task 8.2, D6⑤): the
 * growth-ledger readout behind ONE guarded dynamic import of
 * `src/ledger/inspect.ts` — the same seam shape pet.ts uses for
 * `createLedger` (one import site; a test/`verify:trim` may swap the
 * loader). The ledger is claimed deletable (D10); this panel is the proof
 * on the page side: when the module is absent (a trimmed build) or ANY
 * step of the seam fails, the honest「成长账本不可用（已被裁剪）」
 * card renders — never a blank, never a throw.
 *
 * Data flow: the PET WINDOW's ledger writes
 * `localStorage['elftia-pet-2d:ledger:v1']` (debounced <= 1 s); this page
 * re-reads on every `storage` event for that key, so the panel is live to
 * within one debounce window. The key itself comes from the loaded module
 * (never hardcoded — a hardcoded literal would survive the trim and defeat
 * verify-trim's forbidden-symbol assertion), so events are only filtered
 * once the seam has loaded; before that the load itself is the read.
 *
 * All types at the seam are structural (the model comes from the contract
 * tree, which survives the trim) so the trimmed build still typechecks.
 */
import { useEffect, useState } from 'react';

import type { LedgerPanelModel } from '../contract/ledgerPort';
import type { PageStrings } from '../interact/locale';
import { safeLocalStorage } from '../state/safeStorage';

/** What the seam must yield — a structural subset of `ledger/inspect.ts`. */
export interface LedgerInspectModule {
  readLedgerState(storage: Pick<Storage, 'getItem'>): unknown;
  summarizeLedger(state: unknown, now?: number): LedgerPanelModel;
  readonly LEDGER_STORAGE_KEY: string;
}

/** The ONE dynamic-import site (module-level so its identity is stable). */
const defaultLoadInspect = (): Promise<LedgerInspectModule> => import('../ledger/inspect');

type PanelView =
  | { status: 'loading' }
  | { status: 'ready'; model: LedgerPanelModel }
  | { status: 'unavailable' };

export function LedgerPanel(props: { strings: PageStrings; loadInspect?: () => Promise<LedgerInspectModule> }) {
  const { strings } = props;
  const loadInspect = props.loadInspect ?? defaultLoadInspect;
  const [view, setView] = useState<PanelView>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let ledgerKey: string | null = null;

    async function load(): Promise<void> {
      try {
        const inspect = await loadInspect();
        ledgerKey = inspect.LEDGER_STORAGE_KEY;
        const model = inspect.summarizeLedger(inspect.readLedgerState(safeLocalStorage()));
        if (!cancelled) setView({ status: 'ready', model });
      } catch {
        // Absent module (trimmed build), rejected import, or a throwing
        // seam — all degrade to the honest card. readLedgerState itself
        // never throws by contract; this guards the rest.
        if (!cancelled) setView({ status: 'unavailable' });
      }
    }
    void load();

    // Live refresh: the pet window's ledger persists on its own debounce;
    // the browser's `storage` event (never fired in the writing window)
    // tells THIS window to re-read. Filtered by the key the loaded module
    // provided — before the seam loads there is nothing to refresh.
    const onLedgerStorage = (event: StorageEvent): void => {
      if (ledgerKey === null) return;
      if (event.key !== ledgerKey) return;
      if (event.storageArea !== safeLocalStorage()) return;
      void load();
    };
    window.addEventListener('storage', onLedgerStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onLedgerStorage);
    };
  }, [loadInspect]);

  if (view.status === 'loading') {
    return <p className="text-xs text-muted-foreground">{strings.sectionPlaceholder}</p>;
  }

  if (view.status === 'unavailable') {
    return (
      <div
        data-testid="pet-manager-ledger-unavailable"
        className="rounded-xl border border-border/30 bg-surface-2/60 p-4 dark:border-border/50"
      >
        <p className="text-sm font-medium text-foreground">{strings.ledgerUnavailableTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{strings.ledgerUnavailableBody}</p>
      </div>
    );
  }

  const { model } = view;
  const stats: ReadonlyArray<[label: string, value: string]> = [
    [strings.ledgerStatTasks, String(model.stats.tasksDone)],
    [strings.ledgerStatFailures, String(model.stats.failures)],
    [strings.ledgerStatTurns, String(model.stats.turns)],
    [strings.ledgerStatMediaJobs, String(model.stats.mediaJobs)],
    [strings.ledgerStatActive, model.activeHuman],
  ];

  return (
    <div data-testid="pet-manager-ledger-body" className="flex flex-col gap-3">
      {/* Level + title + XP bar (D6⑤). The fill's width is inline (percent
          data, not a Tailwind class); its color rides the host theme token
          directly — a class like bg-primary is not in this page's attested
          host-CSS envelope. */}
      <div className="flex items-center gap-3">
        <span
          data-testid="pet-manager-ledger-level"
          className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {strings.ledgerLevelLabel} {model.level}
        </span>
        <span
          data-testid="pet-manager-ledger-title"
          className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
        >
          {model.titleId ?? strings.ledgerNoTitle}
        </span>
      </div>
      <div
        data-testid="pet-manager-ledger-xp-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={model.progressPct}
        className="h-2 overflow-hidden rounded-md bg-surface-2"
      >
        <div
          data-testid="pet-manager-ledger-xp-fill"
          className="h-full"
          style={{ width: `${model.progressPct}%`, backgroundColor: 'var(--primary)' }}
        />
      </div>
      <p data-testid="pet-manager-ledger-xp-text" className="text-xs text-muted-foreground">
        {model.xpIntoLevel} / {model.xpForNextLevel} XP
      </p>

      {/* Stats row. */}
      <div data-testid="pet-manager-ledger-stats" className="flex flex-wrap gap-3">
        {stats.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col rounded-md border border-border/20 bg-surface-1/80 px-3 py-2 dark:border-border/40"
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            <span data-testid={`pet-manager-ledger-stat-${label}`} className="text-sm text-foreground">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* The 8-entry memory ring, newest first, with relative timestamps. */}
      <div>
        <p className="mb-1 text-xs font-medium text-foreground">{strings.ledgerMemoryTitle}</p>
        {model.memory.length === 0 ? (
          <p data-testid="pet-manager-ledger-memory-empty" className="text-xs text-muted-foreground">
            {strings.ledgerMemoryEmpty}
          </p>
        ) : (
          <ul data-testid="pet-manager-ledger-memory" className="flex flex-col gap-1">
            {model.memory.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                data-testid={`pet-manager-ledger-memory-item-${index}`}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="text-foreground">{entry.text}</span>
                <span>{entry.relative}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
