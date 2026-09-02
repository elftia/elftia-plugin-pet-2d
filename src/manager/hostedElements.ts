/**
 * src/manager/hostedElements.ts — the manager's INTERACTIVE-element creation
 * seam (the 0.2.4 dead-controls patch).
 *
 * WHY THIS EXISTS. Inside the compartment, bare `react` resolves through the
 * host's import-map shim to the PLAIN shared React instance — whose
 * `createElement` does nothing special. The host forwards user events to a
 * remote-projected node ONLY when the frame serializer reported that node
 * with a non-empty `events` array, and that array is derived from the
 * `data-elftia-events` attribute that ONLY the PATCHED
 * `host.react.instance.createElement` stamps on elements whose props carry
 * React handlers (`compartmentHostProjection.tsx` — the byo/DS pattern).
 * A plugin-local `<button onClick>` built with the bare import therefore
 * serializes with `events: []` and the host attaches no handler — the
 * control renders but clicks do nothing (0.2.3's dead manager page).
 *
 * THE SEAM. Every INTERACTIVE element the manager renders goes through one
 * of the `Hosted*` wrappers below, which create the DOM element with the
 * HOST's patched createElement when the bridge holds one (so the serializer
 * opts the node into event forwarding) and with plain React otherwise — a
 * degraded host or a member-exact test fake gets byte-identical DOM, just
 * unmarked. Non-interactive nodes keep the bare import: the patch is purely
 * additive (same React instance, one extra attribute the serializer strips
 * before projection), so marking only handler-carrying elements is exactly
 * the opt-in the host design intends.
 *
 * Known host-side caveat (documented, not worked around here): the host's
 * event REPLAY into the frame re-dispatches a native event on the real
 * in-frame node, and for text inputs React's value-tracker dedupes a
 * programmatic `node.value = x` + 'change' pair, while `<select>` replay
 * carries the frame node's previous value — plugin-local FORM CONTROLS may
 * still need the `host.ui.*` typed-callback path (which the DS acceptance
 * proved end-to-end) for their change semantics to round-trip. Buttons
 * (click has no value semantics) are fully functional through this seam.
 * JSX compiles to `react/jsx-runtime`, which stays plain — hence the
 * explicit wrappers instead of a jsx-runtime shim.
 */
import {
  type ButtonHTMLAttributes,
  createElement,
  type InputHTMLAttributes,
  type ReactElement,
  type SelectHTMLAttributes,
} from 'react';

import { getManagerHostOrNull } from './hostBridge';

/** The patched createElement's string-element shape (children ride in props). */
type HostedCreate = (type: string, props: object | null) => ReactElement;

/**
 * `data-*` probe/stability attributes (the page's testid contract). JSX on
 * intrinsic tags allows hyphenated attributes for free; these wrappers are
 * FUNCTION components, so the attribute set must be declared to typecheck
 * the explicit `createElement` call sites (MasterControls).
 */
type HostedDataAttributes = { readonly [key: `data-${string}`]: string | undefined };

function hostedCreate(type: string, props: object | null): ReactElement {
  // Structural read — a test fake may carry `react: null` even though the
  // contract type says the handle exists, so every hop is guarded.
  const patched = (
    getManagerHostOrNull()?.react as
      | { readonly instance?: { readonly createElement?: unknown } }
      | null
      | undefined
  )?.instance?.createElement;
  const create = (typeof patched === 'function' ? patched : createElement) as HostedCreate;
  return create(type, props);
}

/** A `<button>` opted into host event forwarding when the host is present. */
export function HostedButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & HostedDataAttributes,
): ReactElement {
  return hostedCreate('button', props);
}

/** An `<input>` opted into host event forwarding when the host is present. */
export function HostedInput(
  props: InputHTMLAttributes<HTMLInputElement> & HostedDataAttributes,
): ReactElement {
  return hostedCreate('input', props);
}

/** A `<select>` opted into host event forwarding when the host is present. */
export function HostedSelect(
  props: SelectHTMLAttributes<HTMLSelectElement> & HostedDataAttributes,
): ReactElement {
  return hostedCreate('select', props);
}
