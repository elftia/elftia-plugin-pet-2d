/**
 * src/render/__tests__/hitTest.test.ts — task 5.6: the alpha-mask pipeline
 * against a stubbed canvas painting a synthetic half-transparent image. The
 * stub derives the drawn FRAME from the source rect it received (sx / sw)
 * and paints a known spatial pattern — frame 0 opaque on the left half of
 * the stage, frame 1 on the right — so these tests pin everything
 * `createHitTest` owns: the stage→cell mapping, one mask per (state,
 * frame), one image load per URL, the threshold pass-through, the
 * frameSize GETTER (pack-switch freshness), invalidate(), and failure
 * propagation. The per-pixel reduction itself is the browser binding's
 * three lines and is not duplicated here.
 */
import { describe, expect, it } from 'vitest';

import type { PetState } from '../../contract/petState';
import { ALPHA_THRESHOLD, createHitTest, type HitTestDeps, MASK_SIZE } from '../hitTest';

interface DrawnRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

function createStubDeps(options: { failLoad?: boolean } = {}) {
  const loadCalls: string[] = [];
  const draws: DrawnRect[] = [];
  const canvasSizes: number[] = [];
  const readThresholds: number[] = [];

  const deps: HitTestDeps = {
    loadImage(url) {
      loadCalls.push(url);
      return options.failLoad
        ? Promise.reject(new Error(`stub load failure: ${url}`))
        : Promise.resolve({ width: 512, height: 256 }); // a 2×256 two-frame strip
    },
    createCanvas(sizePx) {
      canvasSizes.push(sizePx);
      return {
        drawSheetFrame(_image, rect) {
          draws.push({ ...rect });
        },
        readAlphaInto(target, threshold) {
          readThresholds.push(threshold);
          const last = draws[draws.length - 1];
          const frame = last ? Math.round(last.sx / last.sw) : 0;
          for (let i = 0; i < target.length; i++) {
            const cellX = i % MASK_SIZE;
            const opaque = frame === 0 ? cellX < MASK_SIZE / 2 : cellX >= MASK_SIZE / 2;
            target[i] = opaque ? 1 : 0;
          }
        },
      };
    },
  };
  return { deps, loadCalls, draws, canvasSizes, readThresholds };
}

function makeHitTest(initialFrameSize = 256) {
  const urls: Partial<Record<PetState, string>> = { idle: 'data:image/png;base64,IDLE' };
  let frameSize = initialFrameSize;
  const stub = createStubDeps();
  const hitTest = createHitTest(
    (state) => urls[state] ?? '',
    () => frameSize,
    stub.deps
  );
  return {
    hitTest,
    stub,
    setFrameSize(next: number) {
      frameSize = next;
    },
  };
}

describe('cell mapping against the synthetic half-transparent image', () => {
  it('frame 0: the left half of the stage is opaque, the right half is not', async () => {
    const { hitTest } = makeHitTest();
    expect(await hitTest.isOpaqueAt('idle', 0, 0, 0, 256)).toBe(true); // cell (0,0)
    expect(await hitTest.isOpaqueAt('idle', 0, 127, 255, 256)).toBe(true); // cellX 31 — last left cell
    expect(await hitTest.isOpaqueAt('idle', 0, 128, 0, 256)).toBe(false); // cellX 32 — first right cell
    expect(await hitTest.isOpaqueAt('idle', 0, 255, 255, 256)).toBe(false); // cell (63,63)
  });

  it('frame 1 has its own mask — drawn from the strip’s second cell', async () => {
    const { hitTest, stub } = makeHitTest();
    expect(await hitTest.isOpaqueAt('idle', 1, 0, 0, 256)).toBe(false);
    expect(await hitTest.isOpaqueAt('idle', 1, 255, 0, 256)).toBe(true);
    expect(stub.draws[0]).toEqual({ sx: 256, sy: 0, sw: 256, sh: 256 });
  });

  it('out-of-stage coordinates are transparent by definition', async () => {
    const { hitTest } = makeHitTest();
    expect(await hitTest.isOpaqueAt('idle', 0, -1, 0, 256)).toBe(false);
    expect(await hitTest.isOpaqueAt('idle', 0, 0, -0.5, 256)).toBe(false);
    expect(await hitTest.isOpaqueAt('idle', 0, 256, 0, 256)).toBe(false);
    expect(await hitTest.isOpaqueAt('idle', 0, 0, 999, 256)).toBe(false);
    expect(await hitTest.isOpaqueAt('idle', 0, 0, 0, 0)).toBe(false); // degenerate stage
  });
});

describe('caching and lifecycle', () => {
  it('builds one mask per (state, frame) and loads one image per URL', async () => {
    const { hitTest, stub } = makeHitTest();
    await hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    await hitTest.isOpaqueAt('idle', 0, 64, 64, 256); // same (state, frame): cached mask
    await hitTest.isOpaqueAt('idle', 0, 200, 100, 256); // ditto
    await hitTest.isOpaqueAt('idle', 1, 0, 0, 256); // new frame: second mask, same image
    expect(stub.draws).toHaveLength(2);
    expect(stub.loadCalls).toEqual(['data:image/png;base64,IDLE']);
    expect(stub.canvasSizes).toEqual([MASK_SIZE, MASK_SIZE]);
    expect(stub.readThresholds).toEqual([ALPHA_THRESHOLD, ALPHA_THRESHOLD]); // 8/255 flows through
  });

  it('invalidate() drops both the mask and the image cache', async () => {
    const { hitTest, stub } = makeHitTest();
    await hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    hitTest.invalidate();
    await hitTest.isOpaqueAt('idle', 0, 0, 0, 256);
    expect(stub.draws).toHaveLength(2);
    expect(stub.loadCalls).toHaveLength(2);
  });

  it('reads frameSize through the getter, so a pack switch is picked up after invalidate()', async () => {
    const { hitTest, stub, setFrameSize } = makeHitTest(256);
    await hitTest.isOpaqueAt('idle', 1, 255, 0, 256); // builds with 256 → sx 256
    setFrameSize(128);
    hitTest.invalidate();
    await hitTest.isOpaqueAt('idle', 1, 255, 0, 256); // rebuilt with 128 → sx 128
    expect(stub.draws[stub.draws.length - 1]).toEqual({ sx: 128, sy: 0, sw: 128, sh: 128 });
  });

  it('propagates image-load failures — the caller decides to treat them as transparent', async () => {
    const stub = createStubDeps({ failLoad: true });
    const hitTest = createHitTest(() => 'data:image/png;base64,BAD', () => 256, stub.deps);
    await expect(hitTest.isOpaqueAt('idle', 0, 0, 0, 256)).rejects.toThrow('stub load failure');
  });
});
