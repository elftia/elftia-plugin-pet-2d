/**
 * src/packs/__tests__/whaleGirlCompat.test.ts — task 6.8 Tier-A (always
 * runs): the adapter round-trips the REAL whale-girl manifest — all 15
 * states, playback/motion/frames/fps preserved, `stageSize`→`stageScale:1`,
 * synthesized apiVersion/license — and the result passes
 * `validateCharacterPack`. Shape/error cases use inline synthetic manifests
 * so only the round-trip block depends on the committed fixture file (which
 * is part of this repo — see NOTICE; Tier-B additionally uses the sheets).
 *
 * Tier-A validates against dimensions SYNTHESIZED from the manifest's own
 * numbers (width = frames × 256, height = 256): it proves the manifest is
 * self-consistent with the pack contract's default frameSize. Measuring the
 * REAL sheet bytes is Tier-B's job (end-to-end, fixture-sheets-dependent).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type MeasuredSheetDimensions, validateCharacterPack } from '../../contract/characterPack';
import { PET_STATES } from '../../contract/petState';
import { FIXTURE_WHALE_GIRL_DIR } from '../__fixtures__/paths';
import { fromWhaleGirlManifest, listWhaleGirlCharacters } from '../whaleGirlCompat';

const fixtureManifestPath = join(FIXTURE_WHALE_GIRL_DIR, 'lib', 'assets', 'manifest.json');
const fixtureManifest: unknown = JSON.parse(readFileSync(fixtureManifestPath, 'utf8'));

/** whale-girl's real per-state slots, straight from the fixture. */
const wgStates = (
  fixtureManifest as { characters: { 'whale-girl': { states: Record<string, unknown> } } }
).characters['whale-girl'].states;

describe('listWhaleGirlCharacters', () => {
  it('lists the registry form’s ids from the real fixture', () => {
    expect(listWhaleGirlCharacters(fixtureManifest)).toEqual(['whale-girl']);
  });

  it('returns [] for the legacy flat form and for garbage', () => {
    expect(listWhaleGirlCharacters({ states: {} })).toEqual([]);
    expect(listWhaleGirlCharacters(null)).toEqual([]);
    expect(listWhaleGirlCharacters({ characters: 'nope' })).toEqual([]);
  });
});

describe('fromWhaleGirlManifest — round-trip over the real fixture (Tier-A)', () => {
  const pack = fromWhaleGirlManifest(fixtureManifest, 'whale-girl');

  it('synthesizes apiVersion/license, maps credit/name, maps stageSize→stageScale:1', () => {
    expect(pack.apiVersion).toBe(1);
    expect(pack.license).toBe('MIT');
    expect(pack.credit).toBe('ZipZipPipe');
    expect(pack.name).toBe('鲸鱼娘');
    expect(pack.meta).toEqual({ stageScale: 1 }); // stageSize 110 is NOT carried as pixels
  });

  it('covers exactly the 15 PET_STATES', () => {
    expect(Object.keys(pack.states).sort()).toEqual([...PET_STATES].sort());
  });

  it.each(Object.keys(wgStates))(
    'preserves %s slot values verbatim (sheet/frames/fps/playback/motion)',
    (state) => {
      const expected = wgStates[state] as Record<string, unknown>;
      expect(pack.states[state as (typeof PET_STATES)[number]]).toEqual(expected);
    }
  );

  it('the mapped manifest passes validateCharacterPack (self-consistent dims)', () => {
    const measured: Record<string, { width: number; height: number }> = {};
    for (const slot of Object.values(pack.states)) {
      measured[slot.sheet] = { width: slot.frames * 256, height: 256 };
    }
    expect(validateCharacterPack(pack, measured)).toEqual([]);
  });
});

describe('fromWhaleGirlManifest — the four documented adaptations (synthetic inputs)', () => {
  const flatStates = {
    idle: { sheet: 'idle.png', frames: 3, fps: 2, playback: 'blink' },
    // 14 more states omitted — the adapter maps shapes; the GATE rejects gaps.
  };

  it('adaptation 4: accepts the legacy flat root form, using characterId as the id', () => {
    const json = { name: 'Flat Char', credit: 'Someone', meta: { stageSize: 110 }, states: flatStates };
    const pack = fromWhaleGirlManifest(json, 'flat-char');
    expect(pack.id).toBe('flat-char');
    expect(pack.name).toBe('Flat Char');
    expect(pack.states.idle).toEqual(flatStates.idle);
    expect(pack.meta).toEqual({ stageScale: 1 });
  });

  it('registry form wins over a co-existing flat block; a missing id falls back to the flat block', () => {
    const json = {
      characters: { alpha: { name: 'Alpha', credit: 'A', states: flatStates } },
      credit: 'Root Credit', // the flat-form fallback reads attribution from the root
      states: { idle: { sheet: 'z.png', frames: 1, fps: 1, playback: 'loop' } },
    };
    expect(fromWhaleGirlManifest(json, 'alpha').states.idle).toEqual(flatStates.idle);
    expect(fromWhaleGirlManifest(json, 'beta').states.idle).toEqual({
      sheet: 'z.png',
      frames: 1,
      fps: 1,
      playback: 'loop',
    });
  });

  it('defaults name to the id when the block has none', () => {
    const pack = fromWhaleGirlManifest({ credit: 'X', states: flatStates }, 'nameless');
    expect(pack.name).toBe('nameless');
  });

  it('is not a validator: unknown state names carry through for the gate to reject', () => {
    const json = {
      credit: 'X',
      states: { ...flatStates, backflip: { sheet: 'bf.png', frames: 1, fps: 2, playback: 'loop' } },
    };
    const pack = fromWhaleGirlManifest(json, 'weird');
    const measured: MeasuredSheetDimensions = {
      'idle.png': { width: 768, height: 256 },
      'z.png': { width: 256, height: 256 },
      'bf.png': { width: 256, height: 256 },
    };
    const problems = validateCharacterPack(pack, measured);
    expect(problems.some((p) => p.includes('backflip'))).toBe(true);
  });
});

describe('fromWhaleGirlManifest — readable errors', () => {
  it('rejects non-objects', () => {
    expect(() => fromWhaleGirlManifest('nope', 'x')).toThrow('must be a JSON object');
  });

  it('rejects a manifest with neither the registry entry nor a flat states block', () => {
    expect(() => fromWhaleGirlManifest({ characters: {} }, 'ghost')).toThrow(
      /no characters\.ghost entry and no legacy top-level states block/
    );
  });

  it('rejects a character with no credit (attribution is mandatory)', () => {
    expect(() => fromWhaleGirlManifest({ states: {} }, 'x')).toThrow(/no credit/);
  });
});
