/**
 * Initial focus and focus return for the card's modal surfaces.
 *
 * Every dialog closes on Escape through a `keydown` listener on its own panel,
 * and opening one moves focus nowhere by itself, so the panel takes focus or
 * Escape never reaches it. `tabindex="-1"` on the panel also has screen readers
 * announce the dialog and keeps a click on non-focusable content inside it from
 * dropping focus back to the body.
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
 * Whether focus has been left on nothing.
 *
 * The browser drops focus on `<body>` when the element holding it leaves the
 * document, and from there Escape and the arrow keys reach nothing that is
 * still on screen. Only the surface still standing knows where focus belongs
 * instead, so this reports rather than acts — and a caller must not yank focus
 * from a user who had already moved on somewhere else.
 */
export function focusStranded(): boolean {
  const at = deepActiveElement();
  return !at || at === document.body || !at.isConnected;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Whether the browser is drawing this element, and would let it take focus.
 *
 * `visibility: hidden` holds a control in the layout without offering it — the
 * table's row actions until their row is hovered — and `.focus()` on one is a
 * silent no-op, so a trap ending there never wraps. jsdom lays nothing out and
 * implements no `checkVisibility`; treating everything there as drawn is what a
 * plain `querySelectorAll` says anyway.
 */
function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility !== 'function') return true;
  return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true } as CheckVisibilityOptions);
}

/**
 * Every focusable control under `root`, in tab order, descending into the shadow
 * root of any custom element on the way.
 *
 * `querySelectorAll` stops at the first shadow boundary, so a trap built on it
 * takes a first and a last from the middle of what can be reached, and Tab
 * walks straight out through everything the query could not see. The walk
 * follows the flattened tree, which is where tab order comes from: a host
 * renders its shadow root in its place and its light children appear only where
 * a `<slot>` pulls them in. Walking light children directly collects what is
 * written but not rendered — the card hands the table the expanded view's whole
 * empty state, buttons and all, beside every row it is not showing.
 */
export function deepFocusables(root: ParentNode | null | undefined): HTMLElement[] {
  const found: HTMLElement[] = [];

  function take(el: HTMLElement) {
    // A hidden subtree is not in the tab order, and `hidden` is how this card
    // keeps a collapsed panel's controls out of it.
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
   * Call from `updated()` with the current open state and a getter for the
   * panel. Acts only on the open/close transitions, so re-renders never pull
   * focus away from whatever the user is typing in.
   *
   * `onOpenerGone` answers a close whose opener is gone — a row deleted by the
   * action, a photo removed from under the lightbox. Focus sits on the panel
   * leaving the document, so the browser drops it on `<body>`: outside the
   * surface still on screen and out of reach of its Escape. Only the caller
   * knows where focus belongs instead, so it acts rather than naming an element.
   */
  sync(
    open: boolean,
    panel: () => HTMLElement | null | undefined,
    onOpenerGone?: () => void,
  ): void {
    if (open) {
      if (this._active) return;
      // Where focus came from is read the moment the host says "open", because
      // focus has not moved yet — but the panel may need another update to
      // exist. The lightbox signs its image URL over the connection and draws
      // nothing until that resolves, so its first update has no panel to focus.
      // Staying inactive is what makes the next update try again; treating the
      // surface as focused before it is there leaves it deaf to the Escape
      // bound to its panel, with nowhere to hand focus back to.
      this._returnTo ??= deepActiveElement();
      const el = panel();
      if (!el) return;
      this._active = true;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      return;
    }
    if (!this._active) {
      // Closed before it ever drew: forget the opener rather than returning to
      // a stale one the next time something opens.
      this._returnTo = null;
      return;
    }
    this._active = false;
    const back = this._returnTo;
    this._returnTo = null;
    if (back?.isConnected) {
      back.focus({ preventScroll: true });
      return;
    }
    // Nothing to return to. Rescue focus only if it really was stranded: a
    // close that happened while the user was already somewhere else must not
    // have focus yanked out from under them.
    if (focusStranded()) onOpenerGone?.();
  }
}
