/**
 * src/main/packStore.ts — D3's user-pack storage layer over
 * `<userData>/plugin-data/pet-2d/packs/<id>/`: scan, read, install
 * (staging-rename + pre-swap verification), delete. PURE STORAGE — every
 * validation decision routes through the shared pipeline
 * (`src/packs/assemblePack.ts`): install VERIFIES the staged dir by
 * assembling from it before the swap, so nothing lands in the store that
 * `packs:load` could not read back (D5's validate-then-install, enforced at
 * the store boundary, not trusted from the caller).
 *
 * Layout is EXACTLY the packs-src authoring layout (`pack.json` +
 * `sheets/<name>.png|.svg`) — the directory IS the index (no drift-prone
 * sidecar; the registry.ts lesson). Staging dirs (`.staging-*`) and any
 * dot-prefixed entry are invisible to `listPacks`.
 *
 * Id policy (D3): ids must match PACK_ID_PATTERN (this is also the
 * path-traversal guard — an id becomes a path segment); a collision with a
 * built-in pack id REJECTS (rename); an existing user pack requires
 * `overwrite: true`. Every entry point returns a result object, never throws
 * (a failed store op degrades to its problems list).
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CharacterPackManifest } from '../contract/characterPack';
import { assemblePackFromSourceDir } from '../packs/assemblePack';
import { nodeAssembleFs } from './nodeAssembleFs';

/** D3's id shape — lowercase slug, ≤32 chars. Doubles as the traversal guard. */
export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** One `packs:list` row (D3: id/name/credit/license only). */
export interface PackSummary {
  readonly id: string;
  readonly name: string;
  readonly credit: string;
  readonly license: string;
}

/** A sheet file to install: bytes in hand (import path) or a source path (save path). */
export interface StoredSheetFile {
  /** Store-relative name — must be `sheets/<basename>` (single level). */
  readonly name: string;
  readonly path?: string;
  readonly bytes?: Uint8Array;
}

export interface InstallPackInput {
  readonly manifest: CharacterPackManifest;
  readonly sheetFiles: readonly StoredSheetFile[];
  readonly overwrite: boolean;
  readonly builtinIds: ReadonlySet<string>;
}

export type InstallPackResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      /**
       * Stable machine-readable cause for the two id-collision rejects
       * (fix-round F5): the studio keys its collision affordance off this,
       * never off the human-readable message text.
       */
      readonly code?: 'builtin-id-collision' | 'already-installed';
      readonly problems: readonly string[];
    };

export type DeletePackResult =
  | { readonly ok: true; readonly id: string; readonly existed: boolean }
  | { readonly ok: false; readonly problems: readonly string[] };

/** A stored sheet name must be exactly `sheets/<basename>` — one level, no traversal. */
function sheetNameProblem(name: string): string | null {
  if (!name.startsWith('sheets/')) {
    return `sheet entry "${name}" must live under sheets/`;
  }
  const base = name.slice('sheets/'.length);
  if (base === '' || base === '.' || base === '..' || /[\\/]/.test(base)) {
    return `sheet entry "${name}" is not a plain file name under sheets/`;
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** D3 scan: every pack dir's `pack.json` (id/name/credit/license). Never throws. */
export async function listPacks(packsRoot: string): Promise<PackSummary[]> {
  let entries;
  try {
    entries = await readdir(packsRoot, { withFileTypes: true });
  } catch {
    return []; // no store yet — an empty list, not an error
  }
  const rows: PackSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue; // staging + dot dirs invisible
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(join(packsRoot, entry.name, 'pack.json'), 'utf8'));
    } catch {
      console.info(`[pet-2d/packStore] skipping "${entry.name}": unreadable pack.json`);
      continue;
    }
    const record = (manifest ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    rows.push({
      id: entry.name, // the directory IS the id (install guarantees they match)
      name: str(record.name) || entry.name,
      credit: str(record.credit),
      license: str(record.license),
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/**
 * The installed pack dir for `id`, or null when absent. The id guard doubles
 * as containment: PACK_ID_PATTERN rejects separators, dots, and case tricks.
 */
export async function readPackDir(packsRoot: string, id: string): Promise<string | null> {
  if (!PACK_ID_PATTERN.test(id)) return null;
  const dir = join(packsRoot, id);
  try {
    if (!(await stat(dir)).isDirectory()) return null;
  } catch {
    return null;
  }
  return dir;
}

/**
 * Install per D5 step 4: guard ids → stage (`.staging-<id>-<ts>/`) →
 * VERIFY the staged tree by assembling from it (the shared pipeline; its
 * problems ride back verbatim) → swap (remove target, rename staging in).
 * The target is untouched unless verification passed — a rejected pack
 * simply isn't installed.
 */
export async function installPackDir(
  packsRoot: string,
  input: InstallPackInput
): Promise<InstallPackResult> {
  const id = input.manifest?.id;
  if (typeof id !== 'string' || !PACK_ID_PATTERN.test(id)) {
    return {
      ok: false,
      problems: [`pack id "${String(id)}" is invalid — it must match ^[a-z0-9][a-z0-9-]{0,31}$`],
    };
  }
  if (input.builtinIds.has(id)) {
    return {
      ok: false,
      code: 'builtin-id-collision',
      problems: [`pack id "${id}" collides with a built-in pack — rename the pack and try again`],
    };
  }
  const sheetProblems = input.sheetFiles
    .map((f) => sheetNameProblem(f.name))
    .filter((p): p is string => p !== null);
  if (sheetProblems.length > 0) return { ok: false, problems: sheetProblems };

  const target = join(packsRoot, id);
  if ((await pathExists(target)) && !input.overwrite) {
    return {
      ok: false,
      code: 'already-installed',
      problems: [`pack "${id}" is already installed — replace it explicitly (overwrite)`],
    };
  }

  const staging = join(packsRoot, `.staging-${id}-${Date.now()}`);
  try {
    await mkdir(join(staging, 'sheets'), { recursive: true });
    await writeFile(join(staging, 'pack.json'), JSON.stringify(input.manifest, null, 2), 'utf8');
    for (const file of input.sheetFiles) {
      const dest = join(staging, file.name);
      if (file.bytes !== undefined) await writeFile(dest, file.bytes);
      else if (file.path !== undefined) await copyFile(file.path, dest);
      else return { ok: false, problems: [`sheet entry "${file.name}" has neither bytes nor a source path`] };
    }

    // Pre-swap verification: the staged tree must load back through the SAME
    // pipeline packs:load uses (resolve/measure/validate — verbatim problems).
    try {
      await assemblePackFromSourceDir(staging, nodeAssembleFs);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      return {
        ok: false,
        problems: [error instanceof Error ? error.message : String(error)],
      };
    }

    if (await pathExists(target)) {
      await rm(target, { recursive: true, force: true });
    }
    await rename(staging, target);
    return { ok: true, id };
  } catch (error) {
    // Best-effort staging cleanup; the target was never touched pre-swap.
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
}

/** Delete per D3. Idempotent (absent → ok, existed:false — repair-safe). */
export async function deletePack(packsRoot: string, id: string): Promise<DeletePackResult> {
  if (!PACK_ID_PATTERN.test(id)) {
    return {
      ok: false,
      problems: [`pack id "${id}" is invalid — it must match ^[a-z0-9][a-z0-9-]{0,31}$`],
    };
  }
  try {
    const dir = join(packsRoot, id);
    const existed = await pathExists(dir);
    await rm(dir, { recursive: true, force: true });
    return { ok: true, id, existed };
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
}
