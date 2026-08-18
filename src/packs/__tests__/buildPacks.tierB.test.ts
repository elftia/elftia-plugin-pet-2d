/**
 * src/packs/__tests__/buildPacks.tierB.test.ts — task 6.8 Tier-B: the pack
 * pipeline against the REAL whale-girl fixture (real PNG bytes, real IHDR
 * dimensions, the full install layout). Tier-B because the fixture is
 * stripped before publication (ZipZipPipe's character art is not ours to
 * ship): when `fixtures/whale-girl/` is absent these tests SKIP with a
 * clear message instead of failing a fresh clone.
 *
 * The always-run halves of the story live elsewhere: synthetic-pack builds
 * in buildPack.test.ts, manifest adaptation in whaleGirlCompat.test.ts.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPackFromWhaleGirlInstall } from '../../../scripts/lib/buildPack';
import { measurePngDimensions, measureSheetFile } from '../../../scripts/lib/measureSheets';
import { validateCharacterPack } from '../../contract/characterPack';
import { FIXTURE_WHALE_GIRL_DIR } from '../__fixtures__/paths';

const FIXTURE_PRESENT = existsSync(FIXTURE_WHALE_GIRL_DIR);
const CHARACTER_SHEET_DIR = join(FIXTURE_WHALE_GIRL_DIR, 'lib', 'assets', 'characters', 'whale-girl');

describe.skipIf(!FIXTURE_PRESENT)(
  'Tier-B: real whale-girl fixture (skipped when fixtures/whale-girl is absent — it is stripped before publication)',
  () => {
    let outDir: string;

    beforeAll(async () => {
      outDir = await mkdtemp(join(tmpdir(), 'pet2d-wg-tierb-'));
    });

    afterAll(async () => {
      await rm(outDir, { recursive: true, force: true });
    });

    it('measures real PNG sheets from their IHDR: idle strip 768×256, drag 256×256', async () => {
      await expect(measureSheetFile(join(CHARACTER_SHEET_DIR, 'idle.png'))).resolves.toEqual({
        width: 768,
        height: 256,
      });
      await expect(measureSheetFile(join(CHARACTER_SHEET_DIR, 'drag.png'))).resolves.toEqual({
        width: 256,
        height: 256,
      });
    });

    it('rejects non-PNG bytes with a readable signature error', () => {
      expect(() => measurePngDimensions(new TextEncoder().encode('<svg/>'))).toThrow(/not a PNG/);
    });

    it('end-to-end: adapt → measure → validate (real dims) → inline → emit → re-import', async () => {
      // The full production path `build-packs --from-whale-girl` drives; a
      // clean return here already proves validateCharacterPack passed with
      // the REAL measured dimensions (buildPack throws on any problem).
      const built = await buildPackFromWhaleGirlInstall(FIXTURE_WHALE_GIRL_DIR, 'whale-girl');

      expect(built.manifest.id).toBe('whale-girl');
      expect(built.sheets.walk.frames).toBe(3);
      expect(built.sheets.walk.url.startsWith('data:image/png;base64,')).toBe(true);
      // Real strip geometry made it through the gate: idle = 3 frames × 256.
      const idleSheet = built.manifest.states.idle.sheet;
      expect(built.measured[idleSheet]).toEqual({ width: 768, height: 256 });

      // Written output is the D1 module shape and re-imports cleanly.
      const modulePath = join(outDir, 'pack.mjs');
      await writeFile(modulePath, built.code, 'utf8');
      const mod = (await import(pathToFileURL(modulePath).href)) as {
        default: { manifest: { id: string }; sheets: Record<string, { frames: number }> };
      };
      expect(mod.default.manifest.id).toBe('whale-girl');
      expect(mod.default.sheets.sleep.frames).toBe(2);

      // And the write went OUTSIDE dist/ — whale-girl art never ships.
      const repoDist = fileURLToPath(new URL('../../../dist/', import.meta.url));
      expect(resolve(modulePath).startsWith(resolve(repoDist))).toBe(false);
    });

    it('a strip whose width contradicts the declared frames is flagged by the gate', async () => {
      const built = await buildPackFromWhaleGirlInstall(FIXTURE_WHALE_GIRL_DIR, 'whale-girl');
      // Real measured dims, but idle's slot claims 1 frame → expected width
      // 256, actual 768. The gate must say so, precisely.
      const { manifest, measured } = built;
      const tampered = {
        ...manifest,
        states: {
          ...manifest.states,
          idle: { ...manifest.states.idle, frames: 1 },
        },
      };
      const problems = validateCharacterPack(tampered, measured);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('768'))).toBe(true);
    });
  }
);
