/**
 * src/render/__tests__/facing.test.ts — task 5.6: left is the identity
 * transform (assets are authored facing left, D7), right mirrors with
 * `scaleX(-1)` on the sprite element, and a horizontal delta decides the
 * facing — with zero delta keeping the current one (a vertical-only stroll
 * has no opinion).
 */
import { describe, expect, it } from 'vitest';

import { applyFacing, createFacingState, facingFromDelta, facingTransform } from '../facing';

describe('facingTransform', () => {
  it('left is the identity (the authored baseline), right mirrors', () => {
    expect(facingTransform('left')).toBe('');
    expect(facingTransform('right')).toBe('scaleX(-1)');
  });
});

describe('applyFacing', () => {
  it('writes the transform onto the sprite element', () => {
    const el = document.createElement('div');
    applyFacing(el, 'right');
    expect(el.style.transform).toBe('scaleX(-1)');
    applyFacing(el, 'left');
    expect(el.style.transform).toBe('');
  });
});

describe('facingFromDelta', () => {
  it('movement direction decides; zero keeps the current facing', () => {
    expect(facingFromDelta(10, 'left')).toBe('right');
    expect(facingFromDelta(-3, 'right')).toBe('left');
    expect(facingFromDelta(0, 'right')).toBe('right');
    expect(facingFromDelta(0, 'left')).toBe('left');
  });
});

describe('createFacingState', () => {
  it('defaults to left (the authored baseline)', () => {
    expect(createFacingState()).toEqual({ facing: 'left' });
    expect(createFacingState('right')).toEqual({ facing: 'right' });
  });
});
