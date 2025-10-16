import { LitElement, css, html } from 'lit';
import type { HassLike } from './store/types';
import { Store } from './store/store';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host { display: block; }
  `;

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
      void this.store.init().catch(() => undefined);
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If hass was already set before connectedCallback ran, ensure subscription exists
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._storeUnsub) {
      this._storeUnsub();
      this._storeUnsub = undefined;
    }
  }

  render() {
    return html`<div>HAventory card placeholder</div>`;
  }
}

customElements.define('haventory-card', HAventoryCard);
