/**
 * src/packs/loadPack.ts — D1's runtime half: load ONE pack module
 * (`plugin://pet-2d/characters/<id>/pack.mjs`) and hand the player
 * `SheetSource`s. This is the ONLY module that knows how a sheet `url` was
 * produced — the player/stage consume `{url, frames}` whatever it is (data
 * URI today; plain `plugin://` URLs if the host ever adds `img-src plugin:`
 * — a loader-only change, the seam's whole point).
 *
 * Failure never blanks the pet: any error (network/protocol failure, a
 * corrupt module, a shape/consistency mismatch) degrades to a static
 * fallback glyph pack, with a console.warn — the "restricted plugin ⇒ empty
 * window with no error" failure mode (trust/classify) must not be able to
 * happen twice.
 *
 * Shape rules enforced here (cheap, runtime): `default` export with
 * `manifest` + `sheets`; all 15 PET_STATES covered; every sheet a string
 * `url` + positive-integer `frames`; `sheets[state].frames` equal to
 * `manifest.states[state].frames`. The FULL contract (dimensions etc.) is
 * `validateCharacterPack` at build time — runtime has no way to measure
 * real pixel sizes, so it checks what it can and falls back on doubt.
 */
import type { CharacterPackManifest } from '../contract/characterPack';
import { PET_STATES, type PetState } from '../contract/petState';

/** The one thing the player consumes (D1). */
export interface SheetSource {
  readonly url: string;
  readonly frames: number;
}

/** A loaded, runtime-trusted pack: the manifest + state-keyed sheet sources. */
export interface CharacterPack {
  readonly manifest: CharacterPackManifest;
  readonly sheets: Readonly<Record<PetState, SheetSource>>;
}

/** Injected so tests drive the import; production uses the dynamic import. */
export type PackModuleImporter = (url: string) => Promise<{ default?: unknown }>;

/** The plugin:// URL a pack module lives at (D1; entry served by the host). */
export function packModuleUrl(id: string): string {
  return `plugin://pet-2d/characters/${id}/pack.mjs`;
}

// @vite-ignore: the URL is runtime data (the plugin's install origin), not a
// build-time specifier — this is exactly the channel spike item ① measured.
const defaultImporter: PackModuleImporter = (url) => import(/* @vite-ignore */ url);

export async function loadPack(
  id: string,
  importer: PackModuleImporter = defaultImporter
): Promise<CharacterPack> {
  try {
    const mod = await importer(packModuleUrl(id));
    const pack = normalizePackPayload(mod.default);
    if (pack) return pack;
    console.warn(`[pet-2d] pack "${id}" has an unusable module shape; using the fallback glyph`);
  } catch (error) {
    console.warn(
      `[pet-2d] pack "${id}" failed to load (${error instanceof Error ? error.message : String(error)}); using the fallback glyph`
    );
  }
  return fallbackPack();
}

/**
 * Runtime shape check (see header). Returns null — never throws — on doubt.
 * SHARED (task 2.3, D6): the module path here AND the user-pack ipc path
 * (`userPacks.ts`, group 5) push their payload through this ONE gate —
 * both intakes get the same all-15-states / url-string / positive-int-
 * frames / slot-cross-check rules, and both fall back identically on doubt.
 */
export function normalizePackPayload(defaultExport: unknown): CharacterPack | null {
  if (typeof defaultExport !== 'object' || defaultExport === null) return null;
  const { manifest, sheets } = defaultExport as {
    manifest?: unknown;
    sheets?: unknown;
  };
  if (typeof manifest !== 'object' || manifest === null) return null;
  if (typeof sheets !== 'object' || sheets === null) return null;

  const slotRecord = (manifest as { states?: unknown }).states;
  if (typeof slotRecord !== 'object' || slotRecord === null) return null;

  const checked: Record<PetState, SheetSource> = {} as Record<PetState, SheetSource>;
  for (const state of PET_STATES) {
    const slot = (slotRecord as Record<string, unknown>)[state];
    const sheet = (sheets as Record<string, unknown>)[state];
    if (typeof sheet !== 'object' || sheet === null) return null;
    const { url, frames } = sheet as { url?: unknown; frames?: unknown };
    if (typeof url !== 'string' || url === '') return null;
    if (typeof frames !== 'number' || !Number.isInteger(frames) || frames <= 0) return null;
    // Cross-check the module's two halves against each other.
    const slotFrames = (slot as { frames?: unknown } | undefined)?.frames;
    if (slotFrames !== frames) return null;
    checked[state] = { url, frames };
  }
  return { manifest: manifest as CharacterPackManifest, sheets: checked };
}

/** A 1-frame placeholder blob — the pack that can never fail to load. */
const FALLBACK_GLYPH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' +
  '<circle cx="128" cy="150" r="62" fill="#9aa5b1" stroke="#4a5560" stroke-width="3"/>' +
  '<circle cx="108" cy="140" r="6" fill="#1f2933"/><circle cx="148" cy="140" r="6" fill="#1f2933"/>' +
  '<path d="M 114 166 Q 128 176 142 166" fill="none" stroke="#1f2933" stroke-width="4" stroke-linecap="round"/>' +
  '</svg>';
const FALLBACK_GLYPH_URL = `data:image/svg+xml,${encodeURIComponent(FALLBACK_GLYPH_SVG)}`;

export const FALLBACK_PACK_ID = 'pet-2d-fallback';

/** The static fallback: same 15 states, one grey frame each. */
export function fallbackPack(): CharacterPack {
  const sheets = {} as Record<PetState, SheetSource>;
  const states = {} as Record<PetState, { sheet: string; frames: number; fps: number; playback: 'loop' }>;
  for (const state of PET_STATES) {
    sheets[state] = { url: FALLBACK_GLYPH_URL, frames: 1 };
    states[state] = { sheet: 'fallback', frames: 1, fps: 2, playback: 'loop' };
  }
  return {
    manifest: {
      apiVersion: 1,
      id: FALLBACK_PACK_ID,
      name: 'Fallback',
      credit: 'elftia-plugin-pet-2d',
      license: 'MIT',
      states,
    },
    sheets,
  };
}
