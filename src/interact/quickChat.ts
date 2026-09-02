/**
 * src/interact/quickChat.ts — the OPTIONAL Quick Chat launcher
 * (`pet-2d-quick-chat-launcher`): a menu-driven consumer of the host
 * capability `elftia.quick-chat` (the bundled Quick Chat provider).
 *
 * Contract (mirrors the host's committed vertical:
 * `quickChatDesktopVertical.integration.test.ts` "Pet-style capability
 * lease"):
 *   - the requirement must ALSO be declared in `elftia-plugin.json.src`
 *     (`capabilities.optional`) — an undeclared consumer gets
 *     `not-declared` from `explain` and `CAPABILITY_NOT_FOUND` from `require`;
 *   - one transport operation, `surface.request`, whose payload selects the
 *     surface intent — the pet sends `{ operation: 'toggle', placement:
 *     'near-active-pet' }` exactly once per activation. The HOST/provider owns
 *     the window, placement and focus policy; the pet never touches a
 *     BrowserWindow, a Local Channel client, or chat state;
 *   - a FRESH `require` per click: no cached availability result, lease,
 *     provider identity, or generation is reused, and the non-idempotent
 *     toggle is never retried automatically;
 *   - degradation is total but silent-by-default: an absent/disabled/
 *     conflicted provider simply hides the menu item; a failure AFTER the
 *     item was offered surfaces as one short localized non-modal status.
 *
 * The structural slices below deliberately re-declare the tiny surface this
 * module touches instead of importing the host package's capability types —
 * the pinned `@elftia/plugin-types` and the running host may be different
 * minor versions, and the pet window's consumer projection is exactly
 * `explain` + `require` (no `provide`). `host.capabilities` itself is OPTIONAL
 * (the same discipline as `host.petRuntime`): every entry point
 * feature-detects it.
 */

/** The one capability this plugin optionally consumes (manifest-declared). */
export const QUICK_CHAT_REQUIREMENT = Object.freeze({
  id: 'elftia.quick-chat',
  range: '^1.0.0',
  target: 'main',
} as const);

/** The structural minimum of `host.capabilities` the launcher touches. */
export interface QuickChatCapabilities {
  explain(requirement: {
    readonly id: string;
    readonly range: string;
    readonly target: string;
  }): Promise<{ readonly state: string }>;
  require(requirement: {
    readonly id: string;
    readonly range: string;
    readonly target: string;
  }): Promise<QuickChatLease>;
}

/** The structural minimum of a capability lease the launcher touches. */
export interface QuickChatLease {
  invoke(operation: string, input?: unknown): Promise<unknown>;
  release(): void | Promise<unknown>;
}

/** The status element's lifetime; short by design (non-modal, non-focus). */
const STATUS_TIMEOUT_MS = 4_000;

export interface QuickChatLauncher {
  /** Fresh `explain` for ONE menu generation — `true` iff state is available. */
  probe(): Promise<boolean>;
  /** Fresh require → one exact toggle invocation → acknowledged release. */
  activate(): Promise<void>;
  /** Page-hide / activation-supersession: release in-flight leases, drop UI. */
  dispose(): void;
}

export function isQuickChatCapabilities(value: unknown): value is QuickChatCapabilities {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.explain === 'function' && typeof candidate.require === 'function';
}

/**
 * The launcher. `statusText` is the localized generic failure string (shown
 * only when an OFFERED action fails); `documentRef` is injectable for tests.
 */
export function createQuickChatLauncher(options: {
  readonly capabilities: unknown;
  readonly statusText: string;
  readonly documentRef?: Document;
  /** Status lifetime override (tests); defaults to {@link STATUS_TIMEOUT_MS}. */
  readonly statusTimeoutMs?: number;
}): QuickChatLauncher {
  const doc = options.documentRef ?? document;
  const capabilities = isQuickChatCapabilities(options.capabilities)
    ? options.capabilities
    : undefined;
  const statusTimeoutMs = options.statusTimeoutMs ?? STATUS_TIMEOUT_MS;

  /** Bumped by dispose: in-flight activations with an older ticket fail closed. */
  let disposalTicket = 0;
  let disposed = false;
  /** The lease of the activation currently in flight (dispose releases it). */
  let inFlight: QuickChatLease | null = null;
  let statusElement: HTMLElement | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function removeStatus(): void {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    statusElement?.remove();
    statusElement = null;
  }

  function showStatus(): void {
    if (disposed) return;
    removeStatus();
    const element = doc.createElement('div');
    element.setAttribute('role', 'status');
    element.dataset.petQuickChatStatus = 'true';
    element.textContent = options.statusText;
    element.style.cssText =
      'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);' +
      'padding:6px 12px;border-radius:8px;background:rgba(31,41,51,0.95);' +
      'color:#e6e9ec;font:12px/1.4 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;' +
      'white-space:nowrap;pointer-events:none;';
    doc.body.appendChild(element);
    statusElement = element;
    statusTimer = setTimeout(removeStatus, statusTimeoutMs);
  }

  /** Release without ever throwing: a failed release is cleanup-only (logged). */
  async function releaseQuietly(lease: QuickChatLease): Promise<void> {
    try {
      await lease.release();
    } catch (error) {
      console.warn('[pet-2d] quick-chat lease release failed (cleanup-only)', error);
    }
  }

  return {
    async probe(): Promise<boolean> {
      if (disposed || !capabilities) return false;
      try {
        const availability = await capabilities.explain(QUICK_CHAT_REQUIREMENT);
        return availability?.state === 'available';
      } catch (error) {
        console.warn('[pet-2d] quick-chat availability probe failed', error);
        return false;
      }
    },

    async activate(): Promise<void> {
      if (disposed || !capabilities) {
        showStatus();
        return;
      }
      const ticket = disposalTicket;
      let lease: QuickChatLease;
      try {
        lease = await capabilities.require(QUICK_CHAT_REQUIREMENT);
      } catch (error) {
        console.warn('[pet-2d] quick-chat require failed', error);
        showStatus();
        return;
      }
      if (disposed || ticket !== disposalTicket) {
        // A late acquisition after pagehide/supersession: release, never invoke.
        await releaseQuietly(lease);
        return;
      }
      inFlight = lease;
      try {
        await lease.invoke('surface.request', {
          operation: 'toggle',
          placement: 'near-active-pet',
        });
      } catch (error) {
        console.warn('[pet-2d] quick-chat toggle failed', error);
        showStatus();
      } finally {
        inFlight = null;
        await releaseQuietly(lease);
      }
    },

    dispose(): void {
      disposed = true;
      disposalTicket += 1;
      removeStatus();
      const lease = inFlight;
      inFlight = null;
      if (lease) void releaseQuietly(lease);
    },
  };
}
