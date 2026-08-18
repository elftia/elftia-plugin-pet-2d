/**
 * scripts/lib/packModule.ts — D1's pack-module EMISSION (build-time only).
 * The data-URI encoders moved to `src/packs/assemblePack.ts` (task 2.2) —
 * that src module is now the ONLY place a sheet's URL flavor is produced
 * (emitted modules here and the main half's `packs:load` payloads share
 * those encoders byte-for-byte); this file emits one ES module per pack,
 * default-exporting `{ manifest, sheets }` where each sheet entry is an
 * `EmittedSheetSource = { url, frames }`. User packs NEVER get a module
 * (D8) — they ride the store + ipc instead, so this emitter is not in
 * their path at all.
 */
import type { CharacterPackManifest } from '../../src/contract/characterPack';

/** The one sheet entry the runtime player consumes (mirrors loadPack.ts). */
export interface EmittedSheetSource {
  readonly url: string;
  readonly frames: number;
}

/**
 * The pack module text: a tiny header a pack author can recognise in `dist/`,
 * the manifest verbatim (JSON), and per-state `{ url, frames }`.
 */
export function emitPackModule(
  manifest: CharacterPackManifest,
  sheets: Record<string, EmittedSheetSource>
): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  const sheetsJson = JSON.stringify(sheets, null, 2);
  return [
    '// GENERATED FILE — do not edit. Emitted by scripts/build-packs.ts.',
    `// Source: the pack's packs-src/<id>/ directory (or --from-whale-girl input).`,
    '// Contract: docs/character-pack.md (D1 — data-URI pack modules; the pet',
    '// window imports this module cross-origin, so sheet bytes ride inside it).',
    'export default {',
    `  manifest: ${manifestJson},`,
    `  sheets: ${sheetsJson},`,
    '};',
    '',
  ].join('\n');
}
