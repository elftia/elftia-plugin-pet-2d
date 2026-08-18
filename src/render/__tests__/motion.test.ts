/**
 * src/render/__tests__/motion.test.ts — task 5.6: the animation shorthand is
 * pinned exactly, applyMotion applies/clears it, and ensureMotionStyles
 * injects all nine recipes as one style element exactly once.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { MOTION_RECIPES } from '../../contract/petState';
import {
  __resetMotionStyleForTests,
  applyMotion,
  ensureMotionStyles,
  motionAnimation,
} from '../motion';

describe('motionAnimation', () => {
  it('builds the exact shorthand for a few pinned recipes', () => {
    expect(motionAnimation('bob')).toBe('pet-motion-bob 2200ms ease-in-out infinite');
    expect(motionAnimation('shake')).toBe('pet-motion-shake 600ms ease-in-out infinite');
    expect(motionAnimation('sigh')).toBe('pet-motion-sigh 3400ms ease-in-out infinite');
    expect(motionAnimation('wave')).toBe('pet-motion-wave 1600ms ease-in-out infinite');
  });

  it('names its keyframes after the recipe for all nine (contract tie to MOTION_RECIPES)', () => {
    expect(MOTION_RECIPES).toHaveLength(9);
    for (const recipe of MOTION_RECIPES) {
      expect(motionAnimation(recipe)).toMatch(
        new RegExp(`^pet-motion-${recipe} \\d+ms ease-in-out infinite$`)
      );
    }
  });
});

describe('applyMotion', () => {
  it('applies the recipe and clears on null', () => {
    const el = document.createElement('div');
    applyMotion(el, 'bob');
    expect(el.style.animation).toBe(motionAnimation('bob'));
    applyMotion(el, null);
    expect(el.style.animation).toBe('');
  });
});

describe('ensureMotionStyles', () => {
  beforeEach(() => {
    __resetMotionStyleForTests();
    document.getElementById('pet-2d-motion-keyframes')?.remove();
  });

  it('injects one style element carrying all nine keyframes', () => {
    ensureMotionStyles(document);
    const style = document.getElementById('pet-2d-motion-keyframes');
    expect(style).not.toBeNull();
    const text = style?.textContent ?? '';
    for (const recipe of MOTION_RECIPES) {
      expect(text).toContain(`@keyframes pet-motion-${recipe} `);
    }
  });

  it('is idempotent — a second call injects nothing', () => {
    ensureMotionStyles(document);
    ensureMotionStyles(document);
    expect(document.querySelectorAll('#pet-2d-motion-keyframes')).toHaveLength(1);
  });
});
