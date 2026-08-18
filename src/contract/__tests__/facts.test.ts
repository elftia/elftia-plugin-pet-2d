import { describe, expect, it } from 'vitest';

import { PET_FACT_TYPES } from '../facts';

/**
 * Pins `PET_FACT_TYPES` against the authoritative source list this repo has
 * no import access to:
 * `HOST_WT/packages/shared/src/contracts/pet-facts.ts:40-49`
 * (`PetFactTypeSchema`). Read verbatim at authoring time (2026-08-18); if
 * the host adds, removes, or renames a fact type, this hand-copied list
 * goes stale silently unless someone re-diffs it against the source on the
 * next host facts-protocol change — no automated cross-repo check is
 * possible here (D14: zero runtime dependency, no `@elftia/shared` access).
 */
const HOST_PET_FACT_TYPES_SOURCE_OF_TRUTH = [
  'taskCompleted',
  'taskFailed',
  'sessionThinking',
  'sessionWaitingApproval',
  'turnCompleted',
  'mediaJobCompleted',
  'requestError',
  'appLifecycle',
].sort();

describe('PET_FACT_TYPES', () => {
  it('matches pet-facts.ts:40-49 exactly (set equality, order-independent)', () => {
    expect([...PET_FACT_TYPES].sort()).toEqual(HOST_PET_FACT_TYPES_SOURCE_OF_TRUTH);
  });

  it('has no duplicate entries', () => {
    expect(new Set(PET_FACT_TYPES).size).toBe(PET_FACT_TYPES.length);
  });
});
