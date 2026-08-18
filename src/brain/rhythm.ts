/**
 * src/brain/rhythm.ts — D4/D6/task 4.4: pure scheduling helpers for the
 * randomized local-rhythm timers (blink, working interlude, stroll, facing
 * turn). Each takes an injected `() => number` random source (never
 * `Math.random` directly) so tests can seed it and assert determinism (task
 * 4.5f) — the interaction layer (Group 7) is the one place that wires
 * `Math.random` in, at composition time.
 */
import type { DurationRange } from './timings';
import { TIMINGS } from './timings';

/** `random()` must return a value in `[0, 1)`, matching `Math.random`'s own
 * contract — every function here assumes that range. */
export type RandomSource = () => number;

function rollWithin(range: DurationRange, random: RandomSource): number {
  return range.minMs + random() * (range.maxMs - range.minMs);
}

/**
 * Next epoch ms a blink should play, while a `blink`-playback state (D6
 * `player.ts`) is on-screen holding frame 0. Whale-girl blinks roughly
 * every 2-6s (`_others/whale-girl/docs/state-machine.md`); neither
 * design.md nor task 4.1 gives this one a named range (it is the one
 * rhythm timer that isn't itself a `SenseFlag` window — it drives
 * `player.ts`'s blink schedule directly, not `deriveSense`), so the range
 * is declared locally here rather than duplicated into `timings.ts`'s
 * per-flag table.
 */
const BLINK_INTERVAL_MS: DurationRange = { minMs: 2000, maxMs: 6000 };

export function nextBlinkAt(now: number, random: RandomSource): number {
  return now + rollWithin(BLINK_INTERVAL_MS, random);
}

/**
 * One resolved working-interlude plan: `triggerAt` is when the interlude
 * should start (only meaningful while `thinking` holds — the caller is
 * responsible for not scheduling one otherwise); `durationMs` is how long
 * the window stays open once it actually fires. Both ends are rolled
 * together so a single call fully describes the next interlude — the
 * caller combines `durationMs` with the interlude's actual fire time to
 * produce the `{ startedAt, endsAt }` window `sense.ts`'s
 * `LocalState.workingInterludeWindow` expects.
 */
export interface WorkingInterludePlan {
  readonly triggerAt: number;
  readonly durationMs: number;
}

export function nextWorkingInterlude(now: number, random: RandomSource): WorkingInterludePlan {
  return {
    triggerAt: now + rollWithin(TIMINGS.workingInterlude.triggerMs, random),
    durationMs: rollWithin(TIMINGS.workingInterlude.durationMs, random),
  };
}

/** Next epoch ms a stroll should trigger — `TIMINGS.strollIntervalMs`
 * (task 4.1 "stroll 18-40s"). The stroll's own on-screen duration once
 * triggered is `TIMINGS.strollDurationMs`, applied by `sense.ts`, not
 * rolled here (unlike the working interlude, the duration is a fixed
 * constant, not a per-trigger random range — see `timings.ts`'s
 * `strollDurationMs` doc comment). */
export function nextStrollAt(now: number, random: RandomSource): number {
  return now + rollWithin(TIMINGS.strollIntervalMs, random);
}

/** Next epoch ms a facing-direction turn should happen while
 * idle/think/wait — `TIMINGS.facingTurnMs` (task 4.1 "facing turn 10-25s";
 * D6 `facing.ts`). */
export function nextFacingTurnAt(now: number, random: RandomSource): number {
  return now + rollWithin(TIMINGS.facingTurnMs, random);
}
