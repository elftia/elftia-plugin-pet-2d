/**
 * src/packs/__tests__/buildPack.test.ts — task 6.8 (always-run half): the
 * pack builder against SYNTHETIC packs in temp dirs — the happy path, the
 * missing-sheet readable error, and the strip-dimension rejection. The
 * whale-girl end-to-end lives in buildPacks.tierB.test.ts (fixture-gated).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPackFromSourceDir } from '../../../scripts/lib/buildPack';
import { PET_STATES } from '../../contract/petState';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pet2d-buildpack-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** A 256×256 single-frame sheet (square = 1 frame × frameSize 256). */
const ONE_FRAME_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#8a8f98"/></svg>';
/** A 512×256 strip — claims two 256px frames. */
const TWO_FRAME_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><rect width="512" height="256" fill="#8a8f98"/></svg>';

/** Writes a complete, valid synthetic pack (15 states × 1 frame). */
async function writeValidPack(dir: string): Promise<void> {
  const states: Record<string, { sheet: string; frames: number; fps: number; playback: 'loop' }> = {};
  for (const state of PET_STATES) {
    states[state] = { sheet: `${state}.svg`, frames: 1, fps: 2, playback: 'loop' };
  }
  const manifest = {
    apiVersion: 1,
    id: 'synth-pack',
    name: 'Synth Pack',
    credit: 'ATELIER AI',
    license: 'CC0-1.0',
    meta: { frameSize: 256, stageScale: 1 },
    states,
  };
  await mkdir(join(dir, 'sheets'), { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest), 'utf8');
  for (const state of PET_STATES) {
    await writeFile(join(dir, 'sheets', `${state}.svg`), ONE_FRAME_SVG, 'utf8');
  }
}

describe('buildPackFromSourceDir (synthetic packs)', () => {
  it('builds a valid pack: state-keyed sheets, measured, module code emitted', async () => {
    const dir = join(workDir, 'valid');
    await writeValidPack(dir);
    const result = await buildPackFromSourceDir(dir);

    expect(result.manifest.id).toBe('synth-pack');
    // Sheets are STATE-keyed (D1), one entry per PET_STATE.
    expect(Object.keys(result.sheets).sort()).toEqual([...PET_STATES].sort());
    expect(result.sheets.idle.frames).toBe(1);
    expect(result.sheets.idle.url.startsWith('data:image/svg+xml,')).toBe(true);
    // Measured geometry (keyed by SHEET NAME): 1 frame × 256 = 256 wide, 256 tall.
    expect(result.measured[result.manifest.states.idle.sheet]).toEqual({ width: 256, height: 256 });
    // The emitted module is the D1 pack-module shape.
    expect(result.code).toContain('export default');
    expect(result.code).toContain('"id": "synth-pack"');
  });

  it('a missing sheet file fails with a readable error naming the dir contents', async () => {
    const dir = join(workDir, 'missing-sheet');
    await writeValidPack(dir);
    await rm(join(dir, 'sheets', 'sleep.svg'));

    await expect(buildPackFromSourceDir(dir)).rejects.toThrow(/sleep/);
    await expect(buildPackFromSourceDir(dir)).rejects.toThrow(/idle\.svg/); // dir listing
  });

  it('a strip whose width contradicts the declared frame count is rejected by the gate', async () => {
    const dir = join(workDir, 'bad-strip');
    await writeValidPack(dir);
    // idle declares frames:1 but the strip holds two frames → width 512 ≠ 1×256.
    await writeFile(join(dir, 'sheets', 'idle.svg'), TWO_FRAME_SVG, 'utf8');

    await expect(buildPackFromSourceDir(dir)).rejects.toThrow(/idle/);
  });

  it('pack.json must exist', async () => {
    const dir = join(workDir, 'empty');
    await mkdir(dir, { recursive: true });
    await expect(buildPackFromSourceDir(dir)).rejects.toThrow(/pack\.json/);
  });

  it('rejects manifest sheet names that are not plain file names (traversal guard, fix-round F1)', async () => {
    // The pack sits three levels deep so '../../../…' resolves to a REAL file
    // outside it — without the transport-layer guard the build would succeed
    // on that outside file. '..' and '/etc/…' need no target: the guard
    // rejects the NAME itself, before any fs access.
    const dir = join(workDir, 'a', 'b', 'traversal-pack');
    await writeValidPack(dir);
    await mkdir(join(workDir, 'out'), { recursive: true });
    await writeFile(join(workDir, 'out', 'secret.png'), ONE_FRAME_SVG, 'utf8');
    for (const sheet of ['../../../out/secret.png', '..\\..\\..\\out\\secret.png', '..', '/etc/secret.png']) {
      const manifest = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')) as {
        states: Record<string, { sheet: string }>;
      };
      manifest.states.idle.sheet = sheet;
      await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest), 'utf8');
      await expect(buildPackFromSourceDir(dir), `"${sheet}"`).rejects.toThrow(/is not a plain file name/);
    }
  });
});

// Keep the URL→path helper honest (it is how the repo root is derived elsewhere).
// Identity = the repo's OWN package.json, NOT the folder name — the trim
// proof (verify-trim.mjs) runs this suite from a copy whose directory is
// named differently, and a folder-name assertion would fail there.
it('repo-root derivation reaches this plugin repo (sanity for path helpers)', async () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    name?: string;
  };
  expect(manifest.name).toBe('elftia-plugin-pet-2d');
});
