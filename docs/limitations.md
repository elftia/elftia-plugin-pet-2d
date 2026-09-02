# Known limitations

Everything here is a documented, deliberate v1 boundary — each item names
the host-platform gap that causes it and the recorded follow-up that would
fix it properly. None of them is worked around inside this plugin; the
portfolio's rule was to design around host gaps, never to patch host code
from a plugin.

## Behavioral

- **`walk` is in-stage only.** The window never moves itself; there is no
  autonomous window-motion verb in `petRuntime` v1 (a `nudge(dx,dy)` is a
  v1.x host proposal). Strolls are a bounded 6 s in-stage animation that
  returns to `idle`. (OQ5, LEAD-ruled.)
- **`welcome` is usually missed.** It fires only from
  `appLifecycle{phase:'started'}`, and the facts pump's single initial push
  is typically lost before the pet window's renderer subscribes (cold
  start). You will see it when any *other* change re-pushes the snapshot
  while the app-started fact is still inside its 60 s window — i.e. if you
  start using the app immediately. (D13/OQ2; the host re-push follow-up
  fixes it.)
- **A >25 s agent turn expires the thinking fact.** Stateful facts carry
  `deadline = generatedAt + STATE_TTL_MS` (25 s) and the host does not
  re-push while nothing changes, so a long turn goes stale mid-flight. The
  pet handles this honestly: `activityUnknown` forbids `sleep` and `walk`
  and the pet returns to `idle` instead of falsely claiming to think.
  (D3/OQ2; same host follow-up.)

## Fact coverage (host-side gaps, not plugin bugs)

- **CLI-backend sessions produce no session facts.** The host's runtime
  projection covers TinyElf backends only; sessions running through the
  Code-CLI backend (`agentBackend === 'cli'`) generate no
  `sessionThinking` / `sessionWaitingApproval` / `turnCompleted` facts, so
  the pet is blind to them. (Child A, recorded.)
- **Delegation facts are partial.** Delegation is default-off (source
  inert until enabled), and its *launch*-phase failures
  (`engine_start_failed`, `workspace_preparation_failed`) transition
  directly in the DB without passing the observer — only engine-phase
  failures reach the pet as `taskFailed`. (Child A, recorded.)
- **In-session TTS/ASR produce no `mediaJobCompleted`.** Only
  image/video/music jobs enter the host's media-job registry.
  (Child A, recorded.)

## Interaction

- **Clicks on transparent corner pixels are swallowed.** Window-level
  pointer capture is rectangle-based (host-side cursor polling turns
  capture on inside the window rect); the plugin's alpha mask decides
  *whether a captured click feeds the pet*, but cannot pass an unwanted
  click through to the app underneath. A click that lands on a fully
  transparent pixel inside the rect is consumed by the pet window and goes
  nowhere. Per-frame alpha hit regions exist in the mask code precisely to
  keep the *pet-facing* half of this honest; the pass-through half needs a
  host-side fix. (Child B D4.)
- **Timer-driven behavior throttles to ~1 Hz when fully occluded.**
  Measured on the real window flags: JS timers collapse to one tick per
  second when a fullscreen app covers the pet, while compositor-thread CSS
  animations keep running. Sense derivation and frame stepping visibly
  stutter in that condition. This is informational per the OQ4 ruling — no
  `backgroundThrottling:false` override exists anywhere, host or plugin.
  (Spike item ②.)
- **No cross-plugin asset sharing.** Each pack is self-contained and
  same-origin by construction; a `plugin://`-load from a *different*
  plugin id is CSP-blocked (verified in the spike). There is deliberately
  no mechanism for one plugin's pet to render another plugin's assets.

## Ledger

- **Growth data does not carry between dev and packaged origins.** The
  ledger persists to the pet window's `localStorage`, which is partitioned
  per origin: a dev run (vite dev-server origin) and a packaged install
  (`app://bundle`) are different origins with separate stores. Points,
  titles and memory earned in dev do not appear in the installed app, and
  vice versa. (Inherent to `localStorage`; a host-owned storage port would
  be the fix, and is not in v1.)

## Manager page (v0.2)

- **Config freshness is pull-on-focus.** There is no config push port: the
  page re-reads `petRuntime.getConfig()` on mount, on window focus, and on
  visibility→visible. A config change made elsewhere (the Settings section,
  or another window) while the page sits in a background tab appears when
  you next focus the tab — not instantly. Every WRITE re-reads immediately,
  so the page's own toggles never show stale state.
- **Hosts < 1.53 get a degraded page, not a broken one.** Without
  `petRuntime.setConfig` the master controls are replaced by an
  update-required card; the gallery, pack switching, and the ledger stay
  fully functional because they are plugin-local (prefs/ledger read the
  main-window localStorage, same origin as the pet window in both dev and
  packaged layouts — the ledger's dev-vs-packaged origin split applies to
  the page identically).
- **The ledger panel is only as live as the pet window's writer.** It
  refreshes on `storage` events for the ledger key; the pet window
  debounces its writes ≤ 1 s, so the panel trails real accrual by at most
  one debounce window plus the event dispatch.

## Sandboxed storage (v0.2.3)

- **In the opaque-frame sandbox there is no storage at all — only a
  session-scoped stand-in.** The host mounts both plugin surfaces
  (`pet.mjs`, `manager.mjs`) in `allow-scripts` sandboxes without
  `allow-same-origin`, so the frame's origin is opaque and the
  `localStorage` property access itself throws `SecurityError`. Since
  0.2.3 every storage read goes through `src/state/safeStorage.ts`, which
  hands back the REAL storage when the host grants one (dev, trusted
  windows — unchanged behavior) and otherwise a shared in-memory
  stand-in, so both pages render and same-page reads/writes cohere. What
  is unavailable in that mode: persistence beyond the page's life (prefs,
  ledger growth, the user-pack cache reset on reload) and every
  cross-window `storage`-event channel (the pack-selection ring and the
  packs-rev refresh protocol only sync windows that share a real origin).
  In-sandbox plugin state remains readable/writable through the host verbs
  (`petRuntime.getConfig`/`setConfig`, `packs:*` ipc), which do not depend
  on the frame's origin.

## Scope

- **2D sprite packs only.** The contract (and this reference
  implementation) is 2D sprite strips driven by CSS. Unity/WebGL/3D pets
  are outside the contract: `SheetSource` accepts any `<img>`-loadable
  URL, which makes a canvas-based renderer *theoretically* reachable, but
  nothing in this repo supports, tests, or documents that path. Treat it
  as experimental and unsupported.
