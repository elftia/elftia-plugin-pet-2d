/**
 * src/packs/assemblePack.ts — the ONE resolve+measure+validate(+inline)
 * pipeline (task 2.2, extracted from `scripts/lib/buildPack.ts` verbatim).
 * Consumers: build-packs / verify-packs (via the script-side wrapper), the
 * main half's save/import/catalog (D5/D7), and the Tier-B acceptance — there
 * is no second, drifting build implementation, per that old header's rule.
 *
 * The module-EMIT half (`emitPackModule`) stays in `scripts/lib/packModule.ts`
 * — build-time only; user packs never emit modules (D8).
 *
 * Environment-free: every fs/path touch is INJECTED (`AssembleFs`) so this
 * file typechecks/lints under the same browser-ambient rules as the rest of
 * `src/packs/` while running node-side in practice. The data-URI encoders
 * here are the ONLY place a sheet URL flavor is produced (D1/D6): the
 * emitted pack modules and the main half's `packs:load` payloads share them
 * byte-for-byte — btoa/TextDecoder, not Buffer, so they run in any context.
 */
import {
  type CharacterPackManifest,
  type MeasuredSheetDimensions,
  validateCharacterPack,
} from '../contract/characterPack';
import type { PetState } from '../contract/petState';
import type { SheetSource } from './loadPack';
import { isPngBytes, measureSheetBytes, type SheetDimensions } from './measureSheets';
import { fromWhaleGirlManifest } from './whaleGirlCompat';

/** The injected fs/path surface the pipeline needs (see header). */
export interface AssembleFs {
  readFileBytes(path: string): Promise<Uint8Array>;
  readFileText(path: string): Promise<string>;
  isFile(path: string): Promise<boolean>;
  listDir(path: string): Promise<string[]>;
  joinPath(...parts: string[]): string;
}

/** A resolved, measured, inlined sheet (keyed by SHEET NAME, not state). */
export interface AssembledSheet {
  /** The resolved source path (verbatim / `.svg` / `.png` candidate). */
  readonly path: string;
  /** Real measured dimensions — already validator-checked. */
  readonly dimensions: SheetDimensions;
  /** The data-URI inline (the encoders below). */
  readonly url: string;
}

/** What the shared pipeline returns. */
export interface AssembledPack {
  readonly manifest: CharacterPackManifest;
  /** STATE-keyed sheet sources (D1) — exactly what the runtime player consumes. */
  readonly sheets: Readonly<Record<PetState, SheetSource>>;
  /** Per-SHEET-NAME resolved sources (paths + dims + urls). */
  readonly sheetSources: Readonly<Record<string, AssembledSheet>>;
  /** Measured {width,height} per sheet name (the validator's input). */
  readonly measured: MeasuredSheetDimensions;
}

// --- data-URI encoders (D1/D6 — the single URL-flavor source) ---------------

/** Percent-encoded inline SVG — ASCII-safe, no base64 inflation for the shipped packs. */
export function svgSheetToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

/** Base64 inline PNG — ~4/3× the bytes (D1's documented cost for PNG-based packs). */
export function pngSheetToDataUri(bytes: Uint8Array): string {
  // Chunked spread: String.fromCharCode is variadic with a call-argument cap,
  // and MB-scale sheets blow past it in one shot.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Dispatch on content (PNG magic or SVG text) — the same rule `measureSheetBytes` uses. */
export function sheetToDataUri(bytes: Uint8Array): string {
  return isPngBytes(bytes)
    ? pngSheetToDataUri(bytes)
    : svgSheetToDataUri(new TextDecoder().decode(bytes));
}

// --- entries ------------------------------------------------------------------

/** Build from a packs-src-style directory: `pack.json` + `sheets/`. */
export async function assemblePackFromSourceDir(
  packDir: string,
  fs: AssembleFs
): Promise<AssembledPack> {
  const manifest: CharacterPackManifest = JSON.parse(
    await fs.readFileText(fs.joinPath(packDir, 'pack.json'))
  );
  return assemblePackCore(manifest, fs.joinPath(packDir, 'sheets'), fs);
}

/**
 * Assemble a DRAFT manifest against an arbitrary sheet dir — the studio save
 * path (D7.5/D5): the manifest comes from the payload (not yet on disk) and
 * sheets resolve inside the PICKED source dir (flat, like the catalog lists
 * them; the store's `sheets/` subdirectory shape is what INSTALL writes).
 */
export function assemblePackFromManifest(
  manifest: CharacterPackManifest,
  sheetDir: string,
  fs: AssembleFs
): Promise<AssembledPack> {
  return assemblePackCore(manifest, sheetDir, fs);
}

/**
 * whale-girl sheet-dir resolution, folded out of the old
 * `buildPackFromWhaleGirlInstall` (task 2.2) so the studio's auto-fill (D8)
 * and the build share ONE rule: registry form (`characters/<id>/`) when the
 * manifest declares the character, else the legacy flat form (sheets beside
 * the manifest). Returns path SEGMENTS — callers join against their own root.
 */
export function resolveSheetDir(wgManifest: unknown, characterId: string): string[] {
  const registryEntry =
    typeof wgManifest === 'object' &&
    wgManifest !== null &&
    typeof (wgManifest as { characters?: unknown }).characters === 'object' &&
    (wgManifest as { characters: Record<string, unknown> }).characters[characterId] !== undefined;
  return registryEntry
    ? ['lib', 'assets', 'characters', characterId]
    : ['lib', 'assets']; // legacy flat form: sheets beside the manifest
}

/**
 * Build from a whale-girl checkout/install root: adapts the manifest
 * (`whaleGirlCompat`, D8's four adaptations), resolves the sheet dir
 * (`resolveSheetDir` above), then runs the shared pipeline.
 */
export async function assemblePackFromWhaleGirlInstall(
  wgRoot: string,
  characterId: string,
  fs: AssembleFs
): Promise<AssembledPack> {
  const wgManifest: unknown = JSON.parse(
    await fs.readFileText(fs.joinPath(wgRoot, 'lib', 'assets', 'manifest.json'))
  );
  const manifest = fromWhaleGirlManifest(wgManifest, characterId);
  const sheetDir = fs.joinPath(wgRoot, ...resolveSheetDir(wgManifest, characterId));
  return assemblePackCore(manifest, sheetDir, fs);
}

// --- the shared pipeline: resolve → measure → inline → validate --------------

async function assemblePackCore(
  manifest: CharacterPackManifest,
  sheetDir: string,
  fs: AssembleFs
): Promise<AssembledPack> {
  const sheetNames = [...new Set(Object.values(manifest.states).map((slot) => slot.sheet))];

  // Mutable while assembling; crosses into MeasuredSheetDimensions (the
  // readonly param type) only at the validate/return boundary.
  const measured: Record<string, SheetDimensions> = {};
  const sheetSources: Record<string, AssembledSheet> = {};
  for (const sheetName of sheetNames) {
    const file = await resolveSheetFile(fs, sheetDir, sheetName);
    const bytes = await fs.readFileBytes(file);
    const dimensions = measureSheetBytes(bytes);
    measured[sheetName] = dimensions;
    sheetSources[sheetName] = { path: file, dimensions, url: sheetToDataUri(bytes) };
  }

  const problems = validateCharacterPack(manifest, measured);
  if (problems.length > 0) {
    throw new Error(
      `pack "${manifest.id}" failed validation (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`
    );
  }

  // The pack's sheets are STATE-keyed (D1): the runtime maps a state straight
  // to its SheetSource. `frames` rides both here and in the manifest slot;
  // the runtime cross-checks them and falls back on mismatch.
  const sheets = {} as Record<PetState, SheetSource>;
  for (const [state, slot] of Object.entries(manifest.states)) {
    sheets[state as PetState] = { url: sheetSources[slot.sheet].url, frames: slot.frames };
  }

  return { manifest, sheets, sheetSources, measured };
}

/** `<name>` as-is, else with `.svg`/`.png` appended; readable error if absent. */
async function resolveSheetFile(
  fs: AssembleFs,
  sheetDir: string,
  sheetName: string
): Promise<string> {
  // Transport-layer guard (fix-round F1): a sheet NAME is one path segment.
  // It is joined into `sheetDir` BEFORE validateCharacterPack runs (which
  // checks non-empty-string only), so a hostile manifest — a crafted
  // `.petpack` import or `packs:save` payload — could otherwise aim the
  // resolve/read OUTSIDE the sheet dir, and the stored pack.json would keep
  // the traversal name and re-read outside on every `packs:load`. Same
  // discipline as the verbs' previewFile name check; the contract's state
  // table itself is untouched.
  if (sheetName === '' || sheetName === '.' || sheetName === '..' || /[\\/]/.test(sheetName)) {
    throw new Error(`sheet name "${sheetName}" is not a plain file name`);
  }
  for (const candidate of [sheetName, `${sheetName}.svg`, `${sheetName}.png`]) {
    const path = fs.joinPath(sheetDir, candidate);
    if (await fs.isFile(path)) return path;
  }
  let present = '';
  try {
    present = (await fs.listDir(sheetDir)).join(', ');
  } catch {
    present = '<sheet directory unreadable>';
  }
  throw new Error(
    `sheet "${sheetName}" not found in ${sheetDir} (tried verbatim, .svg, .png). Directory contains: ${present}`
  );
}
