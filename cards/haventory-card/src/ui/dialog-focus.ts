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

export class DialogFocus {
  /** Where focus came from; also marks "we are currently open". */
  private _returnTo: HTMLElement | null = null;
  private _active = false;

  /**
   * Call from `updated()` with the current open state and a getter for the
   * panel. Acts only on the open/close transitions, so re-renders never pull
   * focus away from whatever the user is typing in.
   */
  sync(open: boolean, panel: () => HTMLElement | null | undefined): void {
    if (open && !this._active) {
      this._active = true;
      this._returnTo = deepActiveElement();
      const el = panel();
      if (el) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      }
      return;
    }
    if (!open && this._active) {
      this._active = false;
      const back = this._returnTo;
      this._returnTo = null;
      // The opener can be gone by now (a row that the action deleted).
      if (back?.isConnected) back.focus({ preventScroll: true });
    }
  }
}
