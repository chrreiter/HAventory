import { css, html } from 'lit';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { DialogFocus } from './dialog-focus';
import { onEscape } from './keyboard';
import { nextZBase } from '../utils/zindex';

/**
 * The chrome every centred dialog is drawn in: backdrop, centring layer, panel.
 * `modalSheet` restyles `.wrap` and `.panel`, so a host must keep those names.
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
 * The phone form of a centred dialog: a bottom sheet, like every other phone
 * surface. A restyle rather than an `hv-bottom-sheet` wrapper, so `Modal` keeps
 * the focus, Escape and stacking; separate because the organize dialog, a
 * full-bleed page on a phone, takes the chrome without it.
 */
export const modalSheet = css`
  :host([mobile]) .wrap {
    padding: 0;
    place-items: end stretch;
  }
  :host([mobile]) .panel {
    width: 100%;
    max-width: none;
    /* dvh: vh ignores the browser chrome and could push actions under the URL bar. */
    max-height: 92dvh;
    border-radius: var(--hv-radius-sheet) var(--hv-radius-sheet) 0 0;
    box-shadow: var(--hv-shadow-sheet);
    /* Clears the home indicator, with a thumb's air where there is none. */
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
   * Every dismissal calls this, and it reports rather than closes: the host
   * binds `open`, and Lit would never write back a value it thinks unchanged.
   */
  onClose: () => void;
  /** `alertdialog` where the dialog is a question the user has to settle. */
  role?: 'dialog' | 'alertdialog';
}

export interface ModalHostOptions {
  /** Whether the dialog is on screen. Read on every update. */
  open: () => boolean;
  /** The control that takes the caret on open; omitted, focus stays on the panel. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Where stranded focus goes when the opener cannot take it back; see `DialogFocus.sync`. */
  onOpenerGone?: () => void;
}

/**
 * The modal plumbing shared by the centred dialogs: one stacking base per
 * opening, focus in and back out, and Escape. A dialog declares it once and
 * calls `render` from its `render()`.
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

  /** Claim a stacking base on opening, so the last surface raised sits on top. */
  hostUpdate(): void {
    const open = this._opts.open();
    if (open && !this._wasOpen) this._z = nextZBase();
    this._wasOpen = open;
  }

  hostUpdated(): void {
    const open = this._opts.open();
    this._focus.sync(open, () => this._panel, () => this._opts.onOpenerGone?.());
    if (!open) {
      this._landed = false;
      return;
    }
    // The panel can arrive a render after `open`; wait for it.
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
