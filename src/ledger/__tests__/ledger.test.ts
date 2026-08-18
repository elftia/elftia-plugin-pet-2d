/**
 * ledger.test.ts — task 8.5: the createLedger behaviours D10 spells out —
 * fact idempotency across repeated snapshots AND across a reload (persisted
 * seen-map), failures counted but never penalized, capped companionship
 * accrual, summary()'s null-before-first-observe contract, and the
 * memory/title/level-up side effects.
 */
import { describe, expect, it } from 'vitest';

import type { PetFactEntryLike, PetFactsSnapshotLike } from '../../contract/facts';
import { createLedger, factKey, isThinking } from '../createLedger';
import { ACTIVE_CAP_MS } from '../xp';
import { fakeStorage, fakeTimeout } from './fakes';

function fact(
  partial: Partial<PetFactEntryLike> & { type: string; id: string; deadline: number }
): PetFactEntryLike {
  return { active: true, occurredAt: 1_000, ...partial };
}

function snapshotOf(...facts: PetFactEntryLike[]): PetFactsSnapshotLike {
  return { apiVersion: 1, revision: 1, generatedAt: 0, facts };
}

const TASK = fact({ type: 'taskCompleted', id: 't1', occurredAt: 1_000, deadline: 9_000 });

describe('fact idempotency (D10 mechanism 1)', () => {
  it('a taskCompleted fact reappearing in every snapshot awards ONCE', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    const snapshot = snapshotOf(TASK);
    ledger.observe(snapshot, 1_000);
    expect(ledger.summary()?.xp).toBe(10);
    for (const t of [1_125, 1_250, 1_375, 2_000, 5_000]) {
      ledger.observe(snapshot, t); // same fact, still inside its 8 s window
    }
    expect(ledger.summary()?.xp).toBe(10);
    expect(ledger.summary()?.stats.tasksDone).toBe(1);
  });

  it('DISTINCT fact instances in one snapshot each count once', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(
      snapshotOf(
        fact({ type: 'taskCompleted', id: 't1', occurredAt: 1_000, deadline: 9_000 }),
        fact({ type: 'taskCompleted', id: 't2', occurredAt: 1_050, deadline: 9_050 })
      ),
      1_000
    );
    expect(ledger.summary()?.stats.tasksDone).toBe(2);
    expect(ledger.summary()?.xp).toBe(20);
  });

  it('a RELOAD with the persisted seen-map does not re-award', () => {
    const storage = fakeStorage();
    const timeoutA = fakeTimeout();
    const a = createLedger({ storage, timeout: timeoutA });
    a.observe(snapshotOf(TASK), 1_000);
    timeoutA.flush(); // persist (seen map included) before the "reload"

    const b = createLedger({ storage, timeout: fakeTimeout() });
    b.observe(snapshotOf(TASK), 2_000); // same fact, fresh ledger instance
    expect(b.summary()?.stats.tasksDone).toBe(1);
    expect(b.summary()?.xp).toBe(10);
  });

  it('an EXPIRED seen entry is pruned — the same key can award again later', () => {
    // Contract (ledgerPort.observe): keyed to deadline "so a re-observed-
    // after-expiry fact with the same id can award again".
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    const shortLived = fact({ type: 'taskCompleted', id: 't1', occurredAt: 1_000, deadline: 1_100 });
    ledger.observe(snapshotOf(shortLived), 1_000);
    expect(ledger.summary()?.xp).toBe(10);
    ledger.observe(snapshotOf(shortLived), 1_200); // past deadline: pruned, re-awards
    expect(ledger.summary()?.xp).toBe(20);
  });

  it('failures are idempotent too — repeated taskFailed facts count once', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    const failed = fact({ type: 'taskFailed', id: 'f1', occurredAt: 1_000, deadline: 9_000 });
    for (const t of [1_000, 1_125, 1_250, 2_000]) {
      ledger.observe(snapshotOf(failed), t);
    }
    expect(ledger.summary()?.stats.failures).toBe(1);
  });
});

describe('zero negative feedback (D10)', () => {
  it('failures NEVER reduce xp, and mixed facts keep both counters', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(
      snapshotOf(
        fact({ type: 'taskFailed', id: 'f1', occurredAt: 1_000, deadline: 9_000 }),
        fact({ type: 'requestError', id: 'e1', occurredAt: 1_000, deadline: 9_000 })
      ),
      1_000
    );
    expect(ledger.summary()?.xp).toBe(0);
    expect(ledger.summary()?.stats.failures).toBe(2);

    ledger.observe(snapshotOf(TASK), 2_000);
    expect(ledger.summary()?.xp).toBe(10);
    expect(ledger.summary()?.stats.failures).toBe(2); // untouched
  });

  it('nothing derived from a failure ever reaches memory', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(
      snapshotOf(fact({ type: 'taskFailed', id: 'f1', occurredAt: 1_000, deadline: 9_000 })),
      1_000
    );
    expect(ledger.summary()?.memory).toEqual([]);
  });
});

describe('companionship accrual (D10 mechanism 2)', () => {
  const THINKING = fact({ type: 'sessionThinking', id: 's1', deadline: 1_000 + 600_000 });

  it('accrues elapsed ms between observes while a live thinking fact holds', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(snapshotOf(THINKING), 1_000);
    expect(ledger.summary()?.stats.activeMs).toBe(0); // first observe anchors only
    ledger.observe(snapshotOf(THINKING), 61_000);
    expect(ledger.summary()?.stats.activeMs).toBe(60_000);
  });

  it('caps a single increment at 5 minutes (an overnight gap cannot farm)', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(snapshotOf(THINKING), 1_000);
    ledger.observe(snapshotOf(THINKING), 1_000 + ACTIVE_CAP_MS + 3_600_000); // ~1h gap
    expect(ledger.summary()?.stats.activeMs).toBe(ACTIVE_CAP_MS);
  });

  it('credits a stretch at its ENDING observe — a non-thinking observe closes the stretch', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(snapshotOf(THINKING), 1_000);
    ledger.observe(snapshotOf(), 61_000); // thinking ended somewhere in here —
    expect(ledger.summary()?.stats.activeMs).toBe(60_000); // the stretch is credited at its end
    ledger.observe(snapshotOf(THINKING), 121_000); // anchors a NEW stretch
    expect(ledger.summary()?.stats.activeMs).toBe(60_000); // no accrual while held
    ledger.observe(snapshotOf(THINKING), 131_000);
    expect(ledger.summary()?.stats.activeMs).toBe(70_000); // + the new 10 s stretch
  });

  it('isThinking mirrors sense.ts: live only while now < deadline', () => {
    expect(isThinking(snapshotOf(THINKING), THINKING.deadline - 1)).toBe(true);
    expect(isThinking(snapshotOf(THINKING), THINKING.deadline)).toBe(false);
    expect(
      isThinking(snapshotOf(fact({ type: 'sessionThinking', id: 's1', deadline: 9_000, active: false })), 1_000)
    ).toBe(false);
  });
});

describe('summary() and noteInteraction()', () => {
  it('summary() is null before the first observe, then carries derived level + thresholds', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    expect(ledger.summary()).toBeNull();
    ledger.observe(snapshotOf(), 1_000);
    const summary = ledger.summary();
    expect(summary?.level).toBe(1);
    expect(summary?.xp).toBe(0);
    expect(summary?.xpForNextLevel).toBe(50);
    expect(summary?.stats.firstSeenAt).toBe(1_000);
  });

  it('level follows xp across the 50-xp boundary', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    for (let n = 1; n <= 5; n += 1) {
      ledger.observe(
        snapshotOf(fact({ type: 'taskCompleted', id: `t${n}`, occurredAt: n * 10_000, deadline: n * 10_000 + 8_000 })),
        n * 10_000
      );
    }
    expect(ledger.summary()?.xp).toBe(50);
    expect(ledger.summary()?.level).toBe(2);
    expect(ledger.summary()?.xpForNextLevel).toBe(150);
  });

  it('noteInteraction awards for the recognized kinds and no-ops unknown ones', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(snapshotOf(), 1_000);
    ledger.noteInteraction('feed');
    ledger.noteInteraction('play');
    ledger.noteInteraction('drag');
    ledger.noteInteraction('switchCharacter');
    expect(ledger.summary()?.xp).toBe(4);
    ledger.noteInteraction('timeTravel');
    expect(ledger.summary()?.xp).toBe(4);
    expect(ledger.summary()?.stats).toEqual({
      tasksDone: 0,
      failures: 0,
      turns: 0,
      mediaJobs: 0,
      activeMs: 0,
      firstSeenAt: 1_000,
    });
  });

  it('state survives a reload: xp/stats/titles/memory/firstSeenAt round-trip', () => {
    const storage = fakeStorage();
    const timeoutA = fakeTimeout();
    const a = createLedger({ storage, timeout: timeoutA });
    a.observe(snapshotOf(TASK), 1_000);
    timeoutA.flush();

    const b = createLedger({ storage, timeout: fakeTimeout() });
    expect(b.summary()).toBeNull(); // before first observe, per contract
    b.observe(snapshotOf(), 50_000);
    const summary = b.summary();
    expect(summary?.xp).toBe(10);
    expect(summary?.stats.tasksDone).toBe(1);
    expect(summary?.stats.firstSeenAt).toBe(1_000); // from the earlier life
    expect(summary?.memory.map((entry) => entry.text)).toEqual([
      'Completed task (no. 1)',
      'Unlocked title: first-task', // one task is first-task's threshold
    ]);
  });
});

describe('memory, titles, level-ups (the side effects)', () => {
  function observeTasks(count: number) {
    const storage = fakeStorage();
    const ledger = createLedger({ storage, timeout: fakeTimeout() });
    for (let n = 1; n <= count; n += 1) {
      ledger.observe(
        snapshotOf(fact({ type: 'taskCompleted', id: `t${n}`, occurredAt: n * 10_000, deadline: n * 10_000 + 8_000 })),
        n * 10_000
      );
    }
    return ledger;
  }

  it('a task completion earns a memory entry; a turn does NOT (too frequent)', () => {
    const storage = fakeStorage();
    const ledger = createLedger({ storage, timeout: fakeTimeout() });
    ledger.observe(
      snapshotOf(
        TASK,
        fact({ type: 'turnCompleted', id: 'r1', occurredAt: 1_000, deadline: 9_000 })
      ),
      1_000
    );
    expect(ledger.summary()?.xp).toBe(12); // 10 + 2
    expect(ledger.summary()?.stats.turns).toBe(1);
    expect(ledger.summary()?.memory.map((entry) => entry.text)).toEqual([
      'Completed task (no. 1)',
      'Unlocked title: first-task', // the first task unlocks its title too
    ]);
  });

  it('a media job earns +5 and its own memory entry', () => {
    const ledger = createLedger({ storage: fakeStorage(), timeout: fakeTimeout() });
    ledger.observe(
      snapshotOf(fact({ type: 'mediaJobCompleted', id: 'm1', occurredAt: 1_000, deadline: 9_000 })),
      1_000
    );
    expect(ledger.summary()?.xp).toBe(5);
    expect(ledger.summary()?.memory.map((entry) => entry.text)).toEqual([
      'Media job finished (no. 1)',
    ]);
  });

  it('early title + level-up entries survive when the ring is not full (5 tasks)', () => {
    const ledger = observeTasks(5); // xp 50 -> level 2 exactly
    const texts = ledger.summary()?.memory.map((entry) => entry.text) ?? [];
    expect(texts).toContain('Unlocked title: first-task');
    expect(texts).toContain('Reached level 2');
    expect(ledger.summary()?.titles).toEqual(['first-task']);
    expect(ledger.summary()?.level).toBe(2);
  });

  it('the LATE events (helper, level 3) are present even after the ring evicts the early ones', () => {
    const ledger = observeTasks(20); // xp 200 -> level 3 crossed at 150 (task 15)
    const texts = ledger.summary()?.memory.map((entry) => entry.text) ?? [];
    expect(texts).toContain('Unlocked title: helper'); // unlocked at task 20 — newest
    expect(texts).toContain('Reached level 3'); // at task 15 — still inside the ring
    expect(texts).not.toContain('Reached level 2'); // evicted by the 20-task barrage
    expect(ledger.summary()?.titles).toEqual(['first-task', 'helper']);
  });

  it('the ring still caps at 8 under a barrage (20 tasks -> 8 entries)', () => {
    const ledger = observeTasks(20);
    expect(ledger.summary()?.memory).toHaveLength(8);
  });
});

describe('factKey (the D10 key shape)', () => {
  it('is type|id|occurredAt, degrading to since when occurredAt is absent', () => {
    expect(factKey(TASK)).toBe('taskCompleted|t1|1000');
    expect(factKey(fact({ type: 'turnCompleted', id: 'r9', occurredAt: undefined, since: 55, deadline: 9 }))).toBe(
      'turnCompleted|r9|55'
    );
  });
});
