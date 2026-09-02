/**
 * src/interact/menu.ts — D12's context menu, plugin-drawn DOM (no native
 * menu is reachable from a renderer, and the window is `focusable:false`,
 * so the menu is click-driven, not focus-driven). Four verbs: feed / play /
 * switch character / exit Elftia.
 *
 * Capture discipline (D12): opening the menu or holding a drag asserts
 * `setPointerCapture(true)` so a host cursor-poll tick at a rect boundary
 * cannot yank input mid-gesture; closing releases it (`false`). Capture is
 * never asserted idly — that would defeat click-through, the entire point
 * of the transparent window. Tests pin the open/close pairing exactly.
 */
import type { MenuStrings } from './locale';

/** The host surface the menu touches (both verbs are petRuntime's). */
export interface MenuPetRuntime {
  setPointerCapture(inside: boolean): void;
  requestAppExit(): void;
}

export interface MenuActions {
  onFeed(): void;
  onPlay(): void;
  onSwitchCharacter(): void;
}

export interface OpenMenuOptions {
  readonly strings: MenuStrings;
  /** Feed / play / switch-character verbs; exit is the petRuntime verb. */
  readonly actions: MenuActions;
  /** Viewport coordinates (from the contextmenu event). */
  readonly x: number;
  readonly y: number;
  readonly petRuntime?: MenuPetRuntime;
  readonly documentRef?: Document;
}

/** One optional late-arriving menu action (`pet-2d-quick-chat-launcher`). */
export interface MenuOptionalAction {
  readonly key: string;
  readonly label: string;
  readonly run: () => void;
}

export interface MenuHandle {
  close(): void;
  /** The menu's root element (tests assert removal/content). */
  readonly element: HTMLElement;
  /**
   * Insert an optional action before Exit. Availability probes are async, so
   * the item typically arrives AFTER the menu opened: a closed or superseded
   * menu ignores the offer (a stale probe must never mutate the CURRENT
   * menu), a duplicate offer is ignored, and the viewport clamp is refit for
   * the grown menu. The four core actions never wait for this.
   */
  offerOptionalAction(action: MenuOptionalAction): void;
}

const MENU_STYLE_ID = 'pet-2d-menu-styles';
const MENU_CSS = `
.pet-2d-menu { position: fixed; z-index: 2147483647; min-width: 148px; padding: 4px 0;
  background: rgba(31, 41, 51, 0.97); border: 1px solid rgba(154, 165, 177, 0.35);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font: 13px/1.4 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; color: #e6e9ec; }
.pet-2d-menu button { display: block; width: 100%; padding: 7px 14px; border: 0;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pet-2d-menu button:hover, .pet-2d-menu button:focus-visible { background: rgba(90, 130, 200, 0.35); }
.pet-2d-menu button:last-child { color: #ff9a9a; border-radius: 0 0 10px 10px; }
`;

function ensureMenuStyles(documentRef: Document): void {
  if (documentRef.getElementById(MENU_STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = MENU_STYLE_ID;
  style.textContent = MENU_CSS;
  documentRef.head.appendChild(style);
}

/** One menu button: role=menuitem, action-keyed for tests/drivers, click = close+run. */
function buildMenuButton(
  doc: Document,
  item: { key: string; label: string; run: () => void },
  close: () => void
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.dataset.petMenuAction = item.key;
  button.textContent = item.label;
  button.addEventListener('click', () => {
    close();
    item.run();
  });
  return button;
}

/**
 * Opens the menu. Exactly one menu is meant to be open at a time — the
 * caller (pet.ts) closes any previous handle before opening a new one; this
 * module stays global-state-free so tests never fight leftover DOM.
 */
export function openContextMenu(options: OpenMenuOptions): MenuHandle {
  const doc = options.documentRef ?? document;
  ensureMenuStyles(doc);

  const menu = doc.createElement('div');
  menu.className = 'pet-2d-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', options.strings.menuLabel);

  const items: ReadonlyArray<{ key: string; label: string; run: () => void }> = [
    { key: 'feed', label: options.strings.feed, run: options.actions.onFeed },
    { key: 'play', label: options.strings.play, run: options.actions.onPlay },
    { key: 'switch', label: options.strings.switchCharacter, run: options.actions.onSwitchCharacter },
    { key: 'exit', label: options.strings.exitApp, run: () => options.petRuntime?.requestAppExit() },
  ];
  for (const item of items) {
    menu.appendChild(buildMenuButton(doc, item, close));
  }

  // Keep the menu inside the viewport (contextmenu fires near an edge when
  // the pet is dragged there). Refit-able: a late optional action grows the
  // menu and re-runs the same clamp.
  let itemCount = items.length;
  function fitToViewport(): void {
    const widthGuess = 170;
    const heightGuess = itemCount * 32 + 8;
    const maxX = Math.max(0, doc.defaultView?.innerWidth ?? 0) - widthGuess;
    const maxY = Math.max(0, doc.defaultView?.innerHeight ?? 0) - heightGuess;
    const x = Math.min(Math.max(options.x, 0), Math.max(maxX, 0));
    const y = Math.min(Math.max(options.y, 0), Math.max(maxY, 0));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }
  fitToViewport();

  function offerOptionalAction(action: MenuOptionalAction): void {
    if (closed || menu.querySelector(`[data-pet-menu-action="${action.key}"]`)) return;
    const buttons = menu.querySelectorAll('button');
    const exitButton = buttons[buttons.length - 1]; // Exit stays last by design
    const button = buildMenuButton(doc, action, close);
    if (exitButton?.dataset.petMenuAction === 'exit') {
      menu.insertBefore(button, exitButton);
    } else {
      menu.appendChild(button);
    }
    itemCount += 1;
    fitToViewport();
  }

  let closed = false;
  const onOutsideDown = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close();
  };

  function close(): void {
    if (closed) return;
    closed = true;
    doc.removeEventListener('pointerdown', onOutsideDown, true);
    menu.remove();
    options.petRuntime?.setPointerCapture(false); // ALWAYS paired with the open assert
  }

  doc.addEventListener('pointerdown', onOutsideDown, true);
  doc.body.appendChild(menu);
  options.petRuntime?.setPointerCapture(true); // asserted while the menu is open (D12)

  return {
    close,
    element: menu,
    offerOptionalAction,
  };
}

/**
 * The contextmenu wiring: hit-testing is the CALLER's concern (it owns the
 * render context); this attaches the listener that asks before opening.
 */
export function attachContextMenu(
  el: HTMLElement,
  shouldOpen: (stageX: number, stageY: number) => Promise<boolean>,
  open: (viewportX: number, viewportY: number) => MenuHandle
): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const stageX = event.clientX - rect.left;
    const stageY = event.clientY - rect.top;
    void shouldOpen(stageX, stageY).then((opaque) => {
      if (opaque) open(event.clientX, event.clientY);
    });
  };
  el.addEventListener('contextmenu', onContextMenu);
  return () => el.removeEventListener('contextmenu', onContextMenu);
}
