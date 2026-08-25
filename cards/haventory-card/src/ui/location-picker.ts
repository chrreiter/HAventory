import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import '../components/hv-location-tree';

/**
 * The disclosure around `hv-location-tree`: a trigger that says what is picked,
 * a holder the tree is drawn into while it is open, and the rule that picking
 * one closes it.
 *
 * Four surfaces reach for a location this way — the item editor's field, the
 * filter panel's Where chip, the organize dialog's parent picker and its merge
 * target — and each wrote the same button, the same `aria-expanded` /
 * `aria-controls` pair, the same holder and the same close-on-pick. What
 * differs stays with the host: the trigger's classes and its contents, and the
 * tree's own properties, because `.field-button`, `.control` and
 * `hv-chip toggle` are the host forms' own vocabularies and the tree each
 * surface wants is a different tree.
 *
 * A controller drawing into the host's own template rather than an element of
 * its own, for those same class rules: they live in the host's stylesheet and
 * do not reach across a shadow boundary. It also keeps the tree inside the
 * host's single update, which is what every one of these surfaces' tests waits
 * on.
 *
 * The holder outlives the tree: `aria-controls` pointing at an element that is
 * not there announces the trigger as controlling nothing, so the box stays and
 * only its contents come and go.
 */

/** What a surface settles once, for the life of the picker. */
export interface LocationPickerOptions {
  /**
   * Picking adds to a set rather than finishing the job, so the tree stays open
   * — the filter panel narrows by several locations at once. Clearing the
   * selection is still the pick that finishes it, either way round.
   */
  keepOpenOnSelect?: boolean;
}

/** What the trigger and the holder are called and dressed in, per render. */
export interface LocationPickerChrome {
  /** The classes the host's stylesheet dresses the trigger in. */
  triggerClass: string;
  /** What a harness and the host's own queries locate the trigger by. */
  testid: string;
  /** The trigger's tooltip, where the host has more to say than fits on it. */
  title?: string;
  /** The trigger's contents: the host's own icons, chips and label. */
  trigger: unknown;
  /**
   * The id `aria-controls` names, and the holder's own. Scoped to the host's
   * shadow root, so two forms mounted at once do not collide.
   */
  holderId: string;
  /** The holder's classes; every host calls it `tree-holder` and sizes its own. */
  holderClass?: string;
}

export class LocationPicker {
  private readonly _host: ReactiveControllerHost;
  private readonly _opts: LocationPickerOptions;
  private _open = false;

  constructor(host: ReactiveControllerHost, opts: LocationPickerOptions = {}) {
    this._host = host;
    this._opts = opts;
  }

  /** Whether the tree is showing, for a host deciding what Escape takes back. */
  get open(): boolean {
    return this._open;
  }

  close(): void {
    this._set(false);
  }

  private _set(open: boolean) {
    if (this._open === open) return;
    this._open = open;
    this._host.requestUpdate();
  }

  /**
   * A pick closes the tree. An area heads the top level rather than sitting in
   * it, so picking one is a pick too — and it carries no `locationId`, which is
   * the same shape as clearing the selection.
   */
  private _onSelect = (e: Event) => {
    const picked = (e as CustomEvent<{ locationId?: string | null }>).detail?.locationId ?? null;
    if (this._opts.keepOpenOnSelect && picked !== null) return;
    this.close();
  };

  /**
   * `tree` is a function, not a template: a closed picker draws nothing, and
   * building the nodes for a tree nobody has opened is work every keystroke in
   * the form around it would pay for.
   */
  render(chrome: LocationPickerChrome, tree: () => unknown): TemplateResult {
    return html`
      <button
        class=${chrome.triggerClass}
        data-testid=${chrome.testid}
        title=${ifDefined(chrome.title)}
        aria-expanded=${String(this._open)}
        aria-controls=${chrome.holderId}
        @click=${() => this._set(!this._open)}
      >
        ${chrome.trigger}
      </button>
      <div
        class=${chrome.holderClass ?? 'tree-holder'}
        id=${chrome.holderId}
        ?hidden=${!this._open}
        @select=${this._onSelect}
        @select-area=${this._onSelect}
      >
        ${this._open ? tree() : null}
      </div>
    `;
  }
}
