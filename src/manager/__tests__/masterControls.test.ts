/**
 * src/manager/__tests__/masterControls.test.ts — task 5.2's gate: the four
 * D6② states through the REAL page component (createRoot + act in jsdom,
 * the repo has no @testing-library). States: off / on+resolved /
 * on+unresolved / no-management-API. Plus the interaction contracts: the
 * enable CTA writes {enabled:true}, the rescan row writes the EMPTY patch
 * (D3), a switch toggle writes its field, writeConfig RE-READS after every
 * write (the PetSection F12 lesson), and focus/visibility re-pull config.
 *
 * @vitest-environment jsdom
 */
import type { AgentUiHostApi, HostPetRuntimeConfig } from '@elftia/plugin-types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetManagerHost, setManagerHost } from '../hostBridge';
import { ManagerPage } from '../page';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function baseConfig(overrides: Partial<HostPetRuntimeConfig> = {}): HostPetRuntimeConfig {
  return {
    enabled: true,
    petId: 'pet-2d',
    window: { width: 300, height: 300 },
    presenceHidden: false,
    ...overrides,
  };
}

interface FakeRuntime {
  getConfig: ReturnType<typeof vi.fn>;
  setConfig?: ReturnType<typeof vi.fn>;
}

function installHost(runtime: FakeRuntime): void {
  const host: Record<string, unknown> = {
    version: '1.53.0',
    compat: { major: 1, minor: 53 },
    react: null,
    ui: null, // the Switch fallback branch renders the semantic toggle
    i18n: null,
    theme: null,
    ipc: null,
    page: { register: () => () => {} },
    petRuntime: runtime,
  };
  setManagerHost(host as unknown as AgentUiHostApi);
}

function runtimeWith(
  config: HostPetRuntimeConfig,
  options: { withoutSetConfig?: boolean } = {},
): FakeRuntime {
  const rt: FakeRuntime = { getConfig: vi.fn(async () => config) };
  if (options.withoutSetConfig !== true) {
    rt.setConfig = vi.fn(async () => {});
  }
  return rt;
}

interface Rendered {
  container: HTMLElement;
  root: Root;
}

async function renderPage(): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ManagerPage));
  });
  return { container, root };
}

async function unmount(rendered: Rendered | null): Promise<void> {
  if (rendered === null) return;
  await act(async () => {
    rendered.root.unmount();
  });
  rendered.container.remove();
}

let current: Rendered | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await unmount(current);
  current = null;
  __resetManagerHost();
  vi.restoreAllMocks();
});

describe('MasterControls — the four states (task 5.2 gate)', () => {
  it('state OFF: banner + enable CTA, no unresolved row', async () => {
    installHost(runtimeWith(baseConfig({ enabled: false })));
    current = await renderPage();
    const q = current.container.querySelector.bind(current.container);
    expect(q('[data-testid="pet-manager-off-banner"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-enable-button"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-unresolved-row"]')).toBeNull();
    expect(q('[data-testid="pet-manager-pet-id"]')?.textContent).toBe('pet-2d');
  });

  it('state ON + RESOLVED: no banner, no unresolved row, switch reflects on', async () => {
    installHost(runtimeWith(baseConfig()));
    current = await renderPage();
    const q = current.container.querySelector.bind(current.container);
    expect(q('[data-testid="pet-manager-off-banner"]')).toBeNull();
    expect(q('[data-testid="pet-manager-unresolved-row"]')).toBeNull();
    const toggle = q('[data-testid="pet-manager-enabled-switch"] button[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });

  it('state ON + UNRESOLVED: unresolved row + rescan button + no multi-contributor hint', async () => {
    installHost(runtimeWith(baseConfig({ petId: null, resolutionHint: false })));
    current = await renderPage();
    const q = current.container.querySelector.bind(current.container);
    expect(q('[data-testid="pet-manager-unresolved-row"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-rescan-button"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-multi-contributor-hint"]')).toBeNull();
  });

  it('resolutionHint renders the multi-contributor hint (OQ1: points to Settings)', async () => {
    localStorage.setItem('locale', 'zh');
    installHost(runtimeWith(baseConfig({ resolutionHint: true })));
    current = await renderPage();
    const hint = current.container.querySelector('[data-testid="pet-manager-multi-contributor-hint"]');
    expect(hint?.textContent).toContain('设置');
  });

  it('state NO-MANAGEMENT-API: needs-update card replaces the switches', async () => {
    installHost(runtimeWith(baseConfig(), { withoutSetConfig: true }));
    current = await renderPage();
    const q = current.container.querySelector.bind(current.container);
    expect(q('[data-testid="pet-manager-needs-update"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-enabled-switch"]')).toBeNull();
    expect(q('[data-testid="pet-manager-opaque-fallback-switch"]')).toBeNull();
  });
});

describe('MasterControls — interaction contracts', () => {
  it('the enable CTA writes {enabled:true}', async () => {
    const rt = runtimeWith(baseConfig({ enabled: false }));
    installHost(rt);
    current = await renderPage();
    await act(async () => {
      current?.container
        .querySelector<HTMLButtonElement>('[data-testid="pet-manager-enable-button"]')
        ?.click();
    });
    expect(rt.setConfig).toHaveBeenCalledWith({ enabled: true });
  });

  it('the rescan button writes the EMPTY patch (D3 re-scan request)', async () => {
    const rt = runtimeWith(baseConfig({ petId: null }));
    installHost(rt);
    current = await renderPage();
    await act(async () => {
      current?.container
        .querySelector<HTMLButtonElement>('[data-testid="pet-manager-rescan-button"]')
        ?.click();
    });
    expect(rt.setConfig).toHaveBeenCalledWith({});
  });

  it('toggling the enabled switch writes {enabled:false}', async () => {
    const rt = runtimeWith(baseConfig());
    installHost(rt);
    current = await renderPage();
    await act(async () => {
      current?.container
        .querySelector<HTMLButtonElement>(
          '[data-testid="pet-manager-enabled-switch"] button[role="switch"]',
        )
        ?.click();
    });
    expect(rt.setConfig).toHaveBeenCalledWith({ enabled: false });
  });

  it('writeConfig RE-READS after every write (getConfig count 1 -> 2)', async () => {
    const rt = runtimeWith(baseConfig({ enabled: false }));
    installHost(rt);
    current = await renderPage();
    expect(rt.getConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      current?.container
        .querySelector<HTMLButtonElement>('[data-testid="pet-manager-enable-button"]')
        ?.click();
    });
    expect(rt.setConfig).toHaveBeenCalledTimes(1);
    expect(rt.getConfig).toHaveBeenCalledTimes(2);
  });

  it('window focus re-pulls the config', async () => {
    const rt = runtimeWith(baseConfig());
    installHost(rt);
    current = await renderPage();
    expect(rt.getConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(rt.getConfig).toHaveBeenCalledTimes(2);
  });

  it('a host without petRuntime degrades to unavailable (no crash, no switches)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host: Record<string, unknown> = {
      version: '1.53.0',
      compat: { major: 1, minor: 53 },
      page: { register: () => () => {} },
    };
    setManagerHost(host as unknown as AgentUiHostApi);
    current = await renderPage();
    const q = current.container.querySelector.bind(current.container);
    expect(q('[data-testid="pet-manager-page"]')).not.toBeNull();
    expect(q('[data-testid="pet-manager-enabled-switch"]')).toBeNull();
    expect(q('[data-testid="pet-manager-needs-update"]')).not.toBeNull();
    // The CONFIG layer must stay silent about a missing petRuntime (expected
    // degradation). The gallery's pack loads MAY warn — plugin:// is
    // unloadable under jsdom — so scope the assertion to config-path warns.
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toMatch(/petRuntime|getConfig|setConfig/i);
    }
  });
});
