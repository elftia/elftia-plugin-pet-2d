/**
 * src/main/petpackFile.ts — D4's `.petpack` artifact: WRITE via `archiver`
 * (a host-provided external — PNG entries STORED, already compressed;
 * pack.json + SVG entries deflated) and READ via `adm-zip` (the repo's first
 * bundled devDependency) as a PARSER ONLY — every entry is read as bytes and
 * validated by THIS ladder before anything touches the store, so the
 * guardrails are ours, not the library's (D5).
 *
 * The read ladder, in order (cheap→dear, mirroring installGuardrails):
 *   1. container: file ≤ 32 MiB; ≤ 64 entries; per-entry uncompressed ≤ 8 MiB
 *      and total uncompressed ≤ 32 MiB — checked from zip HEADERS, before a
 *      single entry is decompressed (the bomb cap).
 *   2. entry names: no backslashes, no absolute paths, no drive letters, no
 *      `..`/`.` segments, nothing outside `pack.json` + `sheets/<name>`;
 *      symlink entries rejected outright.
 *   3. content: `.png` sheets verify against the PNG magic, `.svg` sheets
 *      against SVG text; `pack.json` must parse.
 * Semantic validation (measure/validate/id policy) is NOT here — it is the
 * shared pipeline's, enforced by packStore's pre-swap verification on
 * install. Every rejection throws a one-line readable Error (the verbs turn
 * it into `{ok:false, problems}` verbatim).
 */
import { createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import archiver from 'archiver';

import { isPngBytes } from '../packs/measureSheets';

export const MAX_PETPACK_BYTES = 32 * 1024 * 1024;
export const MAX_PETPACK_ENTRIES = 64;
export const MAX_PETPACK_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_PETPACK_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

/** What a verified `.petpack` holds — exactly installPackDir's input shape. */
export interface PetpackContents {
  /** Parsed pack.json (JSON-valid; semantics checked at install). */
  readonly manifest: unknown;
  /** Store-relative sheet entries (`sheets/<name>`), bytes in hand. */
  readonly sheetFiles: ReadonlyArray<{ name: string; bytes: Uint8Array }>;
}

/**
 * D4's writer: zip an installed pack dir as `pack.json` + `sheets/*`
 * (PNG stored, text deflated). No validation here — export ships an
 * INSTALLED pack, which the store already verified at install time.
 */
export async function writePetpack(packDir: string, outPath: string): Promise<void> {
  const manifestText = await readFile(join(packDir, 'pack.json'), 'utf8');
  const sheetNames = (await readdir(join(packDir, 'sheets')))
    .filter((name) => /\.(png|svg)$/i.test(name))
    .sort();
  // archiver takes Buffer/Stream/String sources only (no Promises) — and the
  // store's own caps bound these bytes, so eager reads are fine.
  const sheetBytes = await Promise.all(
    sheetNames.map((name) => readFile(join(packDir, 'sheets', name)))
  );
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip');
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(manifestText, { name: 'pack.json' });
    sheetNames.forEach((name, index) => {
      archive.append(sheetBytes[index], {
        name: `sheets/${name}`,
        store: /\.png$/i.test(name), // PNG is already compressed — STORE it
      });
    });
    void archive.finalize();
  });
}

/** Entry-name guard: layout + traversal posture (ladder step 2). */
function entryNameProblem(entryName: string): string | null {
  if (entryName.includes('\\')) {
    return `entry "${entryName}": backslash separators are not allowed`;
  }
  if (entryName.startsWith('/')) {
    return `entry "${entryName}": absolute entry names are not allowed`;
  }
  if (/^[A-Za-z]:/.test(entryName)) {
    return `entry "${entryName}": drive-letter entry names are not allowed`;
  }
  const segments = entryName.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return `entry "${entryName}": "." or ".." segments are not allowed`;
  }
  if (entryName === 'pack.json') return null;
  if (entryName.startsWith('sheets/')) {
    const base = entryName.slice('sheets/'.length);
    if (base === '' || base.includes('/')) {
      return `entry "${entryName}": sheet entries must be exactly one level under sheets/`;
    }
    if (!/\.(png|svg)$/i.test(base)) {
      return `entry "${entryName}": sheet entries must be .png or .svg`;
    }
    return null;
  }
  return `entry "${entryName}": only pack.json and sheets/* belong in a .petpack`;
}

/** D5's reader: the full guard ladder, then the verified contents. */
export async function readPetpack(path: string): Promise<PetpackContents> {
  const fileInfo = await stat(path).catch(() => {
    throw new Error(`"${path}" does not exist`);
  });
  if (fileInfo.size > MAX_PETPACK_BYTES) {
    throw new Error(
      `"${path}" is ${fileInfo.size} bytes — over the ${MAX_PETPACK_BYTES} byte .petpack cap`
    );
  }

  const zip = new AdmZip(path);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0) throw new Error('the .petpack has no entries');
  if (entries.length > MAX_PETPACK_ENTRIES) {
    throw new Error(
      `the .petpack has ${entries.length} entries — over the ${MAX_PETPACK_ENTRIES} entry cap`
    );
  }

  let totalUncompressed = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.entryName;
    const problem = entryNameProblem(name);
    if (problem !== null) throw new Error(problem);
    if (seen.has(name)) throw new Error(`entry "${name}": duplicate entry name`);
    seen.add(name);

    // Symlink posture: unix mode lives in the high half of the external attrs.
    const mode = (entry.attr >>> 16) & 0xffff;
    if ((mode & 0o170000) === 0o120000) {
      throw new Error(`entry "${name}": symbolic-link entries are not allowed`);
    }

    // Bomb caps BEFORE decompression — header-declared sizes only. A
    // declared size <= 0 is hostile too (fix-round F3): adm-zip drops its
    // output cap when the header claims usize 0, so a small DEFLATE stream
    // inflates unbounded until its CRC check fails — a transient main-
    // process memory spike on a hostile import.
    if (entry.header.size <= 0) {
      throw new Error(
        `entry "${name}" declares ${entry.header.size} uncompressed bytes — every .petpack entry must declare a positive size`
      );
    }
    if (entry.header.size > MAX_PETPACK_ENTRY_BYTES) {
      throw new Error(
        `entry "${name}" declares ${entry.header.size} uncompressed bytes — over the ${MAX_PETPACK_ENTRY_BYTES} byte per-entry cap`
      );
    }
    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_PETPACK_UNCOMPRESSED_BYTES) {
      throw new Error(`the .petpack declares over ${MAX_PETPACK_UNCOMPRESSED_BYTES} uncompressed bytes in total`);
    }
  }

  const hasPackJson = seen.has('pack.json');
  if (!hasPackJson) throw new Error('the .petpack has no pack.json');

  const sheetFiles: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of entries) {
    const name = entry.entryName;
    if (name === 'pack.json') continue;
    const bytes = new Uint8Array(entry.getData());
    if (/\.png$/i.test(name)) {
      if (!isPngBytes(bytes)) {
        throw new Error(`entry "${name}" is not a PNG (magic bytes mismatch)`);
      }
    } else {
      if (isPngBytes(bytes)) {
        throw new Error(`entry "${name}" is not an SVG (it has PNG magic bytes)`);
      }
      const text = new TextDecoder().decode(bytes);
      if (!/<svg[\s>]/i.test(text.slice(0, 4096))) {
        throw new Error(`entry "${name}" does not look like an SVG`);
      }
    }
    sheetFiles.push({ name, bytes });
  }
  if (sheetFiles.length === 0) throw new Error('the .petpack has no sheets');

  const packJsonEntry = zip.getEntry('pack.json');
  if (packJsonEntry === null) throw new Error('the .petpack has no pack.json');
  const packJsonText = new TextDecoder().decode(new Uint8Array(packJsonEntry.getData()));
  let manifest: unknown;
  try {
    manifest = JSON.parse(packJsonText);
  } catch (error) {
    throw new Error(`pack.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { manifest, sheetFiles };
}
