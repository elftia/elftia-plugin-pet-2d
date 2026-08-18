/**
 * src/manager/Gallery.tsx — section 4's body (task 6.1/6.2): one PackCard per
 * `PACK_IDS`, the selection ringed. Selection WRITES through
 * `src/state/prefs.ts`'s own store (`createPrefsStore`) — the same module the
 * pet window reads, the same storage key, the same debounce; there is no
 * parallel writer anywhere on the page. The optimistic `setSelected` mirrors
 * the store's in-memory read (`setPackId` updates it synchronously), so the
 * ring and the persisted truth can only diverge if the write itself throws —
 * which `writePrefsNow` swallows by contract (quota failures must never
 * surface in the pet UI).
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
import { useEffect, useState } from 'react';

import type { PageStrings } from '../interact/locale';
import { DEFAULT_PACK_ID, PACK_IDS } from '../packs/registry';
import {
  createPrefsStore,
  PREFS_STORAGE_KEY,
  type PrefsStore,
  readPrefs,
} from '../state/prefs';
import { PackCard } from './PackCard';

export function Gallery(props: { strings: PageStrings }) {
  const { strings } = props;
  const [store] = useState<PrefsStore>(() => createPrefsStore());
  const [selected, setSelected] = useState<string>(() => store.read().packId ?? DEFAULT_PACK_ID);

  // Task 7.2 — the symmetric half of the bridge: the pet window's context
  // menu (switchCharacter rotation) writes the SAME key, and the browser's
  // `storage` event lands HERE (never in the writing window). Re-read
  // through the same store so the ring tracks the pet's live choice.
  useEffect(() => {
    const onPrefsStorage = (event: StorageEvent): void => {
      if (event.key !== PREFS_STORAGE_KEY) return;
      if (event.storageArea !== window.localStorage) return;
      setSelected(readPrefs(window.localStorage).packId ?? DEFAULT_PACK_ID);
    };
    window.addEventListener('storage', onPrefsStorage);
    return () => window.removeEventListener('storage', onPrefsStorage);
  }, []);

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
      {PACK_IDS.map((id) => (
        <PackCard
          key={id}
          id={id}
          strings={strings}
          selected={selected === id}
          onSelect={(next) => {
            // Same module, same key, same debounce as the pet window's writer.
            store.setPackId(next);
            setSelected(next);
          }}
        />
      ))}
    </div>
  );
}
