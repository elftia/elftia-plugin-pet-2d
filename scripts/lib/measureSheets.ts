/**
 * scripts/lib/measureSheets.ts — fs glue ONLY. The measurement math lives in
 * `src/packs/measureSheets.ts` (moved there by task 2.1) and is re-exported
 * so existing script/test imports keep working; `measureSheetFile` is the
 * one node-side reader (path in → bytes → the shared `measureSheetBytes`
 * dispatch). Keep it that way: the main half's D5 import pipeline measures
 * zip-entry buffers with the SAME src functions — no drifting twin.
 */
import { readFile } from 'node:fs/promises';

import { measureSheetBytes, type SheetDimensions } from '../../src/packs/measureSheets';

export {
  isPngBytes,
  measurePngDimensions,
  measureSheetBytes,
  measureSvgDimensions,
  type SheetDimensions,
} from '../../src/packs/measureSheets';

/** Reads a sheet file and measures it (dispatch on content, in src). */
export async function measureSheetFile(path: string): Promise<SheetDimensions> {
  return measureSheetBytes(await readFile(path));
}
