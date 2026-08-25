import { css, html } from 'lit';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { DialogFocus } from './dialog-focus';
import { onEscape } from './keyboard';
import { nextZBase } from '../utils/zindex';

/**
 * The chrome every centred dialog in the card is drawn in: a backdrop, a
 * centring layer, and the box itself.
 *
 * A dialog supplies its own body, its width and whatever height rules it needs;
 * everything else is here. `.wrap` and `.panel` are the class names the mobile
 * restyle below reaches for, so a host that renames them loses its phone form.
 */
export const modalChrome = css`
  :host {
    display: block;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
  }
  .wrap {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
  }
  .panel {
    width: 330px;
    max-width: 100%;
    box-sizing: border-box;
    background: var(--hv-surface);
    color: var(--hv-text);
    border-radius: var(--hv-radius-dialog);
    box-shadow: var(--hv-shadow-dialog);
    overflow: hidden;
  }
`;

/**
 * The phone presentation of a centred dialog.
 *
 * A centred 330–500px box is a desktop shape. At 390px it leaves a strip of
 * page either side of a dialog that is effectively full width anyway, and it
 * arrives from the middle of the screen while the filter panel, the detail
 * sheet and the ⋮ menu all rise from the bottom edge — the same interaction
 * with two different manners. Under `mobile` a dialog takes the bottom-sheet
 * form instead, so one gesture vocabulary covers every surface on a phone.
 *
 * A restyle of `.wrap` and `.panel` rather than a wrapping `hv-bottom-sheet`:
 * moving the content into a slot would rebuild the focus handling, the Escape
 * binding and the stacking base `Modal` already owns, for a change that is
 * presentational. Separate from `modalChrome` because a dialog that is a
 * full-bleed page on a phone — the organize dialog — takes the chrome without
 * it.
 */
export const modalSheet = css`
  :host([mobile]) .wrap {
    padding: 0;
    /* Stretched across the bottom edge, not centred in the middle of it. */
    place-items: end stretch;
  }
  :host([mobile]) .panel {
    width: 100%;
    max-width: none;
    /* dvh, not vh: on a phone vh resolves against the viewport with the browser
       chrome retracted, so a tall sheet could stand higher than the screen
       actually showing and push its actions under the URL bar. */
    max-height: 92dvh;
    border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
    box-shadow: var(--hv-shadow-sheet);
    /* Clears the home indicator on a phone that reports one, and gives the
       bottom row of actions a thumb's worth of air on one that does not. */
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    animation: hv-sheet-rise var(--hv-motion-sheet) var(--hv-ease-out);
  }
  :host([mobile]) .backdrop {
    background: var(--hv-scrim);
  }
  @keyframes hv-sheet-rise {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
`;

/** What a dialog tells the chrome about itself, per render. */
export interface ModalOptions {
  /** Accessible name for the dialog. */
  label: string;
  /** The panel's `data-testid`, which is what a harness locates it by. */
  testid: string;
  /**
   * The one way out. Every dismissal — the backdrop, Escape, a Cancel button —
   * calls this, and it reports rather than closes: a dialog never writes its own
   * `open`, because the host binds that property from its own state. Lit
   * compares against the value it last committed, sees no change, and never
   * writes the property back, so a host with a question to ask first could only
   * put the dialog up again by writing behind the binding's back.
   */
  onClose: () => void;
  /** `alertdialog` where the dialog is a question the user has to settle. */
  role?: 'dialog' | 'alertdialog';
}

/** What the chrome needs from the element hosting it, for that element's life. */
export interface ModalHostOptions {
  /** Whether the dialog is on screen. Read on every update. */
  open: () => boolean;
  /**
   * The control that takes the caret when the dialog opens, where landing on the
   * panel is not enough — a confirmation puts it on the accepting button so
   * Enter completes and Escape aborts. Omitted, focus stays on the panel.
   */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * The modal plumbing shared by the card's centred dialogs: one stacking base
 * per opening, focus into the dialog and back out again, and Escape.
 *
 * A controller rather than a plain function because two of the three are state
 * that outlives a render — where focus came from, and which pair of z-indexes
 * this opening claimed. It hangs on the host's own update cycle, so a dialog
 * declares it once and calls `render` from its `render()`.
 */
export class Modal implements ReactiveController {
  private readonly _opts: ModalHostOptions;
  private readonly _focus = new DialogFocus();
  private _panel: HTMLElement | null = null;
  /** The backdrop's z-index; the panel takes the next one up. */
  private _z = 0;
  private _wasOpen = false;
  /** Whether this opening has already placed the caret. */
  private _landed = false;

  constructor(host: ReactiveControllerHost, opts: ModalHostOptions) {
    this._opts = opts;
    host.addController(this);
  }

  /**
   * Claim a stacking base as the dialog opens, so the last surface raised sits
   * over the one that raised it — a confirmation over the sheet that asked for
   * it. Before the render that first draws the panel, which is where the pair
   * of numbers is needed.
   */
  hostUpdate(): void {
    const open = this._opts.open();
    if (open && !this._wasOpen) this._z = nextZBase();
    this._wasOpen = open;
  }

  hostUpdated(): void {
    const open = this._opts.open();
    this._focus.sync(open, () => this._panel);
    if (!open) {
      this._landed = false;
      return;
    }
    // The panel can arrive a render later than `open` — the lightbox signs its
    // URL first — and `DialogFocus` waits for it. So does this, or the caret is
    // aimed at a dialog that has not been drawn yet.
    if (this._landed || !this._panel) return;
    this._landed = true;
    this._opts.initialFocus?.()?.focus({ preventScroll: true });
  }

  /** Where the Escape binding and the returning focus land. */
  private _capture = (el?: Element) => {
    this._panel = (el as HTMLElement | undefined) ?? null;
  };

  render(opts: ModalOptions, body: unknown): TemplateResult {
    const z = this._z;
    return html`
      <div class="backdrop" role="presentation" style="z-index:${z}" @click=${opts.onClose}></div>
      <div class="wrap" role="none" style="z-index:${z + 1}">
        <div
          class="panel"
          role=${opts.role ?? 'dialog'}
          aria-modal="true"
          aria-label=${opts.label}
          data-testid=${opts.testid}
          ${ref(this._capture)}
          @keydown=${onEscape(opts.onClose)}
        >
          ${body}
        </div>
      </div>
    `;
  }
}
