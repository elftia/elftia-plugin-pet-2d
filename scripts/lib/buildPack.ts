/**
 * scripts/lib/buildPack.ts — the build-side wrapper over the shared pipeline
 * (task 2.2): the resolve+measure+validate+inline CORE lives in
 * `src/packs/assemblePack.ts` (fs injected) and the node binding lives in
 * `src/main/nodeAssembleFs.ts` (one implementation, shared with the main
 * half — D8's "no second, drifting build implementation" rule). This file
 * adds the one thing only the BUILD path does: the module EMIT
 * (`packModule.ts` — build-time only; user packs never emit).
 *
 * Public API unchanged from pre-extraction (BuiltPack incl. `code`), so
 * build-packs.ts / verify-packs.ts / the Tier-B tests consume it unchanged.
 */
import type { CharacterPackManifest, MeasuredSheetDimensions } from '../../src/contract/characterPack';
import { nodeAssembleFs } from '../../src/main/nodeAssembleFs';
import {
  type AssembledPack,
  assemblePackFromSourceDir,
  assemblePackFromWhaleGirlInstall,
} from '../../src/packs/assemblePack';
import { emitPackModule, type EmittedSheetSource } from './packModule';

export interface BuiltPack {
  readonly manifest: CharacterPackManifest;
  readonly sheets: Record<string, EmittedSheetSource>;
  /** The emitted pack.mjs text (already data-URI-inlined). */
  readonly code: string;
  /** Measured {width,height} per sheet name (already validator-checked). */
  readonly measured: MeasuredSheetDimensions;
}

/** Shared core result + the build-only module emit. */
function toBuiltPack(assembled: AssembledPack): BuiltPack {
  const sheets = assembled.sheets as Record<string, EmittedSheetSource>;
  return {
    manifest: assembled.manifest,
    sheets,
    code: emitPackModule(assembled.manifest, sheets),
    measured: assembled.measured,
  };
}

/** Build from a packs-src-style directory: `pack.json` + `sheets/`. */
export async function buildPackFromSourceDir(packDir: string): Promise<BuiltPack> {
  return toBuiltPack(await assemblePackFromSourceDir(packDir, nodeAssembleFs));
}

/**
 * Build from a whale-girl checkout/install root: adapts the manifest
 * (`whaleGirlCompat`, D8's four adaptations), then builds from the
 * character's sheet directory (registry or legacy flat — `resolveSheetDir`
 * in the shared core). The OUTPUT is the caller's own build — nothing here
 * writes anywhere.
 */
export async function buildPackFromWhaleGirlInstall(
  wgRoot: string,
  characterId: string
): Promise<BuiltPack> {
  return toBuiltPack(await assemblePackFromWhaleGirlInstall(wgRoot, characterId, nodeAssembleFs));
}
