/**
 * src/contract/petState.ts — the closed 15-state pet-state union (D5), the
 * four sprite-playback modes and nine CSS motion recipes (D6), and the full
 * sense-flag vocabulary the state table (D4) is built from.
 *
 * This is pure data — no host import, no runtime dependency on anything
 * outside this file. A third-party pack/pet author should be able to read
 * this one file and know the entire vocabulary the rest of the repo speaks.
 */

/**
 * The closed pet-state set (D5) — identical to whale-girl's own 15 states
 * (`_others/whale-girl/docs/sprites-spec.md` §状态总表; verified against the
 * real `lib/assets/manifest.json`, whose `states` keys are exactly this
 * list). Closed by design: packs may not introduce new states (D5
 * alternatives — "角色不能新增动作"), only new pack art for these 15.
 */
export const PET_STATES = [
  'idle',
  'working',
  'celebrate',
  'error',
  'disappointed',
  'joy',
  'eat',
  'play',
  'drag',
  'walk',
  'sleep',
  'wake',
  'welcome',
  'think',
  'wait',
] as const;

export type PetState = (typeof PET_STATES)[number];

/** Type guard usable at any untrusted-data boundary (e.g. a loaded pack). */
export function isPetState(value: unknown): value is PetState {
  return typeof value === 'string' && (PET_STATES as readonly string[]).includes(value);
}

/**
 * The four sprite playback modes (D6 `player.ts`). `pingpong` and `blink`
 * both require `frames >= 2` — enforced by `validateCharacterPack` (D7), not
 * here (this file stays pure data).
 */
export const PLAYBACK_MODES = ['loop', 'pingpong', 'once', 'blink'] as const;

export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export function isPlaybackMode(value: unknown): value is PlaybackMode {
  return typeof value === 'string' && (PLAYBACK_MODES as readonly string[]).includes(value);
}

/**
 * The nine CSS motion recipes whale-girl uses (D6 `motion.ts`), applied to a
 * wrapper element and allowed only on `frames: 1` states, with the single
 * documented exception (`error`, 2 frames + `shake` — see
 * `MOTION_ON_MULTI_FRAME_EXCEPTION` below).
 */
export const MOTION_RECIPES = [
  'bob',
  'wiggle',
  'squash',
  'shake',
  'sigh',
  'hop',
  'tilt',
  'float',
  'wave',
] as const;

export type MotionRecipe = (typeof MOTION_RECIPES)[number];

export function isMotionRecipe(value: unknown): value is MotionRecipe {
  return typeof value === 'string' && (MOTION_RECIPES as readonly string[]).includes(value);
}

/**
 * The single state allowed to break the "`motion` only on `frames: 1`" rule
 * (D7's documented `error` exception / D6 `motion.ts`): `error` ships 2
 * frames + `shake`. `validateCharacterPack` reads this constant rather than
 * hard-coding the exception inline, so the one place this rule lives is here.
 */
export const MOTION_ON_MULTI_FRAME_EXCEPTION: PetState = 'error';

/**
 * The full sense-flag vocabulary `deriveSense` (D3) produces and
 * `STATE_TABLE` (D4) consumes. Eight are fact-derived (`FACT_FLAGS`, D3);
 * one (`activityUnknown`) is the stateful-expiry flag (D3 rule 3) — it
 * asserts nothing and only ever appears in a `forbids` column; the rest are
 * local interaction/rhythm flags the interaction layer owns (D3's closing
 * paragraph). Kept as one flat list so `Sense` (`Record<SenseFlag,
 * boolean>`) and the table-driven state-table tests (task 4.5e) have a
 * single source of truth for "every flag that exists."
 */
export const SENSE_FLAGS = [
  // fact-derived (D3 FACT_FLAGS table)
  'taskDone',
  'turnDone',
  'mediaDone',
  'failed',
  'sulking',
  'thinking',
  'awaitingApproval',
  'greeting',
  // stateful expiry (D3 rule 3) — asserts nothing, only ever `forbids`
  'activityUnknown',
  // local interaction/rhythm flags (D3, last paragraph)
  'dragging',
  'dropBuffer',
  'feeding',
  'playing',
  'waking',
  'joyful',
  'sleeping',
  'strolling',
  'workingInterlude',
] as const;

export type SenseFlag = (typeof SENSE_FLAGS)[number];
