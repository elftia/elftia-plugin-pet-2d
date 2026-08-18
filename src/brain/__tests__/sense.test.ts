/**
 * src/brain/__tests__/sense.test.ts — task 4.5 (a)-(d): one case per fact
 * type (incl. both `appLifecycle` phases), clamping/expiry at exact
 * boundaries, `sessionThinking` past `deadline` producing `activityUnknown`
 * with `sleep`/`walk` suppressed (proven through `pickState`, the layer
 * that actually does the suppressing), and a `null` snapshot leaving every
 * fact flag false. A few defensive-branch tests (inactive / unknown-type
 * entries ignored) and a local-flags sweep round out `deriveSense`'s own
 * contract beyond the required (a)-(d).
 */
import { describe, expect, it } from 'vitest';

import type { PetFactEntryLike, PetFactsSnapshotLike } from '../../contract/facts';
import type { SenseFlag } from '../../contract/petState';
import type { LocalState, Sense } from '../sense';
import { deriveSense } from '../sense';
import { pickState } from '../stateTable';
import { TIMINGS } from '../timings';

const NOW = 1_000_000;

function snapshotOf(...facts: PetFactEntryLike[]): PetFactsSnapshotLike {
  return { apiVersion: 1, revision: 1, generatedAt: NOW, facts };
}

function neutralLocal(overrides: Partial<LocalState> = {}): LocalState {
  return {
    dragging: false,
    dragReleasedAt: null,
    feedingAt: null,
    playingAt: null,
    wakingAt: null,
    joyfulAt: null,
    lastInteractionAt: NOW,
    strollTriggeredAt: null,
    workingInterludeWindow: null,
    ...overrides,
  };
}

const FACT_DERIVED_FLAGS = [
  'taskDone',
  'turnDone',
  'mediaDone',
  'failed',
  'sulking',
  'thinking',
  'awaitingApproval',
  'greeting',
  'activityUnknown',
] as const satisfies readonly SenseFlag[];
type FactDerivedFlag = (typeof FACT_DERIVED_FLAGS)[number];

function factFlags(sense: Sense): Record<FactDerivedFlag, boolean> {
  const out = {} as Record<FactDerivedFlag, boolean>;
  for (const flag of FACT_DERIVED_FLAGS) out[flag] = sense[flag];
  return out;
}

/** Asserts exactly `trueFlag` (or none, if `null`) is true among the nine
 * fact-derived flags — every other fact-derived flag must be false. */
function expectOnly(sense: Sense, trueFlag: FactDerivedFlag | null): void {
  const expected = {} as Record<FactDerivedFlag, boolean>;
  for (const flag of FACT_DERIVED_FLAGS) expected[flag] = flag === trueFlag;
  expect(factFlags(sense)).toEqual(expected);
}

describe('deriveSense — one case per fact type (task 4.5a)', () => {
  it('taskCompleted -> taskDone', () => {
    const snap = snapshotOf({
      type: 'taskCompleted',
      id: 't1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'taskDone');
  });

  it('turnCompleted -> turnDone', () => {
    const snap = snapshotOf({
      type: 'turnCompleted',
      id: 'r1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'turnDone');
  });

  it('mediaJobCompleted -> mediaDone', () => {
    const snap = snapshotOf({
      type: 'mediaJobCompleted',
      id: 'm1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'mediaDone');
  });

  it('taskFailed -> failed', () => {
    const snap = snapshotOf({
      type: 'taskFailed',
      id: 'f1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'failed');
  });

  it('requestError -> failed (same flag as taskFailed, different fact type)', () => {
    const snap = snapshotOf({
      type: 'requestError',
      id: 'e1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'failed');
  });

  it('sessionThinking -> thinking (stateful, still within deadline)', () => {
    const snap = snapshotOf({
      type: 'sessionThinking',
      id: 's1',
      active: true,
      deadline: NOW + 5000,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'thinking');
  });

  it('sessionWaitingApproval -> awaitingApproval (stateful, still within deadline)', () => {
    const snap = snapshotOf({
      type: 'sessionWaitingApproval',
      id: 'w1',
      active: true,
      deadline: NOW + 5000,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'awaitingApproval');
  });

  it('appLifecycle phase "started" -> greeting', () => {
    const snap = snapshotOf({
      type: 'appLifecycle',
      id: 'app',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
      details: { phase: 'started' },
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), 'greeting');
  });

  it('appLifecycle phase "quitting" -> no flag (no goodbye state exists)', () => {
    const snap = snapshotOf({
      type: 'appLifecycle',
      id: 'app',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
      details: { phase: 'quitting' },
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), null);
  });
});

describe('deriveSense — clamping/expiry at exact boundaries (task 4.5b)', () => {
  it('clamp picks the host deadline when it is tighter than preferredWindowMs', () => {
    // occurredAt + preferredWindowMs(6000) = NOW + 5900, but the host's own
    // deadline (NOW + 2000) is tighter — the clamp must use the smaller one.
    const snap = snapshotOf({
      type: 'taskCompleted',
      id: 't1',
      active: true,
      occurredAt: NOW - 100,
      deadline: NOW + 2000,
    });
    expect(deriveSense(snap, neutralLocal(), NOW + 1999).taskDone).toBe(true);
    expect(deriveSense(snap, neutralLocal(), NOW + 2000).taskDone).toBe(false);
  });

  it('failed clamp boundary, then the sulking tail, then full expiry', () => {
    // preferredWindowMs.failure = 4000, sulkTailMs = 6000; host deadline is
    // far in the future so the clamp is governed purely by preferredWindowMs.
    const snap = snapshotOf({
      type: 'taskFailed',
      id: 'f1',
      active: true,
      occurredAt: NOW,
      deadline: NOW + 999_999,
    });
    expect(factFlags(deriveSense(snap, neutralLocal(), NOW + 3999))).toMatchObject({
      failed: true,
      sulking: false,
    });
    // Clamp boundary: failed drops, tail begins in the same instant.
    expect(factFlags(deriveSense(snap, neutralLocal(), NOW + TIMINGS.preferredWindowMs.failure))).toMatchObject({
      failed: false,
      sulking: true,
    });
    expect(
      factFlags(
        deriveSense(
          snap,
          neutralLocal(),
          NOW + TIMINGS.preferredWindowMs.failure + TIMINGS.sulkTailMs - 1
        )
      )
    ).toMatchObject({ failed: false, sulking: true });
    // Tail end: fully expired, neither flag holds.
    expect(
      factFlags(
        deriveSense(
          snap,
          neutralLocal(),
          NOW + TIMINGS.preferredWindowMs.failure + TIMINGS.sulkTailMs
        )
      )
    ).toMatchObject({ failed: false, sulking: false });
  });

  it('stateful sessionThinking boundary: thinking flips to activityUnknown exactly at deadline', () => {
    const snap = snapshotOf({
      type: 'sessionThinking',
      id: 's1',
      active: true,
      deadline: NOW + 2000,
    });
    expect(factFlags(deriveSense(snap, neutralLocal(), NOW + 1999))).toMatchObject({
      thinking: true,
      activityUnknown: false,
    });
    expect(factFlags(deriveSense(snap, neutralLocal(), NOW + 2000))).toMatchObject({
      thinking: false,
      activityUnknown: true,
    });
  });
});

describe('deriveSense — sessionThinking past deadline (task 4.5c)', () => {
  it('produces activityUnknown, not thinking, and pickState suppresses sleep/walk', () => {
    const snap = snapshotOf({
      type: 'sessionThinking',
      id: 's1',
      active: true,
      deadline: NOW - 1, // already past — the plugin is still holding this
      // stale snapshot because the host pump has not re-pushed since.
    });
    const local = neutralLocal({
      // Long enough since the last interaction that `sleeping` would
      // otherwise hold...
      lastInteractionAt: NOW - TIMINGS.sleepAfterMs - 1000,
      // ...and a stroll window that would otherwise be open too.
      strollTriggeredAt: NOW - 100,
    });
    const sense = deriveSense(snap, local, NOW);

    expect(sense.thinking).toBe(false);
    expect(sense.activityUnknown).toBe(true);
    // deriveSense itself does not suppress the local flags — that is
    // STATE_TABLE's job (the `forbids` column on the `sleep`/`walk` rows).
    expect(sense.sleeping).toBe(true);
    expect(sense.strolling).toBe(true);

    // The suppression is only observable through pickState: without the
    // `forbids: ['activityUnknown', ...]` clause on those two rows, this
    // sense would pick 'sleep' (sleeping is the first-true special-case
    // flag reachable here); with it, both rows are skipped and the table
    // falls through to the default 'idle' row.
    expect(pickState(sense)).toBe('idle');
  });
});

describe('deriveSense — null snapshot (task 4.5d)', () => {
  it('every fact-derived flag is false; local flags still apply normally', () => {
    const local = neutralLocal({ dragging: true });
    const sense = deriveSense(null, local, NOW);
    expectOnly(sense, null);
    expect(sense.dragging).toBe(true);
  });
});

describe('deriveSense — defensive branches', () => {
  it('ignores an entry with active: false (never emitted on the real wire, defended anyway)', () => {
    const snap = snapshotOf({
      type: 'taskCompleted',
      id: 't1',
      active: false,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), null);
  });

  it('ignores an entry whose type is not in the known PetFactType union (forward-compat)', () => {
    const snap = snapshotOf({
      type: 'someFutureFactType',
      id: 'u1',
      active: true,
      occurredAt: NOW - 1000,
      deadline: NOW + 999_999,
    });
    expectOnly(deriveSense(snap, neutralLocal(), NOW), null);
  });
});

describe('deriveSense — local flags', () => {
  it('dragging passes through directly, not time-windowed', () => {
    expect(deriveSense(null, neutralLocal({ dragging: true }), NOW).dragging).toBe(true);
    expect(deriveSense(null, neutralLocal({ dragging: false }), NOW).dragging).toBe(false);
  });

  it('sleeping becomes true only once the no-interaction threshold is reached', () => {
    const local = neutralLocal({ lastInteractionAt: NOW });
    expect(deriveSense(null, local, NOW + TIMINGS.sleepAfterMs - 1).sleeping).toBe(false);
    expect(deriveSense(null, local, NOW + TIMINGS.sleepAfterMs).sleeping).toBe(true);
  });

  it.each([
    ['dragReleasedAt', 'dropBuffer', TIMINGS.dropBufferMs] as const,
    ['feedingAt', 'feeding', TIMINGS.transientMs] as const,
    ['playingAt', 'playing', TIMINGS.transientMs] as const,
    ['wakingAt', 'waking', TIMINGS.transientMs] as const,
    ['joyfulAt', 'joyful', TIMINGS.joyMs] as const,
    ['strollTriggeredAt', 'strolling', TIMINGS.strollDurationMs] as const,
  ])('%s drives %s for its window, then false at the boundary', (field, flag, windowMs) => {
    const local = neutralLocal({ [field]: NOW } as Partial<LocalState>);
    expect(deriveSense(null, local, NOW + windowMs - 1)[flag as SenseFlag]).toBe(true);
    expect(deriveSense(null, local, NOW + windowMs)[flag as SenseFlag]).toBe(false);
  });

  it('workingInterludeWindow drives workingInterlude until its own endsAt', () => {
    const local = neutralLocal({
      workingInterludeWindow: { startedAt: NOW, endsAt: NOW + 3000 },
    });
    expect(deriveSense(null, local, NOW + 2999).workingInterlude).toBe(true);
    expect(deriveSense(null, local, NOW + 3000).workingInterlude).toBe(false);
  });
});
