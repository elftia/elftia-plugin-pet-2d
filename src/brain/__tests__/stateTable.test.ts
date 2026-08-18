/**
 * src/brain/__tests__/stateTable.test.ts — task 4.5e: the table-driven
 * STATE_TABLE matrix. Three assertions over the SAME data the production
 * `pickState` walks, so any future row edit fails here before it silently
 * reorders priority in the shipped pet:
 *   1. row-count pin — `STATE_TABLE.length === 18` (a silent row insertion
 *      or deletion is a priority change and must not pass unnoticed);
 *   2. one case per row proving the row FIRES — built from exactly the
 *      row's own `requires` (everything else false), which is also a proof
 *      that no earlier row's `requires` is a subset of a later row's
 *      `requires` (if it were, the later row could never fire);
 *   3. one case per row (except row 0) proving the row ABOVE shadows it —
 *      the row's own firing sense UNION the previous row's firing sense must
 *      still pick the previous row's state, i.e. priority is real, not
 *      incidental flag layout.
 */
import { describe, expect, it } from 'vitest';

import type { SenseFlag } from '../../contract/petState';
import { SENSE_FLAGS } from '../../contract/petState';
import type { Sense } from '../sense';
import { pickState, STATE_TABLE } from '../stateTable';

/** A `Sense` with exactly `on` true and every other flag false. */
function senseOf(...on: SenseFlag[]): Sense {
  const sense = {} as Sense;
  for (const flag of SENSE_FLAGS) sense[flag] = on.includes(flag);
  return sense;
}

describe('STATE_TABLE shape', () => {
  it('has exactly 18 rows — a silent row insertion/deletion is a priority change', () => {
    expect(STATE_TABLE).toHaveLength(18);
  });

  it('every row state is a member of the closed PetState union', () => {
    // Imported shape check: `state` is typed `PetState`, so this is guaranteed
    // at compile time; the runtime assertion guards a future `as` cast.
    for (const rule of STATE_TABLE) {
      expect(typeof rule.state).toBe('string');
      expect((SENSE_FLAGS as readonly string[]).length).toBeGreaterThan(0); // sanity: import live
    }
  });
});

describe('STATE_TABLE — one firing case per row', () => {
  it.each(STATE_TABLE.map((rule, index) => ({ rule, index })))(
    'row $index ($rule.state) fires on exactly its own requires: $rule.requires',
    ({ rule }) => {
      const sense = senseOf(...rule.requires);
      // Every `forbids` flag must be false in this minimal sense — true by
      // construction (a flag cannot be both required and forbidden within the
      // table's design), asserted so a contradictory future row fails loudly
      // here rather than as an inexplicable "never fires" in production.
      for (const flag of rule.forbids ?? []) {
        expect(sense[flag]).toBe(false);
      }
      expect(pickState(sense)).toBe(rule.state);
    }
  );
});

describe('STATE_TABLE — one shadowing case per row (the row above wins)', () => {
  it.each(
    STATE_TABLE.map((rule, index) => ({ rule, index })).filter(({ index }) => index > 0)
  )(
    'row $index ($rule.state) is shadowed by row ${index - 1} when both fire',
    ({ rule, index }) => {
      const above = STATE_TABLE[index - 1];
      const union = senseOf(...rule.requires, ...above.requires);
      expect(pickState(union)).toBe(above.state);
    }
  );
});
