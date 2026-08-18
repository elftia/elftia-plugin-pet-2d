/**
 * src/brain/stateTable.ts — D4: the state table IS data. Row order is
 * priority; `pickState` returns the first row whose `requires` all hold and
 * whose `forbids` (if any) all fail to hold. Row order is deliberately
 * whale-girl's own tuned priority order
 * (`_others/whale-girl/docs/state-machine.md` §优先级) with two additions
 * specific to this design: the `greeting` source (D5 — whale-girl has no
 * equivalent fact) and the `forbids` column itself. Whale-girl encodes the
 * same exclusions as imperative guards inside `when` closures; making them a
 * data column is what turns this table into something a third-party reader
 * can audit line by line instead of tracing control flow (D4's whole
 * point).
 */
import type { PetState, SenseFlag } from '../contract/petState';
import type { Sense } from './sense';

export interface StateRule {
  readonly state: PetState;
  readonly requires: readonly SenseFlag[];
  readonly forbids?: readonly SenseFlag[];
}

/**
 * 18 rows, verbatim from design.md D4 (lines 166-183). Task 4.5f's
 * row-count assertion pins `STATE_TABLE.length === 18` so a silent row
 * insertion or removal fails the test suite instead of silently reordering
 * priority.
 */
export const STATE_TABLE: readonly StateRule[] = [
  { state: 'drag', requires: ['dragging'] },
  { state: 'idle', requires: ['dropBuffer'] },
  { state: 'error', requires: ['failed'] },
  { state: 'disappointed', requires: ['sulking'] },
  { state: 'welcome', requires: ['greeting'], forbids: ['failed', 'sulking'] },
  { state: 'celebrate', requires: ['taskDone'], forbids: ['failed', 'sulking'] },
  { state: 'eat', requires: ['feeding'] },
  { state: 'play', requires: ['playing'] },
  { state: 'wake', requires: ['waking'] },
  { state: 'wait', requires: ['awaitingApproval'] },
  { state: 'celebrate', requires: ['turnDone'], forbids: ['failed', 'sulking'] },
  { state: 'celebrate', requires: ['mediaDone'], forbids: ['failed', 'sulking'] },
  { state: 'working', requires: ['thinking', 'workingInterlude'] },
  { state: 'think', requires: ['thinking'] },
  { state: 'joy', requires: ['joyful'] },
  {
    state: 'sleep',
    requires: ['sleeping'],
    forbids: ['activityUnknown', 'thinking', 'awaitingApproval'],
  },
  {
    state: 'walk',
    requires: ['strolling'],
    forbids: ['activityUnknown', 'thinking', 'awaitingApproval'],
  },
  { state: 'idle', requires: [] },
];

function rowMatches(rule: StateRule, sense: Sense): boolean {
  if (!rule.requires.every((flag) => sense[flag])) return false;
  if (rule.forbids?.some((flag) => sense[flag])) return false;
  return true;
}

/**
 * First matching row wins (D4). The final row (`requires: []`, no
 * `forbids`) always matches, so this never falls through — `idle` is the
 * true, always-reachable default.
 */
export function pickState(sense: Sense): PetState {
  for (const rule of STATE_TABLE) {
    if (rowMatches(rule, sense)) return rule.state;
  }
  // Unreachable: the last row's empty `requires` always matches. Kept as an
  // explicit fallback rather than a non-null assertion so this function has
  // no path that can return `undefined`.
  return 'idle';
}
