/**
 * memory.test.ts — task 8.5: the 8-entry ring evicts oldest-first and never
 * mutates its input.
 */
import { describe, expect, it } from 'vitest';

import type { LedgerMemoryEntry } from '../../contract/ledgerPort';
import { MEMORY_MAX, pushMemory } from '../memory';

describe('pushMemory (the ring)', () => {
  it('MEMORY_MAX is 8', () => {
    expect(MEMORY_MAX).toBe(8);
  });

  it('keeps only the newest 8 entries, oldest evicted first', () => {
    let entries: ReadonlyArray<LedgerMemoryEntry> = [];
    for (let i = 0; i < 10; i += 1) {
      entries = pushMemory(entries, { at: i, text: `entry-${i}` });
    }
    expect(entries.map((entry) => entry.text)).toEqual([
      'entry-2',
      'entry-3',
      'entry-4',
      'entry-5',
      'entry-6',
      'entry-7',
      'entry-8',
      'entry-9',
    ]);
  });

  it('is pure — the input array is never mutated', () => {
    const input: ReadonlyArray<LedgerMemoryEntry> = [{ at: 0, text: 'only' }];
    pushMemory(input, { at: 1, text: 'new' });
    expect(input).toHaveLength(1);
  });

  it('preserves order for fewer than 8 entries', () => {
    const entries = pushMemory([{ at: 0, text: 'a' }], { at: 1, text: 'b' });
    expect(entries.map((entry) => entry.text)).toEqual(['a', 'b']);
  });
});
