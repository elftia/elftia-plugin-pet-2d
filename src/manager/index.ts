/**
 * src/manager/index.ts — the RENDERER entry (`renderer/manager.mjs`), the
 * main-window half of the plugin (desktop-pet-manager-page D1). The host's
 * renderer loader imports this module from `plugin://pet-2d/manager.mjs`
 * and calls the named `activate(host)`; a throw there means
 * `status:'failed'` and the page never appears, silently — ACTIVATE MUST
 * NEVER THROW (the same D13 discipline pet.ts follows).
 *
 * The one registration: a top-level agent page (rail destination), exactly
 * like the DS plugin's `host.page.register`. `react` is imported bare —
 * the host's import map (`installHostModuleImportMap`) resolves it to the
 * HOST's single React instance, so the page body shares hooks/context with
 * the host tree that mounts it.
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';
import { createElement } from 'react';

import { pageStrings, resolvePageLocale } from '../interact/locale';
import { setManagerHost } from './hostBridge';
import { ManagerPage } from './page';

export function activate(host: AgentUiHostApi): void {
  try {
    // The page body reaches petRuntime/ui through the bridge (DS pattern):
    // install it FIRST so any render path finds it populated.
    setManagerHost(host);
    // Feature-detect rather than lean on the catch: an older/partial host
    // (or a member-exact test fake) reaches activate() without the `page`
    // handle — that degrades to a warning, never a failed activation.
    if (typeof host.page?.register !== 'function') {
      console.warn('[pet-2d] host.page.register absent — manager page not registered');
      return;
    }
    host.page.register({
      id: 'pet-2d',
      // The rail label is a RESOLVED string by contract (never an i18n
      // key), resolved from the persisted app locale at register time (D7).
      label: pageStrings(resolvePageLocale()).pageTitle,
      // Emoji glyph — the host rail mapper accepts emoji OR a lucide name.
      icon: 'PawPrint',
      render: () => createElement(ManagerPage),
      railTestId: 'sidebar-agent-page-pet-2d',
    });
  } catch (error) {
    // The last-ditch net (D13): even a register() throw must not surface as
    // a rejected activate() — that would flip the loader status to
    // 'failed' and silently kill the page.
    console.error('[pet-2d] manager activate failed', error);
  }
}
