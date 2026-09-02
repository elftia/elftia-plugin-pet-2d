/**
 * src/manager/__tests__/hostedElements.test.ts — the 0.2.4 seam's gate: the
 * Hosted* wrappers must route handler-carrying elements through the HOST's
 * patched createElement (so the remote-DOM serializer sees
 * `data-elftia-events` and the host attaches forwarded handlers), and must
 * fall back to plain React — identical DOM, no attribute — when the bridge
 * holds no host (unit-test fakes, degraded hosts). The fake patch below
 * mirrors the real one (`compartmentHostProjection.tsx`: stamp the
 * forwarded event kinds derived from the handler props of STRING elements).
 *
 * @vitest-environment jsdom
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pageStrings, resolvePageLocale } from '../../interact/locale';
import { __resetManagerHost, setManagerHost } from '../hostBridge';
import { HostedButton, HostedInput, HostedSelect } from '../hostedElements';
import { MasterControls } from '../MasterControls';
import type { UsePetConfigResult } from '../usePetConfig';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** The host patch's handler→event-kind map (compartmentHostProjection). */
const DOM_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  onChange: 'change',
  onClick: 'click',
  onInput: 'input',
  onKeyDown: 'keydown',
  onSubmit: 'submit',
});

/** A createElement that stamps `data-elftia-events` like the host projection. */
function makePatchedHostReact(): Record<string, unknown> {
  const patched = (type: string, props: Record<string, unknown> | null): ReactElement => {
    const events = Object.entries(DOM_EVENTS)
      .filter(([reactName]) => typeof props?.[reactName] === 'function')
      .map(([, kind]) => kind);
    const stamped =
      events.length > 0
        ? { ...props, 'data-elftia-events': events.join(',') }
        : props;
    // `as never` — the test fake's loose props against React's overloaded
    // createElement (the wrapper always passes a plain string tag).
    return createElement(type, stamped as never);
  };
  return { instance: { createElement: patched } };
}

interface Rendered {
  container: HTMLElement;
  root: Root;
}

async function render(node: ReactNode): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
}

let current: Rendered | null = null;

afterEach(async () => {
  if (current !== null) {
    await act(async () => {
      current?.root.unmount();
    });
    current.container.remove();
    current = null;
  }
  __resetManagerHost();
  vi.restoreAllMocks();
});

describe('Hosted* wrappers — the host-present branch (the 0.2.4 fix)', () => {
  it('HostedButton carries data-elftia-events="click" through the patched createElement', async () => {
    setManagerHost({ react: makePatchedHostReact() } as unknown as AgentUiHostApi);
    current = await render(
      createElement(HostedButton, { 'data-testid': 'x', onClick: () => {} }, 'label'),
    );
    const button = current.container.querySelector('[data-testid="x"]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('data-elftia-events')).toBe('click');
  });

  it('HostedInput/HostedSelect stamp their change handler', async () => {
    setManagerHost({ react: makePatchedHostReact() } as unknown as AgentUiHostApi);
    current = await render(
      createElement(
        'div',
        null,
        createElement(HostedInput, { 'data-testid': 'i', onChange: () => {} }),
        createElement(
          HostedSelect,
          { 'data-testid': 's', onChange: () => {} },
          createElement('option', { value: 'a' }, 'a'),
        ),
      ),
    );
    expect(
      current.container.querySelector('[data-testid="i"]')?.getAttribute('data-elftia-events'),
    ).toBe('change');
    expect(
      current.container.querySelector('[data-testid="s"]')?.getAttribute('data-elftia-events'),
    ).toBe('change');
  });

  it('handler-free elements are NOT stamped (the opt-in is per-handler)', async () => {
    setManagerHost({ react: makePatchedHostReact() } as unknown as AgentUiHostApi);
    current = await render(createElement(HostedButton, { 'data-testid': 'plain' }, 'label'));
    expect(
      current.container.querySelector('[data-testid="plain"]')?.hasAttribute('data-elftia-events'),
    ).toBe(false);
  });

  it('the MasterControls fallback switch is stamped when the host patch is present', async () => {
    // ui:null forces the semantic <button role="switch"> fallback branch;
    // react carries the patch — the exact degraded-host combination the
    // wrapper must still opt in.
    setManagerHost({
      react: makePatchedHostReact(),
      ui: null,
    } as unknown as AgentUiHostApi);
    const cfg: UsePetConfigResult = {
      status: 'ready',
      managementAvailable: true,
      config: {
        enabled: true,
        petId: 'pet-2d',
        window: { width: 300, height: 300 },
        presenceHidden: false,
      },
      saving: false,
      writeConfig: async () => {},
      refresh: async () => {},
    };
    current = await render(
      createElement(MasterControls, { strings: pageStrings(resolvePageLocale()), cfg }),
    );
    const fallback = current.container.querySelector(
      '[data-testid="pet-manager-enabled-switch"] button[role="switch"]',
    );
    expect(fallback?.getAttribute('data-elftia-events')).toBe('click');
  });
});

describe('Hosted* wrappers — the host-absent fallback (test fakes)', () => {
  it('no host: identical DOM, no attribute, and the handler still works', async () => {
    __resetManagerHost();
    const onClick = vi.fn();
    current = await render(
      createElement(HostedButton, { 'data-testid': 'x', onClick }, 'label'),
    );
    const button = current.container.querySelector('[data-testid="x"]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.hasAttribute('data-elftia-events')).toBe(false);
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a host whose react handle is null (the member-exact fake shape) also falls back', async () => {
    setManagerHost({ react: null, ui: null } as unknown as AgentUiHostApi);
    current = await render(
      createElement(HostedButton, { 'data-testid': 'x', onClick: () => {} }, 'label'),
    );
    expect(
      current.container.querySelector('[data-testid="x"]')?.hasAttribute('data-elftia-events'),
    ).toBe(false);
  });
});
