/**
 * scripts/e2e/seed.ts — Tier-C step 1 (task 8.2): seed `packs/whale-girl/`
 * ON DISK into the isolated dev app's user-pack store, exactly the state a
 * real user ends up with after an import (or a studio save + app restart).
 * Runs the SAME production pipeline as the studio's save path —
 * `fromWhaleGirlManifest` → `assemblePackFromManifest` → `installPackDir` —
 * mirroring `src/packs/__tests__/petpackRoundTrip.tierB.test.ts`.
 *
 * Usage: npx tsx scripts/e2e/seed.ts <userDataPluginDataPet2dDir>
 *   e.g. npx tsx scripts/e2e/seed.ts \
 *     C:/Users/Sayo/AppData/Local/Temp/pet2d-spike/elftia-udd/plugin-data/pet-2d
 *
 * Idempotent: overwrites an existing whale-girl install, never touches any
 * other pack. The fixture is TEST material (ZipZipPipe art) and lands ONLY
 * in the app's plugin-data store — never in this repo's `dist/`.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { nodeAssembleFs } from '../../src/main/nodeAssembleFs';
import { installPackDir } from '../../src/main/packStore';
import { FIXTURE_WHALE_GIRL_DIR } from '../../src/packs/__fixtures__/paths';
import { assemblePackFromManifest } from '../../src/packs/assemblePack';
import { fromWhaleGirlManifest } from '../../src/packs/whaleGirlCompat';

async function main(): Promise<void> {
  const dataDir = process.argv[2];
  if (dataDir === undefined || dataDir === '') {
    throw new Error('usage: npx tsx scripts/e2e/seed.ts <plugin-data/pet-2d dir>');
  }
  const packsRoot = join(dataDir, 'packs');
  const assetsDir = join(FIXTURE_WHALE_GIRL_DIR, 'lib', 'assets');
  const characterDir = join(assetsDir, 'characters', 'whale-girl');
  if (!existsSync(assetsDir)) {
    throw new Error(`fixture absent: ${assetsDir} (Tier-C needs the real whale-girl atlas)`);
  }

  const manifestJson: unknown = JSON.parse(await readFile(join(assetsDir, 'manifest.json'), 'utf8'));
  const assembled = await assemblePackFromManifest(
    fromWhaleGirlManifest(manifestJson, 'whale-girl'),
    characterDir,
    nodeAssembleFs,
  );
  await mkdir(packsRoot, { recursive: true });
  const saved = await installPackDir(packsRoot, {
    manifest: assembled.manifest,
    sheetFiles: Object.values(assembled.sheetSources).map((sheet) => ({
      name: `sheets/${basename(sheet.path)}`,
      path: sheet.path,
    })),
    overwrite: true,
    builtinIds: new Set(['elf-blob', 'tin-bot']),
  });
  if (saved.ok !== true) {
    throw new Error(`seed install failed: ${JSON.stringify(saved.problems)}`);
  }
  console.log(`SEEDED pack "${saved.id}" -> ${join(packsRoot, saved.id)} (15 states)`);
}

main().catch((error) => {
  console.error(`SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
