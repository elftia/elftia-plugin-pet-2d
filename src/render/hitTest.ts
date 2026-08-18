/**
 * src/render/hitTest.ts — D6: pointer hit-testing against the sprite's real
 * alpha, not its bounding box. On first use per `(state, frame)` the frame is
 * drawn into an offscreen 64×64 canvas and reduced to a 1-bit alpha mask
 * (`Uint8Array(4096)`, 4 KB per frame); a pointer event maps its stage
 * coordinates to a mask cell and is ignored when the cell's alpha < 8/255.
 * This is why D1's canvas-readability requirement is load-bearing: the mask
 * needs untainted `getImageData`.
 *
 * All canvas/image work is INJECTED (`HitTestDeps`) — jsdom ships no 2D
 * canvas, so the mask logic is unit-tested against a stub and the browser
 * binding lives in one small factory at the bottom. Coarser than per-pixel
 * and strictly more accurate than whale-girl's bbox scan (a bbox counts the
 * transparent corners as hits; a 1/64 cell is at most ~4 px at stage 256).
 */
import type { PetState } from '../contract/petState';
import { frameSourceRect } from './sheetGeometry';

/** Mask edge resolution: the stage is divided into 64×64 cells. */
export const MASK_SIZE = 64;

/** A cell with alpha >= this is "opaque" (8/255 ≈ 3% — catches AA fringes). */
export const ALPHA_THRESHOLD = 8;

/** A loaded sheet image (production: `HTMLImageElement`). Opaque handle. */
export interface HitTestSheetImage {
  readonly width: number;
  readonly height: number;
}

/** An offscreen canvas able to reduce one drawn frame to an alpha mask. */
export interface HitTestCanvas {
  drawSheetFrame(
    image: HitTestSheetImage,
    rect: { sx: number; sy: number; sw: number; sh: number }
  ): void;
  /** Reads the canvas back as per-cell 0/1 opacity into `target` (MASK_SIZE²). */
  readAlphaInto(target: Uint8Array, threshold: number): void;
}

export interface HitTestDeps {
  loadImage(url: string): Promise<HitTestSheetImage>;
  createCanvas(sizePx: number): HitTestCanvas;
}

export interface HitTest {
  /**
   * Stage-relative hit test for the CURRENT `(state, frame)`. Builds the mask
   * on first use (async: image load + draw). Out-of-stage coordinates are
   * transparent by definition.
   */
  isOpaqueAt(
    state: PetState,
    frame: number,
    stageX: number,
    stageY: number,
    stagePx: number
  ): Promise<boolean>;
  /** Drops all caches (pack switch / sheet URL change). */
  invalidate(): void;
}

export function createHitTest(
  sheetUrlFor: (state: PetState) => string,
  /** Getter (not value): the pack's frameSize can change on a pack switch —
   * `stage.ts` invalidates the caches at the same time, so masks are never
   * served stale, but the getter keeps the source-rect math from silently
   * freezing at the first pack's value. */
  frameSizeFor: () => number,
  deps: HitTestDeps
): HitTest {
  const masks = new Map<string, Uint8Array>();
  const images = new Map<string, Promise<HitTestSheetImage>>();

  return {
    async isOpaqueAt(state, frame, stageX, stageY, stagePx) {
      if (stagePx <= 0) return false;
      const cellX = Math.floor((stageX / stagePx) * MASK_SIZE);
      const cellY = Math.floor((stageY / stagePx) * MASK_SIZE);
      if (cellX < 0 || cellY < 0 || cellX >= MASK_SIZE || cellY >= MASK_SIZE) return false;
      const mask = await ensureMask(state, frame);
      return mask[cellY * MASK_SIZE + cellX] === 1;
    },
    invalidate() {
      masks.clear();
      images.clear();
    },
  };

  async function ensureMask(state: PetState, frame: number): Promise<Uint8Array> {
    const key = `${state}:${frame}`;
    const cached = masks.get(key);
    if (cached) return cached;

    const url = sheetUrlFor(state);
    const image = await ensureImage(url);
    const canvas = deps.createCanvas(MASK_SIZE);
    canvas.drawSheetFrame(image, frameSourceRect(frame, frameSizeFor()));
    const mask = new Uint8Array(MASK_SIZE * MASK_SIZE);
    canvas.readAlphaInto(mask, ALPHA_THRESHOLD);
    masks.set(key, mask);
    return mask;
  }

  function ensureImage(url: string): Promise<HitTestSheetImage> {
    let pending = images.get(url);
    if (!pending) {
      pending = deps.loadImage(url);
      images.set(url, pending);
    }
    return pending;
  }
}

/**
 * The browser binding. Lives apart from the logic so tests never touch a
 * real 2D context. `decode()` (rather than onload-only) keeps the draw below
 * race-free; both settle for data URIs without network.
 */
export function createBrowserHitTestDeps(documentRef: Document): HitTestDeps {
  return {
    loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`hit-test image failed to load: ${url}`));
        img.src = url;
      });
    },
    createCanvas(sizePx) {
      const canvas = documentRef.createElement('canvas');
      canvas.width = sizePx;
      canvas.height = sizePx;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('hit-test: 2D canvas context unavailable');
      return {
        drawSheetFrame(image, rect) {
          ctx.drawImage(
            image as unknown as CanvasImageSource,
            rect.sx,
            rect.sy,
            rect.sw,
            rect.sh,
            0,
            0,
            sizePx,
            sizePx
          );
        },
        readAlphaInto(target, threshold) {
          const data = ctx.getImageData(0, 0, sizePx, sizePx).data;
          for (let i = 0; i < target.length; i++) {
            target[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
          }
        },
      };
    },
  };
}
