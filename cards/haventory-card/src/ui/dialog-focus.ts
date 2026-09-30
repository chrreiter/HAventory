/**
 * Initial focus and focus return for the card's modal surfaces. Each dialog's
 * Escape listener is on its panel, so the panel takes focus (`tabindex="-1"`)
 * or Escape never reaches it.
 */

/** The genuinely focused element, following `activeElement` through shadow roots. */
export function deepActiveElement(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement as HTMLElement;
  }
  return el;
}

/**
 * Whether focus was dropped on `<body>` or on an element that left the document.
 * Reports rather than acts: only the surface still standing knows where it belongs.
 */
export function focusStranded(): boolean {
  const at = deepActiveElement();
  return !at || at === document.body || !at.isConnected;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Whether the browser draws this element: `.focus()` on a `visibility: hidden`
 * control is a silent no-op. jsdom has no `checkVisibility`, so there all count.
 */
function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility !== 'function') return true;
  return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true } as CheckVisibilityOptions);
}

/**
 * Every focusable control under `root`, in tab order. `querySelectorAll` stops
 * at shadow boundaries, so this walks the flattened tree: a host's shadow root
 * in its place, and light children only where a `<slot>` renders them.
 */
export function deepFocusables(root: ParentNode | null | undefined): HTMLElement[] {
  const found: HTMLElement[] = [];

  function take(el: HTMLElement) {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return;
    if (!isRendered(el)) return;
    if (el.matches(FOCUSABLE) && !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1') {
      found.push(el);
    }
    visit(el.shadowRoot ?? el);
  }

  function visit(node: ParentNode) {
    for (const el of Array.from(node.children) as HTMLElement[]) {
      if (el.localName === 'slot') {
        for (const assigned of (el as HTMLSlotElement).assignedElements({ flatten: true })) {
          take(assigned as HTMLElement);
        }
      } else {
        take(el);
      }
    }
  }

  if (root) visit(root);
  return found;
}

export class DialogFocus {
  /** Where focus came from; also marks "we are currently open". */
  private _returnTo: HTMLElement | null = null;
  private _active = false;

  /**
   * Call from `updated()`; acts only on open/close transitions, so re-renders
   * never pull focus. `onOpenerGone` handles a close whose opener cannot take
   * focus back (deleted, or not drawn) and left it stranded.
   */
  sync(
    open: boolean,
    panel: () => HTMLElement | null | undefined,
    onOpenerGone?: () => void,
  ): void {
    if (open) {
      if (this._active) return;
      // The opener is read before focus moves; the panel may only exist on a
      // later update (the lightbox waits on a signed URL), so stay inactive
      // until it does.
      this._returnTo ??= deepActiveElement();
      const el = panel();
      if (!el) return;
      this._active = true;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      return;
    }
    if (!this._active) {
      // Closed before it ever drew: forget the opener.
      this._returnTo = null;
      return;
    }
    this._active = false;
    const back = this._returnTo;
    this._returnTo = null;
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      // A hover-revealed opener can be hidden again and silently refuse focus.
      if (deepActiveElement() === back) return;
    }
    // Rescue only a stranded focus, never one the user moved elsewhere.
    if (focusStranded()) onOpenerGone?.();
  }
}
