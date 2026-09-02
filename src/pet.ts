/**
 * src/pet.ts — the composition root and the module the host imports from
 * `plugin://pet-2d/pet.mjs` (`loadAppExtensionPets.ts` calls the named
 * `activate(host)` — a throw there means status:'failed' and a blank
 * window, so ACTIVATE MUST NEVER THROW, D13).
 *
 * What it composes (each part individually guarded — one part failing
 * degrades exactly that part, never the whole pet):
 *
 *   prefs (D11)  → which pack the user chose; survives ledger trim
 *   stage (D6)   → the DOM layers + player + alpha hit-test
 *   packs (D1/D6)→ resolvePack never fails (built-in module | user ipc pack
 *                  | fallback glyph on any doubt)
 *   facts (D3)   → host.petRuntime.subscribeFacts → snapshot (may stay
 *                  null forever — cold start is fully functional, D13)
 *   loop (D13)   → 125 ms sense tick + the player's setTimeout stepper;
 *                  both stopped on visibilitychange→hidden, resumed from
 *                  idle on visible (presence pause, D12)
 *   interact     → hit-test-gated drag handshake + the DOM context menu
 *   ledger (D10) → OPTIONAL; composed via the ONE guarded dynamic import
 *                  of the ledger module (the trim seam — task 8.6 proves
 *                  it is deletable); every call site is `ledger?.…`.
 *
 * `host.petRuntime` is OPTIONAL (F5): without it the pet runs facts-free
 * (idle/sleep/stroll/interactions only) with one console.warn.
 */
import type {
  AgentUiHostApi,
  AgentUiPetRuntime,
  HOST_API_VERSION,
} from '@elftia/plugin-types';

import {
  nextFacingTurnAt,
  nextStrollAt,
  nextWorkingInterlude,
  type RandomSource,
  type WorkingInterludePlan,
} from './brain/rhythm';
import { deriveSense, type LocalState } from './brain/sense';
import { pickState } from './brain/stateTable';
import type { PetFactsSnapshotLike } from './contract/facts';
import type { LedgerPort } from './contract/ledgerPort';
import type { PetState } from './contract/petState';
import { menuStrings, resolveLocale } from './interact/locale';
import { attachContextMenu, type MenuHandle, openContextMenu } from './interact/menu';
import { attachPointerHandlers, createPointerController } from './interact/pointer';
import { type CharacterPack } from './packs/loadPack';
import { DEFAULT_PACK_ID, isKnownPackId } from './packs/registry';
import {
  nextPackInRotation,
  PACKS_REV_KEY,
  readCachedUserPacks,
  refreshUserPacks,
  resolvePack,
  rotationPool,
  type UserPackSummary,
} from './packs/userPacks';
import type { Facing } from './render/facing';
import { createBrowserHitTestDeps } from './render/hitTest';
import type { PetWindowSize } from './render/sheetGeometry';
import { createStage, type Stage, type StageEntry } from './render/stage';
import {
  createPrefsStore,
  PREFS_STORAGE_KEY,
  type PrefsStore,
  readPrefs,
} from './state/prefs';
import { safeLocalStorage } from './state/safeStorage';

/** D13: the sense tick. 8 Hz — far finer than any window that matters. */
const SENSE_TICK_MS = 125;

/**
 * v1 has no deactivate verb — activate() runs once per pet window and the
 * window's own teardown is the teardown. But a SECOND activate (a re-imported
 * module, a retried boot, a test harness) must not stack the first
 * activation's listeners: a new activation supersedes the previous one by
 * running its detach handles at entry.
 */
let disposersFromPreviousActivate: Array<() => void> = [];

export async function activate(host: AgentUiHostApi): Promise<void> {
  try {
    await startPet(host);
  } catch (error) {
    // The last-ditch net: anything the individual guards missed still must
    // not surface as a rejected activate() (blank window, D13).
    console.error('[pet-2d] activate failed', error);
  }
}

async function startPet(host: AgentUiHostApi): Promise<void> {
  for (const dispose of disposersFromPreviousActivate) dispose();
  disposersFromPreviousActivate = [];

  const now = (): number => Date.now();
  const random: RandomSource = Math.random;

  // --- feature-detect the optional runtime (F5) -----------------------------
  const runtime: AgentUiPetRuntime | undefined = host.petRuntime;
  if (!runtime) {
    console.warn('[pet-2d] host.petRuntime absent — running facts-free (optional per F5)');
  }

  // --- user packs (D6): scoped ipc to the main half's store ------------------
  // `host.ipc` is member-non-optional in the 1.54 types but resolvePack still
  // feature-detects it (an older host or a narrowed preload must degrade to
  // built-ins, never fail the boot). The cache seeds rotation instantly; the
  // live fetch replaces it as soon as it lands.
  const ipc: unknown = host.ipc;
  let userPacks: UserPackSummary[] = readCachedUserPacks(safeLocalStorage());
  function isSelectablePack(id: string): boolean {
    return isKnownPackId(id) || userPacks.some((pack) => pack.id === id);
  }
  async function refetchUserPacks(): Promise<void> {
    userPacks = await refreshUserPacks(ipc, safeLocalStorage());
  }
  void refetchUserPacks();

  // --- preferences (D11) ----------------------------------------------------
  // A stored id may now be a USER pack too, so an unknown id is no longer
  // coerced at boot — resolvePack decides (user ipc pack, or the glyph).
  const prefs: PrefsStore = createPrefsStore();
  let packId: string = prefs.read().packId ?? '';
  if (packId === '') packId = DEFAULT_PACK_ID;

  // --- stage + pack (both degrade, never throw) ------------------------------
  const stage: Stage = createStage({ hitTestDeps: createBrowserHitTestDeps(document) });
  let pack: CharacterPack = await resolvePack(packId, { ipc });

  let windowSize: PetWindowSize = { width: 256, height: 256 };
  let stagePx = 256;
  const stageScale = (): number => pack.manifest.meta?.stageScale ?? 1;
  function applyWindowSize(size: PetWindowSize): void {
    windowSize = size;
    stage.resize(size, stageScale());
    stagePx = Math.round(Math.min(size.width, size.height) * stageScale());
  }

  async function refreshConfig(reason: string): Promise<void> {
    if (!runtime) return;
    try {
      const config = await runtime.getConfig();
      applyWindowSize(config.window);
      console.info(`[pet-2d] config re-read (${reason}): presenceHidden=${config.presenceHidden}`);
    } catch (error) {
      console.warn('[pet-2d] getConfig() failed; keeping last window size', error);
    }
  }
  try {
    const config = await runtime?.getConfig();
    if (config) applyWindowSize(config.window);
  } catch {
    console.warn('[pet-2d] initial getConfig() failed; using 256×256');
  }

  // --- facts (cold start: null until/unless the first push) ------------------
  let snapshot: PetFactsSnapshotLike | null = null;
  try {
    runtime?.subscribeFacts((push) => {
      // Host lower-bound shape → our concrete mirror (facts.ts explains why
      // the plugin keeps its own copy rather than importing either).
      snapshot = push as unknown as PetFactsSnapshotLike;
    });
  } catch (error) {
    console.warn('[pet-2d] subscribeFacts failed; staying facts-free', error);
  }

  // --- interaction-local state (the LocalState slice sense.ts reads) --------
  let feedingAt: number | null = null;
  let playingAt: number | null = null;
  let wakingAt: number | null = null;
  let joyfulAt: number | null = null;
  let menuInteractionAt = now();
  const markInteraction = (): number => (menuInteractionAt = now());

  let currentPetState: PetState = 'idle';
  let facing: Facing = 'left';

  // --- ledger (D10) — the ONLY import of src/ledger/ in the tree --------
  // Dynamic + guarded: `scripts/verify-trim.mjs` (task 8.6) deletes the
  // ledger directory and stubs this one expression, proving the module is
  // genuinely trimmable; an absent module here degrades to a ledger-less
  // pet (never a failed activate — companionship bookkeeping, not gameplay).
  let ledger: LedgerPort | undefined;
  try {
    const { createLedger } = await import('./ledger/createLedger');
    ledger = createLedger();
  } catch {
    console.info('[pet-2d] ledger module absent — running without (trimmed build)');
  }

  const pointer = createPointerController({
    hitTest: stage.hitTest,
    petRuntime: runtime,
    now,
    onDragEnd: () => {
      // Being carried around delights the pet — `joy`'s trigger (1.6 s).
      joyfulAt = now();
      ledger?.noteInteraction('drag');
    },
    onOpaqueDown: () => {
      // Touch wakes a SLEEPING pet; a tap on an awake pet is nothing (D12).
      if (currentPetState === 'sleep') wakingAt = now();
    },
  });
  const detachPointer = attachPointerHandlers(stage.elements.stage, pointer);

  // --- the state loop --------------------------------------------------------
  let strollTriggeredAt: number | null = null;
  let strollDirection: 1 | -1 = 1;
  let strollDueAt = nextStrollAt(now(), random);
  let interludePlan: WorkingInterludePlan = nextWorkingInterlude(now(), random);
  let interludeWindow: LocalState['workingInterludeWindow'] = null;
  let thinkingHeld = false;
  let facingTurnDueAt = nextFacingTurnAt(now(), random);

  function stageEntryFor(state: PetState): StageEntry {
    return {
      slot: pack.manifest.states[state],
      sheetUrl: pack.sheets[state].url,
      frameSize: pack.manifest.meta?.frameSize ?? 256,
    };
  }

  function applyState(state: PetState): void {
    currentPetState = state;
    stage.setState(state, stageEntryFor(state), strollDirection);
    stage.setFacing(facing);
    // Observability: the on-screen state as a data attribute (tests assert
    // through it; devtools users can read it off the sprite node).
    stage.elements.sprite.dataset.petState = state;
    syncRenderContext();
  }

  function syncRenderContext(): void {
    pointer.setRenderContext({ state: currentPetState, frame: stage.player.currentFrame, stagePx });
  }
  stage.player.onFrameChange = () => syncRenderContext();

  function buildLocal(): LocalState {
    const pointerLocal = pointer.getLocalState();
    return {
      dragging: pointerLocal.dragging,
      dragReleasedAt: pointerLocal.dragReleasedAt,
      feedingAt,
      playingAt,
      wakingAt,
      joyfulAt,
      lastInteractionAt: Math.max(pointerLocal.lastInteractionAt, menuInteractionAt),
      strollTriggeredAt,
      workingInterludeWindow: interludeWindow,
    };
  }

  function tick(): void {
    const t = now();

    // Rhythm rolls (D4/D6): strolls and facing turns run while idle-ish;
    // working interludes only stack on a HELD thinking fact — a fresh rising
    // edge re-rolls the plan so an idle-rolled trigger can't fire instantly
    // the moment thinking starts.
    const senseProbe = deriveSense(snapshot, buildLocal(), t);
    if (senseProbe.thinking && !thinkingHeld) {
      interludePlan = nextWorkingInterlude(t, random);
      interludeWindow = null;
    }
    thinkingHeld = senseProbe.thinking;
    if (thinkingHeld && interludeWindow === null && t >= interludePlan.triggerAt) {
      interludeWindow = { startedAt: t, endsAt: t + interludePlan.durationMs };
    }
    if (interludeWindow !== null && t >= interludeWindow.endsAt) {
      interludeWindow = null;
      interludePlan = nextWorkingInterlude(t, random);
    }
    if (t >= strollDueAt) {
      strollTriggeredAt = t;
      strollDirection = random() < 0.5 ? -1 : 1;
      strollDueAt = nextStrollAt(t, random);
    }
    if (t >= facingTurnDueAt) {
      if (currentPetState === 'idle' || currentPetState === 'think' || currentPetState === 'wait') {
        facing = facing === 'left' ? 'right' : 'left';
        stage.setFacing(facing);
      }
      facingTurnDueAt = nextFacingTurnAt(t, random);
    }

    const sense = deriveSense(snapshot, buildLocal(), t);
    const next = pickState(sense);
    if (next !== currentPetState) applyState(next);
    if (snapshot !== null) ledger?.observe(snapshot, t);
  }

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  function startTick(): void {
    if (tickTimer === null) tickTimer = setInterval(tick, SENSE_TICK_MS);
  }
  function stopTick(): void {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  // --- the context menu (D12) -----------------------------------------------
  let menu: MenuHandle | null = null;

  // Pack-switch core (stage.ts 5.5 contract): load, invalidate the alpha
  // hit-test, re-apply geometry + state. `packLoadSeq` drops out-of-order
  // loads when switches arrive faster than the load resolves. Every load is
  // resolvePack (built-in module | user ipc | glyph — D6's one dispatch).
  let packLoadSeq = 0;
  async function applyPack(next: string): Promise<void> {
    const seq = ++packLoadSeq;
    packId = next;
    const loaded = await resolvePack(next, { ipc });
    if (seq !== packLoadSeq) return; // a newer switch superseded this load
    pack = loaded;
    stage.invalidateHitTest();
    applyWindowSize(windowSize);
    applyState(currentPetState);
    markInteraction();
  }

  async function switchPack(): Promise<void> {
    const next = nextPackInRotation(packId, rotationPool(userPacks.map((p) => p.id)));
    prefs.setPackId(next);
    await applyPack(next);
    ledger?.noteInteraction('switchCharacter');
  }

  // Cross-window selection (task 7.1): the manager page's Gallery writes the
  // prefs key from the MAIN window; the browser's `storage` event lands HERE
  // (it never fires in the writing window). Read DISK truth (`readPrefs`),
  // not the store's in-memory snapshot — that snapshot only tracks OUR writes,
  // so it is exactly stale after another window wrote the key. A USER id the
  // pet doesn't know yet (the manager just saved it — the rev event and this
  // one race) is resolved by refetching the list FIRST, not by dropping the
  // switch.
  function onPrefsStorage(event: StorageEvent): void {
    if (event.key !== PREFS_STORAGE_KEY) return;
    if (event.storageArea !== safeLocalStorage()) return;
    const next = readPrefs(safeLocalStorage()).packId ?? '';
    if (next === packId) return;
    if (isKnownPackId(next)) {
      void applyPack(next);
      return;
    }
    void (async () => {
      await refetchUserPacks();
      if (!isSelectablePack(next)) return; // unknown id — keep the current pack
      await applyPack(next);
    })();
  }

  // The store-revision half of the refresh protocol (D6): the manager bumps
  // PACKS_REV_KEY after every store mutation (save/delete/import); the bump
  // lands here as a `storage` event and the list is refetched. If the pack
  // the pet is showing was the one deleted, repair to the default — the
  // alternative is a pet permanently rendering the fallback glyph.
  function onPacksRevStorage(event: StorageEvent): void {
    if (event.key !== PACKS_REV_KEY) return;
    if (event.storageArea !== safeLocalStorage()) return;
    void (async () => {
      await refetchUserPacks();
      if (packId !== '' && !isSelectablePack(packId)) {
        prefs.setPackId(DEFAULT_PACK_ID);
        await applyPack(DEFAULT_PACK_ID);
      }
    })();
  }

  const strings = menuStrings(resolveLocale(navigator.language));
  const detachContextMenu = attachContextMenu(
    stage.elements.stage,
    (x, y) =>
      stage.hitTest.isOpaqueAt(currentPetState, stage.player.currentFrame, x, y, stagePx),
    (viewportX, viewportY) => {
      menu?.close();
      menu = openContextMenu({
        strings,
        x: viewportX,
        y: viewportY,
        petRuntime: runtime,
        actions: {
          onFeed: () => {
            feedingAt = now();
            markInteraction();
            ledger?.noteInteraction('feed');
          },
          onPlay: () => {
            playingAt = now();
            markInteraction();
            ledger?.noteInteraction('play');
          },
          onSwitchCharacter: () => {
            void switchPack();
          },
        },
      });
      return menu;
    }
  );

  // --- presence pause (D12): hidden stops both clocks, visible resumes -----
  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      stopTick();
      stage.player.stop();
      prefs.flush();
      // The LEDGER's own flush is owned by its persist layer (it registers
      // its own visibilitychange/pagehide listeners, task 8.2) — LedgerPort
      // deliberately has no flush verb for pet.ts to reach through.
    } else {
      void refreshConfig('visibility resumed');
      applyState('idle'); // resume from idle, never mid-gesture (D12)
      stage.player.start();
      startTick();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  const onPageHide = (): void => prefs.flush();
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('storage', onPrefsStorage);
  window.addEventListener('storage', onPacksRevStorage);

  // v1 has no deactivate verb — activate() runs once per pet window and the
  // window's own teardown is the teardown. The detach handles are collected
  // (not discarded) so a future deactivate() would have them ready.
  const disposers: Array<() => void> = [
    detachPointer,
    detachContextMenu,
    stopTick,
    () => stage.player.stop(),
    () => document.removeEventListener('visibilitychange', onVisibilityChange),
    () => window.removeEventListener('pagehide', onPageHide),
    () => window.removeEventListener('storage', onPrefsStorage),
    () => window.removeEventListener('storage', onPacksRevStorage),
  ];
  disposersFromPreviousActivate = disposers;

  // --- go ---------------------------------------------------------------------
  applyState('idle');
  stage.player.start();
  startTick();
}

// Type-only proof for task 2.3's gate ("HOST_API_VERSION resolves to
// 1.54.0" — bumped with the v1.54 manager-page promotion): errors at compile
// time if the pinned host API version this repo was built against ever
// drifts, with zero runtime cost or bundle impact
// (`import type` + `verbatimModuleSyntax` erase it before the bundle).
type _HostApiVersionProbe = typeof HOST_API_VERSION extends '1.54.0'
  ? true
  : ['HOST_API_VERSION drifted from 1.54.0 — see tsconfig.json paths note'];
const _hostApiVersionProbe: _HostApiVersionProbe = true as _HostApiVersionProbe;
void _hostApiVersionProbe;
