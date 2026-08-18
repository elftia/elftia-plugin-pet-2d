/**
 * src/main/__tests__/packStore.test.ts — task 3.1's Tier-A store tests over
 * real temp dirs: scan, install (+pre-swap verification), delete,
 * collision-with-builtin reject, overwrite-false reject, invalid/traversal
 * ids, staging invisibility, and the dangling-selection repair data (delete
 * result carries `existed`; the list no longer contains the id).
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import {
  deletePack,
  installPackDir,
  listPacks,
  PACK_ID_PATTERN,
  readPackDir,
} from '../packStore';

let root: string;
let srcDir: string;

const ONE_FRAME_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#8a8f98"/></svg>';

function validManifest(id: string): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const state of PET_STATES) {
    states[state] = { sheet: `${state}.svg`, frames: 1, fps: 2, playback: 'loop' };
  }
  return {
    apiVersion: 1,
    id,
    name: `Pack ${id}`,
    credit: 'ATELIER AI',
    license: 'CC0-1.0',
    states,
  };
}

/** A complete in-memory sheet set: every PET_STATES sheet as a stored file. */
function allSheetFiles(): Array<{ name: string; bytes: Uint8Array }> {
  return PET_STATES.map((state) => ({
    name: `sheets/${state}.svg`,
    bytes: new TextEncoder().encode(ONE_FRAME_SVG),
  }));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pet2d-packstore-'));
  srcDir = await mkdtemp(join(tmpdir(), 'pet2d-packstore-src-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(srcDir, { recursive: true, force: true });
});

describe('installPackDir → listPacks → readPackDir (the happy loop)', () => {
  it('installs, scans, reads back, and the staged layout is exactly packs-src', async () => {
    const result = await installPackDir(root, {
      manifest: validManifest('my-pack') as never,
      sheetFiles: allSheetFiles(),
      overwrite: false,
      builtinIds: new Set(['elf-blob', 'tin-bot']),
    });
    expect(result).toEqual({ ok: true, id: 'my-pack' });

    const rows = await listPacks(root);
    expect(rows).toEqual([
      { id: 'my-pack', name: 'Pack my-pack', credit: 'ATELIER AI', license: 'CC0-1.0' },
    ]);

    const dir = await readPackDir(root, 'my-pack');
    expect(dir).toBe(join(root, 'my-pack'));
    const manifest = JSON.parse(await readFile(join(dir as string, 'pack.json'), 'utf8'));
    expect(manifest.id).toBe('my-pack');
    const sheets = (await readdir(join(dir as string, 'sheets'))).sort();
    expect(sheets).toEqual(PET_STATES.map((state) => `${state}.svg`).sort());
  });

  it('leaves no staging residue behind', async () => {
    const entries = (await readdir(root)).filter((n) => n.startsWith('.staging'));
    expect(entries).toEqual([]);
  });

  it('overwrite:true replaces; the old content is gone', async () => {
    const first = await installPackDir(root, {
      manifest: validManifest('replace-me') as never,
      sheetFiles: allSheetFiles(),
      overwrite: false,
      builtinIds: new Set(),
    });
    expect(first.ok).toBe(true);

    const second = await installPackDir(root, {
      manifest: { ...validManifest('replace-me'), name: 'Replaced' } as never,
      sheetFiles: allSheetFiles(),
      overwrite: true,
      builtinIds: new Set(),
    });
    expect(second).toEqual({ ok: true, id: 'replace-me' });
    const rows = await listPacks(root);
    expect(rows.find((r) => r.id === 'replace-me')?.name).toBe('Replaced');
  });

  it('rejects an existing id without overwrite (readable message)', async () => {
    const result = await installPackDir(root, {
      manifest: validManifest('replace-me') as never,
      sheetFiles: allSheetFiles(),
      overwrite: false,
      builtinIds: new Set(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]).toMatch(/already installed.*overwrite/i);
      // fix-round F5: the studio keys its affordance off this structured
      // code, never off the human-readable message above.
      expect(result.code).toBe('already-installed');
    }
  });

  it('rejects a built-in id collision (rename, never shadow)', async () => {
    const result = await installPackDir(root, {
      manifest: validManifest('elf-blob') as never,
      sheetFiles: allSheetFiles(),
      overwrite: true, // even WITH overwrite — built-ins are never replaceable
      builtinIds: new Set(['elf-blob']),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]).toMatch(/built-in.*rename/i);
      expect(result.code).toBe('builtin-id-collision'); // fix-round F5
    }
  });

  it('rejects invalid ids (shape = the traversal guard)', async () => {
    for (const bad of ['../evil', 'UPPER', 'a b', '', '.hidden', 'x'.repeat(33)]) {
      const result = await installPackDir(root, {
        manifest: validManifest(bad) as never,
        sheetFiles: allSheetFiles(),
        overwrite: false,
        builtinIds: new Set(),
      });
      expect(result.ok, `id "${bad}"`).toBe(false);
    }
    expect(PACK_ID_PATTERN.test('../evil')).toBe(false);
    expect(await readPackDir(root, '../evil')).toBeNull();
  });

  it('rejects sheet entries outside sheets/ (zip-slip posture at the store boundary)', async () => {
    const result = await installPackDir(root, {
      manifest: validManifest('slippery') as never,
      sheetFiles: [
        ...allSheetFiles(),
        { name: '../pack.json', bytes: new TextEncoder().encode('{}') },
      ],
      overwrite: false,
      builtinIds: new Set(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/sheets\//);
  });

  it('pre-swap verification rejects a broken pack and leaves the target untouched', async () => {
    // Frames contradict the 256px strip → validateCharacterPack problem.
    const broken = validManifest('broken-strip') as { states: Record<string, unknown> };
    broken.states.idle = { sheet: 'idle.svg', frames: 2, fps: 2, playback: 'loop' };
    const result = await installPackDir(root, {
      manifest: broken as never,
      sheetFiles: allSheetFiles(),
      overwrite: false,
      builtinIds: new Set(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/idle/);
    expect(await readPackDir(root, 'broken-strip')).toBeNull();
    const residue = (await readdir(root)).filter((n) => n.startsWith('.staging'));
    expect(residue).toEqual([]);
  });

  it('installs from source PATHS too (the packs:save shape), not just bytes', async () => {
    // A source dir holding one sheet file, referenced by path.
    const srcSheet = join(srcDir, 'idle.svg');
    await writeFile(srcSheet, ONE_FRAME_SVG, 'utf8');
    const manifest = validManifest('from-path');
    const result = await installPackDir(root, {
      manifest: manifest as never,
      sheetFiles: PET_STATES.map((state) => ({
        name: `sheets/${state}.svg`,
        path: srcSheet, // every state may share one file — resolution by name still holds
      })),
      overwrite: false,
      builtinIds: new Set(),
    });
    expect(result).toEqual({ ok: true, id: 'from-path' });
    const stored = await readFile(join(root, 'from-path', 'sheets', 'idle.svg'), 'utf8');
    expect(stored).toBe(ONE_FRAME_SVG);
  });
});

describe('deletePack (and the dangling-selection repair data)', () => {
  it('deletes an installed pack and reports existed:true', async () => {
    await installPackDir(root, {
      manifest: validManifest('doomed') as never,
      sheetFiles: allSheetFiles(),
      overwrite: false,
      builtinIds: new Set(),
    });
    const result = await deletePack(root, 'doomed');
    expect(result).toEqual({ ok: true, id: 'doomed', existed: true });
    expect(await readPackDir(root, 'doomed')).toBeNull();
    const rows = await listPacks(root);
    expect(rows.find((r) => r.id === 'doomed')).toBeUndefined();
  });

  it('is idempotent: absent pack → ok with existed:false (repair-safe)', async () => {
    const result = await deletePack(root, 'never-was');
    expect(result).toEqual({ ok: true, id: 'never-was', existed: false });
  });

  it('rejects traversal ids without touching the fs', async () => {
    const result = await deletePack(root, '../evil');
    expect(result.ok).toBe(false);
  });
});

describe('listPacks resilience', () => {
  it('an empty/missing store lists empty, never throws', async () => {
    const rows = await listPacks(join(root, 'no-such-root'));
    expect(rows).toEqual([]);
  });

  it('skips staging dirs and packs with unreadable pack.json', async () => {
    await mkdir(join(root, '.staging-x-1', 'sheets'), { recursive: true });
    await mkdir(join(root, 'junk-pack'), { recursive: true });
    const rows = await listPacks(root);
    expect(rows.find((r) => r.id === '.staging-x-1')).toBeUndefined();
    expect(rows.find((r) => r.id === 'junk-pack')).toBeUndefined();
  });
});
