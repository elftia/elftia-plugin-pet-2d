/**
 * src/state/__tests__/prefs.test.ts — task 7.1: D11's plugin-local prefs —
 * normalize discipline, the never-throw storage contract, and the debounced
 * store (rapid switch-character rotation = one write; flush on hide).
 */
import { describe, expect, it } from 'vitest';

import {
  createPrefsStore,
  normalizePrefs,
  PREFS_STORAGE_KEY,
  PREFS_WRITE_DEBOUNCE_MS,
  readPrefs,
  writePrefsNow,
} from '../prefs';

/** Minimal in-memory Storage stand-in (also counts writes). */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>(initial === undefined ? [] : [[PREFS_STORAGE_KEY, initial]]);
  return {
    map,
    writes: 0,
    getItem: (key: string) => map.get(key) ?? null,
    setItem(key: string, value: string) {
      this.writes += 1;
      map.set(key, value);
    },
  };
}

/** Drivable timeout double (no real waits). */
function fakeTimeout() {
  const timers: Array<{ handler: () => void; fired: boolean }> = [];
  return {
    setTimeout: (handler: () => void) => {
      timers.push({ handler, fired: false });
      return timers.length - 1;
    },
    clearTimeout: (handle: unknown) => {
      const timer = timers[handle as number];
      if (timer) timer.fired = true;
    },
    /** Fire every timer not cancelled/cleared, oldest first. */
    flush: () => {
      for (const timer of timers) if (!timer.fired) { timer.fired = true; timer.handler(); }
    },
  };
}

describe('normalizePrefs', () => {
  it('keeps known well-typed fields and drops everything else', () => {
    expect(
      normalizePrefs({ packId: 'tin-bot', facingSeed: 3, bogus: 'x', hack: { evil: true } })
    ).toEqual({ packId: 'tin-bot', facingSeed: 3 });
  });

  it('rejects malformed values and non-objects', () => {
    expect(normalizePrefs({ packId: '', facingSeed: 'left' })).toEqual({});
    expect(normalizePrefs(null)).toEqual({});
    expect(normalizePrefs('tin-bot')).toEqual({});
    expect(normalizePrefs(42)).toEqual({});
  });
});

describe('readPrefs / writePrefsNow', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    writePrefsNow(storage, { packId: 'elf-blob' });
    expect(readPrefs(storage)).toEqual({ packId: 'elf-blob' });
  });

  it('corrupt JSON or a missing key reads as empty prefs, never a throw', () => {
    expect(readPrefs(fakeStorage('{not json'))).toEqual({});
    expect(readPrefs(fakeStorage())).toEqual({});
  });

  it('a throwing setItem (quota/private mode) never throws', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writePrefsNow(storage, { packId: 'x' })).not.toThrow();
  });
});

describe('createPrefsStore', () => {
  it('setPackId is visible to read() immediately, persisted only after the debounce', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const store = createPrefsStore({ storage, timeout });

    store.setPackId('tin-bot');
    expect(store.read()).toEqual({ packId: 'tin-bot' });
    expect(storage.map.get(PREFS_STORAGE_KEY)).toBeUndefined(); // not yet written

    timeout.flush();
    expect(storage.map.get(PREFS_STORAGE_KEY)).toBe('{"packId":"tin-bot"}');
  });

  it('rapid rotation collapses to ONE write (the timer resets per set)', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const store = createPrefsStore({ storage, timeout });
    store.setPackId('tin-bot');
    store.setPackId('elf-blob');
    timeout.flush();
    expect(storage.writes).toBe(1);
    expect(readPrefs(storage)).toEqual({ packId: 'elf-blob' }); // last value wins
  });

  it('flush() writes pending state immediately and cancels the timer', () => {
    const storage = fakeStorage();
    const timeout = fakeTimeout();
    const store = createPrefsStore({ storage, timeout });
    store.setPackId('tin-bot');
    store.flush();
    expect(storage.writes).toBe(1);
    timeout.flush(); // cancelled — no second write
    expect(storage.writes).toBe(1);
  });

  it('flush() with nothing pending writes nothing', () => {
    const storage = fakeStorage();
    const store = createPrefsStore({ storage, timeout: fakeTimeout() });
    store.flush();
    expect(storage.writes).toBe(0);
  });

  it('the debounce constant is the documented 500 ms', () => {
    expect(PREFS_WRITE_DEBOUNCE_MS).toBe(500);
  });
});
