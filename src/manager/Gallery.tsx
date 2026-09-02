/**
 * src/manager/Gallery.tsx — section 4's body (task 6.1/6.2 + group 5): one
 * PackCard per `PACK_IDS` (kind:'builtin') followed by one per USER pack
 * (kind:'user' — chip + export/delete actions), the selection ringed.
 * Selection WRITES through `src/state/prefs.ts`'s own store
 * (`createPrefsStore`) — the same module the pet window reads, the same
 * storage key, the same debounce; there is no parallel writer anywhere on
 * the page. The optimistic `setSelected` mirrors the store's in-memory read
 * (`setPackId` updates it synchronously), so the ring and the persisted
 * truth can only diverge if the write itself throws — which `writePrefsNow`
 * swallows by contract (quota failures must never surface in the pet UI).
 *
 * Group 5 — the user-pack surface:
 *   - the list comes from `refreshUserPacks(ipc, storage)` (mount + every
 *     change notification); ipc is the prop (test seam) or the loader-
 *     injected host's scoped ipc. null/absent ipc degrades to built-ins
 *     only — the page never crashes for a missing bridge.
 *   - DELETE rides `packs:delete`, then `notifyPacksChanged(window)` — the
 *     rev bump for the pet window + the in-window event (a `storage` event
 *     never fires in the writing window) that this component itself listens
 *     for and refetches on. When the deleted pack was the selected one the
 *     selection is repaired to the default BEFORE the refetch lands (a ring
 *     on a vanished card is a lie even for one frame).
 *   - EXPORT rides `packs:export` (path from payload or the save dialog;
 *     a cancel simply produces no note) and shows the transient done-note.
 *   - IMPORT (fix-round F2 — the share receive end) rides `packs:importFile`
 *     with NO path payload: the main half opens the host's file dialog, runs
 *     the full read ladder + install, and returns `{ok,id}` / problems /
 *     `{canceled}`. Success dispatches `notifyPacksChanged(window)` — the
 *     same lesson delete learned: a verb-driven store change must ride the
 *     product's own refresh channel or this list stays stale.
 *
 * The symmetric `storage` listener (task 7.2): a context-menu switch in the
 * pet window (while the page is open) moves the ring via the same key.
 *
 * The store's FLUSH contract — the same one pet.ts gives it in the pet
 * window: `pagehide` and visibilitychange→hidden both flush the debounce,
 * so a selection made right before the page hides is never lost to the
 * 500 ms window (hidden pages get their timers throttled; pagehide is the
 * last synchronous chance before unload).
 */
import { useCallback, useEffect, useState } from 'react';

import type { PageStrings } from '../interact/locale';
import { DEFAULT_PACK_ID, PACK_IDS } from '../packs/registry';
import {
  notifyPacksChanged,
  type PackIpc,
  PACKS_CHANGED_EVENT,
  PACKS_REV_KEY,
  refreshUserPacks,
  type UserPackSummary,
} from '../packs/userPacks';
import {
  createPrefsStore,
  PREFS_STORAGE_KEY,
  type PrefsStore,
  readPrefs,
} from '../state/prefs';
import { safeLocalStorage } from '../state/safeStorage';
import { getManagerHostOrNull } from './hostBridge';
import { HostedButton } from './hostedElements';
import { PackCard } from './PackCard';

export function Gallery(props: { strings: PageStrings; ipc?: PackIpc | null }) {
  const { strings } = props;
  const [store] = useState<PrefsStore>(() => createPrefsStore());
  const [selected, setSelected] = useState<string>(() => store.read().packId ?? DEFAULT_PACK_ID);
  // `props.ipc` is the test seam; production resolves through the bridge the
  // loader populated before the page ever rendered (hostBridge.ts). The
  // explicit-null case must STAY null (a test asserting the ipc-less
  // degrade), hence the ternary rather than `??`.
  const [ipc] = useState<PackIpc | null>(() =>
    props.ipc !== undefined ? props.ipc : getManagerHostOrNull()?.ipc ?? null,
  );
  const [userPacks, setUserPacks] = useState<UserPackSummary[]>([]);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const refetch = useCallback(async () => {
    setUserPacks(await refreshUserPacks(ipc, safeLocalStorage()));
  }, [ipc]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Both change channels converge here: the in-window PACKS_CHANGED_EVENT
  // (our own delete; group 6's studio save/import — a `storage` event never
  // fires in the writing window) and the cross-window PACKS_REV_KEY event
  // (another manager window's mutations; the pet window never mutates).
  useEffect(() => {
    const onChanged = (): void => {
      void refetch();
    };
    const onRevStorage = (event: StorageEvent): void => {
      if (event.key !== PACKS_REV_KEY) return;
      if (event.storageArea !== safeLocalStorage()) return;
      onChanged();
    };
    window.addEventListener(PACKS_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onRevStorage);
    return () => {
      window.removeEventListener(PACKS_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onRevStorage);
    };
  }, [refetch]);

  // Task 7.2 — the symmetric half of the bridge: the pet window's context
  // menu (switchCharacter rotation) writes the SAME key, and the browser's
  // `storage` event lands HERE (never in the writing window). Re-read
  // through the same store so the ring tracks the pet's live choice.
  useEffect(() => {
    const onPrefsStorage = (event: StorageEvent): void => {
      if (event.key !== PREFS_STORAGE_KEY) return;
      if (event.storageArea !== safeLocalStorage()) return;
      setSelected(readPrefs(safeLocalStorage()).packId ?? DEFAULT_PACK_ID);
    };
    window.addEventListener('storage', onPrefsStorage);
    return () => window.removeEventListener('storage', onPrefsStorage);
  }, []);

  const select = useCallback(
    (next: string): void => {
      // Same module, same key, same debounce as the pet window's writer.
      store.setPackId(next);
      setSelected(next);
    },
    [store],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (ipc === null) return;
      try {
        const result: unknown = await ipc.invoke('packs:delete', { id });
        if (
          typeof result !== 'object' ||
          result === null ||
          (result as { ok?: unknown }).ok !== true
        ) {
          return; // not installed / invalid id / store hiccup — keep the card
        }
      } catch {
        return;
      }
      if (selected === id) select(DEFAULT_PACK_ID);
      notifyPacksChanged(window); // rev for the pet window; in-window refetch
    },
    [ipc, select, selected],
  );

  const handleExport = useCallback(
    async (id: string): Promise<void> => {
      if (ipc === null) return;
      try {
        const result: unknown = await ipc.invoke('packs:export', { id });
        if (typeof result !== 'object' || result === null) return;
        const path = (result as { path?: unknown }).path;
        if (typeof path === 'string' && path !== '') setLastExport(path);
      } catch {
        // silent — export is a convenience action; a dialog cancel already
        // returns {canceled:true} (no path, no note)
      }
    },
    [ipc],
  );

  const handleImport = useCallback(async (): Promise<void> => {
    if (ipc === null || importBusy) return;
    setImportBusy(true);
    try {
      // No path payload: the main half opens the host's open dialog, then
      // runs the .petpack read ladder + the shared install pipeline.
      const result: unknown = await ipc.invoke('packs:importFile', {});
      const r = (typeof result === 'object' && result !== null ? result : {}) as {
        ok?: unknown;
        id?: unknown;
        problems?: unknown;
        canceled?: unknown;
      };
      if (r.ok === true && typeof r.id === 'string') {
        setImportNote(strings.importDoneNote.replace('{id}', r.id));
        notifyPacksChanged(window); // rev for the pet window; in-window refetch
        return;
      }
      if (r.canceled === true) return; // a dialog cancel is not an outcome
      const problem = Array.isArray(r.problems) && r.problems.length > 0 ? String(r.problems[0]) : 'packs:importFile failed';
      setImportNote(strings.importFailedNote.replace('{problem}', problem));
    } catch (error) {
      setImportNote(
        strings.importFailedNote.replace('{problem}', error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setImportBusy(false);
    }
  }, [ipc, importBusy, strings]);

  // The combined card list: built-ins first, then user ids that do not
  // shadow a built-in (a colliding id is the store's already-installed
  // builtin rename case — never a duplicate card here).
  const userCards = userPacks.filter((pack) => !PACK_IDS.includes(pack.id));

  // The flush half of pet.ts's own prefs contract (see the file header): a
  // selection still inside the 500 ms debounce when the page hides would
  // otherwise be lost — timers are throttled in hidden pages and pagehide is
  // the last synchronous moment before unload.
  useEffect(() => {
    const onPageHide = (): void => store.flush();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') store.flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [store]);

  return (
    <div data-testid="pet-manager-gallery-grid" className="flex flex-wrap gap-3">
      <div data-testid="pet-manager-gallery-actions" className="flex w-full items-center justify-end gap-3">
        <HostedButton
          type="button"
          data-testid="pet-manager-import"
          disabled={ipc === null || importBusy}
          className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50"
          onClick={() => {
            void handleImport();
          }}
        >
          {strings.importAction}
        </HostedButton>
        {importNote !== null ? (
          <span data-testid="pet-manager-import-note" className="text-xs text-text-muted">
            {importNote}
          </span>
        ) : null}
      </div>
      {PACK_IDS.map((id) => (
        <PackCard
          key={id}
          id={id}
          strings={strings}
          selected={selected === id}
          onSelect={select}
        />
      ))}
      {userCards.map((pack) => (
        <PackCard
          key={pack.id}
          id={pack.id}
          strings={strings}
          kind="user"
          selected={selected === pack.id}
          onSelect={select}
          onExport={(id) => {
            void handleExport(id);
          }}
          onDelete={(id) => {
            void handleDelete(id);
          }}
          deps={{ ipc }}
        />
      ))}
      {lastExport !== null ? (
        <p
          data-testid="pet-manager-gallery-export-note"
          className="w-full text-xs text-text-muted"
        >
          {strings.exportDoneNote.replace('{path}', lastExport)}
        </p>
      ) : null}
    </div>
  );
}
