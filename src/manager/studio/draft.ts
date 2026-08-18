/**
 * src/manager/studio/draft.ts — the Pack Studio's PURE model (D7): the
 * editable draft, its conversions to and from `CharacterPackManifest`
 * (whale-girl prefill comes in through the same manifest shape), the
 * measured-dimensions table the live validator needs, and the slot
 * normalizer that keeps a hand-edited draft self-consistent with the
 * contract's gating rules (pingpong/blink need ≥2 frames; motion only at
 * frames === 1 except `error`). No DOM, no ipc — the components own those.
 */
import {
  CHARACTER_PACK_API_VERSION,
  type CharacterPackManifest,
  type CharacterPackStateSlot,
  type MeasuredSheetDimensions,
} from '../../contract/characterPack';
import {
  MOTION_ON_MULTI_FRAME_EXCEPTION,
  MOTION_RECIPES,
  type MotionRecipe,
  PET_STATES,
  type PetState,
  PLAYBACK_MODES,
  type PlaybackMode,
} from '../../contract/petState';

/** One catalog file row (the main half's `packs:catalog` shape; group 6). */
export interface StudioCatalogFile {
  readonly name: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
}

/** One detected whale-girl character (registry form only; D8). */
export interface StudioWhaleGirlCharacter {
  readonly id: string;
  readonly name: string;
  readonly dir: string;
  readonly files: readonly StudioCatalogFile[];
}

/** The catalog result the studio works from (top level + whale-girl block). */
export interface StudioCatalog {
  readonly dir: string;
  readonly files: readonly StudioCatalogFile[];
  readonly whaleGirl?: {
    readonly manifest: unknown;
    readonly characters: readonly StudioWhaleGirlCharacter[];
  };
}

/** One state's editable row (`sheet: ''` = unassigned). */
export interface SlotDraft {
  readonly sheet: string;
  readonly frames: number;
  readonly fps: number;
  readonly playback: PlaybackMode;
  readonly motion: MotionRecipe | null;
}

/** The whole editable draft (meta + all 15 state rows). */
export interface StudioDraft {
  readonly id: string;
  readonly name: string;
  readonly credit: string;
  readonly license: string;
  readonly frameSize: number;
  readonly states: Readonly<Record<PetState, SlotDraft>>;
}

/** A fresh draft: every slot unassigned, contract-legal defaults elsewhere. */
export function emptyDraft(frameSize = 256): StudioDraft {
  const states = {} as Record<PetState, SlotDraft>;
  for (const state of PET_STATES) {
    states[state] = { sheet: '', frames: 1, fps: 2, playback: 'loop', motion: null };
  }
  return { id: '', name: '', credit: '', license: '', frameSize, states };
}

/** The prefill direction: an (adapted) manifest → an editable draft. */
export function draftFromManifest(manifest: CharacterPackManifest): StudioDraft {
  const frameSize =
    typeof manifest.meta?.frameSize === 'number' &&
    Number.isInteger(manifest.meta.frameSize) &&
    manifest.meta.frameSize > 0
      ? manifest.meta.frameSize
      : 256;
  const states = {} as Record<PetState, SlotDraft>;
  for (const state of PET_STATES) {
    const slot = manifest.states[state];
    states[state] = slot === undefined
      ? { sheet: '', frames: 1, fps: 2, playback: 'loop', motion: null }
      : {
          sheet: typeof slot.sheet === 'string' ? slot.sheet : '',
          frames: Number.isInteger(slot.frames) && slot.frames > 0 ? slot.frames : 1,
          fps: slot.fps > 0 && slot.fps <= 30 ? slot.fps : 2,
          playback: (PLAYBACK_MODES as readonly string[]).includes(slot.playback)
            ? slot.playback
            : 'loop',
          motion:
            slot.motion !== undefined &&
            (MOTION_RECIPES as readonly string[]).includes(slot.motion)
              ? slot.motion
              : null,
        };
  }
  return {
    id: manifest.id,
    name: manifest.name,
    credit: manifest.credit,
    license: manifest.license,
    frameSize,
    states,
  };
}

/** The save direction: the draft → the manifest `packs:save` assembles from. */
export function draftToManifest(draft: StudioDraft): CharacterPackManifest {
  const states = {} as Record<PetState, CharacterPackStateSlot>;
  for (const state of PET_STATES) {
    const slot = draft.states[state];
    states[state] =
      slot.motion === null
        ? { sheet: slot.sheet, frames: slot.frames, fps: slot.fps, playback: slot.playback }
        : {
            sheet: slot.sheet,
            frames: slot.frames,
            fps: slot.fps,
            playback: slot.playback,
            motion: slot.motion,
          };
  }
  return {
    apiVersion: CHARACTER_PACK_API_VERSION,
    id: draft.id,
    name: draft.name,
    credit: draft.credit,
    license: draft.license,
    meta: { frameSize: draft.frameSize },
    states,
  };
}

/** Catalog rows → the measured-dimensions table `validateCharacterPack`
 *  wants (unmeasurable rows are skipped — the validator reports them). */
export function measuredFromFiles(files: readonly StudioCatalogFile[]): MeasuredSheetDimensions {
  const measured: Record<string, { width: number; height: number }> = {};
  for (const file of files) {
    if (file.width !== null && file.height !== null) {
      measured[file.name] = { width: file.width, height: file.height };
    }
  }
  return measured;
}

/** The bulk action (D7.2): idle's row copied onto every unassigned state. */
export function copyIdleToUnassigned(draft: StudioDraft): StudioDraft {
  const idle = draft.states.idle;
  const states = { ...draft.states };
  for (const state of PET_STATES) {
    if (state !== 'idle' && states[state].sheet === '') {
      states[state] = idle;
    }
  }
  return { ...draft, states };
}

/** Re-applies the contract's gating rules after any hand edit (D7.2): a
 *  draft that self-heals can never sit in a state the validator would
 *  reject for a COMBINATION the UI itself forbids. */
export function normalizeSlot(state: PetState, slot: SlotDraft): SlotDraft {
  let next = slot;
  if (!Number.isInteger(next.frames) || next.frames < 1) next = { ...next, frames: 1 };
  if (!(next.fps > 0 && next.fps <= 30)) next = { ...next, fps: 2 };
  if ((next.playback === 'pingpong' || next.playback === 'blink') && next.frames < 2) {
    next = { ...next, playback: 'loop' };
  }
  if (next.motion !== null && next.frames !== 1 && state !== MOTION_ON_MULTI_FRAME_EXCEPTION) {
    next = { ...next, motion: null };
  }
  return next;
}

/** Shape-guards a `packs:catalog` result; anything malformed → null (the
 *  studio's never-blank discipline: degrade to "pick again", never crash). */
export function parseCatalogResult(result: unknown): StudioCatalog | null {
  if (typeof result !== 'object' || result === null) return null;
  const { dir, files } = result as { dir?: unknown; files?: unknown };
  if (typeof dir !== 'string' || dir === '' || !Array.isArray(files)) return null;
  if (!files.every(isCatalogFile)) return null;
  const { whaleGirl } = result as { whaleGirl?: unknown };
  if (whaleGirl === undefined) return { dir, files };
  if (typeof whaleGirl !== 'object' || whaleGirl === null) return null;
  const { manifest, characters } = whaleGirl as { manifest?: unknown; characters?: unknown };
  if (!Array.isArray(characters) || !characters.every(isWhaleGirlCharacter)) return null;
  return { dir, files, whaleGirl: { manifest, characters } };
}

function isCatalogFile(value: unknown): value is StudioCatalogFile {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === 'string' &&
    typeof row.bytes === 'number' &&
    (row.width === null || typeof row.width === 'number') &&
    (row.height === null || typeof row.height === 'number')
  );
}

function isWhaleGirlCharacter(value: unknown): value is StudioWhaleGirlCharacter {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id !== '' &&
    typeof row.name === 'string' &&
    typeof row.dir === 'string' &&
    Array.isArray(row.files) &&
    row.files.every(isCatalogFile)
  );
}
