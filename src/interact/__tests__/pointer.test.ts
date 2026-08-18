/**
 * src/interact/__tests__/pointer.test.ts — task 7.6: the D12 drag handshake
 * with a stubbed hit test and a recording fake petRuntime — verb ORDER on
 * drag start, capture release pairing, the 6 px threshold, the
 * click-does-nothing rule, and the async hit-test race guard.
 */
import { describe, expect, it, vi } from 'vitest';

import type { HitTest } from '../../render/hitTest';
import { attachPointerHandlers, createPointerController, DRAG_THRESHOLD_PX } from '../pointer';

/** A hit test whose next answer the test controls; records every probe. */
function stubHitTest(initiallyOpaque = true) {
  const probes: Array<{ x: number; y: number }> = [];
  let opaque = initiallyOpaque;
  let resolvePending: ((value: boolean) => void) | null = null;
  const hitTest: HitTest = {
    async isOpaqueAt(_state, _frame, x, y) {
      probes.push({ x, y });
      if (resolvePending !== null) {
        return await new Promise<boolean>((resolve) => {
          resolvePending = resolve;
        });
      }
      return opaque;
    },
    invalidate() {},
  };
  return {
    hitTest,
    probes,
    setOpaque(next: boolean) {
      opaque = next;
    },
    /** Makes the NEXT probe hang until released (race-guard tests). */
    hangNext() {
      resolvePending = () => undefined;
      return () => resolvePending?.(opaque);
    },
  };
}

function fakeRuntime() {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      setPointerCapture: (inside: boolean) => calls.push(`capture:${inside}`),
      startDrag: () => calls.push('startDrag'),
    },
  };
}

function makeController(overrides: Partial<Parameters<typeof createPointerController>[0]> = {}) {
  const stub = stubHitTest();
  const runtime = fakeRuntime();
  const now = vi.fn(() => 1000);
  const onDragEnd = vi.fn();
  const onOpaqueDown = vi.fn();
  const controller = createPointerController({
    hitTest: stub.hitTest,
    petRuntime: runtime.runtime,
    now,
    onDragEnd,
    onOpaqueDown,
    ...overrides,
  });
  return { controller, stub, runtime, now, onDragEnd, onOpaqueDown };
}

/** Flushes the controller's async hit-test probe. */
const settle = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPointerController — the D12 handshake', () => {
  it('threshold is the specified 6 px', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
  });

  it('opaque down → small moves do nothing → past 6 px: capture(true) then startDrag, in order', async () => {
    const { controller, runtime, onOpaqueDown } = makeController();
    controller.pointerdown(100, 100);
    await settle();
    expect(onOpaqueDown).toHaveBeenCalledTimes(1);
    expect(runtime.calls).toEqual([]); // arming alone asserts nothing

    controller.pointermove(103, 103); // ~4.2 px — under threshold
    expect(runtime.calls).toEqual([]);

    controller.pointermove(107, 100); // 7 px — past
    expect(runtime.calls).toEqual(['capture:true', 'startDrag']);
    expect(controller.getLocalState().dragging).toBe(true);
  });

  it('transparent down never arms, no matter how far the pointer moves', async () => {
    const { controller, stub, runtime } = makeController();
    stub.setOpaque(false);
    controller.pointerdown(10, 10);
    await settle();
    controller.pointermove(200, 200);
    controller.pointerup();
    expect(runtime.calls).toEqual([]);
    expect(controller.getLocalState().dragging).toBe(false);
  });

  it('pointerup after a drag: capture(false), dragReleasedAt set, onDragEnd once', async () => {
    const { controller, runtime, onDragEnd, now } = makeController();
    controller.pointerdown(50, 50);
    await settle();
    controller.pointermove(80, 50);
    controller.pointerup();
    expect(runtime.calls).toEqual(['capture:true', 'startDrag', 'capture:false']);
    expect(controller.getLocalState().dragging).toBe(false);
    expect(controller.getLocalState().dragReleasedAt).toBe(now());
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('a click on an opaque pixel with no drag does NOTHING (feed/play are menu verbs)', async () => {
    const { controller, runtime, onDragEnd } = makeController();
    controller.pointerdown(50, 50);
    await settle();
    controller.pointerup();
    expect(runtime.calls).toEqual([]);
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(controller.getLocalState().dragging).toBe(false);
  });

  it('pointercancel behaves as pointerup (capture released, drag ends)', async () => {
    const { controller, runtime } = makeController();
    controller.pointerdown(50, 50);
    await settle();
    controller.pointermove(90, 50);
    controller.pointercancel();
    expect(runtime.calls).toEqual(['capture:true', 'startDrag', 'capture:false']);
    expect(controller.getLocalState().dragging).toBe(false);
  });

  it('a hit-test failure degrades to not-opaque (never an unhandled rejection)', async () => {
    const failing: HitTest = {
      isOpaqueAt: () => Promise.reject(new Error('no 2D canvas')),
      invalidate() {},
    };
    const { controller } = makeController({ hitTest: failing });
    await expect(
      (async () => {
        controller.pointerdown(50, 50);
        await settle();
        controller.pointermove(90, 50);
        controller.pointerup();
      })()
    ).resolves.toBeUndefined();
    expect(controller.getLocalState().dragging).toBe(false);
  });

  it('a down whose hit-test resolves AFTER the gesture ended does not arm retroactively', async () => {
    const { controller, stub, runtime } = makeController();
    const release = stub.hangNext();
    controller.pointerdown(50, 50); // probe hangs…
    controller.pointerup(); // …gesture over before it resolves
    release(); // late "opaque" answer arrives
    await settle();
    controller.pointermove(200, 200);
    expect(runtime.calls).toEqual([]); // never armed → no drag
  });

  it('pointerdown while already dragging cannot re-arm or interrupt the drag', async () => {
    const { controller } = makeController();
    controller.pointerdown(50, 50);
    await settle();
    controller.pointermove(90, 50);
    controller.pointerdown(60, 60); // second finger / spurious down mid-drag
    await settle();
    expect(controller.getLocalState().dragging).toBe(true);
  });

  it('opaque down bumps lastInteractionAt', async () => {
    const { controller, now } = makeController();
    const before = controller.getLocalState().lastInteractionAt;
    now.mockReturnValue(before + 500);
    controller.pointerdown(10, 10);
    await settle();
    expect(controller.getLocalState().lastInteractionAt).toBe(before + 500);
  });
});

describe('attachPointerHandlers', () => {
  it('converts viewport events to stage-relative coordinates', async () => {
    const { controller, stub } = makeController();
    const el = document.createElement('div');
    document.body.appendChild(el);
    // Pin the element at (100, 50) with size 200×200.
    el.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 200, height: 200 }) as DOMRect;

    const detach = attachPointerHandlers(el, controller);
    dispatch(el, 'pointerdown', 150, 90); // stage-relative (50, 40)
    await settle();
    expect(stub.probes[0]).toEqual({ x: 50, y: 40 });

    dispatch(el, 'pointermove', 300, 90); // stage (200, 40) — past threshold
    expect(controller.getLocalState().dragging).toBe(true);
    dispatch(el, 'pointerup', 300, 90);
    expect(controller.getLocalState().dragging).toBe(false);

    detach();
    dispatch(el, 'pointerdown', 150, 90);
    await settle();
    expect(stub.probes.length).toBe(1); // detached — no new probes
  });
});

/** jsdom lacks PointerEvent; the listener only reads clientX/Y. */
function dispatch(el: HTMLElement, type: string, clientX: number, clientY: number): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  el.dispatchEvent(event);
}
