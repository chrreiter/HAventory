import { html } from 'lit';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import { Picker } from './picker';
import type { PickerHolder, PickerOptions } from './picker';
import '../components/hv-location-tree';

/**
 * The disclosure around `hv-location-tree`: the shared trigger and holder from
 * `Picker`, plus the rule that picking a location closes it.
 *
 * Four surfaces reach for a location this way — the item editor's field, the
 * filter panel's Where chip, the organize dialog's parent picker and its
 * location merge target — and each wrote the same close-on-pick.
 */

/** What a surface settles once, for the life of the picker. */
export interface LocationPickerOptions extends PickerOptions {
  /**
   * Picking adds to a set rather than finishing the job, so the tree stays open
   * — the filter panel narrows by several locations at once. Clearing the
   * selection is still the pick that finishes it, either way round.
   */
  keepOpenOnSelect?: boolean;
}

export class LocationPicker extends Picker {
  private readonly _opts: LocationPickerOptions;

  constructor(host: ReactiveControllerHost, opts: LocationPickerOptions = {}) {
    super(host, opts);
    this._opts = opts;
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
   * The base's box, listening for the two events a pick arrives as: a row sends
   * `select` and an area heading sends `select-area`, and both bubble out of the
   * tree to here.
   */
  override renderHolder(holder: PickerHolder, tree: () => unknown): TemplateResult {
    return html`<div
      class=${holder.holderClass ?? 'tree-holder'}
      id=${holder.holderId}
      ?hidden=${!this.open}
      @select=${this._onSelect}
      @select-area=${this._onSelect}
    >
      ${this.open ? tree() : null}
    </div>`;
  }
}
