/**
 * src/render/facing.ts — D6: horizontal facing. Pack assets are authored
 * FACING LEFT (the whale-girl all-character contract, inherited by D7);
 * `left` is therefore the identity transform and `right` mirrors with
 * `scaleX(-1)` on the SPRITE element (never the motion wrapper — motion.ts).
 *
 * Direction is WRITTEN by the moving states (`walk` strolls one way per
 * stroll; `drag` faces the drag's horizontal component) and CARRIED by every
 * static state in between — a pet that snaps back to left-facing the instant
 * it stops walking reads as a glitch, not a reset. The random idle turn
 * (every 10–25 s while idle/think/wait, `rhythm.ts` `nextFacingTurnAt`) is
 * scheduled by the composition layer (pet.ts); this module only holds and
 * applies the current value.
 */

/** The two facings. Assets' authored baseline is `left`. */
export type Facing = 'left' | 'right';

/** The `transform` value applying `facing` to a sprite element. */
export function facingTransform(facing: Facing): string {
  return facing === 'right' ? 'scaleX(-1)' : '';
}

/** Writes `facing` onto the sprite element. No-op when unchanged. */
export function applyFacing(spriteEl: HTMLElement, facing: Facing): void {
  const next = facingTransform(facing);
  if (spriteEl.style.transform !== next) spriteEl.style.transform = next;
}

/**
 * The facing a `walk`-style horizontal delta implies: movement to the right
 * faces right, to the left faces left, and exactly zero keeps the current
 * facing (a vertical-only stroll has no opinion).
 */
export function facingFromDelta(dx: number, current: Facing): Facing {
  if (dx > 0) return 'right';
  if (dx < 0) return 'left';
  return current;
}

/** A tiny holder so `stage.ts`/`pet.ts` don't each keep their own variable. */
export interface FacingState {
  facing: Facing;
}

export function createFacingState(initial: Facing = 'left'): FacingState {
  return { facing: initial };
}
