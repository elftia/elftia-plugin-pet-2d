/**
 * src/state/__tests__/safeStorage.test.ts — the sandbox contract of the
 * one sanctioned localStorage accessor. The opaque-frame host sandbox
 * (`allow-scripts`, no `allow-same-origin`) makes the `localStorage`
 * property access itself throw (SecurityError in the browser); these
 * tests pin the three behaviors every renderer page depends on: no
 * throw, pass-through identity when storage IS granted, and a coherent
 * session-scoped stand-in when it is not. Node project on purpose — the
 * stand-in paths must hold with no real storage anywhere in sight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeLocalStorage, safeWindowStorage } from '../safeStorage';

/** A window whose localStorage getter throws exactly like the sandbox. */
function sandboxedWindow(): { localStorage: Storage } {
  return {
    get localStorage(): Storage {
      // The browser throws SecurityError; Node has no such constructor,
      // and safeLocalStorage's catch is deliberately type-agnostic.
      throw new Error(
        "Failed to read the 'localStorage' property from 'Window': The document is sandboxed"
      );
    },
  };
}

/** A plain Storage fake standing in for a granted one. */
function grantedStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeLocalStorage', () => {
  it('returns the real storage object (identity) when the host grants one', () => {
    const granted = grantedStorage();
    vi.stubGlobal('window', { localStorage: granted });
    expect(safeLocalStorage()).toBe(granted);
    expect(safeLocalStorage()).toBe(safeLocalStorage());
  });

  it('does not throw when the localStorage getter throws — the 0.2.2 defect', () => {
    vi.stubGlobal('window', sandboxedWindow());
    expect(() => safeLocalStorage()).not.toThrow();
  });

  it('does not throw when there is no window at all (node)', () => {
    // The node project has no window global; safeLocalStorage must still
    // yield a working stand-in, never a ReferenceError.
    expect(() => safeLocalStorage()).not.toThrow();
  });

  it('degrades to one coherent session-scoped stand-in', () => {
    vi.stubGlobal('window', sandboxedWindow());
    const storage = safeLocalStorage();
    expect(safeLocalStorage()).toBe(storage); // shared, not per-call
    expect(storage.getItem('k')).toBeNull(); // fresh, like an empty origin
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v'); // writes visible to same-page readers
    storage.removeItem('k');
    expect(storage.getItem('k')).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('survives the sandbox even after a granted storage disappeared', () => {
    const granted = grantedStorage();
    vi.stubGlobal('window', { localStorage: granted });
    expect(safeLocalStorage()).toBe(granted);
    vi.stubGlobal('window', sandboxedWindow());
    const storage = safeLocalStorage();
    expect(storage).not.toBe(granted);
    expect(storage.getItem('k')).toBeNull();
  });
});

describe('safeWindowStorage', () => {
  it('returns the window storage when reachable', () => {
    const granted = grantedStorage();
    expect(safeWindowStorage({ localStorage: granted })).toBe(granted);
  });

  it('returns null for an absent window or a missing member', () => {
    expect(safeWindowStorage(null)).toBeNull();
    expect(safeWindowStorage(undefined)).toBeNull();
    expect(safeWindowStorage({})).toBeNull();
  });

  it('returns null — never throws — when the property access throws', () => {
    expect(() => safeWindowStorage(sandboxedWindow())).not.toThrow();
    expect(safeWindowStorage(sandboxedWindow())).toBeNull();
  });
});
