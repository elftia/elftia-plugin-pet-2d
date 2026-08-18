/**
 * persist.test.ts — task 8.2/8.5: normalize-on-read discipline, the
 * never-throw storage contract, the <=1 s debounced writer, and the
 * ledger's OWN teardown hooks (visibilitychange->hidden + pagehide).
 */
import { describe, expect, it } from 'vitest';

import {
  createLedgerPersistence,
  initialLedgerState,
  LEDGER_STORAGE_KEY,
  LEDGER_WRITE_DEBOUNCE_MS,
  type LedgerState,
  normalizeLedgerState,
  readLedgerState,
  writeLedgerNow,
} from '../persist';
import { fakeDocument, fakeStorage, fakeTimeout, fakeWindow } from './fakes';

describe('normalizeLedgerState (read discipline)', () => {
  it('drops unknown fields — including a stored level, which is ALWAYS derived', () => {
    const normalized = normalizeLedgerState({
      xp: 100,
      level: 99,
      bogus: 'x',
      stats: { tasksDone: 3, failures: 1, turns: 2, mediaJobs: 0, activeMs: 10, firstSeenAt: 5 },
    });
    expect(Object.keys(normalized)).not.toContain('level');
    expect(Object.keys(normalized)).not.toContain('bogus');
    expect(normalized.xp).toBe(100);
    expect(normalized.stats.tasksDone).toBe(3);
  });

  it('clamps garbage numbers to zero / XP_SAFE_MAX instead of throwing', () => {
    const normalized = normalizeLedgerState({
      xp: -50,
      stats: { tasksDone: Number.NaN, failures: -3, turns: 2.7, activeMs: Number.POSITIVE_INFINITY },
    });
    expect(normalized.xp).toBe(0);
    expect(normalized.stats.tasksDone).toBe(0);
    expect(normalized.stats.failures).toBe(0);
    expect(normalized.stats.turns).toBe(2);
    expect(Number.isFinite(normalized.stats.activeMs)).toBe(true);
  });

  it('filters titles to the closed set and caps memory at 8', () => {
    const memory = Array.from({ length: 12 }, (_, i) => ({ at: i, text: `e${i}` }));
    const normalized = normalizeLedgerState({
      xp: 0,
      titles: ['first-task', 'made-up-title', 'first-task'],
      memory,
    });
    expect(normalized.titles).toEqual(['first-task']);
    expect(normalized.memory).toHaveLength(8);
    expect(normalized.memory.at(-1)?.text).toBe('e11');
  });

  it('non-objects fall back to the initial state', () => {
    expect(normalizeLedgerState(null)).toEqual(initialLedgerState());
    expect(normalizeLedgerState('x')).toEqual(initialLedgerState());
    expect(normalizeLedgerState(42)).toEqual(initialLedgerState());
  });
});

describe('readLedgerState / writeLedgerNow', () => {
  it('round-trips a full state (seen map included)', () => {
    const storage = fakeStorage();
    const state: LedgerState = {
      xp: 150,
      stats: { tasksDone: 12, failures: 2, turns: 30, mediaJobs: 1, activeMs: 90_000, firstSeenAt: 7 },
      titles: ['first-task', 'helper'],
      memory: [{ at: 7, text: 'Completed task (no. 12)' }],
      seen: { 'taskCompleted|t1|1000': 9000 },
      updatedAt: 99,
    };
    writeLedgerNow(storage, state);
    expect(readLedgerState(storage)).toEqual(state);
  });

  it('corrupt JSON or a missing key reads as a fresh state, never a throw', () => {
    expect(readLedgerState(fakeStorage())).toEqual(initialLedgerState());
    expect(readLedgerState(fakeStorage({ [LEDGER_STORAGE_KEY]: '{not json' }))).toEqual(
      initialLedgerState()
    );
  });

  it('a throwing setItem (quota) never throws', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeLedgerNow(storage, initialLedgerState())).not.toThrow();
  });
});

describe('createLedgerPersistence', () => {
  const state = (n: number): LedgerState => ({ ...initialLedgerState(), updatedAt: n });

  it('debounces: many writes collapse to one storage write after the timer', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const persistence = createLedgerPersistence({ storage, timeout });
    persistence.write(state(1));
    persistence.write(state(2));
    persistence.write(state(3));
    expect(storage.writes).toBe(0); // nothing yet
    timeout.flush();
    expect(storage.writes).toBe(1); // ONE write, last value wins
    expect(readLedgerState(storage).updatedAt).toBe(3);
  });

  it('the debounce constant is the documented <= 1 s', () => {
    expect(LEDGER_WRITE_DEBOUNCE_MS).toBe(1_000);
  });

  it('flush() writes pending state immediately and cancels the timer', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const persistence = createLedgerPersistence({ storage, timeout });
    persistence.write(state(1));
    persistence.flush();
    expect(storage.writes).toBe(1);
    timeout.flush(); // cancelled — no second write
    expect(storage.writes).toBe(1);
  });

  it('registers its OWN visibilitychange hook: hidden flushes, visible does not', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const document = fakeDocument('visible');
    const persistence = createLedgerPersistence({ storage, timeout, documentRef: document });

    persistence.write(state(1));
    document.dispatch('visibilitychange'); // still visible — no flush
    expect(storage.writes).toBe(0);

    document.visibilityState = 'hidden';
    document.dispatch('visibilitychange');
    expect(storage.writes).toBe(1);
  });

  it('registers its OWN pagehide hook: flushes', () => {
    const storage = fakeStorage();
    const windowRef = fakeWindow();
    const persistence = createLedgerPersistence({ storage, timeout: fakeTimeout(), windowRef });
    persistence.write(state(1));
    windowRef.dispatch('pagehide');
    expect(storage.writes).toBe(1);
  });

  it('dispose() removes both listeners and cancels the pending timer', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const document = fakeDocument();
    const windowRef = fakeWindow();
    const persistence = createLedgerPersistence({ storage, timeout, documentRef: document, windowRef });
    expect(document.listenerCount('visibilitychange')).toBe(1);
    expect(windowRef.listenerCount('pagehide')).toBe(1);

    persistence.write(state(1));
    persistence.dispose();
    expect(document.listenerCount('visibilitychange')).toBe(0);
    expect(windowRef.listenerCount('pagehide')).toBe(0);

    document.visibilityState = 'hidden';
    document.dispatch('visibilitychange');
    windowRef.dispatch('pagehide');
    timeout.flush();
    expect(storage.writes).toBe(0); // everything torn down
  });
});
