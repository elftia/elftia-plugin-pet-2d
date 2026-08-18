/**
 * src/manager/MasterControls.tsx — D6② master controls + D6③ the pet-off
 * banner. Both render ONLY from the usePetConfig result the page passes
 * down (no bridge reads here — the hook owns the config surface).
 *
 * Switches come from `host.ui.Switch` (the frontend-ui mandate: no native
 * form controls). A degraded host without the ui handle renders a semantic
 * `<button role="switch">` fallback — still not a native checkbox, and the
 * state stays readable (tests exercise this branch with ui-less fakes).
 *
 * Empty states (all four unit-tested, task 5.2):
 *   off                -> OffBanner with the enable CTA (D6③)
 *   on + resolved      -> switches only
 *   on + unresolved    -> + the unresolved-contributor row; rescan =
 *                        writeConfig({}) (D3: an empty patch is a
 *                        legitimate re-scan request)
 *   no management API  -> the update-required card replaces the switches
 */
import type { HostSwitchProps } from '@elftia/plugin-types';
import { createElement, type FunctionComponent } from 'react';

import type { PageStrings } from '../interact/locale';
import { getManagerHostOrNull } from './hostBridge';
import type { UsePetConfigResult } from './usePetConfig';

function SwitchRow(props: {
  testid: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}): ReturnType<typeof createElement> {
  // `HostComponentType` is the structural `(props) => unknown` bound — cast
  // to React's own component type for createElement (the host's real Switch
  // returns a ReactNode; the structural bound just can't say so).
  const HostSwitch = getManagerHostOrNull()?.ui?.Switch as unknown as
    | FunctionComponent<HostSwitchProps>
    | undefined;
  return createElement(
    'div',
    {
      'data-testid': props.testid,
      className: 'flex items-center justify-between gap-4 py-2',
    },
    createElement(
      'div',
      { className: 'flex min-w-0 flex-col' },
      createElement('span', { className: 'text-sm text-foreground' }, props.label),
      createElement('span', { className: 'text-xs text-muted-foreground' }, props.hint),
    ),
    HostSwitch
      ? createElement(HostSwitch, {
          checked: props.checked,
          disabled: props.disabled,
          onCheckedChange: props.onToggle,
        })
      : createElement(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': props.checked ? 'true' : 'false',
            'aria-label': props.label,
            disabled: props.disabled,
            onClick: () => props.onToggle(!props.checked),
            className:
              'rounded-md border border-border/40 px-3 py-1 text-xs text-foreground dark:border-border/60',
          },
          props.checked ? 'ON' : 'OFF',
        ),
  );
}

export function MasterControls(props: {
  strings: PageStrings;
  cfg: UsePetConfigResult;
}): ReturnType<typeof createElement> {
  const { strings, cfg } = props;
  const ready = cfg.status === 'ready' && cfg.config !== null;

  return createElement(
    'section',
    {
      'data-testid': 'pet-manager-master-controls',
      className:
        'rounded-xl border border-border/30 bg-surface-1/80 p-4 dark:border-border/50',
    },
    createElement(
      'h2',
      { className: 'mb-2 text-sm font-semibold text-foreground' },
      strings.masterControlsTitle,
    ),
    !cfg.managementAvailable
      ? createElement(
          'div',
          {
            'data-testid': 'pet-manager-needs-update',
            className: 'rounded-lg bg-surface-2 p-3',
          },
          createElement(
            'p',
            { className: 'text-sm font-medium text-foreground' },
            strings.needsUpdateTitle,
          ),
          createElement(
            'p',
            { className: 'mt-1 text-xs text-muted-foreground' },
            strings.needsUpdateBody,
          ),
        )
      : createElement(
          'div',
          null,
          createElement(SwitchRow, {
            testid: 'pet-manager-enabled-switch',
            label: strings.enabledSwitchLabel,
            hint: strings.enabledSwitchHint,
            checked: ready === true && cfg.config?.enabled === true,
            disabled: !ready || cfg.saving,
            onToggle: (checked) => {
              void cfg.writeConfig({ enabled: checked });
            },
          }),
          createElement(SwitchRow, {
            testid: 'pet-manager-opaque-fallback-switch',
            label: strings.opaqueFallbackSwitchLabel,
            hint: strings.opaqueFallbackSwitchHint,
            checked: ready === true && cfg.config?.opaqueFallback === true,
            disabled: !ready || cfg.saving,
            onToggle: (checked) => {
              void cfg.writeConfig({ opaqueFallback: checked });
            },
          }),
          ready === true && cfg.config?.enabled === true && cfg.config.petId == null
            ? createElement(
                'div',
                {
                  'data-testid': 'pet-manager-unresolved-row',
                  className:
                    'mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-3',
                },
                createElement(
                  'span',
                  { className: 'min-w-0 text-xs text-muted-foreground' },
                  strings.unresolvedRowText,
                ),
                createElement(
                  'button',
                  {
                    type: 'button',
                    'data-testid': 'pet-manager-rescan-button',
                    disabled: cfg.saving,
                    onClick: () => {
                      // D3: the empty patch IS the re-scan request — the
                      // v1.53 handler refreshes contributors unconditionally.
                      void cfg.writeConfig({});
                    },
                    className:
                      'rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50',
                  },
                  strings.rescanButton,
                ),
              )
            : null,
          ready === true && cfg.config?.resolutionHint === true
            ? createElement(
                'p',
                {
                  'data-testid': 'pet-manager-multi-contributor-hint',
                  className: 'mt-2 text-xs text-text-muted',
                },
                strings.multiContributorHint,
              )
            : null,
        ),
  );
}

export function OffBanner(props: {
  strings: PageStrings;
  cfg: UsePetConfigResult;
}): ReturnType<typeof createElement> | null {
  const { strings, cfg } = props;
  const off = cfg.status === 'ready' && cfg.config?.enabled === false;
  if (!off) return null;
  return createElement(
    'section',
    {
      'data-testid': 'pet-manager-off-banner',
      className:
        'rounded-xl border border-border/30 bg-surface-1/80 p-4 dark:border-border/50',
    },
    createElement(
      'div',
      { className: 'flex flex-wrap items-center justify-between gap-2' },
      createElement(
        'p',
        { className: 'min-w-0 text-sm text-muted-foreground' },
        strings.offBanner,
      ),
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'pet-manager-enable-button',
          disabled: !cfg.managementAvailable || cfg.saving,
          onClick: () => {
            void cfg.writeConfig({ enabled: true });
          },
          className:
            'rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50',
        },
        strings.enableButton,
      ),
    ),
  );
}
