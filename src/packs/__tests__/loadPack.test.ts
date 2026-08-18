/**
 * src/packs/__tests__/loadPack.test.ts — task 6.8: the loader's failure
 * path (and happy path) with a STUBBED importer — the real `plugin://`
 * dynamic import only exists inside the pet window; here the contract is:
 * a good module loads, and EVERY failure degrades to the fallback glyph
 * instead of an empty window or a throw.
 */
import { describe, expect, it, vi } from 'vitest';

import { PET_STATES } from '../../contract/petState';
import { FALLBACK_PACK_ID, fallbackPack, loadPack, packModuleUrl } from '../loadPack';

/** A complete, well-formed pack module default export. */
function validModuleDefault() {
  const manifest = {
    apiVersion: 1,
    id: 'elf-blob',
    name: 'Elf Blob',
    credit: 'X',
    license: 'CC0-1.0',
    states: {} as Record<string, { sheet: string; frames: number; fps: number; playback: 'loop' }>,
  };
  const sheets = {} as Record<string, { url: string; frames: number }>;
  for (const state of PET_STATES) {
    manifest.states[state] = { sheet: `${state}.svg`, frames: 2, fps: 2, playback: 'loop' };
    sheets[state] = { url: 'data:image/svg+xml,x', frames: 2 };
  }
  return { manifest, sheets };
}

describe('packModuleUrl', () => {
  it('points at the pack module under this plugin\'s origin', () => {
    expect(packModuleUrl('elf-blob')).toBe('plugin://pet-2d/characters/elf-blob/pack.mjs');
  });
});

describe('loadPack — happy path', () => {
  it('loads a valid module and returns state-keyed SheetSources', async () => {
    const importer = vi.fn(async () => ({ default: validModuleDefault() }));
    const pack = await loadPack('elf-blob', importer);
    expect(importer).toHaveBeenCalledWith(packModuleUrl('elf-blob'));
    expect(pack.manifest.id).toBe('elf-blob');
    expect(pack.sheets.walk).toEqual({ url: 'data:image/svg+xml,x', frames: 2 });
  });
});

describe('loadPack — every failure degrades to the fallback glyph', () => {
  it('import rejection (protocol/network/404)', async () => {
    const importer = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const pack = await loadPack('ghost', importer);
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
    expect(pack.sheets.idle.url.startsWith('data:image/svg+xml,')).toBe(true);
  });

  it('non-object default export', async () => {
    const pack = await loadPack('x', async () => ({ default: null }));
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
  });

  it('missing state in sheets', async () => {
    const broken = validModuleDefault();
    delete broken.sheets.wait;
    const pack = await loadPack('x', async () => ({ default: broken }));
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
  });

  it('frames cross-check mismatch between manifest slot and sheet entry', async () => {
    const broken = validModuleDefault();
    broken.sheets.walk = { url: 'data:image/svg+xml,x', frames: 5 }; // slot says 2
    const pack = await loadPack('x', async () => ({ default: broken }));
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
  });

  it('empty url string', async () => {
    const broken = validModuleDefault();
    broken.sheets.idle = { url: '', frames: 2 };
    const pack = await loadPack('x', async () => ({ default: broken }));
    expect(pack.manifest.id).toBe(FALLBACK_PACK_ID);
  });
});

describe('fallbackPack', () => {
  it('covers all 15 states with a single grey frame each', () => {
    const fallback = fallbackPack();
    expect(Object.keys(fallback.sheets).sort()).toEqual([...PET_STATES].sort());
    for (const state of PET_STATES) {
      expect(fallback.sheets[state].frames).toBe(1);
      expect(fallback.manifest.states[state].frames).toBe(1);
    }
  });
});
