/**
 * src/packs/whaleGirlCompat.ts — D8: the whale-girl pack-format adapter.
 * Pure functions over whale-girl's manifest JSON — no fs, no network, usable
 * at runtime but DOCUMENTED as a build-time tool (`scripts/build-packs.ts
 * --from-whale-girl <dir>` is the real consumer: a user who owns whale-girl
 * assets builds a pack module into their own build; this repo ships the
 * reader, never the art).
 *
 * THE INVERSION, stated where a port-avoiding reader will actually see it:
 * whale-girl's `/state` endpoint returns PET STATE (`activity.name`) to an
 * external consumer — the pet process decides, the consumer renders. This
 * plugin goes the OTHER way: the Elftia host feeds FACTS and the pet derives
 * state (`src/brain/`). So we borrow whale-girl's assets, frame semantics
 * ("frame 0 is the rest pose"), playback vocabulary, motion recipes, and
 * all-15-mandatory rule — and we do NOT borrow its state-transport
 * direction, its `/state` shape, or its `activity`-object input. Do not read
 * whale-girl's external-snapshot work as prior art for facts.
 *
 * This adapter is NOT a validator: it maps the two manifest shapes whale-girl's
 * own `verify-assets` accepts and passes slot data through essentially as-is
 * (four documented adaptations below); `validateCharacterPack` remains the
 * single gate. Unknown state names are carried through on purpose so the
 * gate rejects them loudly instead of the adapter silently dropping them.
 *
 * The four adaptations (D8):
 *  1. `apiVersion` is synthesized (`CHARACTER_PACK_API_VERSION`) — whale-girl
 *     manifests have no such field.
 *  2. `license` is synthesized as whale-girl-the-software's `MIT` (Sam Gao
 *     / vlln, https://github.com/vlln/whale-girl) and `credit` maps from the
 *     character's own `credit` field. Caveat a publisher must own: MIT covers
 *     the SOFTWARE; a whale-girl-derived pack's ART (the 鲸鱼娘 character is
 *     ZipZipPipe's IP) needs its own rights story — this repo never
 *     distributes it (see NOTICE).
 *  3. `meta.stageSize` (whale-girl: a web-page stage size, e.g. 110) is NOT
 *     carried over as pixels — meaningless in a 256×256 OS window. It maps to
 *     `stageScale: 1` (fill the pet window's shorter side) unconditionally.
 *  4. whale-girl's legacy FLAT top-level form (`states` at the manifest root,
 *     sheets flat in `assets/` — the compat block its own verify-assets still
 *     validates) is accepted alongside the `characters.<id>` registry form.
 */
import {
  CHARACTER_PACK_API_VERSION,
  type CharacterPackManifest,
  type CharacterPackStateSlot,
} from '../contract/characterPack';
import type { PetState } from '../contract/petState';

/** A whale-girl character entry (registry form) or the root (legacy flat form). */
interface WhaleGirlCharacterBlock {
  readonly name?: unknown;
  readonly credit?: unknown;
  readonly meta?: unknown;
  readonly states?: unknown;
}

/**
 * Character ids a whale-girl manifest declares (registry form). The legacy
 * flat form declares no id, so a pure-flat manifest lists nothing — its
 * character is reached via `fromWhaleGirlManifest(json, '<chosen-id>')`.
 */
export function listWhaleGirlCharacters(json: unknown): readonly string[] {
  const characters = asRecord(json)?.characters;
  if (!isRecord(characters)) return [];
  return Object.entries(characters)
    .filter(([, entry]) => isRecord(entry) && isRecord(entry.states))
    .map(([id]) => id);
}

/**
 * Maps whale-girl manifest `json` into our pack contract as `characterId`.
 * Registry form (`characters.<id>`) wins; otherwise a legacy flat root
 * (`states` at the top) is used with `characterId` as the output id — the
 * flat form carries none of its own. Throws a readable Error on anything
 * else; a mapped result still must pass `validateCharacterPack` to be usable.
 */
export function fromWhaleGirlManifest(json: unknown, characterId: string): CharacterPackManifest {
  const root = asRecord(json);
  if (!root) {
    throw new Error('whale-girl manifest must be a JSON object');
  }

  const registryEntry = isRecord(root.characters)
    ? asRecord(root.characters[characterId])
    : null;
  const block: WhaleGirlCharacterBlock | null =
    registryEntry ?? (isRecord(root.states) ? root : null);

  if (!block || !isRecord(block.states)) {
    throw new Error(
      `whale-girl manifest has no characters.${characterId} entry and no legacy top-level states block — cannot adapt`
    );
  }

  const credit = typeof block.credit === 'string' ? block.credit.trim() : '';
  if (credit === '') {
    throw new Error(
      `whale-girl character "${characterId}" has no credit — a pack requires asset-author attribution`
    );
  }

  const states: Record<string, CharacterPackStateSlot> = {};
  for (const [stateName, slot] of Object.entries(block.states)) {
    if (!isRecord(slot)) {
      // Pass the breakage through as an invalid slot; the gate reports it.
      states[stateName] = slot as unknown as CharacterPackStateSlot;
      continue;
    }
    const mapped: Record<string, unknown> = {};
    for (const field of ['sheet', 'frames', 'fps', 'playback', 'motion'] as const) {
      if (slot[field] !== undefined) mapped[field] = slot[field];
    }
    states[stateName] = mapped as unknown as CharacterPackStateSlot;
  }

  return {
    apiVersion: CHARACTER_PACK_API_VERSION,
    id: characterId,
    name: typeof block.name === 'string' && block.name.trim() !== '' ? block.name : characterId,
    credit,
    license: 'MIT',
    meta: { stageScale: 1 },
    states: states as unknown as Record<PetState, CharacterPackStateSlot>,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
