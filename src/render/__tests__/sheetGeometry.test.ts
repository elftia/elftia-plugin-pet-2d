/**
 * src/render/__tests__/sheetGeometry.test.ts — task 5.6: the strip-geometry
 * math pinned with exact numbers, including the rounding rule (whole pixels)
 * and the mask source-rect derivation hitTest consumes.
 */
import { describe, expect, it } from 'vitest';

import {
  backgroundPositionFor,
  backgroundSizeFor,
  frameSourceRect,
  stagePxFor,
} from '../sheetGeometry';

describe('stagePxFor', () => {
  it('uses the shorter window side', () => {
    expect(stagePxFor({ width: 256, height: 384 }, 1)).toBe(256);
    expect(stagePxFor({ width: 384, height: 256 }, 1)).toBe(256);
  });

  it('applies stageScale as a fraction of that side', () => {
    expect(stagePxFor({ width: 512, height: 512 }, 0.5)).toBe(256);
    expect(stagePxFor({ width: 256, height: 256 }, 0.75)).toBe(192);
  });

  it('rounds fractional scales to whole pixels (background-position must step on the pixel grid)', () => {
    expect(stagePxFor({ width: 300, height: 300 }, 0.5)).toBe(150);
    expect(stagePxFor({ width: 301, height: 301 }, 0.5)).toBe(151); // 150.5 rounds up
    expect(stagePxFor({ width: 255, height: 255 }, 1 / 3)).toBe(85); // 84.95 → 85
  });
});

describe('backgroundSizeFor / backgroundPositionFor', () => {
  it('stretches the strip to frames × stagePx and holds height at stagePx', () => {
    expect(backgroundSizeFor(3, 128)).toBe('384px 128px');
    expect(backgroundSizeFor(1, 256)).toBe('256px 256px');
  });

  it('slides left by frameIndex × stagePx, row stays 0', () => {
    expect(backgroundPositionFor(0, 128)).toBe('0px 0');
    expect(backgroundPositionFor(2, 128)).toBe('-256px 0');
    expect(backgroundPositionFor(4, 64)).toBe('-256px 0');
  });
});

describe('frameSourceRect', () => {
  it('is the cell the hit-test canvas draws for one frame', () => {
    expect(frameSourceRect(0, 256)).toEqual({ sx: 0, sy: 0, sw: 256, sh: 256 });
    expect(frameSourceRect(2, 256)).toEqual({ sx: 512, sy: 0, sw: 256, sh: 256 });
    expect(frameSourceRect(3, 128)).toEqual({ sx: 384, sy: 0, sw: 128, sh: 128 });
  });
});
