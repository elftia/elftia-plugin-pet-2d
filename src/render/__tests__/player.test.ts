/**
 * src/render/__tests__/player.test.ts — task 5.6: the exact frame sequence
 * per playback mode over >= 2 full periods, the `frames: 1` guards, and the
 * DOM player (stepper chain, blink scheduling, style application) driven
 * through injected timeout/random fakes — no real timers, no flake.
 */
import { describe, expect, it } from 'vitest';

import type { CharacterPackStateSlot } from '../../contract/characterPack';
import { createSpritePlayer, frameAt, type SpritePlayer } from '../player';

function sequence(
  playback: CharacterPackStateSlot['playback'],
  frames: number,
  ticks: number,
  blinkTick: number | null = null
): number[] {
  return Array.from({ length: ticks }, (_, t) => frameAt(playback, frames, t, blinkTick));
}

describe('frameAt — exact sequences over >= 2 full periods', () => {
  it('loop cycles 0..N-1', () => {
    expect(sequence('loop', 3, 8)).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
  });

  it('pingpong runs the triangle wave over period 2N-2 (N=3)', () => {
    expect(sequence('pingpong', 3, 8)).toEqual([0, 1, 2, 1, 0, 1, 2, 1]);
  });

  it('pingpong runs the triangle wave over period 2N-2 (N=4)', () => {
    expect(sequence('pingpong', 4, 12)).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
  });

  it('once advances then holds the last frame (rest = 0, completion = N-1)', () => {
    expect(sequence('once', 3, 6)).toEqual([0, 1, 2, 2, 2, 2]);
  });

  it('blink holds 0 while resting and plays 0 -> N-1 -> 0 while a blink runs', () => {
    // Resting: blinkTick null, any tick.
    expect(frameAt('blink', 3, 0, null)).toBe(0);
    expect(frameAt('blink', 3, 999, null)).toBe(0);
    // A blink (N=3, period 4): 0,1,2,1 then finished-hold 0 (blinkTick past
    // the period, defensive against a caller that forgets to reset).
    const blinkPass = Array.from({ length: 6 }, (_, b) => frameAt('blink', 3, b, b));
    expect(blinkPass).toEqual([0, 1, 2, 1, 0, 0]);
  });

  it('clamps negative ticks to frame 0 (defensive; callers never pass them)', () => {
    expect(frameAt('loop', 3, -1, null)).toBe(0);
    expect(frameAt('once', 3, -7, null)).toBe(0);
  });
});

describe('frameAt — frames:1 guards (pack validation rejects these; player stays safe)', () => {
  it.each(['loop', 'pingpong', 'once', 'blink'] as const)(
    '%s with frames:1 always shows frame 0',
    (playback) => {
      for (let t = 0; t < 6; t++) {
        expect(frameAt(playback, 1, t, playback === 'blink' ? t : null)).toBe(0);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// DOM player with injected timeout + random.

interface CapturedTimer {
  ms: number;
  fire: () => void;
}

function fakeTimeout() {
  const timers: CapturedTimer[] = [];
  const cleared: number[] = [];
  let seq = 0;
  return {
    timers,
    cleared,
    api: {
      setTimeout(handler: () => void, ms: number) {
        const entry: CapturedTimer = { ms, fire: handler };
        timers.push(entry);
        return ++seq;
      },
      clearTimeout(handle: unknown) {
        cleared.push(Number(handle));
      },
    },
  };
}

function makeEl(): HTMLElement {
  const el = document.createElement('div');
  return el;
}

function slot(overrides: Partial<CharacterPackStateSlot> = {}): CharacterPackStateSlot {
  return { sheet: 'idle', frames: 3, fps: 2, playback: 'loop', ...overrides };
}

describe('SpritePlayer — style application and stepping', () => {
  it('setState applies sheet url, size, and frame-0 position', () => {
    const el = makeEl();
    const player = createSpritePlayer(el);
    player.setState({ slot: slot(), sheetUrl: 'data:image/png;base64,AAA', stagePx: 128 });
    expect(el.style.backgroundImage).toBe('url("data:image/png;base64,AAA")');
    expect(el.style.backgroundSize).toBe('384px 128px');
    // jsdom normalizes the unitless 0 in backgroundPositionFor's '0px 0' to '0px 0px'.
    expect(el.style.backgroundPosition).toBe('0px 0px');
    expect(player.currentFrame).toBe(0);
  });

  it('step advances the frame and background-position at loop cadence', () => {
    const el = makeEl();
    const player = createSpritePlayer(el);
    player.setState({ slot: slot(), sheetUrl: 'u', stagePx: 100 });
    player.step();
    expect(player.currentFrame).toBe(1);
    expect(el.style.backgroundPosition).toBe('-100px 0px');
    player.step();
    expect(player.currentFrame).toBe(2);
    player.step();
    expect(player.currentFrame).toBe(0); // wrapped
  });

  it('setState resets the tick (safe mid-animation swap)', () => {
    const el = makeEl();
    const player = createSpritePlayer(el);
    player.setState({ slot: slot(), sheetUrl: 'u', stagePx: 100 });
    player.step();
    player.step();
    player.setState({ slot: slot({ playback: 'once' }), sheetUrl: 'u2', stagePx: 100 });
    expect(player.currentFrame).toBe(0);
    expect(el.style.backgroundSize).toBe('300px 100px');
  });

  it('reports every applied frame through onFrameChange', () => {
    const el = makeEl();
    const player = createSpritePlayer(el);
    const seen: number[] = [];
    player.onFrameChange = (frame) => seen.push(frame);
    player.setState({ slot: slot({ frames: 2 }), sheetUrl: 'u', stagePx: 64 });
    player.step();
    player.step();
    expect(seen).toEqual([0, 1, 0]); // setState applies 0, then two steps
  });
});

describe('SpritePlayer — setTimeout chain (no rAF, D13)', () => {
  it('start schedules at 1000/fps and each fire steps then reschedules', () => {
    const el = makeEl();
    const { timers, api } = fakeTimeout();
    const player = createSpritePlayer(el, { timeout: api });
    player.setState({ slot: slot({ fps: 2 }), sheetUrl: 'u', stagePx: 100 });
    player.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(500);

    timers[0].fire();
    expect(player.currentFrame).toBe(1);
    expect(timers).toHaveLength(2); // rescheduled
    expect(timers[1].ms).toBe(500);
  });

  it('stop clears the pending timer and stops stepping; start is idempotent', () => {
    const el = makeEl();
    const { timers, cleared, api } = fakeTimeout();
    const player = createSpritePlayer(el, { timeout: api });
    player.setState({ slot: slot(), sheetUrl: 'u', stagePx: 100 });
    player.start();
    player.start();
    expect(timers).toHaveLength(1); // no double-schedule
    player.stop();
    expect(cleared).toHaveLength(1);
    const count = timers.length;
    player.step();
    expect(timers.length).toBe(count); // stop really stopped the chain
  });
});

describe('SpritePlayer — blink scheduling', () => {
  /**
   * Fixed roll: random() -> 0 means nextBlinkAt returns the 2 s minimum; at
   * fps 2 (500 ms/tick) the blink is scheduled 4 ticks out. The player must
   * hold frame 0 until then, run 0,1,2,1, then rest.
   */
  it('holds 0, plays one pingpong pass on schedule, rests after', () => {
    const el = makeEl();
    const player: SpritePlayer = createSpritePlayer(el, { random: () => 0 });
    player.setState({ slot: slot({ frames: 3, playback: 'blink', fps: 2 }), sheetUrl: 'u', stagePx: 100 });

    const frames: number[] = [];
    for (let i = 0; i < 12; i++) {
      player.step();
      frames.push(player.currentFrame);
    }
    // tick:      1  2  3  4  5  6  7  8  9 10 11 12
    expect(frames).toEqual([0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0]);
    //                           ^ tick 4 >= nextBlinkTick(0+4): blink starts,
    //                             showing 0; then 1,2,1; blink ends (>= 4
    //                             ticks) and the next blink is scheduled 4
    //                             ticks after tick 8 — tick 12 restarts it,
    //                             showing 0 again.
  });

  it('a longer roll delays the blink proportionally (2-6 s range from rhythm.ts)', () => {
    const el = makeEl();
    // random -> 1 - epsilon: near the 6 s max => 12 ticks at fps 2.
    const player = createSpritePlayer(el, { random: () => 1 - 1e-9 });
    player.setState({ slot: slot({ frames: 2, playback: 'blink', fps: 2 }), sheetUrl: 'u', stagePx: 100 });
    for (let i = 0; i < 11; i++) player.step();
    expect(player.currentFrame).toBe(0); // still resting one tick before the blink
    player.step();
    player.step(); // blink tick 1
    expect(player.currentFrame).toBe(1);
  });
});
