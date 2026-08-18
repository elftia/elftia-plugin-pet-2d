/**
 * src/render/sheetGeometry.ts — D6: the strip-geometry math, pure. A sheet is
 * a horizontal strip of `frames` square cells of `frameSize` px (default 256,
 * D7); the stage renders one cell at a time via `background-size` (stretch the
 * strip to `frames * stagePx` wide, `stagePx` tall) and `background-position`
 * (slide left by `frameIndex * stagePx`). All three exports are string/number
 * in, string/number out — no DOM — so the geometry is testable and identical
 * wherever it is applied (the sprite element, the hit-test canvas source
 * rect, a future second renderer).
 */

/** Window size as the pet window reports it (`getConfig().window`, 1..2000). */
export interface PetWindowSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The stage's edge length in px: the shorter window side times the pack's
 * `meta.stageScale` (0 < x <= 1, D7), rounded to an integer so
 * `background-position` steps land on whole pixels (fractional positions
 * sample sheets off their pixel grid and read as blur).
 */
export function stagePxFor(windowSize: PetWindowSize, stageScale: number): number {
  return Math.round(Math.min(windowSize.width, windowSize.height) * stageScale);
}

/** `background-size` for a `frames`-cell strip rendered into `stagePx`. */
export function backgroundSizeFor(frames: number, stagePx: number): string {
  return `${frames * stagePx}px ${stagePx}px`;
}

/**
 * `background-position` showing cell `frameIndex` (0-based). Negative X
 * slides the strip left; Y stays 0 (single-row strips by contract).
 */
export function backgroundPositionFor(frameIndex: number, stagePx: number): string {
  return `${-frameIndex * stagePx}px 0`;
}

/**
 * The source rect of cell `frameIndex` inside a `frameSize`-cell strip, as
 * `hitTest.ts` needs it when drawing one frame into its 64×64 mask canvas
 * (`drawImage(img, sx, sy, sw, sh, …)`). Kept here so the strip layout has
 * exactly one definition file.
 */
export function frameSourceRect(frameIndex: number, frameSize: number): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  return { sx: frameIndex * frameSize, sy: 0, sw: frameSize, sh: frameSize };
}
