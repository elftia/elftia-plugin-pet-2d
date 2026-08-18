/**
 * src/manager/PackCard.tsx — one gallery card (task 6.1; group 5 widens it to
 * the two runtimes). The preview is the pack's `idle` sheet stepped by the
 * SAME pure math the pet window uses — `frameAt` for the frame index,
 * `backgroundSizeFor`/`backgroundPositionFor` for the strip geometry — at a
 * fixed 128px stage instead of the window-derived one. The clock is a
 * `setTimeout` chain at the slot's fps (the player.ts D13 decision: never
 * rAF; a backgrounded main window must not freeze previews). `data-frame`
 * mirrors the showing frame so tests (and probes) can observe stepping
 * without reading computed styles.
 *
 * Loading is `resolvePack(id, {ipc})` (D6's dispatch: built-in module pack |
 * user ipc pack | fallback glyph) — the SAME resolver the pet window routes
 * through, importer/ipc injectable only so tests can drive it. Its
 * never-throw contract is the card's never-blank guarantee — any failure
 * degrades to the fallback glyph pack, marked `data-fallback="true"`.
 * User cards add the "用户包" chip and (group 5.3) export/delete actions,
 * rendered in a SIBLING row below the select button (nested buttons are
 * invalid HTML and bubble clicks into selection).
 */
import { useEffect, useState } from 'react';

import { PET_STATES } from '../contract/petState';
import type { PageStrings } from '../interact/locale';
import { type CharacterPack, FALLBACK_PACK_ID } from '../packs/loadPack';
import { resolvePack,type ResolvePackDeps } from '../packs/userPacks';
import { frameAt } from '../render/player';
import { backgroundPositionFor, backgroundSizeFor } from '../render/sheetGeometry';

/** The preview stage edge (D6④: cards preview at ~128px). */
export const PACK_PREVIEW_PX = 128;

export function PackCard(props: {
  id: string;
  strings: PageStrings;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Which runtime this card represents (group 5: user cards get actions). */
  kind?: 'builtin' | 'user';
  /** User-card actions (rendered only for kind:'user'). */
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Test seam only — resolvePack deps (production uses the plugin importer
   *  and the page's scoped ipc). */
  deps?: ResolvePackDeps;
}) {
  const { id, strings, selected, onSelect, kind = 'builtin', onExport, onDelete, deps } = props;
  const [pack, setPack] = useState<CharacterPack | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void resolvePack(id, deps ?? {}).then((loaded) => {
      if (alive) setPack(loaded);
    });
    return () => {
      alive = false;
    };
  }, [id, deps]);

  useEffect(() => {
    if (pack === null) return;
    const slot = pack.manifest.states.idle;
    const intervalMs = 1000 / slot.fps;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const step = (): void => {
      setTick((t) => t + 1);
      handle = setTimeout(step, intervalMs);
    };
    handle = setTimeout(step, intervalMs);
    return () => {
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [pack]);

  const slot = pack?.manifest.states.idle ?? null;
  // Blink previews need a blinkTick driver — frameAt rests on 0 with a null
  // one, and both shipped packs' idle slots are `playback: 'blink'`. The
  // pet window drives blinks from brain/rhythm's nextBlinkAt; a card gets a
  // deterministic cycle instead: rest 3 blink-periods, then one pingpong
  // blink (the same 0..N-1..0 walk frameAt already defines).
  let frame = 0;
  if (slot !== null) {
    const blinkPeriod = 2 * Math.max(2, slot.frames) - 2;
    const cycle = 4 * blinkPeriod; // 3 rest periods + 1 blink walk
    const phase = tick % cycle;
    const blinkTick =
      slot.playback === 'blink' && phase >= 3 * blinkPeriod ? phase - 3 * blinkPeriod : null;
    frame = frameAt(slot.playback, slot.frames, tick, blinkTick);
  }
  const isFallback = pack !== null && pack.manifest.id === FALLBACK_PACK_ID;

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        data-testid={`pet-manager-pack-card-${id}`}
        data-selected={selected ? 'true' : 'false'}
        data-fallback={isFallback ? 'true' : 'false'}
        aria-pressed={selected}
        onClick={() => {
          onSelect(id);
        }}
        className={
          'flex min-w-0 flex-col items-center gap-2 rounded-xl border p-3 text-left ' +
          (selected ? 'border-border/60 bg-surface-2 dark:border-border' : 'border-border/30 bg-surface-1/80 dark:border-border/50')
        }
      >
        <div
          data-testid={`pet-manager-pack-preview-${id}`}
          data-frame={frame}
          className="shrink-0 rounded-lg"
          style={
            pack !== null && slot !== null
              ? {
                  width: `${PACK_PREVIEW_PX}px`,
                  height: `${PACK_PREVIEW_PX}px`,
                  backgroundImage: `url("${pack.sheets.idle.url}")`,
                  backgroundSize: backgroundSizeFor(slot.frames, PACK_PREVIEW_PX),
                  backgroundPosition: backgroundPositionFor(frame, PACK_PREVIEW_PX),
                  backgroundRepeat: 'no-repeat',
                }
              : { width: `${PACK_PREVIEW_PX}px`, height: `${PACK_PREVIEW_PX}px` }
          }
        />
        <div className="flex min-w-0 flex-col items-center gap-0.5">
          <span className="max-w-full truncate text-sm text-foreground">
            {pack?.manifest.name ?? id}
          </span>
          <span className="max-w-full truncate text-xs text-muted-foreground">
            {pack !== null
              ? `${pack.manifest.credit} · ${pack.manifest.license} · ${strings.cardStatesCaption.replace(
                  '{count}',
                  String(PET_STATES.length),
                )}`
              : strings.sectionPlaceholder}
          </span>
          <span className="flex items-center gap-1">
            {kind === 'user' ? (
              <span
                data-testid={`pet-manager-pack-user-chip-${id}`}
                className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
              >
                {strings.userPackChip}
              </span>
            ) : null}
            {selected ? (
              <span
                data-testid={`pet-manager-pack-selected-badge-${id}`}
                className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-text-muted"
              >
                {strings.cardSelectedBadge}
              </span>
            ) : null}
          </span>
        </div>
      </button>
      {kind === 'user' ? (
        <div className="mt-1 flex items-center justify-center gap-2">
          <button
            type="button"
            data-testid={`pet-manager-pack-export-${id}`}
            className="rounded-md border border-border/40 px-2 py-0.5 text-xs text-foreground"
            onClick={() => {
              onExport?.(id);
            }}
          >
            {strings.packExportAction}
          </button>
          <button
            type="button"
            data-testid={`pet-manager-pack-delete-${id}`}
            className="rounded-md border border-border/40 px-2 py-0.5 text-xs text-foreground"
            onClick={() => {
              onDelete?.(id);
            }}
          >
            {strings.packDeleteAction}
          </button>
        </div>
      ) : null}
    </div>
  );
}
