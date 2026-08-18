/**
 * src/manager/hostBridge.ts — the package-internal holder for the injected
 * `AgentUiHostApi` (the DS `hostBridge` pattern, copied per D1). The page
 * body is created by `render(): createElement(ManagerPage)` — the contract
 * passes NO host argument — so the page reads the loader-injected host
 * through this module instead. `setManagerHost` runs FIRST inside
 * `activate(host)` (before register), so any render path that reaches the
 * bridge finds it populated; the `OrNull` variant keeps a pre-activate read
 * a degrade, not a crash (the D13 discipline).
 */
import type { AgentUiHostApi } from '@elftia/plugin-types';

let injectedHost: AgentUiHostApi | null = null;

/** Install the loader-injected host (called once from `activate(host)`). */
export function setManagerHost(host: AgentUiHostApi): void {
  injectedHost = host;
}

/** The injected host, or null before `activate` ran (boot-order safety). */
export function getManagerHostOrNull(): AgentUiHostApi | null {
  return injectedHost;
}

/** Test-only reset (mirrors DS's `__resetDesignHost`). */
export function __resetManagerHost(): void {
  injectedHost = null;
}
