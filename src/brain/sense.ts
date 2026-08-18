/**
 * src/brain/sense.ts — D3: turns a possibly-stale facts snapshot plus local
 * interaction/rhythm timestamps into `Sense`, a flat `Record<SenseFlag,
 * boolean>`. The one exported function, `deriveSense`, is pure: same three
 * arguments in, same result out — no clock reads, no I/O, no mutation of
 * its inputs.
 *
 * Staleness note (read this before touching stateful-fact handling): the
 * host only re-pushes a snapshot when something changes — "the in-process
 * pump does NOT re-push while nothing changes" (D3 rule 3) — and a fresh
 * push never includes a fact the host itself now considers expired
 * (`PetFactsSnapshotLike.facts` entries always carry `active: true`;
 * expired entries are omitted from a snapshot at GENERATION time, never
 * emitted with `active: false` — pet-facts.ts:64-65). Neither of those
 * facts requires `deriveSense` to remember anything across calls: the
 * snapshot object this plugin is HOLDING between pushes still contains a
 * stateful entry's original absolute `deadline` unchanged, so comparing the
 * caller's current `now` against that `deadline` (rule 3, `applyStateful`
 * below) already distinguishes "still valid" from "gone stale without a
 * fresh push" using only the one snapshot in hand — no history needed.
 */
import type {
  PetFactEntryLike,
  PetFactsSnapshotLike,
  PetFactType,
} from '../contract/facts';
import { isKnownPetFactType } from '../contract/facts';
import type { SenseFlag } from '../contract/petState';
import { SENSE_FLAGS } from '../contract/petState';
import { TIMINGS } from './timings';

export type Sense = Record<SenseFlag, boolean>;

/**
 * Raw inputs the interaction/rhythm layers (Group 7) own — timestamps, plus
 * one direct boolean (`dragging`, a discrete pointer-driven state, not a
 * timed window). `deriveSense` turns each into its windowed flag using
 * `TIMINGS`, so there is exactly one place ("is this window still open?")
 * that can get the arithmetic wrong — never the interaction layer itself.
 */
export interface LocalState {
  /** Set directly by the drag handshake (D12): true from armed-drag-start
   * to pointerup/cancel. Not time-windowed. */
  readonly dragging: boolean;
  /** epoch ms of the last drag release, or `null` before any drag this
   * session. Drives `dropBuffer` for `TIMINGS.dropBufferMs` after release. */
  readonly dragReleasedAt: number | null;
  /** epoch ms the feed menu action fired, or `null`. Drives `feeding` for
   * `TIMINGS.transientMs`. */
  readonly feedingAt: number | null;
  /** epoch ms the play menu action fired, or `null`. Drives `playing` for
   * `TIMINGS.transientMs`. */
  readonly playingAt: number | null;
  /** epoch ms a wake trigger fired, or `null`. Drives `waking` for
   * `TIMINGS.transientMs`. */
  readonly wakingAt: number | null;
  /** epoch ms a joy trigger fired, or `null`. Drives `joyful` for
   * `TIMINGS.joyMs`. */
  readonly joyfulAt: number | null;
  /** epoch ms of the most recent user interaction of ANY kind (pointer,
   * menu, drag). Drives `sleeping` once `now - lastInteractionAt >=
   * TIMINGS.sleepAfterMs`. */
  readonly lastInteractionAt: number;
  /** epoch ms `rhythm.ts`'s `nextStrollAt` schedule fired, or `null`.
   * Drives `strolling` for `TIMINGS.strollDurationMs`. */
  readonly strollTriggeredAt: number | null;
  /** The currently-open working-interlude window (its own randomized
   * duration already resolved by `rhythm.ts`'s `nextWorkingInterlude` at
   * trigger time), or `null` when not in an interlude. Drives
   * `workingInterlude` while `now < endsAt`. */
  readonly workingInterludeWindow: {
    readonly startedAt: number;
    readonly endsAt: number;
  } | null;
}

interface FactFlagRule {
  readonly flag: SenseFlag;
  /** Present for instantaneous facts; absent (with `stateful: true`
   * instead) for the two session-state facts. */
  readonly preferredWindowMs?: number;
  readonly stateful?: true;
  /** `sulking`'s tail (D3 rule 2) — only `taskFailed` / `requestError`
   * carry this. */
  readonly tailFlag?: SenseFlag;
  readonly tailMs?: number;
  /** Only `appLifecycle` carries this — restricts the rule to entries whose
   * `details.phase` matches (D3's table: `appLifecycle` -> `greeting` only
   * on `'started'`; `'quitting'` entries match no rule at all, since there
   * is no "goodbye" state in the closed D5 union). */
  readonly phase?: string;
}

/**
 * D3's FACT_FLAGS table, verbatim (design.md:133-142).
 * `Record<PetFactType, ...>` (not `Partial`) means TypeScript itself
 * enforces "every fact type has a rule" — combined with the
 * `PET_FACT_TYPES` pin test (`contract/__tests__/facts.test.ts`), a fact
 * type can never silently fall through unmapped.
 */
const FACT_FLAGS: Record<PetFactType, FactFlagRule> = {
  taskCompleted: {
    flag: 'taskDone',
    preferredWindowMs: TIMINGS.preferredWindowMs.taskCompleted,
  },
  turnCompleted: {
    flag: 'turnDone',
    preferredWindowMs: TIMINGS.preferredWindowMs.turnCompleted,
  },
  mediaJobCompleted: {
    flag: 'mediaDone',
    preferredWindowMs: TIMINGS.preferredWindowMs.mediaJobCompleted,
  },
  taskFailed: {
    flag: 'failed',
    preferredWindowMs: TIMINGS.preferredWindowMs.failure,
    tailFlag: 'sulking',
    tailMs: TIMINGS.sulkTailMs,
  },
  requestError: {
    flag: 'failed',
    preferredWindowMs: TIMINGS.preferredWindowMs.failure,
    tailFlag: 'sulking',
    tailMs: TIMINGS.sulkTailMs,
  },
  sessionThinking: { flag: 'thinking', stateful: true },
  sessionWaitingApproval: { flag: 'awaitingApproval', stateful: true },
  appLifecycle: {
    flag: 'greeting',
    preferredWindowMs: TIMINGS.preferredWindowMs.greeting,
    phase: 'started',
  },
};

function emptySense(): Sense {
  const sense = {} as Sense;
  for (const flag of SENSE_FLAGS) sense[flag] = false;
  return sense;
}

function detailsPhase(entry: PetFactEntryLike): string | undefined {
  const phase = entry.details?.phase;
  return typeof phase === 'string' ? phase : undefined;
}

/**
 * Applies one instantaneous-fact entry against its rule: D3 rule 1's clamp
 * (`now < min(entry.deadline, entry.occurredAt + preferredWindowMs)`), then
 * D3 rule 2's past-clamp `sulking` tail when the rule defines one. Mutates
 * `sense` in place (internal helper only, never exported).
 */
function applyInstantaneous(
  sense: Sense,
  entry: PetFactEntryLike,
  rule: FactFlagRule,
  now: number
): void {
  if (rule.phase !== undefined && detailsPhase(entry) !== rule.phase) return;
  if (entry.occurredAt === undefined || rule.preferredWindowMs === undefined) return;

  const clampedDeadline = Math.min(entry.deadline, entry.occurredAt + rule.preferredWindowMs);
  if (now < clampedDeadline) {
    sense[rule.flag] = true;
    return;
  }
  if (rule.tailFlag === undefined || rule.tailMs === undefined) return;

  // D3 rule 2: the tail runs PAST the fact's own clamped deadline — legal
  // precisely because it asserts the pet's own emotion (it is sad about
  // what just happened), not a continuing claim about the host's state.
  const tailEnd = clampedDeadline + rule.tailMs;
  if (now < tailEnd) {
    sense[rule.tailFlag] = true;
  }
}

/**
 * Applies one stateful-fact entry (D3 rule 3): true while `now <
 * entry.deadline`; past it, asserts nothing but marks `activityUnknown` —
 * see the file-header staleness note for why comparing against this one
 * held snapshot, with no extra memory, is sufficient.
 */
function applyStateful(sense: Sense, entry: PetFactEntryLike, rule: FactFlagRule, now: number): void {
  if (now < entry.deadline) {
    sense[rule.flag] = true;
  } else {
    sense.activityUnknown = true;
  }
}

function applyFactFlags(sense: Sense, snapshot: PetFactsSnapshotLike, now: number): void {
  for (const entry of snapshot.facts) {
    if (!entry.active || !isKnownPetFactType(entry.type)) continue;
    const rule = FACT_FLAGS[entry.type];
    if (rule.stateful) {
      applyStateful(sense, entry, rule, now);
    } else {
      applyInstantaneous(sense, entry, rule, now);
    }
  }
}

function applyLocalFlags(sense: Sense, local: LocalState, now: number): void {
  sense.dragging = local.dragging;

  if (local.dragReleasedAt !== null && now < local.dragReleasedAt + TIMINGS.dropBufferMs) {
    sense.dropBuffer = true;
  }
  if (local.feedingAt !== null && now < local.feedingAt + TIMINGS.transientMs) {
    sense.feeding = true;
  }
  if (local.playingAt !== null && now < local.playingAt + TIMINGS.transientMs) {
    sense.playing = true;
  }
  if (local.wakingAt !== null && now < local.wakingAt + TIMINGS.transientMs) {
    sense.waking = true;
  }
  if (local.joyfulAt !== null && now < local.joyfulAt + TIMINGS.joyMs) {
    sense.joyful = true;
  }
  if (now - local.lastInteractionAt >= TIMINGS.sleepAfterMs) {
    sense.sleeping = true;
  }
  if (
    local.strollTriggeredAt !== null &&
    now < local.strollTriggeredAt + TIMINGS.strollDurationMs
  ) {
    sense.strolling = true;
  }
  if (local.workingInterludeWindow !== null && now < local.workingInterludeWindow.endsAt) {
    sense.workingInterlude = true;
  }
}

/**
 * D3's single exported entry point. `snapshot` may be `null` (cold start,
 * D13 — before the first facts push ever arrives): every fact-derived flag
 * stays `false`, local flags still apply normally (design.md:361, "the pet
 * is fully functional... with zero facts").
 */
export function deriveSense(
  snapshot: PetFactsSnapshotLike | null,
  local: LocalState,
  now: number
): Sense {
  const sense = emptySense();
  if (snapshot !== null) {
    applyFactFlags(sense, snapshot, now);
  }
  applyLocalFlags(sense, local, now);
  return sense;
}
