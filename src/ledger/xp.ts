/**
 * xp.ts — the pure XP arithmetic (D10), adapted from whale-girl's
 * `lib/src/pet-state.mjs` (the growth-system doc there is the semantic
 * authority this ledger adapts; see docs/growth-system.md in that repo).
 *
 * One XP axis; `level` is ALWAYS derived (`xpForLevel`), never stored. All
 * awards are additive — zero negative feedback: no decay, no penalty, no
 * requirement (a failed task counts a stat, never subtracts).
 *
 * Companionship NOTE (a deliberate divergence from D10's compressed phrasing
 * "XP from … plus accumulated companionship ms"): in the reference
 * implementation, active-time accumulation (`recordActive`) adds ZERO xp —
 * `activeMs` exists to feed the `regular` title threshold, nothing else.
 * This ledger follows the reference: companionship ms accrues into
 * `stats.activeMs` (capped per increment), it does not convert to XP.
 */
import type { LedgerInteractionKind } from '../contract/ledgerPort';

/** XP awards per fact type (D10's table). Only these three types award. */
export const TASK_XP = 10;
export const MEDIA_JOB_XP = 5;
export const TURN_XP = 2;

/** Recognized interaction kinds (`pet.ts` reports these, Group 7) and their
 * flat award. An unrecognized kind is a no-op award, mirroring
 * `isKnownPetFactType`'s "unknown degrades to nothing" discipline. */
const INTERACTION_XP: Readonly<Record<LedgerInteractionKind, number>> = {
  feed: 1,
  play: 1,
  drag: 1,
  switchCharacter: 1,
};

/**
 * Single-increment cap on companionship ms (D10's anti-idle-farming rule):
 * one `observe()` gap can add at most 5 real minutes of `activeMs`, so an
 * overnight "thinking" session (or a machine that slept) cannot farm the
 * `regular` title in one increment.
 */
export const ACTIVE_CAP_MS = 5 * 60_000;

/** Upper bound fed into `levelFor` so the closed form cannot overflow to
 * Infinity (the reference caps at persistence level; we cap at the math). */
export const XP_SAFE_MAX = 1e12;

/** Cumulative XP required to reach `level` (triangular: L2=50, L3=150…). */
export function xpForLevel(level: number): number {
  return (50 * level * (level - 1)) / 2;
}

/**
 * O(1) inverse of `xpForLevel` (closed form of the triangular number
 * inverse; the reference replaced a linear while-loop with this after the
 * loop could hang the host on huge xp). Clamped to >= 1: level 1 is the
 * floor, xp 0 is level 1.
 */
export function levelFor(xp: number): number {
  const xpSafe = Math.max(0, Math.min(xp, XP_SAFE_MAX));
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xpSafe) / 25)) / 2));
}

/** XP for one observed fact of `type`; 0 for every type not in D10's table
 * (failures, session states, lifecycle — counted elsewhere or ignored). */
export function xpAwardForFact(type: string): number {
  if (type === 'taskCompleted') return TASK_XP;
  if (type === 'mediaJobCompleted') return MEDIA_JOB_XP;
  if (type === 'turnCompleted') return TURN_XP;
  return 0;
}

/** XP for one user interaction of `kind`; 0 for unrecognized kinds. */
export function xpAwardForInteraction(kind: LedgerInteractionKind): number {
  return INTERACTION_XP[kind] ?? 0;
}
