/**
 * src/contract/characterPack.ts — the character-pack contract (D7): the
 * manifest shape, the per-state slot shape, and `validateCharacterPack`, the
 * machine gate every pack (shipped or third-party) must pass.
 *
 * `validateCharacterPack` is pure and NEVER throws: it returns a list of
 * human-readable problem strings (empty array = valid). Each rule has
 * exactly one named message so a pack author's build failure is legible
 * without reading this file (`__tests__/characterPack.test.ts` asserts the
 * exact text of every rejection, so message wording IS the contract).
 *
 * Dimension checks need the real pixel size of each sheet, which this
 * module cannot measure itself — it has no fs/canvas access, and must stay
 * usable from a browser context too (a pack could in principle be validated
 * client-side before install). Callers supply `measuredSheets`;
 * `scripts/verify-packs.ts` (Group 6) reads real PNG/SVG dimensions for it.
 */
import {
  isMotionRecipe,
  isPlaybackMode,
  MOTION_ON_MULTI_FRAME_EXCEPTION,
  type MotionRecipe,
  PET_STATES,
  type PetState,
  type PlaybackMode,
} from './petState';

/** `apiVersion` is the pack CONTRACT's own version (this file's schema), not
 * the character's version. `1` is the only value that currently exists. */
export const CHARACTER_PACK_API_VERSION = 1;

/** `^[a-z0-9][a-z0-9-]{0,31}$` — lowercase, digits, hyphens, 1-32 chars,
 * cannot start with a hyphen. URL/path-safe, mirrors the host's own flat-id
 * discipline for plugin ids. */
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const DEFAULT_FRAME_SIZE = 256;

export interface CharacterPackMeta {
  /** Positive integer; every state's sheet height must equal it. Default
   * 256 (D7). */
  readonly frameSize?: number;
  /** `0 < x <= 1`; fraction of the pet window's shorter side the stage
   * occupies. Default 1 (D7). */
  readonly stageScale?: number;
}

export interface CharacterPackStateSlot {
  /** Pack-relative asset key; the build inlines each sheet into the pack
   * MODULE as a data URI (D1, Group 6) — the v1 transport. A same-origin
   * `plugin://` sheet URL is NOT usable today: the host CSP grants
   * `plugin:` to `script-src` only, so `<img src="plugin://…">` is blocked
   * in the real pet window (`img-src` has no `plugin:` token). The
   * `SheetSource` seam (pack module → player) is where a future host-side
   * `img-src plugin:` change would flip packs to per-file URLs without a
   * contract break. This file never resolves the key. */
  readonly sheet: string;
  /** Positive integer; strip width must equal `frames * meta.frameSize`. */
  readonly frames: number;
  /** `0 < fps <= 30`. */
  readonly fps: number;
  readonly playback: PlaybackMode;
  /** One of the nine recipes (`petState.ts`). Allowed only when
   * `frames === 1`, except `MOTION_ON_MULTI_FRAME_EXCEPTION` (`error`). */
  readonly motion?: MotionRecipe;
}

export interface CharacterPackManifest {
  readonly apiVersion: number;
  readonly id: string;
  readonly name: string;
  /** Asset author attribution — always shown in the pack picker (D7). */
  readonly credit: string;
  /** SPDX id or explicit text for the ART specifically (may differ from
   * the plugin's own code license). */
  readonly license: string;
  readonly meta?: CharacterPackMeta;
  /** All 15 `PetState` keys required; no unknown keys. */
  readonly states: Readonly<Record<PetState, CharacterPackStateSlot>>;
}

/**
 * `{width, height}` in pixels, as measured from the real sheet asset (PNG
 * IHDR / SVG `viewBox` — see `scripts/verify-packs.ts`). Keyed by the
 * slot's `sheet` value, not by state — two states could in principle share
 * one sheet, though no shipped pack does.
 */
export type MeasuredSheetDimensions = Readonly<
  Record<string, { width: number; height: number }>
>;

/**
 * Validates a character-pack manifest against the full D7 contract. Pure,
 * never throws. Returns an empty array when the manifest is valid.
 */
export function validateCharacterPack(
  manifest: unknown,
  measuredSheets: MeasuredSheetDimensions
): string[] {
  const problems: string[] = [];

  if (!isRecord(manifest)) {
    return ['manifest must be an object'];
  }

  if (manifest.apiVersion !== CHARACTER_PACK_API_VERSION) {
    problems.push(
      `apiVersion must be ${CHARACTER_PACK_API_VERSION}, got ${JSON.stringify(manifest.apiVersion)}`
    );
  }

  if (typeof manifest.id !== 'string' || !PACK_ID_PATTERN.test(manifest.id)) {
    problems.push(
      `id must match ${PACK_ID_PATTERN.source} (lowercase letters, digits, hyphens, 1-32 chars, cannot start with a hyphen), got ${JSON.stringify(manifest.id)}`
    );
  }

  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    problems.push('name is required and must be a non-empty string');
  }

  if (typeof manifest.credit !== 'string' || manifest.credit.trim() === '') {
    problems.push(
      'credit is required and must be a non-empty string (asset author attribution)'
    );
  }

  if (typeof manifest.license !== 'string' || manifest.license.trim() === '') {
    problems.push(
      'license is required and must be a non-empty string (SPDX id or explicit text)'
    );
  }

  const frameSize = readFrameSize(manifest.meta, problems);
  validateStageScale(manifest.meta, problems);
  validateStates(manifest.states, frameSize, measuredSheets, problems);

  return problems;
}

function readFrameSize(meta: unknown, problems: string[]): number {
  if (!isRecord(meta) || meta.frameSize === undefined) return DEFAULT_FRAME_SIZE;
  const { frameSize } = meta;
  if (typeof frameSize !== 'number' || !Number.isInteger(frameSize) || frameSize <= 0) {
    problems.push(`meta.frameSize must be a positive integer, got ${JSON.stringify(frameSize)}`);
    return DEFAULT_FRAME_SIZE;
  }
  return frameSize;
}

function validateStageScale(meta: unknown, problems: string[]): void {
  if (!isRecord(meta) || meta.stageScale === undefined) return;
  const { stageScale } = meta;
  if (typeof stageScale !== 'number' || !(stageScale > 0 && stageScale <= 1)) {
    problems.push(
      `meta.stageScale must be a number with 0 < x <= 1, got ${JSON.stringify(stageScale)}`
    );
  }
}

function validateStates(
  states: unknown,
  frameSize: number,
  measuredSheets: MeasuredSheetDimensions,
  problems: string[]
): void {
  if (!isRecord(states)) {
    problems.push('states is required and must be an object');
    return;
  }

  const presentKeys = new Set(Object.keys(states));

  for (const state of PET_STATES) {
    if (!presentKeys.has(state)) {
      problems.push(`states.${state} is missing — all 15 states are required, no fallback`);
    }
  }

  for (const key of presentKeys) {
    if (!(PET_STATES as readonly string[]).includes(key)) {
      problems.push(`states.${key} is not a known PetState — unknown state keys are rejected`);
      continue;
    }
    validateStateSlot(key as PetState, states[key], frameSize, measuredSheets, problems);
  }
}

function validateStateSlot(
  state: PetState,
  slot: unknown,
  frameSize: number,
  measuredSheets: MeasuredSheetDimensions,
  problems: string[]
): void {
  if (!isRecord(slot)) {
    problems.push(`states.${state} must be an object`);
    return;
  }

  const { sheet, frames, fps, playback, motion } = slot;

  const sheetOk = typeof sheet === 'string' && sheet.trim() !== '';
  if (!sheetOk) {
    problems.push(`states.${state}.sheet is required and must be a non-empty string`);
  }

  const framesOk = typeof frames === 'number' && Number.isInteger(frames) && frames > 0;
  if (!framesOk) {
    problems.push(
      `states.${state}.frames must be a positive integer, got ${JSON.stringify(frames)}`
    );
  }

  if (typeof fps !== 'number' || !(fps > 0 && fps <= 30)) {
    problems.push(
      `states.${state}.fps must be a number with 0 < fps <= 30, got ${JSON.stringify(fps)}`
    );
  }

  if (!isPlaybackMode(playback)) {
    problems.push(
      `states.${state}.playback must be one of loop|pingpong|once|blink, got ${JSON.stringify(playback)}`
    );
  } else if (framesOk && (playback === 'pingpong' || playback === 'blink') && frames < 2) {
    problems.push(
      `states.${state}.playback "${playback}" requires frames >= 2, got frames: ${frames}`
    );
  }

  if (motion !== undefined) {
    if (!isMotionRecipe(motion)) {
      problems.push(
        `states.${state}.motion must be one of the nine recipes, got ${JSON.stringify(motion)}`
      );
    } else if (framesOk && frames !== 1 && state !== MOTION_ON_MULTI_FRAME_EXCEPTION) {
      problems.push(
        `states.${state}.motion is only allowed when frames === 1 (except "${MOTION_ON_MULTI_FRAME_EXCEPTION}"), got frames: ${frames}`
      );
    }
  }

  if (framesOk && sheetOk) {
    validateSheetDimensions(state, sheet, frames, frameSize, measuredSheets, problems);
  }
}

function validateSheetDimensions(
  state: PetState,
  sheet: string,
  frames: number,
  frameSize: number,
  measuredSheets: MeasuredSheetDimensions,
  problems: string[]
): void {
  const measured = measuredSheets[sheet];
  if (!measured) {
    problems.push(`states.${state}.sheet "${sheet}" has no measured dimensions supplied`);
    return;
  }
  const expectedWidth = frames * frameSize;
  if (measured.width !== expectedWidth) {
    problems.push(
      `states.${state}.sheet "${sheet}" width ${measured.width} does not equal frames(${frames}) * frameSize(${frameSize}) = ${expectedWidth}`
    );
  }
  if (measured.height !== frameSize) {
    problems.push(
      `states.${state}.sheet "${sheet}" height ${measured.height} does not equal frameSize(${frameSize})`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
