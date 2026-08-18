/**
 * src/main/index.ts — the plugin's MAIN half (group 3, D2/D9): resolves the
 * pack store once (`storage.dataDir()/packs`) and registers the nine
 * `packs:*` verbs over scoped ipc. The D13 discipline the renderer halves
 * follow applies doubly here: `activate` NEVER throws (a throw means the
 * loader marks the plugin `failed` and the pet/manager halves pay for it),
 * and no VERB ever throws either — every failure is a discriminated
 * `{ok:false, problems[]}` / `{canceled:true}` result (D9). `validateCharacterPack`'s
 * message strings ARE the contract; they ride back verbatim.
 *
 * Byte posture (D1): pack bytes NEVER cross toward the renderer on any save
 * path — dialogs + reads + writes all happen here; the renderer receives
 * ids, summaries, measured metadata, problem strings, and display-only data
 * URIs (`packs:load` / `packs:previewFile`), the same one-way shape the
 * built-in pack modules already deliver.
 *
 * `packs:export` / `packs:importFile` (group 4, D4): the `.petpack` writer
 * (archiver — an EXTERNAL, PNG stored) and reader (adm-zip parser-only +
 * our guard ladder) live in `petpackFile.ts`; import re-rides the SAME
 * install pipeline, so a `.petpack` and a studio save are indistinguishable
 * at the store boundary.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type {
  AgentBackendHostApi,
  HostIpcMethodMap,
  HostNativeDialogLike,
} from '@elftia/plugin-types';

import type { CharacterPackManifest } from '../contract/characterPack';
import {
  type AssembleFs,
  assemblePackFromManifest,
  assemblePackFromSourceDir,
  sheetToDataUri,
} from '../packs/assemblePack';
import { measureSheetBytes } from '../packs/measureSheets';
import { GENERATED_PACK_IDS } from '../packs/pack-ids.generated';
import { listWhaleGirlCharacters } from '../packs/whaleGirlCompat';
import { nodeAssembleFs } from './nodeAssembleFs';
import { deletePack, installPackDir, listPacks, readPackDir } from './packStore';
import { readPetpack, writePetpack } from './petpackFile';

/** Everything a verb closes over — injectable for the unit tests (3.2). */
export interface PackVerbDeps {
  readonly packsRoot: string;
  readonly fs: AssembleFs;
  readonly builtinIds: ReadonlySet<string>;
  readonly nativeDialog: HostNativeDialogLike | undefined;
}

function problemsFrom(error: unknown): string[] {
  return [error instanceof Error ? error.message : String(error)];
}

/** The never-throws wrapper every verb rides in (D9). */
function guarded(
  verb: string,
  handler: (payload: unknown) => Promise<unknown>
): (payload: unknown) => Promise<unknown> {
  return async (payload: unknown) => {
    try {
      return await handler(payload);
    } catch (error) {
      console.warn(`[pet-2d/main] verb "${verb}" failed`, error);
      return { ok: false, problems: problemsFrom(error) };
    }
  };
}

function readString(payload: unknown, key: string): string | null {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function badPayload(verb: string): { ok: false; problems: string[] } {
  return { ok: false, problems: [`${verb}: malformed payload`] };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * whale-girl character ids are used as path segments (`characters/<id>`) —
 * only path-safe ids may become a catalog row; anything else is skipped
 * rather than joined (the same basename discipline previewFile enforces).
 */
const SAFE_CHARACTER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Measures one directory's file rows (name-sorted; null dims when a sheet
 *  cannot be measured). Shared by the catalog's top-level pass and each
 *  whale-girl character dir (group 6: the studio's slot dropdowns, dimension
 *  checks, and preview all read from these rows). */
async function catalogDirFiles(dir: string): Promise<CatalogFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: CatalogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const info = await stat(join(dir, entry.name));
    let width: number | null = null;
    let height: number | null = null;
    if (/\.(png|svg)$/i.test(entry.name)) {
      try {
        const measured = measureSheetBytes(await readFile(join(dir, entry.name)));
        width = measured.width;
        height = measured.height;
      } catch {
        // unmeasurable (corrupt?) — dims stay null; the studio shows "?"
      }
    }
    files.push({ name: entry.name, bytes: info.size, width, height });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

/** One catalog file row (D7.1): measured metadata only, never image bytes. */
interface CatalogFile {
  readonly name: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * The D9 verb table. Method names are plugin-local; the host namespaces them
 * under `pet-2d:` on the wire.
 */
export function buildPackVerbs(deps: PackVerbDeps): HostIpcMethodMap {
  const { packsRoot, fs, builtinIds, nativeDialog } = deps;
  return {
    'packs:list': guarded('packs:list', async () => ({ packs: await listPacks(packsRoot) })),

    'packs:load': guarded('packs:load', async (payload) => {
      const id = readString(payload, 'id');
      if (id === null) return badPayload('packs:load');
      const dir = await readPackDir(packsRoot, id);
      if (dir === null) return { ok: false, problems: [`pack "${id}" is not installed`] };
      const assembled = await assemblePackFromSourceDir(dir, fs);
      return { manifest: assembled.manifest, sheets: assembled.sheets };
    }),

    'packs:delete': guarded('packs:delete', async (payload) => {
      const id = readString(payload, 'id');
      if (id === null) return badPayload('packs:delete');
      return deletePack(packsRoot, id);
    }),

    'packs:pickSourceDir': guarded('packs:pickSourceDir', async () => {
      if (typeof nativeDialog?.showOpenDialog !== 'function') {
        return { ok: false, problems: ['native dialogs are unavailable in this host'] };
      }
      const picked = await nativeDialog.showOpenDialog({ directory: true });
      if (picked.canceled || picked.paths.length === 0) return { canceled: true };
      return { dir: picked.paths[0] };
    }),

    'packs:catalog': guarded('packs:catalog', async (payload) => {
      const dir = readString(payload, 'dir');
      if (dir === null) return badPayload('packs:catalog');
      const files = await catalogDirFiles(dir);

      // whale-girl detection (D8): a recognizable REGISTRY manifest in the
      // picked dir unlocks the auto-fill offer. Group 6: each detected
      // character also carries its own sheet dir + measured rows, and the
      // parsed manifest rides along so the renderer can run
      // fromWhaleGirlManifest over it (prefill without a second read).
      let whaleGirl:
        | {
            manifest: unknown;
            characters: Array<{ id: string; name: string; dir: string; files: CatalogFile[] }>;
          }
        | undefined;
      const manifestPath = join(dir, 'manifest.json');
      if (await isFile(manifestPath)) {
        try {
          const json: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
          const ids = listWhaleGirlCharacters(json).filter((id) => SAFE_CHARACTER_ID.test(id));
          if (ids.length > 0) {
            const characters = (json as { characters?: Record<string, { name?: unknown }> })
              .characters;
            whaleGirl = {
              manifest: json,
              characters: await Promise.all(
                ids.map(async (id) => {
                  const charDir = join(dir, 'characters', id);
                  return {
                    id,
                    name:
                      typeof characters?.[id]?.name === 'string'
                        ? (characters[id].name as string)
                        : id,
                    dir: charDir,
                    // A registry entry without its dir on disk still offers
                    // the fill; its slots just read from an empty sheet list.
                    files: await catalogDirFiles(charDir).catch(() => []),
                  };
                })
              ),
            };
          }
        } catch {
          // not a whale-girl manifest — no offer
        }
      }
      return whaleGirl === undefined ? { dir, files } : { dir, files, whaleGirl };
    }),

    'packs:previewFile': guarded('packs:previewFile', async (payload) => {
      const dir = readString(payload, 'dir');
      const name = readString(payload, 'name');
      if (dir === null || name === null || /[\\/]/.test(name) || name === '.' || name === '..') {
        return badPayload('packs:previewFile');
      }
      if (!/\.(png|svg)$/i.test(name)) {
        return { ok: false, problems: [`"${name}" is not a .png/.svg sheet`] };
      }
      const bytes = await readFile(join(dir, name));
      return { dataUri: sheetToDataUri(bytes) };
    }),

    'packs:save': guarded('packs:save', async (payload) => {
      const dir = readString(payload, 'dir');
      const manifest = (payload as { manifest?: unknown } | null | undefined)?.manifest;
      const overwrite = (payload as { overwrite?: unknown } | null | undefined)?.overwrite === true;
      if (dir === null || typeof manifest !== 'object' || manifest === null) {
        return badPayload('packs:save');
      }
      // D5's save pipeline: the DRAFT manifest + the picked dir's files →
      // the ONE shared assemble (throws the validator's verbatim problems,
      // which `guarded` turns into `{ok:false, problems[]}`).
      const assembled = await assemblePackFromManifest(
        manifest as CharacterPackManifest,
        dir,
        fs
      );
      const sheetFiles = Object.values(assembled.sheetSources).map((sheet) => ({
        name: `sheets/${basename(sheet.path)}`,
        path: sheet.path,
      }));
      return installPackDir(packsRoot, {
        manifest: assembled.manifest,
        sheetFiles,
        overwrite,
        builtinIds,
      });
    }),

    // D4/D5 export: an INSTALLED pack (already store-verified) → one .petpack
    // file. The dialog supplies the path when the payload doesn't; the writer
    // owns every byte (the renderer sees only ids + the final path).
    'packs:export': guarded('packs:export', async (payload) => {
      const id = readString(payload, 'id');
      if (id === null) return badPayload('packs:export');
      const dir = await readPackDir(packsRoot, id);
      if (dir === null) return { ok: false, problems: [`pack "${id}" is not installed`] };

      let outPath = readString(payload, 'path');
      if (outPath === null) {
        if (typeof nativeDialog?.showSaveDialog !== 'function') {
          return { ok: false, problems: ['native dialogs are unavailable in this host'] };
        }
        const picked = await nativeDialog.showSaveDialog({
          defaultPath: `${id}.petpack`,
          filters: [{ name: 'Pet Pack', extensions: ['petpack'] }],
        });
        if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath === '') {
          return { canceled: true };
        }
        outPath = picked.filePath;
      }
      if (!/\.petpack$/i.test(outPath)) outPath = `${outPath}.petpack`;
      await writePetpack(dir, outPath);
      return { ok: true, id, path: outPath };
    }),

    // D4/D5 import: the guard ladder (readPetpack) → the ONE shared install
    // pipeline (installPackDir's pre-swap verification re-validates
    // everything semantic). Reader problems ride back verbatim via `guarded`.
    'packs:importFile': guarded('packs:importFile', async (payload) => {
      const overwrite =
        (payload as { overwrite?: unknown } | null | undefined)?.overwrite === true;
      let path = readString(payload, 'path');
      if (path === null) {
        if (typeof nativeDialog?.showOpenDialog !== 'function') {
          return { ok: false, problems: ['native dialogs are unavailable in this host'] };
        }
        const picked = await nativeDialog.showOpenDialog({
          filters: [{ name: 'Pet Pack', extensions: ['petpack'] }],
        });
        if (picked.canceled || picked.paths.length === 0) return { canceled: true };
        path = picked.paths[0];
      }
      const contents = await readPetpack(path);
      return installPackDir(packsRoot, {
        manifest: contents.manifest as CharacterPackManifest,
        sheetFiles: contents.sheetFiles,
        overwrite,
        builtinIds,
      });
    }),
  };
}

/**
 * The main-half activate (D2): resolve the store root once, register the
 * verb table. Never throws — a missing storage service degrades the whole
 * pack surface (the renderer feature-detects and falls back to built-ins).
 */
export async function activate(host: AgentBackendHostApi): Promise<void> {
  try {
    const storage = host.services?.storage;
    if (typeof storage?.dataDir !== 'function') {
      console.warn('[pet-2d/main] storage service absent — pack verbs not registered');
      return;
    }
    const packsRoot = join(await storage.dataDir(), 'packs');
    host.registerIpcMethods(
      buildPackVerbs({
        packsRoot,
        fs: nodeAssembleFs,
        builtinIds: new Set<string>(GENERATED_PACK_IDS),
        nativeDialog: host.services?.nativeDialog,
      })
    );
    console.info('[pet-2d/main] activated', { packsRoot });
  } catch (error) {
    console.error('[pet-2d/main] activate failed', error);
  }
}
