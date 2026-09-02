/**
 * src/interact/__tests__/quickChat.test.ts — the optional Quick Chat launcher
 * (`pet-2d-quick-chat-launcher`): fresh explain per probe, one exact
 * `surface.request` toggle invocation with `near-active-pet`, acknowledged
 * release, no automatic retry, visible-but-non-modal failure status, and
 * disposal semantics (pagehide / supersession: in-flight leases release
 * WITHOUT invoking).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createQuickChatLauncher,
  QUICK_CHAT_REQUIREMENT,
  type QuickChatLease,
} from '../quickChat';

interface CallLog {
  explainArgs: unknown[];
  requireArgs: unknown[];
  leases: FakeLease[];
}

class FakeLease implements QuickChatLease {
  readonly calls: string[];
  released = 0;
  releaseShouldFail = false;
  invokeShouldFail = false;
  readonly invokeCalls: Array<{ operation: string; input: unknown }> = [];

  constructor(calls: string[]) {
    this.calls = calls;
  }

  invoke(operation: string, input?: unknown): Promise<unknown> {
    this.invokeCalls.push({ operation, input });
    this.calls.push(`invoke:${operation}`);
    if (this.invokeShouldFail) return Promise.reject(new Error('toggle failed'));
    return Promise.resolve({ state: 'closed' });
  }

  release(): Promise<void> {
    this.released += 1;
    this.calls.push(`release:${this.released}`);
    if (this.releaseShouldFail) return Promise.reject(new Error('release failed'));
    return Promise.resolve();
  }
}

function fakeCapabilities(state: string) {
  const log: CallLog = { explainArgs: [], requireArgs: [], leases: [] };
  const calls: string[] = [];
  return {
    log,
    calls,
    capabilities: {
      explain: async (requirement: unknown) => {
        log.explainArgs.push(requirement);
        calls.push('explain');
        return { state };
      },
      require: async (requirement: unknown) => {
        log.requireArgs.push(requirement);
        calls.push('require');
        const lease = new FakeLease(calls);
        log.leases.push(lease);
        return lease;
      },
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createQuickChatLauncher', () => {
  it('probe() reports true only for state "available"', async () => {
    for (const state of ['available', 'no-provider', 'not-declared', 'provider-conflict', 'provider-unavailable']) {
      const { capabilities } = fakeCapabilities(state);
      const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
      expect(await launcher.probe()).toBe(state === 'available');
    }
  });

  it('probe() sends the frozen manifest requirement and never throws', async () => {
    const { log, capabilities } = fakeCapabilities('available');
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    await expect(launcher.probe()).resolves.toBe(true);
    expect(log.explainArgs).toEqual([QUICK_CHAT_REQUIREMENT]);

    const rejecting = {
      explain: () => Promise.reject(new Error('transport gone')),
      require: () => Promise.reject(new Error('unreachable')),
    };
    const failing = createQuickChatLauncher({ capabilities: rejecting, statusText: 'x' });
    await expect(failing.probe()).resolves.toBe(false);
  });

  it('probe()/activate() degrade to false/status when capabilities is absent', async () => {
    const launcher = createQuickChatLauncher({ capabilities: undefined, statusText: 'QC down' });
    await expect(launcher.probe()).resolves.toBe(false);
    await launcher.activate();
    const status = document.querySelector('[data-pet-quick-chat-status="true"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('QC down');
  });

  it('activate(): fresh require, ONE exact surface.request toggle, then release', async () => {
    const { log, capabilities } = fakeCapabilities('available');
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    await launcher.activate();
    expect(log.requireArgs).toEqual([QUICK_CHAT_REQUIREMENT]);
    expect(log.leases).toHaveLength(1);
    expect(log.leases[0].invokeCalls).toEqual([
      { operation: 'surface.request', input: { operation: 'toggle', placement: 'near-active-pet' } },
    ]);
    expect(log.leases[0].released).toBe(1);
    // Success shows no failure status.
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')).toBeNull();
  });

  it('a failed require shows the localized status and never invokes', async () => {
    const calls: string[] = [];
    const capabilities = {
      explain: async () => ({ state: 'available' }),
      require: () => {
        calls.push('require');
        return Promise.reject(new Error('provider drained'));
      },
    };
    const launcher = createQuickChatLauncher({ capabilities, statusText: '快捷聊天暂时不可用' });
    await launcher.activate();
    expect(calls).toEqual(['require']);
    const status = document.querySelector('[data-pet-quick-chat-status="true"]');
    expect(status?.textContent).toBe('快捷聊天暂时不可用');
  });

  it('a failed invoke still releases the lease exactly once', async () => {
    const { capabilities } = fakeCapabilities('available');
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    // Pre-acquire a failing lease through one activation...
    await launcher.activate();
    // (the first activation used a healthy lease; drive the failure path with
    // a capabilities whose lease fails invoke)
    const calls: string[] = [];
    const failing = {
      explain: async () => ({ state: 'available' }),
      require: async () => {
        const lease = new FakeLease(calls);
        lease.invokeShouldFail = true;
        return lease;
      },
    };
    const failingLauncher = createQuickChatLauncher({ capabilities: failing, statusText: 'QC down' });
    await failingLauncher.activate();
    expect(calls).toEqual(['invoke:surface.request', 'release:1']);
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')?.textContent).toBe('QC down');
  });

  it('a failed RELEASE after a successful toggle is not surfaced as failure', async () => {
    const calls: string[] = [];
    const capabilities = {
      explain: async () => ({ state: 'available' }),
      require: async () => {
        const lease = new FakeLease(calls);
        lease.releaseShouldFail = true;
        return lease;
      },
    };
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    await expect(launcher.activate()).resolves.toBeUndefined();
    expect(calls).toEqual(['invoke:surface.request', 'release:1']);
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')).toBeNull();
  });

  it('dispose during an in-flight require releases the late lease WITHOUT invoking', async () => {
    const deferred: { resolve?: (lease: QuickChatLease) => void } = {};
    const calls: string[] = [];
    const capabilities = {
      explain: async () => ({ state: 'available' }),
      require: () =>
        new Promise<QuickChatLease>((resolve) => {
          deferred.resolve = resolve;
        }),
    };
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    const activating = launcher.activate();
    launcher.dispose(); // pagehide before require resolves
    deferred.resolve?.(new FakeLease(calls));
    await activating;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['release:1']); // released, NEVER invoked
  });

  it('dispose releases an in-flight lease and removes the status element', async () => {
    const deferred: { resolve?: (value: unknown) => void } = {};
    const calls: string[] = [];
    const capabilities = {
      explain: async () => ({ state: 'available' }),
      require: async () => ({
        invoke: () =>
          new Promise((resolve) => {
            deferred.resolve = resolve;
          }),
        release: () => {
          calls.push('release');
          return Promise.resolve();
        },
      }),
    };
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'x' });
    const activating = launcher.activate();
    // While invoke hangs, dispose must release and the settle must not throw.
    launcher.dispose();
    deferred.resolve?.({ state: 'closed' });
    await expect(activating).resolves.toBeUndefined();
    expect(calls).toEqual(['release']);
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')).toBeNull();
  });

  it('activate() after dispose fails closed with NO status and no IPC', async () => {
    const { log, capabilities } = fakeCapabilities('available');
    const launcher = createQuickChatLauncher({ capabilities, statusText: 'QC down' });
    launcher.dispose();
    await launcher.activate();
    // Teardown suppresses UI mutations (the page is going away) and IPC alike.
    expect(log.requireArgs).toEqual([]);
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')).toBeNull();
  });

  it('the status element is non-focusable and self-removes', async () => {
    const capabilities = {
      explain: async () => ({ state: 'available' }),
      require: () => Promise.reject(new Error('gone')),
    };
    const launcher = createQuickChatLauncher({
      capabilities,
      statusText: 'QC down',
      statusTimeoutMs: 10,
    });
    await launcher.activate();
    const status = document.querySelector('[data-pet-quick-chat-status="true"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.querySelectorAll('button,input,a,[tabindex]')).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(document.querySelector('[data-pet-quick-chat-status="true"]')).toBeNull();
  });
});
