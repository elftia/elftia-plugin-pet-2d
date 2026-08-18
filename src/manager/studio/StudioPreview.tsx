/**
 * src/manager/studio/StudioPreview.tsx — step 4's stage (D7.4): the
 * author's live look at ONE state's row. The frame math is the SAME pure
 * `frameAt`/`backgroundSizeFor`/`backgroundPositionFor` the pet window and
 * the gallery cards use, at the cards' 128px scale, stepped by a
 * `setTimeout` chain at the slot's fps (the D13 clock decision). Motion
 * previews ride `applyMotion` on a WRAPPER element — the same
 * wrapper-never-sprite discipline the stage uses — and blink previews pass
 * `blinkTick = tick` so the walk plays continuously instead of on the pet's
 * random 2–6 s rhythm (an author tuning a blink wants to SEE the blink).
 */
import { useEffect, useRef, useState } from 'react';

import { applyMotion, ensureMotionStyles } from '../../render/motion';
import { frameAt } from '../../render/player';
import { backgroundPositionFor, backgroundSizeFor } from '../../render/sheetGeometry';
import type { SlotDraft } from './draft';

export const STUDIO_PREVIEW_PX = 128;

export function StudioPreview(props: { slot: SlotDraft; sheetUrl: string | null }) {
  const { slot, sheetUrl } = props;
  const [tick, setTick] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // The tick chain (fps-bound; restarted whenever the row changes). The
  // handle is reassigned by every step so cleanup cancels the LIVE timer
  // (the PackCard chain pattern).
  useEffect(() => {
    setTick(0);
    const intervalMs = 1000 / Math.max(1, slot.fps);
    let handle: ReturnType<typeof setTimeout> | undefined;
    const step = (): void => {
      setTick((t) => t + 1);
      handle = setTimeout(step, intervalMs);
    };
    handle = setTimeout(step, intervalMs);
    return () => {
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [slot.fps, slot.sheet, slot.frames, slot.playback, slot.motion]);

  // Motion on the WRAPPER only (motion.ts discipline), styles injected once.
  useEffect(() => {
    ensureMotionStyles(document);
    if (wrapperRef.current !== null) applyMotion(wrapperRef.current, slot.motion);
  }, [slot.motion]);

  const frame = frameAt(slot.playback, slot.frames, tick, tick);
  const geometry =
    sheetUrl === null
      ? {}
      : {
          backgroundImage: `url("${sheetUrl}")`,
          backgroundSize: backgroundSizeFor(slot.frames, STUDIO_PREVIEW_PX),
          backgroundPosition: backgroundPositionFor(frame, STUDIO_PREVIEW_PX),
        };
  return (
    <div ref={wrapperRef} className="inline-block" data-testid="pet-manager-studio-preview-motion">
      <div
        data-testid="pet-manager-studio-preview"
        data-frame={frame}
        data-loaded={sheetUrl !== null ? 'true' : 'false'}
        className="rounded-md border border-border/40 bg-surface-2"
        style={{ width: `${STUDIO_PREVIEW_PX}px`, height: `${STUDIO_PREVIEW_PX}px`, ...geometry }}
      />
    </div>
  );
}
