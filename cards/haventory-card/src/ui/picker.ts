import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';

/**
 * A trigger and the box it opens, drawn into the host's own template.
 *
 * Every picker in the card is one button that says what is picked, one holder
 * the choices are drawn into while it is open, and the `aria-expanded` /
 * `aria-controls` pair that ties them together. This owns those three and
 * nothing else: what the trigger is dressed in and what goes in the box belong
 * to the host, because `.field-button`, `.control` and `hv-chip toggle` are the
 * host forms' own vocabularies and each box holds a different thing.
 *
 * A controller drawing into the host's own template rather than an element of
 * its own, for those same class rules: they live in the host's stylesheet and
 * do not reach across a shadow boundary. It also keeps the choices inside the
 * host's single update, which is what every one of these surfaces' tests waits
 * on.
 *
 * The holder outlives its contents: `aria-controls` pointing at an element that
 * is not there announces the trigger as controlling nothing, so the box stays
 * and only what is inside comes and goes.
 */

/** What a surface settles once, for the life of the picker. */
export interface PickerOptions {
  /**
   * Run when the box shuts, for a host that keeps state inside it — a filter
   * over the choices, say — and wants it discarded rather than waiting there
   * on the next open.
   */
  onClose?: () => void;
}

/** What the trigger is called and dressed in, per render. */
export interface PickerTrigger {
  /** The classes the host's stylesheet dresses the trigger in. */
  triggerClass: string;
  /** What a harness and the host's own queries locate the trigger by. */
  testid: string;
  /** The trigger's tooltip, where the host has more to say than fits on it. */
  title?: string;
  /** There is nothing to pick, so the box would open on an empty list. */
  disabled?: boolean;
  /** The trigger's contents: the host's own icons, chips and label. */
  trigger: unknown;
  /**
   * The id `aria-controls` names, and the holder's own. Scoped to the host's
   * shadow root, so two forms mounted at once do not collide.
   */
  holderId: string;
}

/** What the holder is called and dressed in, per render. */
export interface PickerHolder {
  /** The same id the trigger points at. */
  holderId: string;
  /** The holder's classes; every host calls it `tree-holder` and sizes its own. */
  holderClass?: string;
}

export class Picker {
  private readonly _host: ReactiveControllerHost;
  private readonly _pickerOpts: PickerOptions;
  private _open = false;

  constructor(host: ReactiveControllerHost, opts: PickerOptions = {}) {
    this._host = host;
    this._pickerOpts = opts;
  }

  /** Whether the box is showing, for a host deciding what Escape takes back. */
  get open(): boolean {
    return this._open;
  }

  close(): void {
    this._set(false);
  }

  protected _set(open: boolean) {
    if (this._open === open) return;
    this._open = open;
    if (!open) this._pickerOpts.onClose?.();
    this._host.requestUpdate();
  }

  /** The trigger on its own, for a host that puts the holder somewhere else. */
  renderTrigger(chrome: PickerTrigger): TemplateResult {
    return html`<button
      class=${chrome.triggerClass}
      data-testid=${chrome.testid}
      title=${ifDefined(chrome.title)}
      ?disabled=${chrome.disabled ?? false}
      aria-expanded=${String(this._open)}
      aria-controls=${chrome.holderId}
      @click=${() => this._set(!this._open)}
    >
      ${chrome.trigger}
    </button>`;
  }

  /**
   * The holder on its own, for the same host. `body` is a function, not a
   * template: a shut picker draws nothing, and building the choices for a box
   * nobody has opened is work every keystroke in the form around it would pay
   * for.
   */
  renderHolder(holder: PickerHolder, body: () => unknown): TemplateResult {
    return html`<div
      class=${holder.holderClass ?? 'tree-holder'}
      id=${holder.holderId}
      ?hidden=${!this._open}
    >
      ${this._open ? body() : null}
    </div>`;
  }

  /**
   * Both, one after the other — the usual case, where the trigger and the box
   * it opens are siblings in the host's own form. A host whose layout puts them
   * in different parents — a chip row with the tree under it — draws the two
   * halves itself.
   */
  render(chrome: PickerTrigger & PickerHolder, body: () => unknown): TemplateResult {
    return html`${this.renderTrigger(chrome)}${this.renderHolder(chrome, body)}`;
  }
}
