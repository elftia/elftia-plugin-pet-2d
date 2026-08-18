/**
 * src/render/stage.ts — D6: the DOM owner. Mounts the layered stage into
 * `#pet-root` (pet.html ships it; created if missing — D13 robustness), sizes
 * it from the pet window config, injects the static stylesheet, and applies
 * one `setState` per state change:
 *
 *   #pet-root
 *     .pet-stage    (stagePx × stagePx, centered — geometry)
 *       .pet-motion (motion recipe keyframes — motion.ts, WRAPPER only)
 *         .pet-walk (in-stage stroll translate — D5's bounded `walk`)
 *           .pet-sprite (strip background + scaleX(-1) facing — player/facing)
 *
 * The layering is the D6 contract made concrete: a motion recipe's transform
 * (`.pet-motion`) can never fight the facing flip (`.pet-sprite`) or the
 * stroll translate (`.pet-walk`) because each owns a different element.
 *
 * `stage.ts` APPLIES state; it never DECIDES state — `pet.ts` derives it
 * (D3/D4) and calls `setState`. Stroll direction/facing are inputs, not
 * internal choices.
 */
import { TIMINGS } from '../brain/timings';
import type { CharacterPackStateSlot } from '../contract/characterPack';
import type { PetState } from '../contract/petState';
import { applyFacing, type Facing } from './facing';
import { createHitTest, type HitTest, type HitTestDeps } from './hitTest';
import { applyMotion, ensureMotionStyles } from './motion';
import { createSpritePlayer, type SpritePlayer } from './player';
import { type PetWindowSize, stagePxFor } from './sheetGeometry';

/** One state's render inputs: the pack slot, its resolved sheet URL, and the
 * pack's `meta.frameSize` (mask source-rect math — the slot itself doesn't
 * carry pack-level meta). */
export interface StageEntry {
  readonly slot: CharacterPackStateSlot;
  readonly sheetUrl: string;
  readonly frameSize: number;
}

export interface StageElements {
  readonly stage: HTMLElement;
  readonly motion: HTMLElement;
  readonly walk: HTMLElement;
  readonly sprite: HTMLElement;
}

export interface Stage {
  readonly elements: StageElements;
  readonly player: SpritePlayer;
  readonly hitTest: HitTest;
  /** (Re-)sizes from the pet window config; re-applies the current state. */
  resize(windowSize: PetWindowSize, stageScale: number): void;
  /** Applies one state. `strollDirection` (+1 right / -1 left) only affects `walk`. */
  setState(state: PetState, entry: StageEntry, strollDirection?: 1 | -1): void;
  setFacing(facing: Facing): void;
  /** Drops the hit-test caches (a pack switch changed every sheet URL). */
  invalidateHitTest(): void;
}

/** The stroll's travel, each way, as a fraction of stage width (D5). */
export const STROLL_TRAVEL_RATIO = 0.16;

const STATIC_STAGE_CSS = `
#pet-root { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
.pet-stage { position: relative; }
.pet-motion, .pet-walk, .pet-sprite { width: 100%; height: 100%; }
.pet-sprite { background-repeat: no-repeat; }
@keyframes pet-stroll-right { from { transform: translateX(calc(-1 * var(--pet-stroll-amt, 16%))); } to { transform: translateX(var(--pet-stroll-amt, 16%)); } }
@keyframes pet-stroll-left { from { transform: translateX(var(--pet-stroll-amt, 16%)); } to { transform: translateX(calc(-1 * var(--pet-stroll-amt, 16%))); } }
`;

const DEFAULT_WINDOW: PetWindowSize = { width: 256, height: 256 };

interface StageOptions {
  readonly hitTestDeps: HitTestDeps;
  readonly documentRef?: Document;
}

/**
 * Creates (idempotently — the layer tree is built once) the stage inside
 * `#pet-root`, creating `#pet-root` itself if the host page lacks it. The
 * hit-test reads sheet URLs AND the pack frame size from the entry
 * `setState` last applied (via getters, so a pack switch is picked up after
 * `invalidateHitTest()`), so it always tests against what is on screen.
 */
export function createStage(options: StageOptions): Stage {
  const doc = options.documentRef ?? document;
  ensureMotionStyles(doc);
  ensureStageStyles(doc);

  const root = ensurePetRoot(doc);
  const stage = doc.createElement('div');
  stage.className = 'pet-stage';
  const motion = doc.createElement('div');
  motion.className = 'pet-motion';
  const walk = doc.createElement('div');
  walk.className = 'pet-walk';
  const sprite = doc.createElement('div');
  sprite.className = 'pet-sprite';
  walk.appendChild(sprite);
  motion.appendChild(walk);
  stage.appendChild(motion);
  root.appendChild(stage);
  walk.style.setProperty('--pet-stroll-amt', `${STROLL_TRAVEL_RATIO * 100}%`);

  const player = createSpritePlayer(sprite);

  const sheetUrls: Partial<Record<PetState, string>> = {};
  let frameSize = 256;
  let stagePx = stagePxFor(DEFAULT_WINDOW, 1);
  let currentState: PetState | null = null;

  const hitTest = createHitTest(
    (state) => sheetUrls[state] ?? '',
    () => frameSize,
    options.hitTestDeps
  );

  function applySize(): void {
    stage.style.width = `${stagePx}px`;
    stage.style.height = `${stagePx}px`;
  }

  const stageApi: Stage = {
    elements: { stage, motion, walk, sprite },
    player,
    hitTest,
    resize(windowSize, stageScale) {
      stagePx = stagePxFor(windowSize, stageScale);
      applySize();
    },
    setState(state, entry, strollDirection = 1) {
      currentState = state;
      sheetUrls[state] = entry.sheetUrl;
      frameSize = entry.frameSize;
      player.setState({ slot: entry.slot, sheetUrl: entry.sheetUrl, stagePx });
      applyMotion(motion, entry.slot.motion ?? null);
      applyStroll(state, strollDirection);
    },
    setFacing(facing) {
      applyFacing(sprite, facing);
    },
    invalidateHitTest() {
      hitTest.invalidate();
    },
  };

  applySize();

  /** The in-stage stroll (D5): one eased traverse for the stroll's duration. */
  function applyStroll(state: PetState, direction: 1 | -1): void {
    if (state !== 'walk' || currentState === null) {
      walk.style.animation = '';
      return;
    }
    const name = direction >= 0 ? 'pet-stroll-right' : 'pet-stroll-left';
    // Single iteration with `both` fill: the traverse spans exactly the
    // stroll's sense window (TIMINGS.strollDurationMs), and the sense tick
    // clears the animation when the state leaves `walk`.
    walk.style.animation = `${name} ${TIMINGS.strollDurationMs}ms ease-in-out 1 both`;
  }

  function ensureStageStyles(documentRef: Document): void {
    if (documentRef.getElementById('pet-2d-stage-styles')) return;
    const style = documentRef.createElement('style');
    style.id = 'pet-2d-stage-styles';
    style.textContent = STATIC_STAGE_CSS;
    documentRef.head.appendChild(style);
  }

  return stageApi;
}

function ensurePetRoot(documentRef: Document): HTMLElement {
  let root = documentRef.getElementById('pet-root');
  if (!root) {
    root = documentRef.createElement('div');
    root.id = 'pet-root';
    documentRef.body.appendChild(root);
  }
  return root;
}
