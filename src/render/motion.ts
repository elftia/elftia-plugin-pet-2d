/**
 * src/render/motion.ts — D6: the nine CSS keyframe recipes (whale-girl's
 * motion vocabulary, `petState.ts` `MOTION_RECIPES`) for `frames: 1` states
 * that have no strip of their own to animate. The recipes are injected as ONE
 * `<style>` element on first use and applied to a WRAPPER element — never the
 * sprite element itself — so a recipe's `transform` can never fight the
 * sprite's `scaleX(-1)` facing flip (`facing.ts`) or the strip's
 * `background-position` stepping (`player.ts`).
 *
 * CSS/compositor animation is a deliberate D13 choice: spike ② measured CSS
 * keyframes as the only motion layer that keeps advancing while the pet
 * window is fully occluded (JS timers clamp to ~1 Hz there). Motion recipes
 * carry no "current frame" meaning, so riding the compositor costs nothing in
 * coherence — unlike frame-stepping, where a CSS/JS fork was rejected
 * (player.ts header).
 */
import type { MotionRecipe } from '../contract/petState';
import { MOTION_RECIPES } from '../contract/petState';

/** Per-recipe tuning: duration and the easing that reads best for it. */
interface MotionTuning {
  readonly durationMs: number;
  readonly easing: string;
  readonly iterations: string;
}

const MOTION_TUNING: Record<MotionRecipe, MotionTuning> = {
  bob: { durationMs: 2200, easing: 'ease-in-out', iterations: 'infinite' },
  wiggle: { durationMs: 1800, easing: 'ease-in-out', iterations: 'infinite' },
  squash: { durationMs: 2000, easing: 'ease-in-out', iterations: 'infinite' },
  shake: { durationMs: 600, easing: 'ease-in-out', iterations: 'infinite' },
  sigh: { durationMs: 3400, easing: 'ease-in-out', iterations: 'infinite' },
  hop: { durationMs: 1400, easing: 'ease-in-out', iterations: 'infinite' },
  tilt: { durationMs: 2600, easing: 'ease-in-out', iterations: 'infinite' },
  float: { durationMs: 3000, easing: 'ease-in-out', iterations: 'infinite' },
  wave: { durationMs: 1600, easing: 'ease-in-out', iterations: 'infinite' },
};

/**
 * The keyframe bodies. Amplitudes are kept small (a 256 px stage; a pet that
 * wanders off its own stage is a bug, not charm) and Y-flips are avoided —
 * recipes must not look like jumps that belong to real states.
 */
const MOTION_KEYFRAMES: Record<MotionRecipe, string> = {
  bob: `@keyframes pet-motion-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6%); } }`,
  wiggle: `@keyframes pet-motion-wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(2.5deg); } 75% { transform: rotate(-2.5deg); } }`,
  squash: `@keyframes pet-motion-squash { 0%,100% { transform: scale(1,1); } 50% { transform: scale(1.06,0.92); } }`,
  shake: `@keyframes pet-motion-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3%); } 75% { transform: translateX(3%); } }`,
  sigh: `@keyframes pet-motion-sigh { 0%,100% { transform: translateY(0) scale(1,1); } 45% { transform: translateY(2%) scale(1.02,0.97); } 60% { transform: translateY(2%) scale(1.03,0.96); } }`,
  hop: `@keyframes pet-motion-hop { 0%,100% { transform: translateY(0); } 30% { transform: translateY(-9%); } 50% { transform: translateY(0); } 65% { transform: translateY(-4%); } 80% { transform: translateY(0); } }`,
  tilt: `@keyframes pet-motion-tilt { 0%,100% { transform: rotate(0deg); } 50% { transform: rotate(-4deg); } }`,
  float: `@keyframes pet-motion-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3.5%); } }`,
  wave: `@keyframes pet-motion-wave { 0%,100% { transform: rotate(0deg); } 20% { transform: rotate(5deg); } 40% { transform: rotate(-2deg); } 60% { transform: rotate(5deg); } 80% { transform: rotate(-2deg); } }`,
};

let styleInjected = false;

/**
 * Injects all nine keyframes as one `<style>` (idempotent; once per page).
 * Exported separately from `applyMotion` so `stage.ts` can inject eagerly at
 * mount and tests can reset via `__resetMotionStyleForTests`.
 */
export function ensureMotionStyles(documentRef: Document): void {
  if (styleInjected) return;
  const style = documentRef.createElement('style');
  style.id = 'pet-2d-motion-keyframes';
  style.textContent = MOTION_RECIPES.map((recipe) => MOTION_KEYFRAMES[recipe]).join('\n');
  documentRef.head.appendChild(style);
  styleInjected = true;
}

/** `animation` shorthand for a recipe, or `''` for "none". */
export function motionAnimation(recipe: MotionRecipe): string {
  const tuning = MOTION_TUNING[recipe];
  return `pet-motion-${recipe} ${tuning.durationMs}ms ${tuning.easing} ${tuning.iterations}`;
}

/** Applies (recipe !== null) or clears (null) the motion on `el`'s animation. */
export function applyMotion(el: HTMLElement, recipe: MotionRecipe | null): void {
  el.style.animation = recipe === null ? '' : motionAnimation(recipe);
}

/** Test-only: un-mark the injected flag so a fresh jsdom can inject again. */
export function __resetMotionStyleForTests(): void {
  styleInjected = false;
}
