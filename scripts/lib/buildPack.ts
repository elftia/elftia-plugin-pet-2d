/**
 * scripts/lib/buildPack.ts — the shared pack-build pipeline for BOTH source
 * layouts (task 6.1 + 6.4): read the manifest, resolve+measure every sheet,
 * run the ONE validator (`validateCharacterPack` — the same gate
 * `verify-packs` runs; a pack that builds is a pack that validates), inline
 * sheets as data URIs, and emit the pack-module text. Pure-ish (all fs
 * behind injected reads where practical) so Tier-B tests drive the exact
 * production path — there is no second, drifting build implementation.
 *
 * Layouts:
 *  - packs-src: `<packDir>/pack.json` + `<packDir>/sheets/<sheet>` — the
 *    repo's own packs and what a third-party author writes.
 *  - whale-girl: `<wgRoot>/lib/assets/manifest.json` +
 *    `lib/assets/characters/<id>/<sheet>` (registry form) or flat
 *    `lib/assets/<sheet>` (legacy form) — what
 *    `build-packs --from-whale-girl <dir>` reads. We ship the reader, never
 *    the art (D8).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type CharacterPackManifest,
  type MeasuredSheetDimensions,
  validateCharacterPack,
} from '../../src/contract/characterPack';
import { fromWhaleGirlManifest } from '../../src/packs/whaleGirlCompat';
import { isPngBytes, measureSheetFile, type SheetDimensions } from './measureSheets';
import {
  emitPackModule,
  type EmittedSheetSource,
  pngSheetToDataUri,
  svgSheetToDataUri,
} from './packModule';

export interface BuiltPack {
  readonly manifest: CharacterPackManifest;
  readonly sheets: Record<string, EmittedSheetSource>;
  /** The emitted pack.mjs text (already data-URI-inlined). */
  readonly code: string;
  /** Measured {width,height} per sheet name (already validator-checked). */
  readonly measured: MeasuredSheetDimensions;
}

/** Build from a packs-src-style directory: `pack.json` + `sheets/`. */
export async function buildPackFromSourceDir(packDir: string): Promise<BuiltPack> {
  const manifest: CharacterPackManifest = JSON.parse(
    await readFile(join(packDir, 'pack.json'), 'utf8')
  );
  return buildPack(manifest, join(packDir, 'sheets'));
}

/**
 * Build from a whale-girl checkout/install root: adapts the manifest
 * (`whaleGirlCompat`, D8's four adaptations), then builds from the
 * character's sheet directory. The OUTPUT is the caller's own build —
 * nothing here writes anywhere.
 */
export async function buildPackFromWhaleGirlInstall(
  wgRoot: string,
  characterId: string
): Promise<BuiltPack> {
  const wgManifest: unknown = JSON.parse(
    await readFile(join(wgRoot, 'lib', 'assets', 'manifest.json'), 'utf8')
  );
  const manifest = fromWhaleGirlManifest(wgManifest, characterId);
  const registryEntry =
    typeof wgManifest === 'object' &&
    wgManifest !== null &&
    typeof (wgManifest as { characters?: unknown }).characters === 'object' &&
    (wgManifest as { characters: Record<string, unknown> }).characters[characterId] !== undefined;
  const sheetDir = registryEntry
    ? join(wgRoot, 'lib', 'assets', 'characters', characterId)
    : join(wgRoot, 'lib', 'assets'); // legacy flat form: sheets beside the manifest
  return buildPack(manifest, sheetDir);
}

/** The shared pipeline: resolve → measure → validate → inline → emit. */
async function buildPack(
  manifest: CharacterPackManifest,
  sheetDir: string
): Promise<BuiltPack> {
  const sheetNames = [...new Set(Object.values(manifest.states).map((slot) => slot.sheet))];

  // Mutable while assembling; crosses into MeasuredSheetDimensions (the
  // readonly param type) only at the validate/return boundary.
  const measured: Record<string, SheetDimensions> = {};
  const urlBySheet: Record<string, string> = {};
  for (const sheetName of sheetNames) {
    const file = await resolveSheetFile(sheetDir, sheetName);
    measured[sheetName] = await measureSheetFile(file);
    const bytes = await readFile(file);
    urlBySheet[sheetName] = isPngBytes(bytes)
      ? pngSheetToDataUri(bytes)
      : svgSheetToDataUri(bytes.toString('utf8'));
  }

  const problems = validateCharacterPack(manifest, measured);
  if (problems.length > 0) {
    throw new Error(
      `pack "${manifest.id}" failed validation (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`
    );
  }

  // The pack module's sheets are STATE-keyed (D1): the runtime maps a state
  // straight to its SheetSource. `frames` rides both here and in the manifest
  // slot; the runtime cross-checks them and falls back on mismatch.
  const sheets: Record<string, EmittedSheetSource> = {};
  for (const [state, slot] of Object.entries(manifest.states)) {
    sheets[state] = { url: urlBySheet[slot.sheet], frames: slot.frames };
  }

  return { manifest, sheets, code: emitPackModule(manifest, sheets), measured };
}

/** `<name>` as-is, else with `.svg`/`.png` appended; readable error if absent. */
async function resolveSheetFile(sheetDir: string, sheetName: string): Promise<string> {
  for (const candidate of [sheetName, `${sheetName}.svg`, `${sheetName}.png`]) {
    const path = join(sheetDir, candidate);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      // not present — try the next candidate
    }
  }
  let present = '';
  try {
    present = (await readdir(sheetDir)).join(', ');
  } catch {
    present = '<sheet directory unreadable>';
  }
  throw new Error(
    `sheet "${sheetName}" not found in ${sheetDir} (tried verbatim, .svg, .png). Directory contains: ${present}`
  );
}
