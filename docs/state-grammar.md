# The state grammar — facts → sense → state

This is the pet's entire decision mechanism. Three pure modules, no clock
reads, no I/O, no memory between calls:

```
facts snapshot (host pushes) ──┐
                               ├─→ deriveSense() ──→ pickState() ──→ PetState
local interaction/rhythm ──────┘     src/brain/sense.ts  src/brain/stateTable.ts
```

The same inputs always produce the same output. Everything time-dependent
enters as an explicit `now` argument, so the whole grammar is unit-testable
and auditable by reading — which is the point: a third-party pet author
should be able to port `src/brain/` into their own plugin by copying the
directory (it has no host imports).

## The direction of the protocol (read this before borrowing whale-girl)

**The host feeds FACTS; the pet derives state.** whale-girl's `/state`
endpoint works the other way — its pet process decides an `activity.name`
and external consumers render whatever state they are told. This plugin
borrows whale-girl's *assets, frame semantics, playback vocabulary, motion
recipes and priority ordering*, and **does not** borrow its state-transport
direction, its `/state` shape, or its `activity`-object input. Do not read
whale-girl's external-snapshot work as prior art for facts.

## Step 1 — the eight host facts

The closed v1 fact enum (`src/contract/facts.ts`, pinned by test against the
host's `pet-facts.ts`):

| Fact | Meaning | Sense flag | Window |
|---|---|---|---|
| `taskCompleted` | an agent task finished | `taskDone` | 6 s preferred |
| `turnCompleted` | one conversation turn finished | `turnDone` | 4 s preferred |
| `mediaJobCompleted` | an image/video/music job finished | `mediaDone` | 6 s preferred |
| `taskFailed` | a task failed | `failed` + `sulking` tail | 4 s + 6 s tail |
| `requestError` | a provider request errored | `failed` + `sulking` tail | 4 s + 6 s tail |
| `sessionThinking` | an agent turn is running | `thinking` | stateful (see rule 3) |
| `sessionWaitingApproval` | a turn awaits user approval | `awaitingApproval` | stateful (see rule 3) |
| `appLifecycle` | app started / quitting | `greeting` | 6 s, phase `'started'` only |

Each snapshot entry carries `active` and an **absolute `deadline`**. The
snapshot is the single truth: the host does not re-push while nothing
changes, and a fresh push never includes an entry the host itself considers
expired.

The three derivation rules (`src/brain/sense.ts`, D3):

1. **Instantaneous facts clamp.** The flag holds while
   `now < min(entry.deadline, entry.occurredAt + preferredWindowMs)`.
   The pet may cut its own reaction shorter than the host's window, but may
   never claim something the host has stopped asserting — every preferred
   window is ≤ the host's own (`COMPLETION_WINDOW_MS=8000`,
   `ERROR_WINDOW_MS=4000`, `APP_STARTED_WINDOW_MS=60000`).
2. **The `sulking` tail runs past the clamp.** After a failure's clamped
   deadline, `sulking` stays true for another 6 s. This is legal precisely
   because the tail asserts the pet's *own emotion* (it is sad about what
   happened), not a continuing claim about the host's state.
3. **Stateful facts expire to `activityUnknown`, never to `false`.**
   `sessionThinking` / `sessionWaitingApproval` are true while
   `now < entry.deadline`. Past the deadline the flag simply stops being
   asserted and a distinct `activityUnknown` flag is set instead. Treating
   expiry as `false` would let the pet fall asleep mid-turn; treating it as
   `true` would be a false assertion. `activityUnknown` **asserts nothing**
   (it drives no state) and appears only in `forbids` columns of the state
   table — where it keeps `sleep` and `walk` from firing while the pet
   honestly does not know whether the agent is working.

## Step 2 — local flags

Interaction and rhythm are plugin-internal (the protocol is strictly
one-way; the host never hears about them). All windows live in
`src/brain/timings.ts` with per-value provenance:

| Flag | Source | Window |
|---|---|---|
| `dragging` | the drag handshake | direct boolean, not timed |
| `dropBuffer` | drag release | 1.5 s after release |
| `feeding` / `playing` / `waking` | context-menu actions, wake trigger | 1.5 s transient |
| `joyful` | joy trigger | 1.6 s |
| `sleeping` | no interaction of any kind | after 60 s idle |
| `strolling` | rhythm scheduler | 6 s per triggered stroll |
| `workingInterlude` | rhythm scheduler | 2.5–6 s per interlude (trigger every 12–30 s) |

Strolls are scheduled every 18–40 s while idle; facing direction turns every
10–25 s while idle/think/wait.

A **null snapshot** (cold start, before the first facts push ever arrives)
is fully legal: every fact-derived flag stays `false` and the pet is fully
functional on local flags alone.

## Step 3 — the state table (18 rows, priority order)

Row order IS the priority: `pickState` returns the first row whose `requires`
all hold and whose `forbids` all fail to hold (`src/brain/stateTable.ts`).
The order is whale-girl's own tuned priority with two additions — the
`greeting` source (whale-girl has no equivalent fact) and the `forbids`
column itself (whale-girl encodes the same exclusions as imperative guards;
a data column is what makes this auditable line by line). A test pins the
row count at 18 so nothing inserts or reorders silently.

| # | State | requires | forbids | Why here |
|---|---|---|---|---|
| 1 | `drag` | `dragging` | | the user is physically holding the pet — nothing outranks that |
| 2 | `idle` | `dropBuffer` | | a just-released pet lands deliberately (1.5 s grace), it does not snap into a reaction |
| 3 | `error` | `failed` | | a failure outranks every celebration — no smiling through an error |
| 4 | `disappointed` | `sulking` | | the emotion tail outlives the error claim itself |
| 5 | `welcome` | `greeting` | `failed`, `sulking` | greeting, but never on top of a failure |
| 6 | `celebrate` | `taskDone` | `failed`, `sulking` | task success — the biggest celebration |
| 7 | `eat` | `feeding` | | user-initiated, so it outranks passive reactions |
| 8 | `play` | `playing` | | user-initiated |
| 9 | `wake` | `waking` | | user-initiated |
| 10 | `wait` | `awaitingApproval` | | the pet waits for the user with the agent |
| 11 | `celebrate` | `turnDone` | `failed`, `sulking` | a turn is a smaller unit than a task — same state, lower priority |
| 12 | `celebrate` | `mediaDone` | `failed`, `sulking` | same family as task success |
| 13 | `working` | `thinking` + `workingInterlude` | | the periodic animated interlude layered on `think` |
| 14 | `think` | `thinking` | | the steady working pose |
| 15 | `joy` | `joyful` | | a local joy trigger |
| 16 | `sleep` | `sleeping` | `activityUnknown`, `thinking`, `awaitingApproval` | **never nap through a working session** — forbidden while the agent might be busy, and forbidden when activity is unknown |
| 17 | `walk` | `strolling` | `activityUnknown`, `thinking`, `awaitingApproval` | same guards as sleep: no strolling through work or through ignorance |
| 18 | `idle` | (none) | | the always-matching default — `idle` is always reachable |

The `sleep`/`walk` guards are the visible payoff of rule 3: `activityUnknown`
exists so that "the snapshot went stale mid-turn" can forbid sleep without
falsely asserting thinking.
