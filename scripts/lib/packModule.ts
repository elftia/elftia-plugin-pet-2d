/**
 * scripts/lib/packModule.ts — D1's pack-module emission: one ES module per
 * pack, default-exporting `{ manifest, sheets }` where each sheet entry is a
 * `SheetSource = { url, frames }` and `url` is a DATA URI. This is the ONLY
 * place a sheet's URL flavor is produced (the runtime loader never sees a
 * transport — `src/packs/loadPack.ts` consumes whatever `url` string is
 * here), and it is shared by build-packs, verify-packs, and the Tier-B
 * tests so the emitted format cannot drift between them.
 *
 * Why data URIs (D1, spike ① re-probe): the pet window loads from
 * `app://bundle` (dev: localhost) — from that origin a cross-origin
 * `plugin://…` `<img>` is `img-src`-blocked and `fetch` is `connect-src`
 * `-blocked`, while a dynamic `.mjs` module import loads AND stays
 * canvas-readable (the alpha hit-test needs untainted `getImageData`).
 */
import type { CharacterPackManifest } from '../../src/contract/characterPack';

/** The one sheet entry the runtime player consumes (mirrors loadPack.ts). */
export interface EmittedSheetSource {
  readonly url: string;
  readonly frames: number;
}

/** Percent-encoded inline SVG — ASCII-safe, no base64 inflation for the shipped packs. */
export function svgSheetToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

/** Base64 inline PNG — ~4/3× the bytes (D1's documented cost for PNG-based packs). */
export function pngSheetToDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
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
