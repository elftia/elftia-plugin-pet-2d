/**
 * src/packs/__tests__/petpackRoundTrip.tierB.test.ts — task 8.1, D11's
 * acceptance loop against the REAL whale-girl atlas, driven through the
 * SAME production pieces the studio and the store use — nothing mocked
 * except the store's root:
 *
 *   author : fromWhaleGirlManifest + assemblePackFromManifest over
 *            fixtures/whale-girl/lib/assets (the studio's save path)
 *   package: installPackDir → store layout assertions
 *   export : writePetpack → a real .petpack in temp
 *   delete : deletePack → the store dir is gone, the SOURCE atlas untouched
 *   import : readPetpack → installPackDir again (the guard ladder re-rides)
 *   use    : assemblePackFromSourceDir over the reinstalled dir → the
 *            manifest and every state's sheet data-URI are byte-equal to
 *            the authored ones — what packs:load would hand the pet window
 *
 * Tier-B: the fixture is stripped before publication (ZipZipPipe's art is
 * not ours to ship), so the whole suite skips cleanly when it is absent.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { nodeAssembleFs } from '../../main/nodeAssembleFs';
import { deletePack, installPackDir, readPackDir } from '../../main/packStore';
import { readPetpack, writePetpack } from '../../main/petpackFile';
import { FIXTURE_WHALE_GIRL_DIR } from '../__fixtures__/paths';
import {
  type AssembledPack,
  assemblePackFromManifest,
  assemblePackFromSourceDir,
} from '../assemblePack';
import { fromWhaleGirlManifest } from '../whaleGirlCompat';

const FIXTURE_PRESENT = existsSync(FIXTURE_WHALE_GIRL_DIR);
const ASSETS_DIR = join(FIXTURE_WHALE_GIRL_DIR, 'lib', 'assets');
const CHARACTER_DIR = join(ASSETS_DIR, 'characters', 'whale-girl');

describe.skipIf(!FIXTURE_PRESENT)(
  'Tier-B: whale-girl author → package → delete → import → use (skipped when fixtures/whale-girl is absent)',
  () => {
    let storeRoot: string;
    let workDir: string;
    let authored: AssembledPack;
    const builtinIds = new Set<string>(['elf-blob', 'tin-bot']);

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'pet2d-wg-loop-'));
      storeRoot = join(workDir, 'packs');
      await mkdir(storeRoot, { recursive: true });
      // The author step: the registry manifest adapted, then assembled over
      // the character dir (measured + validated with the REAL dims).
      const manifestJson: unknown = JSON.parse(
        await readFile(join(ASSETS_DIR, 'manifest.json'), 'utf8'),
      );
      authored = await assemblePackFromManifest(
        fromWhaleGirlManifest(manifestJson, 'whale-girl'),
        CHARACTER_DIR,
        nodeAssembleFs,
      );
    });

    afterAll(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    it('package: the studio save path installs the authored pack (store layout asserted)', async () => {
      const sheetFiles = Object.values(authored.sheetSources).map((sheet) => ({
        name: `sheets/${basename(sheet.path)}`,
        path: sheet.path,
      }));
      const saved = await installPackDir(storeRoot, {
        manifest: authored.manifest,
        sheetFiles,
        overwrite: false,
        builtinIds,
      });
      expect(saved).toEqual({ ok: true, id: 'whale-girl' });

      // D3 layout: the directory IS the index — pack.json + sheets/<name>.
      const dir = await readPackDir(storeRoot, 'whale-girl');
      expect(dir).toBe(join(storeRoot, 'whale-girl'));
      const packDir = dir as string; // asserted above — `toBe` narrows only at runtime
      const storedManifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
      expect(storedManifest.id).toBe('whale-girl');
      const sheets = (await readdir(join(packDir, 'sheets'))).filter((n) => n.endsWith('.png'));
      expect(sheets).toHaveLength(PET_STATES.length);

      // The author's source atlas was COPIED from, never moved or touched.
      expect(existsSync(join(CHARACTER_DIR, 'idle.png'))).toBe(true);
      // whale-girl bytes never landed anywhere near the repo's dist/.
      expect(packDir.includes(join('elftia-plugin-pet-2d', 'dist'))).toBe(false);
    });

    it('export → delete → import back → data-equal (what the pet window would load)', async () => {
      const dir = await readPackDir(storeRoot, 'whale-girl');
      expect(dir).not.toBeNull();
      const packDir = dir as string; // asserted above — `toBeNull` narrows only at runtime

      // export: a real .petpack file in temp (outside the store and the repo).
      const petpackPath = join(workDir, 'whale-girl.petpack');
      await writePetpack(packDir, petpackPath);
      expect(existsSync(petpackPath)).toBe(true);

      // delete: the store dir disappears; the source atlas is still there.
      const deleted = await deletePack(storeRoot, 'whale-girl');
      expect(deleted).toEqual({ ok: true, id: 'whale-girl', existed: true });
      expect(await readPackDir(storeRoot, 'whale-girl')).toBeNull();
      expect(existsSync(join(CHARACTER_DIR, 'idle.png'))).toBe(true);

      // import: the reader ladder → the ONE install pipeline.
      const contents = await readPetpack(petpackPath);
      const imported = await installPackDir(storeRoot, {
        manifest: contents.manifest as never,
        sheetFiles: contents.sheetFiles,
        overwrite: false,
        builtinIds,
      });
      expect(imported).toEqual({ ok: true, id: 'whale-girl' });

      // use: re-assemble from the store — manifest and every sheet URI
      // byte-equal to the authored pack (the D6 payload the pet renders).
      const roundTripped = await assemblePackFromSourceDir(
        join(storeRoot, 'whale-girl'),
        nodeAssembleFs,
      );
      expect(roundTripped.manifest).toEqual(authored.manifest);
      for (const state of PET_STATES) {
        expect(roundTripped.sheets[state].url).toBe(authored.sheets[state].url);
      }
    });
  }
);
