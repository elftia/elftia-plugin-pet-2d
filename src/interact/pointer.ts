/**
 * src/interact/pointer.ts — D12's drag handshake, hit-test-gated:
 *
 *   pointerdown on an OPAQUE pixel (D6 alpha mask)  → arm
 *   first pointermove past 6 px                     → setPointerCapture(true)
 *                                                     + startDrag() + local `drag`
 *   pointerup / pointercancel                        → release capture,
 *                                                     set `dropBuffer`, done
 *
 * The plugin NEVER computes or requests a window position — `startDrag()`
 * is a signal; the host owns the native drag loop, and because the window
 * follows the cursor it keeps receiving events by construction. A click on
 * an opaque pixel with no drag does nothing (feeding/play come from the
 * menu, not a tap — whale-girl's tap-to-feed reads as a bug when the pet
 * happens to stand over a button you were aiming at).
 *
 * All host verbs go through an injected optional `petRuntime` — with the
 * member absent (F5) the pet still tracks its own drag state, it just
 * cannot ask the host to move anything, which is fine because it never
 * asks anyway.
 */
import type { PetState } from '../contract/petState';
import type { HitTest } from '../render/hitTest';

/** Task 7.3: armed-drag activation threshold. */
export const DRAG_THRESHOLD_PX = 6;

/** What the controller needs to hit-test the CURRENT frame (updated by pet.ts). */
export interface RenderContext {
  readonly state: PetState;
  readonly frame: number;
  readonly stagePx: number;
}

/** The narrow host surface this module touches (both optional-host safe). */
export interface PointerPetRuntime {
  setPointerCapture(inside: boolean): void;
  startDrag(): void;
}

export interface PointerLocalState {
  readonly dragging: boolean;
  readonly dragReleasedAt: number | null;
  readonly lastInteractionAt: number;
}

export interface PointerController {
  /** pet.ts calls this whenever the on-screen state or frame changes. */
  setRenderContext(context: RenderContext): void;
  /** Stage-relative pointer events (attachPointerHandlers converts DOM events). */
  pointerdown(stageX: number, stageY: number): void;
  pointermove(stageX: number, stageY: number): void;
  pointerup(): void;
  pointercancel(): void;
  /** The slice pet.ts merges into sense.ts's LocalState. */
  getLocalState(): PointerLocalState;
}

export function createPointerController(options: {
  hitTest: HitTest;
  petRuntime?: PointerPetRuntime;
  now: () => number;
  /** Fired once per completed drag (pet.ts: ledger noteInteraction). */
  onDragEnd?: () => void;
  /**
   * Fired when a pointerdown lands on an opaque pixel (pet.ts: the wake
   * trigger — touching a sleeping pet wakes it; a tap on an ALREADY awake
   * pet is intentionally nothing, D12).
   */
  onOpaqueDown?: () => void;
}): PointerController {
  const { hitTest, petRuntime, now } = options;

  let context: RenderContext = { state: 'idle', frame: 0, stagePx: 0 };
  let armed: { x: number; y: number } | null = null;
  let dragging = false;
  let dragReleasedAt: number | null = null;
  let lastInteractionAt = now();
  // Guards the async hit test: a down whose resolution arrives after the
  // gesture already ended (or was superseded) must not arm retroactively.
  let downGeneration = 0;

  function tryStartDrag(): void {
    armed = null;
    dragging = true;
    lastInteractionAt = now();
    petRuntime?.setPointerCapture(true); // asserted only while the gesture is live (D12)
    petRuntime?.startDrag();
  }

  function endDrag(): void {
    armed = null;
    if (!dragging) return;
    dragging = false;
    dragReleasedAt = now();
    lastInteractionAt = now();
    petRuntime?.setPointerCapture(false);
    options.onDragEnd?.();
  }

  return {
    setRenderContext(next) {
      context = next;
    },
    pointerdown(stageX, stageY) {
      downGeneration += 1;
      const generation = downGeneration;
      void hitTest
        .isOpaqueAt(context.state, context.frame, stageX, stageY, context.stagePx)
        .then((opaque) => {
          if (generation !== downGeneration) return; // superseded
          if (!opaque || dragging) return;
          armed = { x: stageX, y: stageY };
          lastInteractionAt = now();
          options.onOpaqueDown?.();
        })
        // A hit-test failure (image load, no 2D canvas) degrades to "not
        // opaque" — the gesture simply never arms; never an unhandled
        // rejection from a pointer event.
        .catch(() => undefined);
    },
    pointermove(stageX, stageY) {
      if (dragging) {
        lastInteractionAt = now();
        return;
      }
      if (armed === null) return;
      const dx = stageX - armed.x;
      const dy = stageY - armed.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        tryStartDrag();
      }
    },
    // Bumping the generation invalidates any hit-test probe still in
    // flight: a down that resolves after its gesture already ended (up/
    // cancel observed first) must not arm retroactively.
    pointerup() {
      downGeneration += 1;
      endDrag();
    },
    pointercancel() {
      downGeneration += 1;
      endDrag();
    },
    getLocalState() {
      return { dragging, dragReleasedAt, lastInteractionAt };
    },
  };
}

/**
 * The DOM wiring: stage-relative coordinate conversion + event dispatch to
 * the controller. Kept separate from the logic so tests drive the controller
 * with plain numbers and this stays a three-line adapter per event.
 */
export function attachPointerHandlers(
  el: HTMLElement,
  controller: PointerController
): () => void {
  const toStage = (event: PointerEvent | MouseEvent): { x: number; y: number } => {
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onDown = (event: PointerEvent): void => {
    const { x, y } = toStage(event);
    controller.pointerdown(x, y);
  };
  const onMove = (event: PointerEvent): void => {
    const { x, y } = toStage(event);
    controller.pointermove(x, y);
  };
  const onUp = (): void => controller.pointerup();
  const onCancel = (): void => controller.pointercancel();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
