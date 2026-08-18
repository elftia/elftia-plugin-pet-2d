/**
 * src/main/__tests__/petpackFile.test.ts — task 4.1's Tier-A `.petpack` gate:
 * the write→read round-trip is DATA-EQUAL (manifest deep-equal, sheet bytes
 * byte-equal, layout exactly `pack.json` + `sheets/*`), and every hostile
 * artifact from D11's list is rejected by the reader ladder BEFORE any byte
 * reaches the store. Hostile zips are built programmatically — adm-zip's
 * write API where it can express the shape, and equal-length binary patches
 * of a valid zip's entry names (local AND central headers in one pass) where
 * adm-zip's own `zipnamefix` sanitization makes `..`/backslash/absolute
 * names unwritable through that API.
 */
import { mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { installPackDir } from '../packStore';
import { MAX_PETPACK_BYTES, readPetpack, writePetpack } from '../petpackFile';

let root: string;
let packsRoot: string;
let originDir: string;
let roundTripPath: string;
let originManifest: Record<string, unknown>;

const ONE_FRAME_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#8a8f98"/></svg>';
const SVG_BYTES = Buffer.from(ONE_FRAME_SVG, 'utf8');

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

function sheetEntries(names: readonly string[]): Array<{ name: string; data: Buffer }> {
  return names.map((name) => ({ name: `sheets/${name}`, data: SVG_BYTES }));
}

/** Build a zip from raw entries (adm-zip write API; attr for symlink posture). */
function buildZip(
  path: string,
  entries: ReadonlyArray<{ name: string; data: Buffer | string; attr?: number }>
): void {
  const zip = new AdmZip();
  for (const entry of entries) {
    const added = zip.addFile(entry.name, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8'));
    if (entry.attr !== undefined) added.attr = entry.attr;
  }
  zip.writeZip(path);
}

/** A layout-valid .petpack (reader passes; semantics are the caller's). */
function buildValidPetpack(
  path: string,
  manifest: Record<string, unknown> = validManifest('ladder-pack'),
  extraEntries: ReadonlyArray<{ name: string; data: Buffer | string; attr?: number }> = []
): void {
  buildZip(path, [
    { name: 'pack.json', data: JSON.stringify(manifest, null, 2) },
    ...sheetEntries(PET_STATES.map((state) => `${state}.svg`)),
    ...extraEntries,
  ]);
}

/**
 * Equal-length binary rename of entry names inside a built zip — the only way
 * past adm-zip's write-side sanitization for `..` / backslash / absolute
 * names. Requires ≥2 hits (the local header AND the central directory).
 */
async function patchEntryName(path: string, from: string, to: string): Promise<void> {
  expect(from.length, `patch length: "${from}" → "${to}"`).toBe(to.length);
  const bytes = await readFile(path);
  const needle = Buffer.from(from, 'utf8');
  const replacement = Buffer.from(to, 'utf8');
  let hits = 0;
  for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    if (bytes.subarray(i, i + needle.length).equals(needle)) {
      replacement.copy(bytes, i);
      hits += 1;
      i += needle.length - 1;
    }
  }
  expect(hits).toBeGreaterThanOrEqual(2); // local header + central directory
  await writeFile(path, bytes);
}

/**
 * Rewrite ONE entry's declared uncompressed size in every zip record that
 * carries it (local header AND central directory) — fix-round F3's hostile
 * shape: a header claiming 0 uncompressed bytes. adm-zip's write API always
 * writes real sizes, so — like patchEntryName — this is a binary patch.
 */
async function patchEntryUsize(path: string, entryName: string, size: number): Promise<void> {
  const bytes = await readFile(path);
  const name = Buffer.from(entryName, 'utf8');
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  let patched = 0;
  for (let i = 0; i + 46 <= bytes.length; i += 1) {
    const sig = bytes.readUInt32LE(i);
    if (sig !== CENTRAL && sig !== LOCAL) continue;
    const isCentral = sig === CENTRAL;
    const nameAt = i + (isCentral ? 46 : 30);
    const nameLen = bytes.readUInt16LE(i + (isCentral ? 28 : 26));
    if (!bytes.subarray(nameAt, nameAt + nameLen).equals(name)) continue;
    bytes.writeUInt32LE(size, i + (isCentral ? 24 : 22));
    patched += 1;
  }
  expect(patched, `usize patch hits for "${entryName}"`).toBeGreaterThanOrEqual(2);
  await writeFile(path, bytes);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pet2d-petpack-'));
  packsRoot = join(root, 'packs');
  roundTripPath = join(root, 'round-trip.petpack');

  // A real installed pack (store-verified) is the export source of truth.
  originManifest = validManifest('origin-pack');
  const install = await installPackDir(packsRoot, {
    manifest: originManifest as never,
    sheetFiles: PET_STATES.map((state) => ({
      name: `sheets/${state}.svg`,
      bytes: SVG_BYTES,
    })),
    overwrite: false,
    builtinIds: new Set(),
  });
  expect(install.ok).toBe(true);
  originDir = join(packsRoot, 'origin-pack');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('writePetpack → readPetpack (data-equality round-trip)', () => {
  it('round-trips the manifest and every sheet byte exactly', async () => {
    await writePetpack(originDir, roundTripPath);
    const contents = await readPetpack(roundTripPath);

    expect(contents.manifest).toEqual(originManifest);
    expect(contents.sheetFiles.map((f) => f.name).sort()).toEqual(
      PET_STATES.map((state) => `sheets/${state}.svg`).sort()
    );
    for (const file of contents.sheetFiles) {
      expect(Buffer.from(file.bytes).equals(SVG_BYTES), file.name).toBe(true);
    }
  });

  it('writes exactly pack.json + sheets/* — no directory entries, no strays', async () => {
    const zip = new AdmZip(roundTripPath);
    const names = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();
    expect(names).toEqual(['pack.json', ...PET_STATES.map((state) => `sheets/${state}.svg`)].sort());
    // The sheet set on disk (which export zips) is exactly the store layout.
    expect((await readdir(join(originDir, 'sheets'))).sort()).toEqual(
      PET_STATES.map((state) => `${state}.svg`).sort()
    );
  });

  it('re-imports into a FRESH store and re-measures identical (install equality)', async () => {
    const secondRoot = join(root, 'packs-copy');
    const contents = await readPetpack(roundTripPath);
    const install = await installPackDir(secondRoot, {
      manifest: contents.manifest as never,
      sheetFiles: [...contents.sheetFiles],
      overwrite: false,
      builtinIds: new Set(['elf-blob']),
    });
    expect(install).toEqual({ ok: true, id: 'origin-pack' });
    const stored = await readFile(join(secondRoot, 'origin-pack', 'sheets', 'idle.svg'));
    expect(stored.equals(SVG_BYTES)).toBe(true);
  });
});

describe('readPetpack — the D11 hostile-artifact ladder', () => {
  const dir = () => join(root, `hostile-${crypto.randomUUID()}`);

  it('rejects a nonexistent file', async () => {
    await expect(readPetpack(join(root, 'nope.petpack'))).rejects.toThrow(/does not exist/);
  });

  it('rejects an empty archive', async () => {
    const path = dir() + '.petpack';
    new AdmZip().writeZip(path);
    await expect(readPetpack(path)).rejects.toThrow(/no entries/);
  });

  it('rejects ".." segments (zip-slip) — central directory patched', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('slip'), sheetEntries(['qqq123.svg']));
    await patchEntryName(path, 'sheets/qqq123.svg', 'sheets/../qqq.svg');
    await expect(readPetpack(path)).rejects.toThrow(/\.\." segments/);
  });

  it('rejects backslash separators', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path);
    await patchEntryName(path, 'sheets/idle.svg', 'sheets\\idle.svg');
    await expect(readPetpack(path)).rejects.toThrow(/backslash/);
  });

  it('rejects absolute entry names', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path);
    await patchEntryName(path, 'sheets/idle.svg', '/heets/idle.svg');
    await expect(readPetpack(path)).rejects.toThrow(/absolute/);
  });

  it('rejects drive-letter entry names', async () => {
    const path = dir() + '.petpack';
    // adm-zip's write-side sanitizer happens to preserve 'C:/…' — no patch needed.
    buildZip(path, [
      { name: 'pack.json', data: '{}' },
      { name: 'C:/evil.svg', data: SVG_BYTES },
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/drive-letter/);
  });

  it('rejects over the 64-entry cap (65 entries)', async () => {
    const path = dir() + '.petpack';
    buildZip(path, [
      { name: 'pack.json', data: JSON.stringify(validManifest('count')) },
      ...sheetEntries(Array.from({ length: 64 }, (_, i) => `pad${String(i).padStart(2, '0')}.svg`)),
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/65 entries.*64 entry cap/);
  });

  it('rejects a per-entry bomb (9 MiB declared, from headers, pre-decompression)', async () => {
    const path = dir() + '.petpack';
    buildZip(path, [
      { name: 'pack.json', data: JSON.stringify(validManifest('bomb')) },
      ...sheetEntries(['idle.svg']),
      { name: 'sheets/big.svg', data: Buffer.alloc(9 * 1024 * 1024, 0x61) },
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/declares.*per-entry cap/);
  });

  it('rejects a declared usize of 0 (unbounded-inflate shape) pre-decompression (fix-round F3)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path);
    // Bundled adm-zip drops its maxOutputLength cap when the header claims 0
    // uncompressed bytes — the guard must reject the entry BEFORE the inflate
    // that would otherwise run unbounded up to CRC rejection.
    await patchEntryUsize(path, 'sheets/idle.svg', 0);
    await expect(readPetpack(path)).rejects.toThrow(/must declare a positive size/);
  });

  it('rejects the total-uncompressed bomb (5 × 7 MiB declared)', async () => {
    const path = dir() + '.petpack';
    buildZip(path, [
      { name: 'pack.json', data: JSON.stringify(validManifest('bomb-total')) },
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `sheets/big${i}.svg`,
        data: Buffer.alloc(7 * 1024 * 1024, 0x61),
      })),
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/uncompressed bytes in total/);
  });

  it('rejects over the 32 MiB FILE cap (sparse truncate — the file never decompresses)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path);
    const handle = await open(path, 'r+');
    try {
      await handle.truncate(MAX_PETPACK_BYTES + 1);
    } finally {
      await handle.close();
    }
    expect((await stat(path)).size).toBe(MAX_PETPACK_BYTES + 1);
    await expect(readPetpack(path)).rejects.toThrow(/byte .petpack cap/);
  });

  it('rejects non-png/svg sheet extensions (.jpg)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('jpg'), [{ name: 'sheets/pic.jpg', data: SVG_BYTES }]);
    await expect(readPetpack(path)).rejects.toThrow(/\.png or \.svg/);
  });

  it('rejects PNG magic under an .svg name (mislabeled magic)', async () => {
    const pngPath = fileURLToPath(
      new URL('../../../fixtures/whale-girl/lib/assets/characters/whale-girl/idle.png', import.meta.url)
    );
    const pngBytes = await readFile(pngPath);
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('mislabeled'), [
      { name: 'sheets/fake.svg', data: pngBytes },
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/not an SVG/);
  });

  it('rejects SVG text under a .png name (mislabeled magic, other way)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('mislabeled2'), [
      { name: 'sheets/fake.png', data: SVG_BYTES },
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/not a PNG/);
  });

  it('rejects a missing pack.json', async () => {
    const path = dir() + '.petpack';
    buildZip(path, sheetEntries(['idle.svg']));
    await expect(readPetpack(path)).rejects.toThrow(/no pack\.json/);
  });

  it('rejects an invalid-JSON pack.json', async () => {
    const path = dir() + '.petpack';
    buildZip(path, [
      { name: 'pack.json', data: '{nope' },
      ...sheetEntries(['idle.svg']),
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects symlink entries (S_IFLNK in the external attrs)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('symlink'), [
      { name: 'sheets/link.svg', data: SVG_BYTES, attr: (0o120000 << 16) >>> 0 },
    ]);
    await expect(readPetpack(path)).rejects.toThrow(/symbolic-link/);
  });

  it('rejects stray top-level entries (only pack.json + sheets/*)', async () => {
    const path = dir() + '.petpack';
    buildValidPetpack(path, validManifest('stray'), [{ name: 'README.txt', data: 'hi' }]);
    await expect(readPetpack(path)).rejects.toThrow(/only pack\.json and sheets/);
  });
});
