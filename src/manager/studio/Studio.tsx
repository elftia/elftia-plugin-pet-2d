/**
 * src/manager/studio/Studio.tsx — the Pack Studio orchestrator (D7's
 * six-step authoring flow): ① pick a source folder (`packs:pickSourceDir` →
 * `packs:catalog`), ② the 15-state slot grid, ③ meta, ④ the live preview +
 * problem list (`validateCharacterPack` over the draft + the catalog's
 * MEASURED dimensions — the same gate the save pipeline runs), ⑤ save
 * (`packs:save` → `notifyPacksChanged`, so the Gallery refetches through the
 * same-window channel), ⑥ export (.petpack via `packs:export`).
 *
 * The whale-girl offer (D8): when the catalog detects a registry-form
 * manifest, each character gets an auto-fill button — `fromWhaleGirlManifest`
 * prefills the draft and the ACTIVE source dir switches to the character's
 * own sheet dir, so every later verb (preview, save) needs no changes.
 * The rights caveat rides the offer (MIT covers the software, not the art).
 */
import { useEffect, useRef, useState } from 'react';

import { validateCharacterPack } from '../../contract/characterPack';
import { PET_STATES, type PetState } from '../../contract/petState';
import type { PageStrings } from '../../interact/locale';
import type { PackIpc } from '../../packs/userPacks';
import { notifyPacksChanged } from '../../packs/userPacks';
import { fromWhaleGirlManifest } from '../../packs/whaleGirlCompat';
import {
  copyIdleToUnassigned,
  draftFromManifest,
  draftToManifest,
  emptyDraft,
  measuredFromFiles,
  normalizeSlot,
  parseCatalogResult,
  type StudioCatalogFile,
  type StudioDraft,
  type StudioWhaleGirlCharacter,
} from './draft';
import { MetaForm } from './MetaForm';
import { StateSlotGrid } from './StateSlotGrid';
import { StudioPreview } from './StudioPreview';

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'collision' }
  | { readonly kind: 'failed'; readonly problems: readonly string[] }
  | { readonly kind: 'saved'; readonly id: string };

export function Studio(props: {
  strings: PageStrings;
  ipc: PackIpc | null;
  onExit: () => void;
}) {
  const { strings, ipc } = props;
  const s = strings.studio;
  const [draft, setDraft] = useState(() => emptyDraft());
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [activeFiles, setActiveFiles] = useState<readonly StudioCatalogFile[]>([]);
  const [offer, setOffer] = useState<readonly StudioWhaleGirlCharacter[] | null>(null);
  const [offerManifest, setOfferManifest] = useState<unknown>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PetState>('idle');
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [exportPath, setExportPath] = useState<string | null>(null);
  const previewCache = useRef(new Map<string, string>());

  /** Any draft edit invalidates a completed save — the installed pack is
   *  now the OLD draft, so the saved/export chrome steps back to idle. */
  function updateDraft(next: StudioDraft): void {
    setDraft(next);
    setSaveState({ kind: 'idle' });
    setExportPath(null);
  }

  async function pickSourceDir(): Promise<void> {
    if (ipc === null) return;
    try {
      const picked = (await ipc.invoke('packs:pickSourceDir', {})) as { dir?: unknown };
      if (typeof picked?.dir !== 'string') return; // canceled/unavailable
      const result = parseCatalogResult(await ipc.invoke('packs:catalog', { dir: picked.dir }));
      if (result === null) {
        setFillError(`cannot catalog "${picked.dir}"`);
        return;
      }
      setFillError(null);
      setActiveDir(result.dir);
      setActiveFiles(result.files);
      setOffer(result.whaleGirl?.characters ?? null);
      setOfferManifest(result.whaleGirl?.manifest ?? null);
    } catch (error) {
      setFillError(error instanceof Error ? error.message : String(error));
    }
  }

  function acceptWhaleGirl(character: StudioWhaleGirlCharacter): void {
    try {
      updateDraft(draftFromManifest(fromWhaleGirlManifest(offerManifest, character.id)));
      setActiveDir(character.dir);
      setActiveFiles(character.files);
      setFillError(null);
    } catch (error) {
      setFillError(error instanceof Error ? error.message : String(error));
    }
  }

  const problems =
    activeDir === null ? [] : validateCharacterPack(draftToManifest(draft), measuredFromFiles(activeFiles));
  const previewSheet = draft.states[previewState].sheet;

  // Lazy one-file preview fetch (D7.4): bytes cross only for the state being
  // looked at, cached per (dir, sheet).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (ipc === null || activeDir === null || previewSheet === '') {
      setPreviewUrl(null);
      return;
    }
    const key = `${activeDir}|${previewSheet}`;
    const cached = previewCache.current.get(key);
    if (cached !== undefined) {
      setPreviewUrl(cached);
      return;
    }
    setPreviewUrl(null);
    void ipc
      .invoke('packs:previewFile', { dir: activeDir, name: previewSheet })
      .then((result) => {
        const dataUri = (result as { dataUri?: unknown } | null)?.dataUri;
        if (alive && typeof dataUri === 'string' && dataUri !== '') {
          previewCache.current.set(key, dataUri);
          setPreviewUrl(dataUri);
        }
      })
      .catch(() => {
        /* best-effort: the stage shows the empty frame */
      });
    return () => {
      alive = false;
    };
  }, [ipc, activeDir, previewSheet]);

  async function runSave(overwrite: boolean): Promise<void> {
    if (ipc === null || activeDir === null) return;
    try {
      const result = (await ipc.invoke('packs:save', {
        dir: activeDir,
        manifest: draftToManifest(draft),
        overwrite,
      })) as { ok?: unknown; id?: unknown; problems?: unknown };
      if (result?.ok === true && typeof result.id === 'string') {
        setSaveState({ kind: 'saved', id: result.id });
        setExportPath(null);
        notifyPacksChanged(window);
        return;
      }
      const raw = Array.isArray(result?.problems) ? result.problems.map(String) : ['packs:save failed'];
      // Collision detection is STRUCTURED (fix-round F5): the store stamps
      // `code: 'already-installed'` on the overwrite-missing reject — the
      // human-readable message text is never parsed for control flow.
      setSaveState(
        (result as { code?: unknown } | null)?.code === 'already-installed'
          ? { kind: 'collision' }
          : { kind: 'failed', problems: raw },
      );
    } catch (error) {
      setSaveState({ kind: 'failed', problems: [error instanceof Error ? error.message : String(error)] });
    }
  }

  async function runExport(): Promise<void> {
    if (ipc === null || saveState.kind !== 'saved') return;
    try {
      const result = (await ipc.invoke('packs:export', { id: saveState.id })) as {
        ok?: unknown;
        path?: unknown;
      };
      if (result?.ok === true && typeof result.path === 'string') setExportPath(result.path);
    } catch {
      /* canceled or failed — no note */
    }
  }

  return (
    <div data-testid="pet-manager-studio" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="pet-manager-studio-back"
          className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2"
          onClick={props.onExit}
        >
          {s.backAction}
        </button>
      </div>

      {ipc === null ? (
        <div
          data-testid="pet-manager-studio-unavailable"
          className="rounded-xl border border-border/30 bg-surface-1/80 p-4 text-sm text-foreground"
        >
          <p className="font-semibold">{s.unavailableTitle}</p>
          <p className="mt-1 text-xs text-text-muted">{s.unavailableBody}</p>
        </div>
      ) : (
        <>
          {/* ① Source */}
          <section data-testid="pet-manager-studio-source" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">{s.sourceTitle}</h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="pet-manager-studio-pick-dir"
                className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2"
                onClick={() => {
                  void pickSourceDir();
                }}
              >
                {s.pickSourceDir}
              </button>
              {activeDir !== null ? (
                <span
                  data-testid="pet-manager-studio-dir-label"
                  className="text-xs text-text-muted"
                >
                  {s.sourceDirCaption
                    .replace('{dir}', activeDir)
                    .replace(
                      '{count}',
                      String(activeFiles.filter((f) => /\.(png|svg)$/i.test(f.name)).length),
                    )}
                </span>
              ) : null}
            </div>
            {fillError !== null ? (
              <p data-testid="pet-manager-studio-fill-error" className="text-xs text-red-500">
                {fillError}
              </p>
            ) : null}
            {offer !== null && offer.length > 0 ? (
              <div
                data-testid="pet-manager-studio-wg-offer"
                className="rounded-lg border border-border/30 bg-surface-1/80 p-3"
              >
                <p className="text-xs font-semibold text-foreground">{s.whaleGirlTitle}</p>
                <p className="mt-1 text-xs text-text-muted">{s.whaleGirlRights}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {offer.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      data-testid={`pet-manager-studio-wg-offer-${character.id}`}
                      className="rounded-md border border-border/40 px-2 py-1 text-xs text-foreground hover:bg-surface-2"
                      onClick={() => {
                        acceptWhaleGirl(character);
                      }}
                    >
                      {s.whaleGirlFill.replace('{name}', character.name)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {activeDir !== null ? (
            <>
              <StateSlotGrid
                strings={s}
                draft={draft}
                files={activeFiles}
                onSlotChange={(state, slot) =>
                  updateDraft({ ...draft, states: { ...draft.states, [state]: normalizeSlot(state, slot) } })
                }
                onCopyIdle={() => updateDraft(copyIdleToUnassigned(draft))}
              />
              <MetaForm
                strings={s}
                draft={draft}
                onChange={(patch) => updateDraft({ ...draft, ...patch })}
              />

              {/* ④ Preview + problems */}
              <section data-testid="pet-manager-studio-preview-section" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">{s.previewTitle}</h3>
                <div className="flex items-start gap-4">
                  <div className="flex flex-col gap-1">
                    <StudioPreview slot={draft.states[previewState]} sheetUrl={previewUrl} />
                    <select
                      data-testid="pet-manager-studio-preview-state"
                      className="rounded-md border border-border/40 bg-surface-1 px-1 py-0.5 text-xs text-foreground"
                      value={previewState}
                      onChange={(event) => setPreviewState(event.target.value as PetState)}
                    >
                      {PET_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">{s.problemsTitle}</p>
                    <ul
                      data-testid="pet-manager-studio-problems"
                      data-count={problems.length}
                      className="mt-1 list-disc pl-4 text-xs text-text-muted"
                    >
                      {problems.length === 0 ? (
                        <li>{s.problemsNone}</li>
                      ) : (
                        problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* ⑤⑥ Save + export */}
              <section className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="pet-manager-studio-save"
                    disabled={problems.length > 0}
                    className="rounded-md border border-border/40 px-3 py-1 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50"
                    onClick={() => {
                      void runSave(false);
                    }}
                  >
                    {s.saveAction}
                  </button>
                  {saveState.kind === 'collision' ? (
                    <button
                      type="button"
                      data-testid="pet-manager-studio-overwrite"
                      className="rounded-md border border-border/40 px-3 py-1 text-xs text-foreground hover:bg-surface-2"
                      onClick={() => {
                        void runSave(true);
                      }}
                    >
                      {s.overwriteAction}
                    </button>
                  ) : null}
                </div>
                {saveState.kind === 'failed' ? (
                  <ul data-testid="pet-manager-studio-save-problems" className="list-disc pl-4 text-xs text-red-500">
                    {saveState.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                ) : null}
                {saveState.kind === 'saved' ? (
                  <div className="flex flex-col gap-2">
                    <p data-testid="pet-manager-studio-saved-note" className="text-xs text-foreground">
                      {s.savedNote.replace('{id}', saveState.id)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="pet-manager-studio-export"
                        className="rounded-md border border-border/40 px-3 py-1 text-xs text-foreground hover:bg-surface-2"
                        onClick={() => {
                          void runExport();
                        }}
                      >
                        {s.exportAction}
                      </button>
                      {exportPath !== null ? (
                        <span data-testid="pet-manager-studio-export-note" className="text-xs text-text-muted">
                          {strings.exportDoneNote.replace('{path}', exportPath)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
