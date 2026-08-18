/**
 * src/manager/__tests__/index.test.ts — task 4.5: the manager entry against
 * a member-exact fake host. The manager's member set is the main-window
 * eight (`{version, compat, react, ui, i18n, theme, ipc, page}` — petRuntime
 * is irrelevant to activate; the fake in pet.test.ts carries it instead).
 * Covers: exactly ONE page registration with the right id/icon/railTestId,
 * label resolution (persisted locale wins), a callable render() that
 * produces an element, and the D13 never-throws contract on a host WITHOUT
 * the `page` handle.
 *
 * @vitest-environment jsdom
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activate } from '../index';
import { ManagerPage } from '../page';

/** Definitions captured by the fake `host.page.register`. */
interface CapturedPageDef {
  id: string;
  label: string;
  icon: string;
  render: () => unknown;
  railTestId: string;
  [key: string]: unknown;
}

function createFakeHost(options: { withPage?: boolean } = {}) {
  const registered: CapturedPageDef[] = [];
  const host: Record<string, unknown> = {
    version: '1.53.0',
    compat: { major: 1, minor: 53 },
    react: null, // activate() must never reach past page — dummies suffice
    ui: null,
    i18n: null,
    theme: null,
    ipc: null,
  };
  if (options.withPage !== false) {
    host.page = {
      register: vi.fn((def: CapturedPageDef) => {
        registered.push(def);
        return () => {};
      }),
    };
  }
  return { host: host as unknown as AgentUiHostApi, registered };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('manager activate (task 4.5)', () => {
  it('the fake host carries exactly the main-window eight members', () => {
    const { host } = createFakeHost();
    expect(Object.keys(host as object).sort()).toEqual([
      'compat',
      'i18n',
      'ipc',
      'page',
      'react',
      'theme',
      'ui',
      'version',
    ]);
  });

  it('registers exactly one page def with the right id/icon/railTestId', () => {
    const { host, registered } = createFakeHost();
    expect(() => activate(host)).not.toThrow();
    expect(registered).toHaveLength(1);
    const def = registered[0];
    expect(def.id).toBe('pet-2d');
    expect(def.icon).toBe('PawPrint');
    expect(def.railTestId).toBe('sidebar-agent-page-pet-2d');
    expect(typeof def.label).toBe('string');
    expect(def.label.length).toBeGreaterThan(0);
    expect(typeof def.render).toBe('function');
  });

  it('the rail label resolves the persisted app locale (zh)', () => {
    localStorage.setItem('locale', 'zh');
    const { host, registered } = createFakeHost();
    activate(host);
    expect(registered[0]?.label).toBe('桌面宠物');
  });

  it('the rail label falls back through navigator.language to en', () => {
    // No persisted locale: jsdom's navigator.language is en-US → 'en'.
    const { host, registered } = createFakeHost();
    activate(host);
    expect(registered[0]?.label).toBe('Desktop Pet');
  });

  it('render() returns a truthy element without needing the host tree', () => {
    const { host, registered } = createFakeHost();
    activate(host);
    expect(registered[0]?.render()).toBeTruthy();
  });

  it('never throws on a host without `page` (warns, registers nothing)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host } = createFakeHost({ withPage: false });
    expect(() => activate(host)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('host.page.register absent'));
  });

  it('a throwing register degrades to a logged error, never a rejected activate', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host: Record<string, unknown> = {
      version: '1.53.0',
      compat: { major: 1, minor: 53 },
      page: {
        register: vi.fn(() => {
          throw new Error('registry exploded');
        }),
      },
    };
    expect(() => activate(host as unknown as AgentUiHostApi)).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[pet-2d] manager activate failed'),
      expect.any(Error),
    );
  });
});

describe('ManagerPage skeleton (task 4.2)', () => {
  it('renders the header + five D6 sections with stable testids', () => {
    const html = renderToStaticMarkup(createElement(ManagerPage));
    // pet-manager-off-banner is CONDITIONAL (only when !enabled — group 5);
    // with no host in the bridge the page stays in status 'loading', so the
    // unconditional roots are page/header/controls/gallery/ledger/footer.
    for (const testid of [
      'pet-manager-page',
      'pet-manager-header',
      'pet-manager-master-controls',
      'pet-manager-gallery',
      'pet-manager-ledger',
      'pet-manager-footer',
    ]) {
      expect(html).toContain(`data-testid="${testid}"`);
    }
  });

  it('renders the honest placeholder + footer note strings', () => {
    localStorage.setItem('locale', 'zh');
    const html = renderToStaticMarkup(createElement(ManagerPage));
    expect(html).toContain('此区块将在后续步骤填充。');
    expect(html).toContain('桌宠感知的宿主动作存在覆盖缺口');
  });

  it('the skeleton reset leaves no host in the bridge between tests', () => {
    // ManagerPage with an empty bridge must not throw on static render —
    // the loading state renders placeholders, not controls.
    expect(() => renderToStaticMarkup(createElement(ManagerPage))).not.toThrow();
  });
});
