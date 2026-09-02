/**
 * src/interact/__tests__/menu.test.ts — task 7.6: the D12 context menu —
 * capture assert/release PAIRING (open asserts true, every close path
 * releases), item wiring (feed/play/switch via actions, exit via
 * requestAppExit), outside-click dismissal, and attachContextMenu's
 * hit-test gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { menuStrings } from '../locale';
import { attachContextMenu, type MenuHandle, openContextMenu } from '../menu';

function fakeRuntime() {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      setPointerCapture: (inside: boolean) => calls.push(`capture:${inside}`),
      requestAppExit: () => calls.push('exit'),
    },
  };
}

function makeActions() {
  return {
    onFeed: vi.fn(),
    onPlay: vi.fn(),
    onSwitchCharacter: vi.fn(),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((style) => style.remove());
});

/** QuerySelector that fails loudly instead of non-null-asserting. */
function menuItem(menu: MenuHandle, action: string): HTMLButtonElement {
  const button = menu.element.querySelector<HTMLButtonElement>(`[data-pet-menu-action="${action}"]`);
  if (!button) throw new Error(`menu item "${action}" not found`);
  return button;
}

describe('openContextMenu', () => {
  it('opens asserting capture(true), renders the four verbs in order with the locale strings', () => {
    const { calls, runtime } = fakeRuntime();
    const actions = makeActions();
    const menu = openContextMenu({
      strings: menuStrings('zh'),
      actions,
      x: 10,
      y: 10,
      petRuntime: runtime,
    });

    expect(calls).toEqual(['capture:true']);
    const buttons = [...menu.element.querySelectorAll('button')];
    expect(buttons.map((b) => b.dataset.petMenuAction)).toEqual(['feed', 'play', 'switch', 'exit']);
    expect(buttons.map((b) => b.textContent)).toEqual(['喂食', '玩耍', '换角色', '退出 Elftia']);
    expect(document.body.contains(menu.element)).toBe(true);
    menu.close();
  });

  it('feed click: action fires once, menu removed, capture released exactly once', () => {
    const { calls, runtime } = fakeRuntime();
    const actions = makeActions();
    const menu = openContextMenu({ strings: menuStrings('en'), actions, x: 0, y: 0, petRuntime: runtime });

    menuItem(menu, 'feed').click();

    expect(actions.onFeed).toHaveBeenCalledTimes(1);
    expect(document.body.contains(menu.element)).toBe(false);
    expect(calls).toEqual(['capture:true', 'capture:false']); // the pairing, verbatim
  });

  it('exit click calls requestAppExit (the host verb, not an action)', () => {
    const { calls, runtime } = fakeRuntime();
    const menu = openContextMenu({
      strings: menuStrings('en'),
      actions: makeActions(),
      x: 0,
      y: 0,
      petRuntime: runtime,
    });
    menuItem(menu, 'exit').click();
    // close() runs before the verb (capture released first, then exit).
    expect(calls).toEqual(['capture:true', 'capture:false', 'exit']);
  });

  it('a pointerdown OUTSIDE closes (and releases) without firing any action', () => {
    const { calls, runtime } = fakeRuntime();
    const actions = makeActions();
    const menu = openContextMenu({ strings: menuStrings('en'), actions, x: 0, y: 0, petRuntime: runtime });

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(document.body.contains(menu.element)).toBe(false);
    expect(calls).toEqual(['capture:true', 'capture:false']);
    expect(actions.onFeed).not.toHaveBeenCalled();
  });

  it('close() is idempotent — capture(false) never double-fires', () => {
    const { calls, runtime } = fakeRuntime();
    const menu = openContextMenu({ strings: menuStrings('en'), actions: makeActions(), x: 0, y: 0, petRuntime: runtime });
    menu.close();
    menu.close();
    expect(calls).toEqual(['capture:true', 'capture:false']);
  });

  it('opens without a petRuntime (F5) — no verbs, menu still works', () => {
    const actions = makeActions();
    const menu = openContextMenu({ strings: menuStrings('en'), actions, x: 0, y: 0 });
    menuItem(menu, 'play').click();
    expect(actions.onPlay).toHaveBeenCalledTimes(1);
    expect(document.body.contains(menu.element)).toBe(false);
  });

  it('clamps position into the viewport', () => {
    const menu = openContextMenu({
      strings: menuStrings('en'),
      actions: makeActions(),
      x: 100000,
      y: 100000,
    });
    const left = Number.parseFloat(menu.element.style.left);
    const top = Number.parseFloat(menu.element.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(window.innerHeight);
    menu.close();
  });

  it('offerOptionalAction inserts Quick Chat BEFORE exit, keeps exit last, and runs on click', () => {
    const { runtime } = fakeRuntime();
    const run = vi.fn();
    const menu = openContextMenu({
      strings: menuStrings('zh'),
      actions: makeActions(),
      x: 10,
      y: 10,
      petRuntime: runtime,
    });
    menu.offerOptionalAction({ key: 'quick-chat', label: '快捷聊天', run });
    const order = [...menu.element.querySelectorAll('button')].map((b) => b.dataset.petMenuAction);
    expect(order).toEqual(['feed', 'play', 'switch', 'quick-chat', 'exit']);
    expect(menuItem(menu, 'quick-chat').textContent).toBe('快捷聊天');
    menuItem(menu, 'quick-chat').click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.body.contains(menu.element)).toBe(false);
  });

  it('a duplicate offer and an offer to a CLOSED menu are both no-ops', () => {
    const menu = openContextMenu({
      strings: menuStrings('en'),
      actions: makeActions(),
      x: 0,
      y: 0,
    });
    menu.offerOptionalAction({ key: 'quick-chat', label: 'Quick Chat', run: () => undefined });
    menu.offerOptionalAction({ key: 'quick-chat', label: 'Quick Chat', run: () => undefined });
    expect(menu.element.querySelectorAll('button')).toHaveLength(5);
    menu.close();
    menu.offerOptionalAction({ key: 'quick-chat', label: 'Quick Chat', run: () => undefined });
    expect(document.body.contains(menu.element)).toBe(false); // never recreated
  });

  it('the refit keeps a grown menu inside the viewport', () => {
    const menu = openContextMenu({
      strings: menuStrings('en'),
      actions: makeActions(),
      x: 100000,
      y: 100000,
    });
    menu.offerOptionalAction({ key: 'quick-chat', label: 'Quick Chat', run: () => undefined });
    const top = Number.parseFloat(menu.element.style.top);
    // 5 items * 32px + 8 = 168px tall now; the clamp must still hold.
    expect(top).toBeLessThanOrEqual(window.innerHeight - 168 + 1);
    expect(top).toBeGreaterThanOrEqual(0);
    menu.close();
  });
});

describe('attachContextMenu', () => {
  function contextmenuEvent(el: HTMLElement, clientX: number, clientY: number): Event {
    const event = new Event('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clientX', { value: clientX });
    Object.defineProperty(event, 'clientY', { value: clientY });
    el.dispatchEvent(event);
    return event;
  }

  it('asks the hit test first; opens only on opaque, passing viewport coords', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 256, height: 256 }) as DOMRect;

    const open = vi.fn(
      (x: number, y: number): MenuHandle =>
        openContextMenu({ strings: menuStrings('en'), actions: makeActions(), x, y })
    );
    const detach = attachContextMenu(
      el,
      async (x, y) => x >= 0 && x < 256 && y >= 0 && y < 128, // "top half is opaque"
      open
    );

    const event = contextmenuEvent(el, 120, 100);
    const settle = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(120, 100);
    (open.mock.results[0]?.value as MenuHandle).close();

    contextmenuEvent(el, 120, 200); // transparent half
    await settle();
    expect(open).toHaveBeenCalledTimes(1);

    detach();
  });
});
