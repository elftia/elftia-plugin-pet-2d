/**
 * src/render/player.ts — D6: the frame stepper. `frameAt` is the PURE half:
 * frame index as a function of (playback, frames, tick, blinkTick) — the one
 * definition of every playback mode's frame sequence, unit-tested over full
 * periods. `SpritePlayer` is the thin DOM half: it owns the sprite element,
 * applies geometry, and advances ticks on a `setTimeout` chain at the state's
 * fps.
 *
 * Clock decision (D13 + spike ②, Group 5's call to make): the stepper is a
 * `setTimeout` chain, NOT `requestAnimationFrame` (the pet window is never
 * focused and rAF halts entirely on hidden pages), and NOT CSS `steps()`.
 * The spike measured JS timers collapsing to ~13.8% under a fullscreen
 * occluder while CSS keyframes kept running — CSS `steps()` was therefore
 * considered and deliberately declined for frame ADVANCE: it would fork the
 * notion of "current frame" between CSS (rendering) and JS (the alpha
 * hit-test's per-frame mask), the two can drift across a state change, and
 * the payoff only exists while the window is fully covered (invisible
 * anyway). Motion recipes (motion.ts) stay CSS/compositor-driven — that is
 * the layer the spike showed is occlusion-immune, and it carries no
 * "current frame" meaning, so no fork. The occlusion cliff itself is
 * recorded against OQ4 as a host follow-up, not worked around here.
 */
import { nextBlinkAt, type RandomSource } from '../brain/rhythm';
import type { CharacterPackStateSlot } from '../contract/characterPack';
import type { PlaybackMode } from '../contract/petState';
import { backgroundPositionFor, backgroundSizeFor } from './sheetGeometry';

/**
 * The frame showing at logical tick `tick` (0-based; one tick = one frame
 * period at the state's fps).
 *
 * `blinkTick` is only read for `playback: 'blink'`: `null` while resting on
 * frame 0, or the tick-count since a blink started (the blink plays
 * `0 → N-1 → 0` once — a single pingpong period — and holds 0 again after).
 */
export function frameAt(
  playback: PlaybackMode,
  frames: number,
  tick: number,
  blinkTick: number | null
): number {
  const n = Math.max(1, Math.floor(frames));
  const t = Math.max(0, Math.floor(tick));
  if (n === 1) return 0; // pingpong/blink guards: a 1-frame sheet can only show 0

  switch (playback) {
    case 'loop':
      return t % n;
    case 'pingpong':
      return pingpongPosition(t, n);
    case 'once':
      return Math.min(t, n - 1);
    case 'blink': {
      if (blinkTick === null) return 0;
      const b = Math.max(0, Math.floor(blinkTick));
      if (b >= 2 * n - 2) return 0; // blink finished (defensive: caller resets)
      return pingpongPosition(b, n);
    }
  }
}

/** Position in a triangle wave over period `2n - 2` (n >= 2): 0,1,…,n-1,…,1,0. */
function pingpongPosition(t: number, n: number): number {
  const period = 2 * n - 2;
  const pos = t % period;
  return pos < n ? pos : period - pos;
}

/** Everything `SpritePlayer` needs to render one state (from the pack + geometry). */
export interface SpritePlayerState {
  readonly slot: CharacterPackStateSlot;
  /** The resolved sheet URL/data-URI (D1 `SheetSource.url`). */
  readonly sheetUrl: string;
  readonly stagePx: number;
}

export interface SpritePlayer {
  /** Swap the sheet/state and reset the tick. Safe mid-animation. */
  setState(state: SpritePlayerState): void;
  /** The frame currently shown (drives the hit-test mask choice). */
  readonly currentFrame: number;
  /** Advance one tick immediately (tests; production uses the timer chain). */
  step(): void;
  start(): void;
  stop(): void;
  /** Notification on every applied frame change (hit-test cache, walk sync). */
  onFrameChange: ((frame: number) => void) | null;
}

interface Timeout {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_TIMEOUT: Timeout = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Creates the sprite player for an EXISTING element (stage.ts owns element
 * creation/layering). `timeout` and `random` are injected — tests drive the
 * chain deterministically; production passes the globals. Blink scheduling
 * reuses `rhythm.ts`'s one blink-interval definition (2–6 s), converted to
 * ticks at the state's fps.
 */
export function createSpritePlayer(
  spriteEl: HTMLElement,
  options: { timeout?: Timeout; random?: RandomSource } = {}
): SpritePlayer {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const random = options.random ?? Math.random;

  let slot: CharacterPackStateSlot | null = null;
  let sheetUrl = '';
  let stagePx = 0;
  let tick = 0;
  let blinkTick: number | null = null;
  let nextBlinkTick = Number.POSITIVE_INFINITY;
  let currentFrame = 0;
  let running = false;
  let timerHandle: unknown = null;

  const player: SpritePlayer = {
    onFrameChange: null,
    get currentFrame() {
      return currentFrame;
    },
    setState(next: SpritePlayerState) {
      slot = next.slot;
      sheetUrl = next.sheetUrl;
      stagePx = next.stagePx;
      tick = 0;
      blinkTick = null;
      scheduleNextBlink();
      apply();
    },
    step() {
      tick += 1;
      if (slot?.playback === 'blink') stepBlink();
      apply();
    },
    start() {
      if (running) return;
      running = true;
      scheduleTick();
    },
    stop() {
      running = false;
      if (timerHandle !== null) {
        timeout.clearTimeout(timerHandle);
        timerHandle = null;
      }
    },
  };

  /** Rolls the next blink start (in ticks) using rhythm's 2–6 s range. */
  function scheduleNextBlink(): void {
    const fps = slot?.fps ?? 1;
    const delayMs = nextBlinkAt(0, random); // absolute epoch irrelevant: only the delay is used
    nextBlinkTick = tick + Math.max(1, Math.round(delayMs / (1000 / fps)));
  }

  function stepBlink(): void {
    if (blinkTick !== null) {
      blinkTick += 1;
      // Blink over (a full 0→N-1→0 pass) → rest until the next scheduled one.
      if (blinkTick >= 2 * Math.max(1, slot?.frames ?? 1) - 2) {
        blinkTick = null;
        scheduleNextBlink();
      }
      return;
    }
    if (tick >= nextBlinkTick) blinkTick = 0;
  }

  function apply(): void {
    if (!slot) return;
    const frame = frameAt(slot.playback, slot.frames, tick, blinkTick);
    currentFrame = frame;
    spriteEl.style.backgroundImage = `url("${sheetUrl}")`;
    spriteEl.style.backgroundSize = backgroundSizeFor(slot.frames, stagePx);
    spriteEl.style.backgroundPosition = backgroundPositionFor(frame, stagePx);
    player.onFrameChange?.(frame);
  }

  function scheduleTick(): void {
    if (!running || !slot) return;
    const interval = 1000 / slot.fps;
    timerHandle = timeout.setTimeout(() => {
      timerHandle = null;
      player.step();
      scheduleTick();
    }, interval);
  }

  return player;
}
