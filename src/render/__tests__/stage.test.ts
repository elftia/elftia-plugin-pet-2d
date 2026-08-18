/**
 * src/render/__tests__/stage.test.ts — task 5.6: the layered mount (#pet-root
 * auto-creation, stage > motion > walk > sprite), stage sizing from the
 * window config, one setState's worth of style application (sprite strip,
 * motion recipe, stroll animation and its direction), facing, idempotent
 * style injection across mounts, and the pack-switch hit-test contract —
 * new sheet URLs are only picked up after invalidateHitTest(), which is the
 * promise pet.ts (group 7) must honor on a character switch.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { TIMINGS } from '../../brain/timings';
import type { CharacterPackStateSlot } from '../../contract/characterPack';
import type { HitTestDeps } from '../hitTest';
import { __resetMotionStyleForTests } from '../motion';
import { createStage, type StageEntry, STROLL_TRAVEL_RATIO } from '../stage';

function stubDeps() {
  const loadCalls: string[] = [];
  const deps: HitTestDeps = {
    loadImage(url) {
      loadCalls.push(url);
      return Promise.resolve({ width: 512, height: 256 });
    },
    createCanvas() {
      return {
        drawSheetFrame() {},
        readAlphaInto() {},
      };
    },
  };
  return { deps, loadCalls };
}

function slot(overrides: Partial<CharacterPackStateSlot> = {}): CharacterPackStateSlot {
  return { sheet: 'idle', frames: 3, fps: 2, playback: 'loop', ...overrides };
}

function entry(overrides: Partial<StageEntry> = {}): StageEntry {
  return { slot: slot(), sheetUrl: 'data:image/png;base64,A', frameSize: 256, ...overrides };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  __resetMotionStyleForTests();
});

describe('mount', () => {
  it('creates #pet-root when missing and builds the four layers in order', () => {
    const { elements } = createStage({ hitTestDeps: stubDeps().deps });
    const root = document.getElementById('pet-root');
    expect(root).not.toBeNull();
    expect(root?.contains(elements.stage)).toBe(true);
    expect(elements.stage.className).toBe('pet-stage');
    expect(elements.motion.className).toBe('pet-motion');
    expect(elements.walk.className).toBe('pet-walk');
    expect(elements.sprite.className).toBe('pet-sprite');
    expect(elements.motion.parentElement).toBe(elements.stage);
    expect(elements.walk.parentElement).toBe(elements.motion);
    expect(elements.sprite.parentElement).toBe(elements.walk);
  });

  it('reuses an existing #pet-root', () => {
    document.body.innerHTML = '<div id="pet-root"><span>host content</span></div>';
    const existing = document.getElementById('pet-root');
    const { elements } = createStage({ hitTestDeps: stubDeps().deps });
    expect(existing?.contains(elements.stage)).toBe(true);
    expect(existing?.textContent).toContain('host content'); // nothing was clobbered
  });

  it('injects the stage + motion styles exactly once across mounts', () => {
    createStage({ hitTestDeps: stubDeps().deps });
    createStage({ hitTestDeps: stubDeps().deps });
    expect(document.querySelectorAll('#pet-2d-stage-styles')).toHaveLength(1);
    expect(document.querySelectorAll('#pet-2d-motion-keyframes')).toHaveLength(1);
  });
});

describe('sizing', () => {
  it('mounts at the default 256 window, scale 1', () => {
    const { elements } = createStage({ hitTestDeps: stubDeps().deps });
    expect(elements.stage.style.width).toBe('256px');
    expect(elements.stage.style.height).toBe('256px');
  });

  it('resize uses the shorter side times the scale, and the next setState renders at the new size', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    api.resize({ width: 400, height: 300 }, 0.5); // min(400,300) × 0.5 = 150
    expect(api.elements.stage.style.width).toBe('150px');
    expect(api.elements.stage.style.height).toBe('150px');
    api.setState('idle', entry({ slot: slot({ frames: 3 }) }));
    expect(api.elements.sprite.style.backgroundSize).toBe('450px 150px');
  });
});

describe('setState', () => {
  it('applies the sprite strip and the motion recipe; walk stays still', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    api.setState('idle', entry({ slot: slot({ motion: 'bob' }) }));
    expect(api.elements.sprite.style.backgroundImage).toBe('url("data:image/png;base64,A")');
    expect(api.elements.sprite.style.backgroundSize).toBe('768px 256px');
    expect(api.elements.sprite.style.backgroundPosition).toBe('0px 0px'); // jsdom normalizes '0px 0'
    expect(api.elements.motion.style.animation).toContain('pet-motion-bob');
    expect(api.elements.walk.style.animation).toBe('');
  });

  it('a slot without motion clears the motion layer', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    api.setState('idle', entry({ slot: slot({ motion: 'tilt' }) }));
    api.setState('idle', entry());
    expect(api.elements.motion.style.animation).toBe('');
  });

  it('walk plays the stroll once in the requested direction; leaving walk clears it', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    api.setState('walk', entry(), 1);
    expect(api.elements.walk.style.animation).toBe(
      `pet-stroll-right ${TIMINGS.strollDurationMs}ms ease-in-out 1 both`
    );
    api.setState('walk', entry(), -1);
    expect(api.elements.walk.style.animation).toBe(
      `pet-stroll-left ${TIMINGS.strollDurationMs}ms ease-in-out 1 both`
    );
    api.setState('idle', entry());
    expect(api.elements.walk.style.animation).toBe('');
  });

  it('sets the stroll amplitude CSS variable from STROLL_TRAVEL_RATIO', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    expect(api.elements.walk.style.getPropertyValue('--pet-stroll-amt')).toBe(
      `${STROLL_TRAVEL_RATIO * 100}%`
    );
  });
});

describe('facing', () => {
  it('setFacing mirrors the sprite for right and restores left', () => {
    const api = createStage({ hitTestDeps: stubDeps().deps });
    api.setFacing('right');
    expect(api.elements.sprite.style.transform).toBe('scaleX(-1)');
    api.setFacing('left');
    expect(api.elements.sprite.style.transform).toBe('');
  });
});

describe('hit-test wiring', () => {
  it('tests against the last sheet URL per state; a new URL needs invalidateHitTest()', async () => {
    const { deps, loadCalls } = stubDeps();
    const api = createStage({ hitTestDeps: deps });

    api.setState('idle', entry({ sheetUrl: 'data:image/png;base64,A' }));
    await api.hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    expect(loadCalls).toEqual(['data:image/png;base64,A']);

    // Character switch: same state key, different sheet. Until invalidated,
    // the cached mask for `idle:0` is served — no load of the new URL.
    api.setState('idle', entry({ sheetUrl: 'data:image/png;base64,B' }));
    await api.hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    expect(loadCalls).toEqual(['data:image/png;base64,A']);

    // After invalidate (pet.ts's job on a pack switch), the new URL loads.
    api.invalidateHitTest();
    await api.hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    expect(loadCalls).toEqual(['data:image/png;base64,A', 'data:image/png;base64,B']);
  });
});
