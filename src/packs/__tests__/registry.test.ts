/**
 * src/packs/__tests__/registry.test.ts — task 6.8: the registry over the
 * two shipped packs (the build-time generated list), including the menu's
 * wrap-around rotation.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_PACK_ID, isKnownPackId, nextPackId, PACK_IDS } from '../registry';

describe('registry (build-time generated pack list)', () => {
  it('carries both shipped packs, elf-blob first (the default)', () => {
    expect(PACK_IDS).toEqual(['elf-blob', 'tin-bot']);
    expect(DEFAULT_PACK_ID).toBe('elf-blob');
  });

  it('knows its ids and rejects strangers', () => {
    expect(isKnownPackId('elf-blob')).toBe(true);
    expect(isKnownPackId('tin-bot')).toBe(true);
    expect(isKnownPackId('whale-girl')).toBe(false); // fixture only — never shipped
  });

  it('rotates for switch-character and wraps', () => {
    expect(nextPackId('elf-blob')).toBe('tin-bot');
    expect(nextPackId('tin-bot')).toBe('elf-blob'); // wraps
  });

  it('an unknown current id falls back to the default', () => {
    expect(nextPackId('ghost')).toBe('elf-blob');
  });
});
