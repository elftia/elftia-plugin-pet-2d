/**
 * src/main/__tests__/verbs.test.ts — task 3.2: the verb table through the
 * REAL `activate()` with a fake `AgentBackendHostApi` (the DS test pattern —
 * fake storage/nativeDialog injected, the registered method map captured,
 * then driven against temp dirs). Pins: the nine D9 verbs register; the
 * storage-absent degrade; every verb's never-throws result shapes; save →
 * list → load → delete round-trip; catalog metadata + whale-girl detection;
 * previewFile guards; the group-4 `.petpack` loop — dialog-wired export
 * (extension repair, cancel, unknown id) and importFile (explicit-path and
 * dialog round-trips, reader-ladder + semantic problems surfaced verbatim).
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentBackendHostApi } from '@elftia/plugin-types';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { activate, buildPackVerbs } from '../index';
import { nodeAssembleFs } from '../nodeAssembleFs';

type VerbMap = Record<string, (payload: unknown) => Promise<unknown>>;
type UnknownRecord = Record<string, unknown>;

let dataRoot: string;
let workDir: string;
let registered: VerbMap;

const ONE_FRAME_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#8a8f98"/></svg>';

function draftManifest(id: string): UnknownRecord {
  const states: UnknownRecord = {};
  for (const state of PET_STATES) {
    states[state] = { sheet: `${state}.svg`, frames: 1, fps: 2, playback: 'loop' };
  }
  return { apiVersion: 1, id, name: `Pack ${id}`, credit: 'ATELIER AI', license: 'CC0-1.0', states };
}

function makeHost(storage: UnknownRecord | undefined, nativeDialog?: UnknownRecord) {
  const map: VerbMap = {};
  const host = {
    version: '1.54.0',
    compat: {},
    registerIpcMethods: (methods: VerbMap) => {
      Object.assign(map, methods);
      return () => undefined;
    },
    services: storage === undefined ? {} : { storage, nativeDialog },
  };
  return { host: host as unknown as AgentBackendHostApi, map };
}

async function writeSheets(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const state of PET_STATES) {
    await writeFile(join(dir, `${state}.svg`), ONE_FRAME_SVG, 'utf8');
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pet2d-verbs-'));
  dataRoot = await mkdtemp(join(tmpdir(), 'pet2d-verbs-data-'));
  const { host, map } = makeHost(
    { dataDir: async () => dataRoot },
    {
      showOpenDialog: async () => ({ canceled: false, paths: [join(workDir, 'src')] }),
      showSaveDialog: async () => ({ canceled: true }),
    }
  );
  await activate(host);
  registered = map;
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(dataRoot, { recursive: true, force: true });
});

describe('activate (the DS fake-host pattern)', () => {
  it('registers exactly the nine D9 verbs', () => {
    expect(Object.keys(registered).sort()).toEqual(
      [
        'packs:list',
        'packs:load',
        'packs:delete',
        'packs:pickSourceDir',
        'packs:catalog',
        'packs:previewFile',
        'packs:save',
        'packs:export',
        'packs:importFile',
      ].sort()
    );
  });

  it('degrades silently when the storage service is absent (no verbs, no throw)', async () => {
    const { host, map } = makeHost(undefined);
    await expect(activate(host)).resolves.toBeUndefined();
    expect(Object.keys(map)).toEqual([]);
  });
});

describe('save → list → load → delete (the user-pack loop)', () => {
  it('packs:save assembles + installs from a picked dir; list sees it; load returns the D6 payload', async () => {
    const src = join(workDir, 'src');
    await writeSheets(src);
    const saved = (await registered['packs:save']({
      dir: src,
      manifest: draftManifest('verb-pack'),
      overwrite: false,
    })) as UnknownRecord;
    expect(saved).toEqual({ ok: true, id: 'verb-pack' });

    const listed = (await registered['packs:list']({})) as { packs: UnknownRecord[] };
    expect(listed.packs.find((p) => p.id === 'verb-pack')).toMatchObject({
      name: 'Pack verb-pack',
      license: 'CC0-1.0',
    });

    const loaded = (await registered['packs:load']({ id: 'verb-pack' })) as {
      manifest: { id: string };
      sheets: UnknownRecord;
    };
    expect(loaded.manifest.id).toBe('verb-pack');
    expect(Object.keys(loaded.sheets).sort()).toEqual([...PET_STATES].sort());
    expect((loaded.sheets.idle as { url: string }).url.startsWith('data:image/svg+xml,')).toBe(
      true
    );
  });

  it('packs:save rejects a builtin id collision through the verbs too', async () => {
    const src = join(workDir, 'src2');
    await writeSheets(src);
    const saved = (await registered['packs:save']({
      dir: src,
      manifest: draftManifest('elf-blob'),
      overwrite: false,
    })) as { ok: boolean; problems: string[] };
    expect(saved.ok).toBe(false);
    expect(saved.problems[0]).toMatch(/built-in.*rename/);
  });

  it('packs:save surfaces the validator problems verbatim (never throws)', async () => {
    const src = join(workDir, 'src3');
    await writeSheets(src);
    const manifest = draftManifest('bad-pack') as { states: UnknownRecord };
    delete manifest.states.walk; // all 15 mandatory — the gate must say so
    const saved = (await registered['packs:save']({
      dir: src,
      manifest,
      overwrite: false,
    })) as { ok: boolean; problems: string[] };
    expect(saved.ok).toBe(false);
    expect(saved.problems[0]).toMatch(/walk is missing/);
  });

  it('packs:load of an unknown id degrades to ok:false (the D6 fallback trigger)', async () => {
    const loaded = (await registered['packs:load']({ id: 'ghost' })) as {
      ok: boolean;
      problems: string[];
    };
    expect(loaded.ok).toBe(false);
    expect(loaded.problems[0]).toMatch(/not installed/);
  });

  it('packs:delete removes it; a second delete stays ok (idempotent repair)', async () => {
    const first = (await registered['packs:delete']({ id: 'verb-pack' })) as UnknownRecord;
    expect(first).toMatchObject({ ok: true, id: 'verb-pack', existed: true });
    const second = (await registered['packs:delete']({ id: 'verb-pack' })) as UnknownRecord;
    expect(second).toMatchObject({ ok: true, existed: false });
  });
});

describe('dialogs + catalog + preview', () => {
  it('packs:pickSourceDir returns the picked dir (fake dialog)', async () => {
    const picked = (await registered['packs:pickSourceDir']({})) as UnknownRecord;
    expect(picked).toEqual({ dir: join(workDir, 'src') });
  });

  it('packs:catalog returns measured metadata only (no image bytes), plus whale-girl detection', async () => {
    // The REAL registry-form layout (group 6): manifest.json at the top,
    // sheets under characters/<id>/ — the catalog must measure BOTH levels.
    const dir = join(workDir, 'wg-src');
    await writeSheets(join(dir, 'characters', 'whale-girl'));
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        default: 'whale-girl',
        characters: { 'whale-girl': { name: '鲸鱼娘', states: { idle: {} } } },
      }),
      'utf8'
    );
    await writeFile(join(dir, 'notes.txt'), 'not a sheet', 'utf8');

    const catalog = (await registered['packs:catalog']({ dir })) as {
      dir: string;
      files: Array<{ name: string; bytes: number; width: number | null; height: number | null }>;
      whaleGirl?: {
        manifest: UnknownRecord;
        characters: Array<{
          id: string;
          name: string;
          dir: string;
          files: Array<{ name: string; width: number | null; height: number | null }>;
        }>;
      };
    };
    expect(catalog.dir).toBe(dir);
    // Top level: the manifest + the non-sheet (dims null) — no sheet rows.
    const txt = catalog.files.find((f) => f.name === 'notes.txt');
    expect(txt).toMatchObject({ width: null, height: null });
    expect(catalog.files.find((f) => f.name === 'idle.svg')).toBeUndefined();
    // The whale-girl block: parsed manifest + per-character dir + measured rows.
    expect(catalog.whaleGirl?.manifest).toMatchObject({ default: 'whale-girl' });
    const wg = catalog.whaleGirl?.characters[0];
    expect(wg).toMatchObject({ id: 'whale-girl', name: '鲸鱼娘' });
    expect(wg?.dir).toBe(join(dir, 'characters', 'whale-girl'));
    expect(wg?.files.find((f) => f.name === 'idle.svg')).toMatchObject({
      width: 256,
      height: 256,
      bytes: ONE_FRAME_SVG.length,
    });
    // No data URIs anywhere in the catalog — display-only previews are a
    // separate one-file verb (D1/D7.1).
    expect(JSON.stringify(catalog)).not.toContain('data:');
  });

  it('packs:previewFile returns ONE data URI; guards traversal + extension', async () => {
    const dir = join(workDir, 'src'); // still populated above
    const preview = (await registered['packs:previewFile']({ dir, name: 'idle.svg' })) as {
      dataUri: string;
    };
    expect(preview.dataUri.startsWith('data:image/svg+xml,')).toBe(true);

    const traversal = (await registered['packs:previewFile']({
      dir,
      name: '../pack.json',
    })) as { ok: boolean };
    expect(traversal.ok).toBe(false);
    const wrongExt = (await registered['packs:previewFile']({ dir, name: 'notes.txt' })) as {
      ok: boolean;
    };
    expect(wrongExt.ok).toBe(false);
  });
});

describe('packs:export / packs:importFile (the .petpack loop)', () => {
  let verbs2: VerbMap;
  let dataRoot2: string;
  let exportPath: string;
  let saveQueue: UnknownRecord[];
  let openQueue: UnknownRecord[];

  /** Layout-valid .petpack builders for the verb-level semantic negatives. */
  function buildPetpack(
    path: string,
    manifest: UnknownRecord,
    sheets: ReadonlyArray<{ name: string; data: string }> = PET_STATES.map((state) => ({
      name: `${state}.svg`,
      data: ONE_FRAME_SVG,
    }))
  ): void {
    const zip = new AdmZip();
    zip.addFile('pack.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    for (const sheet of sheets) {
      zip.addFile(`sheets/${sheet.name}`, Buffer.from(sheet.data, 'utf8'));
    }
    zip.writeZip(path);
  }

  beforeAll(async () => {
    dataRoot2 = await mkdtemp(join(tmpdir(), 'pet2d-verbs2-'));
    saveQueue = [];
    openQueue = [];
    const { host, map } = makeHost(
      { dataDir: async () => dataRoot2 },
      {
        showOpenDialog: (async () => openQueue.shift() ?? { canceled: true }) as never,
        showSaveDialog: (async () => saveQueue.shift() ?? { canceled: true }) as never,
      }
    );
    await activate(host);
    verbs2 = map;
    exportPath = join(workDir, 'rt-pack.petpack');
  });

  it('installs a pack to export', async () => {
    const src = join(workDir, 'rt-src');
    await writeSheets(src);
    const saved = (await verbs2['packs:save']({
      dir: src,
      manifest: draftManifest('rt-pack'),
      overwrite: false,
    })) as UnknownRecord;
    expect(saved).toEqual({ ok: true, id: 'rt-pack' });
  });

  it('packs:export with an explicit path answers {ok:true,id,path}', async () => {
    const result = (await verbs2['packs:export']({ id: 'rt-pack', path: exportPath })) as UnknownRecord;
    expect(result).toEqual({ ok: true, id: 'rt-pack', path: exportPath });
  });

  it('packs:export via dialog appends .petpack when the user omitted it', async () => {
    saveQueue.push({ canceled: false, filePath: join(workDir, 'no-ext') });
    const result = (await verbs2['packs:export']({ id: 'rt-pack' })) as UnknownRecord;
    expect(result).toMatchObject({ ok: true, path: join(workDir, 'no-ext.petpack') });
  });

  it('packs:export with a canceled save dialog answers {canceled:true}', async () => {
    saveQueue.push({ canceled: true });
    await expect(verbs2['packs:export']({ id: 'rt-pack' })).resolves.toEqual({ canceled: true });
  });

  it('packs:export of an unknown id stays ok:false', async () => {
    const result = (await verbs2['packs:export']({ id: 'ghost' })) as { ok: boolean; problems: string[] };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/not installed/);
  });

  it('delete → importFile (explicit path) → load: data survives the file round-trip', async () => {
    await verbs2['packs:delete']({ id: 'rt-pack' });
    const imported = (await verbs2['packs:importFile']({ path: exportPath })) as UnknownRecord;
    expect(imported).toEqual({ ok: true, id: 'rt-pack' });

    const loaded = (await verbs2['packs:load']({ id: 'rt-pack' })) as {
      manifest: { id: string };
      sheets: UnknownRecord;
    };
    expect(loaded.manifest.id).toBe('rt-pack');
    expect(Object.keys(loaded.sheets).sort()).toEqual([...PET_STATES].sort());
    expect((loaded.sheets.idle as { url: string }).url.startsWith('data:image/svg+xml,')).toBe(true);
  });

  it('importFile of an already-installed id (no overwrite) stays ok:false', async () => {
    const result = (await verbs2['packs:importFile']({ path: exportPath })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/already installed.*overwrite/);
  });

  it('importFile via open dialog round-trips too', async () => {
    await verbs2['packs:delete']({ id: 'rt-pack' });
    openQueue.push({ canceled: false, paths: [exportPath] });
    const result = (await verbs2['packs:importFile']({})) as UnknownRecord;
    expect(result).toEqual({ ok: true, id: 'rt-pack' });
  });

  it('importFile with a canceled open dialog answers {canceled:true}', async () => {
    openQueue.push({ canceled: true });
    await expect(verbs2['packs:importFile']({})).resolves.toEqual({ canceled: true });
  });

  it('importFile surfaces the reader ladder problems verbatim (hostile names)', async () => {
    const hostile = join(workDir, 'hostile.petpack');
    buildPetpack(hostile, draftManifest('hostile-pack'));
    // adm-zip write API cannot express '..' — equal-length patch of the built file.
    const bytes = Buffer.from(await readFile(hostile));
    const needle = Buffer.from('sheets/idle.svg', 'utf8');
    const replacement = Buffer.from('sheets/../i.svg', 'utf8'); // 15 bytes, '..' segment
    let hits = 0;
    for (let i = 0; i + needle.length <= bytes.length; i += 1) {
      if (bytes.subarray(i, i + needle.length).equals(needle)) {
        replacement.copy(bytes, i);
        hits += 1;
        i += needle.length - 1;
      }
    }
    expect(hits).toBeGreaterThanOrEqual(2);
    await writeFile(hostile, bytes);

    const result = (await verbs2['packs:importFile']({ path: hostile })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/segments are not allowed/);
  });

  it('importFile re-validates semantics: tampered frames vs sheet width', async () => {
    const tampered = join(workDir, 'tampered.petpack');
    const manifest = draftManifest('tampered-pack') as { states: UnknownRecord };
    (manifest.states.idle as UnknownRecord).frames = 2; // 256px strip is 1 frame
    buildPetpack(tampered, manifest as UnknownRecord);
    const result = (await verbs2['packs:importFile']({ path: tampered })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/idle/);
  });

  it('importFile re-validates semantics: unknown apiVersion', async () => {
    const future = join(workDir, 'future.petpack');
    buildPetpack(future, { ...draftManifest('future-pack'), apiVersion: 99 });
    const result = (await verbs2['packs:importFile']({ path: future })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/apiVersion must be 1/);
  });

  it('importFile re-validates semantics: builtin id collision', async () => {
    const collision = join(workDir, 'collision.petpack');
    buildPetpack(collision, draftManifest('elf-blob'));
    const result = (await verbs2['packs:importFile']({ path: collision })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/built-in.*rename/);
  });

  it('importFile re-validates semantics: the incomplete-pack fixture (missing state)', async () => {
    const fixtureRoot = fileURLToPath(new URL('../../../fixtures/incomplete-pack/', import.meta.url));
    const manifest = JSON.parse(await readFile(join(fixtureRoot, 'pack.json'), 'utf8')) as UnknownRecord;
    const sheetNames = (await readdir(join(fixtureRoot, 'sheets'))).sort();
    const zip = new AdmZip();
    zip.addFile('pack.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    for (const name of sheetNames) {
      zip.addFile(`sheets/${name}`, await readFile(join(fixtureRoot, 'sheets', name)));
    }
    const path = join(workDir, 'incomplete.petpack');
    zip.writeZip(path);

    const result = (await verbs2['packs:importFile']({ path })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/is missing/);
  });

  it('importFile of a nonexistent path stays ok:false, never throws', async () => {
    const result = (await verbs2['packs:importFile']({ path: join(workDir, 'nope.petpack') })) as {
      ok: boolean;
      problems: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/does not exist/);
  });
});

describe('buildPackVerbs direct (handler-level)', () => {
  it('malformed payloads degrade to ok:false, never throw', async () => {
    const verbs = buildPackVerbs({
      packsRoot: join(dataRoot, 'packs'),
      fs: nodeAssembleFs,
      builtinIds: new Set<string>(['elf-blob']),
      nativeDialog: undefined,
    });
    for (const verb of ['packs:load', 'packs:delete', 'packs:catalog', 'packs:save']) {
      const result = (await verbs[verb](null)) as { ok: boolean; problems: string[] };
      expect(result.ok, verb).toBe(false);
    }
    const pick = (await verbs['packs:pickSourceDir']({})) as { ok: boolean; problems: string[] };
    expect(pick.ok).toBe(false); // no nativeDialog injected
  });
});

// Keep the repo-root derivation honest for fixtures-free runs (mirrors the
// buildPack test's identity check — the trim proof renames this dir).
it('repo-root sanity', async () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    name?: string;
  };
  expect(pkg.name).toBe('elftia-plugin-pet-2d');
  expect(Array.isArray(await readdir(join(repoRoot, 'src', 'main')))).toBe(true);
});
