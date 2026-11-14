import { html } from 'lit';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import { Picker } from './picker';
import type { PickerHolder, PickerOptions } from './picker';
import type { HvEvent } from '../events';
import '../components/hv-location-tree';

/** The disclosure around `hv-location-tree`: `Picker`'s trigger and holder, closed by a pick. */
export interface LocationPickerOptions extends PickerOptions {
  /** A pick adds to a set and leaves the tree open; clearing still closes it. */
  keepOpenOnSelect?: boolean;
}

export class LocationPicker extends Picker {
  private readonly _opts: LocationPickerOptions;

  constructor(host: ReactiveControllerHost, opts: LocationPickerOptions = {}) {
    super(host, opts);
    this._opts = opts;
  }

  /** An area heading's pick carries no `locationId`, the same shape as clearing. */
  private _onSelect = (e: HvEvent<'hv-location-tree', 'select' | 'select-area'>) => {
    const picked = 'locationId' in e.detail ? e.detail.locationId : null;
    if (this._opts.keepOpenOnSelect && picked !== null) return;
    this.close();
  };

  /**
   * A row sends `select` and an area heading `select-area`; both bubble to here. The holder's
   * only content is the tree, so no native `select` from a text field reaches this listener.
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
