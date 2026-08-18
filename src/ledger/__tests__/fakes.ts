/**
 * Ledger test doubles (node project — no jsdom): injectable storage /
 * timeout / document / window fakes so every ambient dependency in
 * persist.ts + createLedger.ts is driven deterministically.
 */
import type { StorageLike, TimeoutLike } from '../persist';

/** In-memory storage (counts writes; optionally pre-seeded). */
export function fakeStorage(seeded?: Record<string, string>): StorageLike & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>(Object.entries(seeded ?? {}));
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

/** Drivable timeout double: `flush()` fires every un-cancelled timer. */
export function fakeTimeout(): TimeoutLike & { flush(): void } {
  const timers: Array<{ handler: () => void; fired: boolean }> = [];
  return {
    setTimeout: (handler: () => void, _ms: number) => {
      timers.push({ handler, fired: false });
      return timers.length - 1;
    },
    clearTimeout: (handle: unknown) => {
      const timer = timers[handle as number];
      if (timer) timer.fired = true;
    },
    flush: () => {
      for (const timer of timers) if (!timer.fired) { timer.fired = true; timer.handler(); }
    },
  };
}

/** Listener-recording document double with a settable visibilityState. */
export function fakeDocument(initialVisibility = 'visible') {
  const listeners = new Map<string, Array<() => void>>();
  return {
    visibilityState: initialVisibility,
    addEventListener(type: string, listener: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type: string, listener: () => void) {
      const arr = listeners.get(type) ?? [];
      const index = arr.indexOf(listener);
      if (index >= 0) arr.splice(index, 1);
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

/** Listener-recording window double. */
export function fakeWindow() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type: string, listener: () => void) {
      const arr = listeners.get(type) ?? [];
      const index = arr.indexOf(listener);
      if (index >= 0) arr.splice(index, 1);
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
}
