/**
 * Initial focus and focus return for the card's modal surfaces.
 *
 * Every dialog here closes on Escape via a `keydown` listener on its own panel.
 * That only fires when focus is already inside the panel, and opening a dialog
 * does not move focus on its own — so a dialog opened from the overflow menu
 * left `document.activeElement` on `<body>` and simply ignored Escape.
 *
 * Focusing the panel fixes three things at once: Escape reaches the handler,
 * screen readers announce the dialog, and because the panel carries
 * `tabindex="-1"` a click on non-focusable content inside it keeps focus in the
 * dialog rather than dropping back to the body.
 */

/** The genuinely focused element, following `activeElement` through shadow roots. */
export function deepActiveElement(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement as HTMLElement;
  }
  return el;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Whether the browser is drawing this element, and would therefore let it take
 * focus.
 *
 * `visibility: hidden` is how this card holds a control in the layout without
 * offering it — the table's row actions are hidden until their row is hovered
 * or focused. `.focus()` on one of those is a silent no-op, so a trap that
 * ended on it would leave focus on its sentinel and never wrap.
 *
 * `checkVisibility` is the browser's own answer and needs a layout to give it.
 * jsdom performs none and does not implement the method; treating everything
 * as drawn there is exactly what a plain `querySelectorAll` would have said.
 */
function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility !== 'function') return true;
  return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true } as CheckVisibilityOptions);
}

/**
 * Every focusable control under `root`, in tab order, descending into the shadow
 * root of any custom element on the way.
 *
 * `querySelectorAll` stops at the first shadow boundary, so on a surface
 * assembled from `hv-*` components it finds only the controls that surface
 * renders itself. A focus trap built on that list picks a first and a last that
 * sit somewhere in the middle of what can actually be reached, and Tab walks
 * straight out of the trap through everything the query could not see.
 *
 * The walk follows the flattened tree, which is the one the tab order is taken
 * from: a host element renders its shadow root in its place, and its light
 * children appear only where a `<slot>` pulls them in. Walking the light
 * children directly instead would collect content that is written but not
 * rendered — the card passes the expanded view's whole empty state to the table
 * as light DOM, and its buttons exist next to every row it is not showing.
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
   * `onOpenerGone` is the caller's answer to a close whose opener no longer
   * exists — a row deleted by the action, a photo removed from under the
   * lightbox. Focus was on the panel that has just been taken out of the
   * document, so the browser drops it on `<body>`: outside the surface still on
   * screen, out of reach of the Escape that would close it, and back at the top
   * of the page for the next Tab. Only the caller knows where focus belongs
   * instead, so it acts rather than naming an element.
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
    const stranded = deepActiveElement();
    if (!stranded || stranded === document.body || !stranded.isConnected) onOpenerGone?.();
  }
}
