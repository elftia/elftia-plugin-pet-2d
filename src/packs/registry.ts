/**
 * src/packs/registry.ts — which packs exist. The list is BUILD-TIME
 * generated (`src/packs/pack-ids.generated.ts`, emitted by
 * `scripts/build-packs.ts` from the `packs-src/` directory listing): the
 * runtime never enumerates `plugin://` URLs (a restricted/unstamped plugin's
 * entries 404 and are hidden from enumeration — the pet must not depend on
 * directory listing), and a hand-maintained copy would drift from
 * `dist/characters/` the first time someone adds a pack and forgets it.
 */
import { GENERATED_PACK_IDS } from './pack-ids.generated';

/** Every pack this build ships (order = menu order; first = default). */
export const PACK_IDS: readonly string[] = GENERATED_PACK_IDS;

export const DEFAULT_PACK_ID: string = PACK_IDS[0] ?? '';

export function isKnownPackId(id: string): boolean {
  return PACK_IDS.includes(id);
}

/** The next pack in rotation — the menu's switch-character verb (wraps). */
export function nextPackId(current: string): string {
  if (PACK_IDS.length === 0) return current;
  const index = PACK_IDS.indexOf(current);
  if (index === -1) return DEFAULT_PACK_ID || current;
  return PACK_IDS[(index + 1) % PACK_IDS.length];
}
