/**
 * src/__tests__/pet.test.ts — task 7.6: activate() against the MEMBER-EXACT
 * fake 8-member host (`{version, compat, react, ui, i18n, theme, ipc,
 * petRuntime}` — mirroring the host-side scoped-harness member-set test in
 * `buildPetUiHostApi.test.ts`). Covers the D13 robustness contract (absent
 * petRuntime / throwing getConfig ⇒ still mounts), facts driving state, and
 * the D12 presence pause (hidden ⇒ both clocks stopped; visible ⇒ config
 * re-read once + resume). Drag verb order and menu capture pairing are
 * pinned in their own interact tests; this file proves the COMPOSITION.
 *
 * Timers are faked: the 125 ms sense tick and the player's setTimeout chain
 * only advance when the test says so.
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PetFactsSnapshotLike } from '../contract/facts';
import { activate } from '../pet';

const HOST_MEMBER_KEYS = [
  'compat',
  'i18n',
  'ipc',
  'petRuntime',
  'react',
  'theme',
  'ui',
  'version',
];

function createFakePetRuntime(options: { throwGetConfig?: boolean } = {}) {
  const listeners: Array<(snapshot: PetFactsSnapshotLike) => void> = [];
  let configCalls = 0;
  const runtime = {
    subscribeFacts(listener: (snapshot: PetFactsSnapshotLike) => void) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    async getConfig() {
      configCalls += 1;
      if (options.throwGetConfig) throw new Error('getConfig exploded');
      return {
        enabled: true,
        petId: 'pet-2d',
        window: { width: 300, height: 300 },
        presenceHidden: false,
      };
    },
    setPointerCapture: (_inside: boolean) => {},
    startDrag: () => {},
    requestAppExit: () => {},
  };
  return {
    runtime,
    listeners,
    get configCalls() {
      return configCalls;
    },
    push(snapshot: PetFactsSnapshotLike) {
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function createFakeHost(options: { withPetRuntime?: boolean; throwGetConfig?: boolean } = {}) {
  const pet = createFakePetRuntime({ throwGetConfig: options.throwGetConfig });
  const host: Record<string, unknown> = {
    version: '1.51.0',
    compat: { major: 1, minor: 51 },
    react: null, // activate() must never reach past petRuntime — dummies suffice
    ui: null,
    i18n: null,
    theme: null,
    ipc: null,
  };
  if (options.withPetRuntime !== false) host.petRuntime = pet.runtime;
  return { host: host as unknown as AgentUiHostApi, pet };
}

function snapshotWith(facts: PetFactsSnapshotLike['facts']): PetFactsSnapshotLike {
  return { apiVersion: 1, revision: 1, generatedAt: Date.now(), facts };
}

function thinkingSnapshot(): PetFactsSnapshotLike {
  return snapshotWith([
    { type: 'sessionThinking', id: 'session-1', active: true, deadline: Date.now() + 60_000 },
  ]);
}

function waitingApprovalSnapshot(): PetFactsSnapshotLike {
  return snapshotWith([
    { type: 'sessionWaitingApproval', id: 'session-1', active: true, deadline: Date.now() + 60_000 },
  ]);
}

function petRoot(): HTMLElement | null {
  return document.getElementById('pet-root');
}

function sprite(): HTMLElement | null {
  return petRoot?.()?.querySelector<HTMLElement>('.pet-sprite') ?? null;
}

/** jsdom's visibilityState is read-only; defineProperty per event. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the member-exact fake host', () => {
  it('carries EXACTLY the eight scoped-harness members', () => {
    const { host } = createFakeHost();
    expect(Object.keys(host as object).sort()).toEqual(HOST_MEMBER_KEYS);
  });

  it('the absent-petRuntime variant has the other seven', () => {
    const { host } = createFakeHost({ withPetRuntime: false });
    expect(Object.keys(host as object).sort()).toEqual(HOST_MEMBER_KEYS.filter((k) => k !== 'petRuntime'));
  });
});

describe('activate — D13 robustness (must never throw, must always mount)', () => {
  it('full host: mounts the layered stage and renders a sheet (fallback glyph if plugin:// import fails)', async () => {
    const { host } = createFakeHost();
    await expect(activate(host)).resolves.toBeUndefined();

    expect(petRoot()).not.toBeNull();
    expect(petRoot()?.querySelector('.pet-stage .pet-motion .pet-walk .pet-sprite')).not.toBeNull();
    expect(sprite()?.style.backgroundImage).toContain('url("data:image/');
    expect(sprite()?.dataset.petState).toBe('idle');
  });

  it('petRuntime ABSENT (F5): still mounts, facts-free, no throw', async () => {
    const { host } = createFakeHost({ withPetRuntime: false });
    await expect(activate(host)).resolves.toBeUndefined();
    expect(petRoot()?.querySelector('.pet-sprite')).not.toBeNull();
  });

  it('getConfig THROWS: still mounts (kept at the 256 default)', async () => {
    const { host } = createFakeHost({ throwGetConfig: true });
    await expect(activate(host)).resolves.toBeUndefined();
    const stage = petRoot()?.querySelector<HTMLElement>('.pet-stage');
    expect(stage?.style.width).toBe('256px');
  });

  it('subscribeFacts throwing is contained (facts-free, still mounted)', async () => {
    const { host, pet } = createFakeHost();
    pet.runtime.subscribeFacts = () => {
      throw new Error('subscribe exploded');
    };
    await expect(activate(host)).resolves.toBeUndefined();
    expect(sprite()).not.toBeNull();
  });
});

describe('activate — facts drive state through the 125 ms sense tick', () => {
  it('a thinking snapshot flips the pet to think', async () => {
    const { host, pet } = createFakeHost();
    await activate(host);
    expect(sprite()?.dataset.petState).toBe('idle');

    pet.push(thinkingSnapshot());
    await vi.advanceTimersByTimeAsync(300); // > 2 ticks
    expect(sprite()?.dataset.petState).toBe('think');
  });

  it('a superseding approval snapshot flips the pet to wait', async () => {
    const { host, pet } = createFakeHost();
    await activate(host);
    pet.push(thinkingSnapshot());
    await vi.advanceTimersByTimeAsync(300);
    pet.push(waitingApprovalSnapshot());
    await vi.advanceTimersByTimeAsync(300);
    expect(sprite()?.dataset.petState).toBe('wait');
  });
});

describe('activate — presence pause (D12: hidden stops both clocks)', () => {
  it('hidden: ticks stop (a pushed snapshot changes nothing) and prefs flush', async () => {
    const { host, pet } = createFakeHost();
    await activate(host);
    pet.push(thinkingSnapshot());
    await vi.advanceTimersByTimeAsync(300);
    expect(sprite()?.dataset.petState).toBe('think');

    setVisibility('hidden');
    pet.push(waitingApprovalSnapshot()); // arrives while hidden
    await vi.advanceTimersByTimeAsync(500);
    expect(sprite()?.dataset.petState).toBe('think'); // tick stopped — no change

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(500); // resume from idle, then the tick reacts
    expect(sprite()?.dataset.petState).toBe('wait');
    expect(pet.configCalls).toBe(2); // initial + exactly one re-read on visible
  });
});
