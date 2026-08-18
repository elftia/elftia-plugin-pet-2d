/**
 * scripts/lib/measureSheets.ts — real sheet-asset dimensions, the numbers
 * `validateCharacterPack`'s strip rule needs (D7). PNG comes from the IHDR
 * chunk header (no image library, zero installs); SVG from its `viewBox`
 * (fallback: width/height attributes). One implementation shared by
 * build-packs / verify-packs / the Tier-B tests — a second, drifting copy
 * of this math is exactly how a bad pack would slip through.
 */
import { readFile } from 'node:fs/promises';

export interface SheetDimensions {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Width/height from a PNG's IHDR chunk (bytes 16..24, big-endian u32s).
 * Throws a readable error for anything that is not a PNG with an IHDR first
 * chunk (all real PNGs have IHDR first — it is required by the spec).
 */
export function measurePngDimensions(bytes: Uint8Array): SheetDimensions {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('not a PNG: signature mismatch (PNG sheets must start with the 8-byte PNG signature)');
    }
  }
  const isIhdr =
    bytes.length >= 24 &&
    bytes[12] === 0x49 && // I
    bytes[13] === 0x48 && // H
    bytes[14] === 0x44 && // D
    bytes[15] === 0x52; // R
  if (!isIhdr) {
    throw new Error('not a PNG: first chunk is not IHDR (corrupt or non-standard PNG)');
  }
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) {
    throw new Error(`PNG has non-positive dimensions ${width}x${height}`);
  }
  return { width, height };
}

/**
 * Width/height from an SVG's `viewBox="minX minY width height"`, falling
 * back to its `width`/`height` attributes. Throws when neither is present —
 * a dimensionless SVG cannot satisfy the strip contract.
 */
export function measureSvgDimensions(text: string): SheetDimensions {
  const viewBox = text.match(
    /viewBox\s*=\s*["']\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*["']/
  );
  if (viewBox) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const widthAttr = text.match(/\bwidth\s*=\s*["']\s*([-+0-9.eE]+)/);
  const heightAttr = text.match(/\bheight\s*=\s*["']\s*([-+0-9.eE]+)/);
  if (widthAttr && heightAttr) {
    const width = Number(widthAttr[1]);
    const height = Number(heightAttr[1]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  throw new Error(
    'SVG has neither a usable viewBox ("minX minY width height") nor width/height attributes — cannot measure'
  );
}

/** Reads a sheet file and measures it, dispatching on content (PNG magic or SVG text). */
export async function measureSheetFile(path: string): Promise<SheetDimensions> {
  const bytes = await readFile(path);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return measurePngDimensions(bytes);
  }
  return measureSvgDimensions(bytes.toString('utf8'));
}

/** True when the file looks like a PNG by its magic bytes. */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}
