import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';

/**
 * A trigger button, the holder it opens and the `aria-expanded` /
 * `aria-controls` pair between them, drawn into the host's own template so the
 * host's stylesheet dresses both. The holder stays in the DOM while shut, so
 * `aria-controls` always names an element.
 */

export interface PickerOptions {
  /** Run when the box shuts, for a host that discards state kept inside it. */
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
  /** The id `aria-controls` names, scoped to the host's shadow root. */
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

  /** The holder on its own. `body` is a function so a shut picker builds nothing. */
  renderHolder(holder: PickerHolder, body: () => unknown): TemplateResult {
    return html`<div
      class=${holder.holderClass ?? 'tree-holder'}
      id=${holder.holderId}
      ?hidden=${!this._open}
    >
      ${this._open ? body() : null}
    </div>`;
  }

  /** Trigger and holder as siblings, the usual case. */
  render(chrome: PickerTrigger & PickerHolder, body: () => unknown): TemplateResult {
    return html`${this.renderTrigger(chrome)}${this.renderHolder(chrome, body)}`;
  }
}
