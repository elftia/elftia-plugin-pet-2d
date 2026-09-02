/**
 * src/state/safeStorage.ts — the one sanctioned way for renderer code to
 * reach the `localStorage` global. The opaque-frame host sandbox
 * (`sandbox="allow-scripts"` WITHOUT `allow-same-origin`) gives the frame
 * an opaque origin, and there the `localStorage` PROPERTY ACCESS itself
 * throws `SecurityError`: a bare identifier, a `window.` member read, and
 * even `typeof localStorage` all trigger the throwing getter (optional
 * chaining guards null, not throws). 0.2.2's manager page died exactly
 * there — `Gallery`'s `useState` initializer reached `createPrefsStore`'s
 * bare `localStorage` default and the whole render threw before first
 * paint, so the page stayed blank (packaged acceptance §6, the pet-2d
 * counter-case).
 *
 * Contract: `safeLocalStorage()` returns the REAL storage whenever the
 * host grants one (trusted windows, dev, jsdom — behavior identical to
 * the old direct reads, including `event.storageArea` identity, because
 * the browser hands out the same Storage object per origin), and
 * otherwise a shared in-memory stand-in, so the page renders regardless
 * of storage availability and session-scoped reads/writes still cohere
 * (one stand-in per page: a write stays visible to later same-page
 * readers). Persistence beyond the page's life is simply unavailable in
 * that mode — docs/limitations.md owns the caveat.
 */

/** The shared stand-in (created lazily; `null` until first needed). */
let fallback: Storage | null = null;

function memoryBackedStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

/** `window.localStorage` when the host grants one, else the shared
 * session-scoped stand-in. NEVER throws — including in a node test
 * (no `window` at all). */
export function safeLocalStorage(): Storage {
  try {
    return window.localStorage;
  } catch {
    fallback ??= memoryBackedStorage();
    return fallback;
  }
}

/**
 * The `localStorage` member of an injected window-like object
 * (`PacksChangedWindow` and its node-test fakes), `null` when the window
 * is absent or the property access throws (a sandboxed window). Callers
 * with a documented null-tolerant sink — `bumpPacksRev(null)` is already
 * its own no-op — pass the result straight through.
 */
export function safeWindowStorage(
  win: { readonly localStorage?: Storage | null } | null | undefined,
): Storage | null {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}
