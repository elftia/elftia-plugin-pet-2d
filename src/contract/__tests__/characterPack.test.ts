/**
 * src/contract/__tests__/characterPack.test.ts — the D7 gate's own test
 * suite (task 3.4). The realism fixture is the REAL whale-girl manifest
 * data (`_others/whale-girl/lib/assets/manifest.json`,
 * `characters['whale-girl'].states`, read verbatim at authoring time
 * 2026-08-18 — not a synthetic stand-in), hand-adapted into our
 * `CharacterPackManifest` shape inline below (adding `apiVersion` / `id` /
 * `license`, dropping whale-girl's native `meta.stageSize` in favor of our
 * `meta.stageScale` — see D8's documented adaptation notes).
 *
 * This is DELIBERATELY not a call into `whaleGirlCompat.ts` — that adapter
 * module and its own round-trip tests are task 6.3 / 6.8, and don't exist
 * yet. This suite only needs to prove the CONTRACT shape accepts
 * real-world data; it does not need — and must not wait on — the adapter.
 *
 * Dimensions are supplied via `measuredSheets`, not read from disk (this
 * module has no fs access): every whale-girl PNG measures height 256,
 * width = frames * 256 exactly (design.md's Context table, "measured PNG
 * IHDRs"), so `frameSize: 256` throughout matches the real sheets.
 */
import { describe, expect, it } from 'vitest';

import type { CharacterPackManifest, MeasuredSheetDimensions } from '../characterPack';
import { validateCharacterPack } from '../characterPack';

// Copied verbatim from `_others/whale-girl/lib/assets/manifest.json`
// `characters['whale-girl'].states` (read 2026-08-18) — see file header.
const WHALE_GIRL_STATES = {
  idle: { sheet: 'idle.png', frames: 3, fps: 2, playback: 'blink' },
  working: { sheet: 'working.png', frames: 3, fps: 3, playback: 'loop' },
  celebrate: { sheet: 'celebrate.png', frames: 3, fps: 4, playback: 'loop' },
  error: { sheet: 'error.png', frames: 2, fps: 8, motion: 'shake', playback: 'once' },
  disappointed: { sheet: 'disappointed.png', frames: 2, fps: 2, playback: 'loop' },
  joy: { sheet: 'joy.png', frames: 2, fps: 5, playback: 'loop' },
  eat: { sheet: 'eat.png', frames: 3, fps: 8, playback: 'loop' },
  play: { sheet: 'play.png', frames: 3, fps: 4, playback: 'loop' },
  drag: { sheet: 'drag.png', frames: 1, fps: 5, motion: 'tilt', playback: 'loop' },
  walk: { sheet: 'walk.png', frames: 3, fps: 6, playback: 'pingpong' },
  sleep: { sheet: 'sleep.png', frames: 2, fps: 1, playback: 'loop' },
  wake: { sheet: 'wake.png', frames: 2, fps: 3, playback: 'once' },
  welcome: { sheet: 'welcome.png', frames: 2, fps: 3, playback: 'loop' },
  think: { sheet: 'think.png', frames: 1, fps: 2, motion: 'float', playback: 'loop' },
  wait: { sheet: 'wait.png', frames: 1, fps: 2, motion: 'wiggle', playback: 'loop' },
} as const satisfies CharacterPackManifest['states'];

function measuredFor(states: typeof WHALE_GIRL_STATES): MeasuredSheetDimensions {
  const out: Record<string, { width: number; height: number }> = {};
  for (const slot of Object.values(states)) {
    out[slot.sheet] = { width: slot.frames * 256, height: 256 };
  }
  return out;
}

function validManifest(): CharacterPackManifest {
  return {
    apiVersion: 1,
    id: 'whale-girl-fixture',
    name: '鲸鱼娘',
    credit: 'ZipZipPipe',
    license: 'MIT (software) — character is ZipZipPipe IP; local dev fixture, never distributed',
    meta: { frameSize: 256, stageScale: 1 },
    states: WHALE_GIRL_STATES,
  };
}

describe('validateCharacterPack — real whale-girl data', () => {
  it('accepts the real whale-girl manifest, hand-adapted to our contract', () => {
    const problems = validateCharacterPack(validManifest(), measuredFor(WHALE_GIRL_STATES));
    expect(problems).toEqual([]);
  });
});

describe('validateCharacterPack — rejections', () => {
  it('rejects a missing state', () => {
    const manifest = validManifest();
    const { wait: _omitted, ...rest } = manifest.states;
    const problems = validateCharacterPack(
      { ...manifest, states: rest },
      measuredFor(WHALE_GIRL_STATES)
    );
    expect(problems).toContain('states.wait is missing — all 15 states are required, no fallback');
  });

  it('rejects an unknown state key', () => {
    const manifest = validManifest();
    const states = { ...manifest.states, dance: manifest.states.idle };
    const problems = validateCharacterPack(
      { ...manifest, states },
      measuredFor(WHALE_GIRL_STATES)
    );
    expect(problems).toContain(
      'states.dance is not a known PetState — unknown state keys are rejected'
    );
  });

  it('rejects frames * frameSize != measured strip width', () => {
    const manifest = validManifest();
    const measured = { ...measuredFor(WHALE_GIRL_STATES), 'idle.png': { width: 999, height: 256 } };
    const problems = validateCharacterPack(manifest, measured);
    expect(problems).toContain(
      'states.idle.sheet "idle.png" width 999 does not equal frames(3) * frameSize(256) = 768'
    );
  });

  it('rejects motion on a multi-frame non-error state', () => {
    const manifest = validManifest();
    const states = {
      ...manifest.states,
      walk: { ...manifest.states.walk, motion: 'bob' as const },
    };
    const problems = validateCharacterPack(
      { ...manifest, states },
      measuredFor(WHALE_GIRL_STATES)
    );
    expect(problems).toContain(
      'states.walk.motion is only allowed when frames === 1 (except "error"), got frames: 3'
    );
  });

  it('rejects pingpong with 1 frame', () => {
    const manifest = validManifest();
    const states = {
      ...manifest.states,
      walk: { sheet: 'walk.png', frames: 1, fps: 6, playback: 'pingpong' as const },
    };
    const measured = { ...measuredFor(WHALE_GIRL_STATES), 'walk.png': { width: 256, height: 256 } };
    const problems = validateCharacterPack({ ...manifest, states }, measured);
    expect(problems).toContain('states.walk.playback "pingpong" requires frames >= 2, got frames: 1');
  });

  it('rejects blink with 1 frame', () => {
    const manifest = validManifest();
    const states = {
      ...manifest.states,
      idle: { sheet: 'idle.png', frames: 1, fps: 2, playback: 'blink' as const },
    };
    const measured = { ...measuredFor(WHALE_GIRL_STATES), 'idle.png': { width: 256, height: 256 } };
    const problems = validateCharacterPack({ ...manifest, states }, measured);
    expect(problems).toContain('states.idle.playback "blink" requires frames >= 2, got frames: 1');
  });

  it('rejects a bad id charset', () => {
    const manifest = { ...validManifest(), id: 'Whale Girl!' };
    const problems = validateCharacterPack(manifest, measuredFor(WHALE_GIRL_STATES));
    expect(problems.some((p) => p.startsWith('id must match'))).toBe(true);
  });

  it('rejects a missing credit', () => {
    const manifest = { ...validManifest(), credit: '' };
    const problems = validateCharacterPack(manifest, measuredFor(WHALE_GIRL_STATES));
    expect(problems).toContain(
      'credit is required and must be a non-empty string (asset author attribution)'
    );
  });

  it('rejects a missing license', () => {
    const manifest = { ...validManifest(), license: '' };
    const problems = validateCharacterPack(manifest, measuredFor(WHALE_GIRL_STATES));
    expect(problems).toContain(
      'license is required and must be a non-empty string (SPDX id or explicit text)'
    );
  });

  it('rejects a bad stageScale', () => {
    const manifest = { ...validManifest(), meta: { frameSize: 256, stageScale: 1.5 } };
    const problems = validateCharacterPack(manifest, measuredFor(WHALE_GIRL_STATES));
    expect(problems).toContain('meta.stageScale must be a number with 0 < x <= 1, got 1.5');
  });
});
