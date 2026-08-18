/**
 * src/manager/usePetConfig.ts — the page's config hook (task 5.1, D6②).
 *
 * Reads `host.petRuntime.getConfig()` on mount and on window `focus` /
 * `visibilitychange→visible` (the documented cheap-pull staleness policy —
 * there is no config push port). ONE write path, `writeConfig(patch)`,
 * wraps `petRuntime.setConfig` with a saving flag and RE-READS the config
 * after every write: server-resolved fields (`petId`, `resolutionHint`,
 * the window size) are never hand-merged from the patch — the PetSection
 * F12 lesson. `setConfig` is feature-detected: absent on a host < 1.53 ⇒
 * `managementAvailable:false` and the page degrades per D6② (gallery /
 * prefs / ledger stay functional — they are plugin-local).
 */
import type { HostPetConfigPatch, HostPetRuntimeConfig } from '@elftia/plugin-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getManagerHostOrNull } from './hostBridge';

export type PetConfigStatus = 'loading' | 'ready' | 'unavailable';

export interface UsePetConfigResult {
  /** `unavailable` = no readable petRuntime (getConfig absent/throwing). */
  readonly status: PetConfigStatus;
  /** False on hosts without `setConfig` (< 1.53) — the D6② degradation. */
  readonly managementAvailable: boolean;
  /** Last successfully read config; null until the first read resolves. */
  readonly config: HostPetRuntimeConfig | null;
  /** True while a write + re-read round-trip is in flight. */
  readonly saving: boolean;
  /** The ONE write path (D6②): setConfig(patch) then re-read. */
  readonly writeConfig: (patch: HostPetConfigPatch) => Promise<void>;
  /** Manual pull (the rescan row's fallback path is writeConfig({})). */
  readonly refresh: () => Promise<void>;
}

export function usePetConfig(): UsePetConfigResult {
  const [config, setConfigState] = useState<HostPetRuntimeConfig | null>(null);
  const [status, setStatus] = useState<PetConfigStatus>('loading');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const runtime = getManagerHostOrNull()?.petRuntime;
    if (!runtime || typeof runtime.getConfig !== 'function') {
      setStatus('unavailable');
      return;
    }
    try {
      const next = await runtime.getConfig();
      setConfigState(next);
      setStatus('ready');
    } catch (error) {
      // Keep the LAST good config; a transient getConfig failure must not
      // blank controls the user is looking at (D13 degrade, never crash).
      console.warn('[pet-2d] manager getConfig failed; keeping last config', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = (): void => {
      void refresh();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const writeConfig = useCallback(
    async (patch: HostPetConfigPatch): Promise<void> => {
      const runtime = getManagerHostOrNull()?.petRuntime;
      if (!runtime || typeof runtime.setConfig !== 'function') {
        console.warn('[pet-2d] writeConfig on a host without petRuntime.setConfig — no-op');
        return;
      }
      setSaving(true);
      try {
        await runtime.setConfig(patch);
        await refresh();
      } catch (error) {
        console.warn('[pet-2d] setConfig failed', error);
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const managementAvailable = useMemo(() => {
    const runtime = getManagerHostOrNull()?.petRuntime;
    return typeof runtime?.setConfig === 'function';
  }, []);

  return { status, managementAvailable, config, saving, writeConfig, refresh };
}
