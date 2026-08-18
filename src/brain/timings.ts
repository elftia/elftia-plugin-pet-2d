/**
 * src/brain/timings.ts — every duration `sense.ts` / `rhythm.ts` use, in one
 * object, each with its provenance cited (a design-doc source, a host
 * constant it must stay <= to, or — for the one value neither design.md nor
 * whale-girl specifies — an explicitly-flagged local engineering decision).
 * D3's `FACT_FLAGS` table (design.md) already prints exact millisecond
 * values inline for illustration; this file is the single place those
 * values actually LIVE — `sense.ts` imports from here rather than
 * re-stating them, so retuning is always a one-line edit in one file.
 */

/** One `[min, max]` millisecond range for a `rhythm.ts` random-interval
 * roll. `min <= max`; both ends inclusive-ish (`rollWithin` uses
 * `Math.random()`'s own `[0, 1)` convention, so `max` is never actually
 * produced, matching `Math.random`'s own contract). */
export interface DurationRange {
  readonly minMs: number;
  readonly maxMs: number;
}

export const TIMINGS = {
  /**
   * Preferred reaction windows for instantaneous facts (D3 rule 1: the flag
   * holds while `now < min(entry.deadline, entry.occurredAt +
   * preferredWindowMs)`) — deliberately shorter than or equal to the host's
   * own window (`HOST_WT/packages/shared/src/contracts/pet-facts.ts`
   * `COMPLETION_WINDOW_MS=8000` / `ERROR_WINDOW_MS=4000` /
   * `APP_STARTED_WINDOW_MS=60000`), never longer: the pet may cut its own
   * reaction short, but must never claim something the host has stopped
   * asserting.
   */
  preferredWindowMs: {
    /** D3 FACT_FLAGS table (design.md:134). Host COMPLETION_WINDOW_MS=8000;
     * the pet's celebrate reaction is tuned shorter, 6000. */
    taskCompleted: 6000,
    /** D3 FACT_FLAGS table (design.md:135). A turn is a smaller unit than a
     * task, tuned shorter than the task-completion window. */
    turnCompleted: 4000,
    /** D3 FACT_FLAGS table (design.md:136). Same family as
     * `taskCompleted`. */
    mediaJobCompleted: 6000,
    /** D3 FACT_FLAGS table (design.md:137-138). Matches host
     * ERROR_WINDOW_MS=4000 exactly — the `error` state must not outlast the
     * host's own claim that the error is current. Shared by both
     * `taskFailed` and `requestError`. */
    failure: 4000,
    /** D3 FACT_FLAGS table (design.md:142). Host APP_STARTED_WINDOW_MS
     * =60000 is the outer bound the fact itself lives for; the pet's own
     * `welcome` reaction is tuned much shorter, matching whale-girl's
     * welcome-state pacing (`_others/whale-girl/docs/state-machine.md`). */
    greeting: 6000,
  },

  /**
   * `sulking`'s reaction tail (D3 rule 2, design.md:147-148): runs
   * `occurredAt + preferredWindowMs.failure … occurredAt +
   * preferredWindowMs.failure + sulkTailMs`, i.e. entirely PAST the fact's
   * own clamped deadline — legal because it is the pet's own emotion, not a
   * claim about the host's state. Whale-girl's error->disappointed 4s/6s
   * pairing (`_others/whale-girl/docs/state-machine.md`) is the tuning
   * source; task 4.1 states it as "error 4s + sulk tail 6s".
   */
  sulkTailMs: 6000,

  /**
   * Post-drag-release grace (D12, task 4.1 "drop buffer 1.5s") before the
   * pet fully settles back out of `drag` — long enough to read as a
   * deliberate landing, not a snap cut. Design-doc/task-4.1 sourced, not
   * whale-girl (whale-girl has no drag-release concept of its own — Elftia's
   * drag model is host-window-driven, D12).
   */
  dropBufferMs: 1500,

  /**
   * Shared reaction-window duration for the menu/interaction-triggered
   * local flags that don't have their own named window in D3's prose
   * (`feeding`, `playing`, `waking`): a brief acknowledgment before falling
   * back to whatever the fact-derived state would otherwise pick. Task 4.1:
   * "transient 1.5s". Numerically equal to `dropBufferMs` by design (both
   * are "brief acknowledgment, then return") but named separately since
   * they gate unrelated flags and could be tuned independently later.
   */
  transientMs: 1500,

  /** `joyful` window. Task 4.1 "joy 1.6s"; whale-girl's joy-state pacing
   * (`_others/whale-girl/docs/state-machine.md`). */
  joyMs: 1600,

  /** No-interaction threshold before `sleeping` becomes true. Task 4.1
   * "sleep-after 60s"; whale-girl's idle-to-sleep timeout
   * (`_others/whale-girl/docs/state-machine.md`). */
  sleepAfterMs: 60000,

  /**
   * How long a single triggered stroll stays active once `rhythm.ts`'s
   * `nextStrollAt` fires (D5: `walk` is a bounded in-stage animation that
   * returns to `idle`, not a standing state). NOT independently specified
   * anywhere in design.md or task 4.1 — task 4.1 only gives the 18-40s
   * TRIGGER interval below (`strollIntervalMs`), unlike `workingInterlude`,
   * which explicitly names both a trigger range AND a duration range. This
   * value is therefore an IMPLEMENTATION DECISION, not a citation: long
   * enough for whale-girl's walk sheet (3 frames @ 6fps pingpong, ~1s per
   * full cycle) to play a handful of visible cycles, short enough to read
   * as "a stroll" rather than a relocation. Flagged here explicitly so a
   * future reader retuning this repo knows it is free to move without
   * contradicting any design-doc citation.
   */
  strollDurationMs: 6000,

  /** How often a new stroll is scheduled while idle. Task 4.1 "stroll
   * 18-40s"; whale-girl's own walk-trigger interval
   * (`_others/whale-girl/docs/state-machine.md`). */
  strollIntervalMs: { minMs: 18000, maxMs: 40000 },

  /**
   * `working` vs `think` (D4: `working` requires `thinking +
   * workingInterlude`, `think` requires only `thinking` — `working` is the
   * periodic animated interlude layered on top of the steady `think`
   * state). Both ranges from task 4.1 ("working interlude 12-30s trigger /
   * 2.5-6s duration"); whale-girl's working-interlude pacing
   * (`_others/whale-girl/docs/state-machine.md`) is the tuning source.
   */
  workingInterlude: {
    triggerMs: { minMs: 12000, maxMs: 30000 },
    durationMs: { minMs: 2500, maxMs: 6000 },
  },

  /** Random idle/think/wait facing-direction turn interval. Task 4.1
   * "facing turn 10-25s"; D6 `facing.ts` independently corroborates: "a
   * random turn every 10-25s while idle/think/wait". */
  facingTurnMs: { minMs: 10000, maxMs: 25000 },
} as const;
