import { LitElement, css, html } from 'lit';
import type { HassLike } from './store/types';
import { Store } from './store/store';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host { display: block; }
  `;

  private store?: Store;

  connectedCallback(): void {
    super.connectedCallback();
    // Initialize only when Home Assistant provides `hass`
    type HassElement = { hass?: HassLike };
    const hassLike: HassLike | undefined = (this as unknown as HassElement).hass;
    if (hassLike) {
      this.store = new Store(hassLike);
      void this.store.init().catch(() => undefined);
    }
  }

  render() {
    return html`<div>HAventory card placeholder</div>`;
  }
}

customElements.define('haventory-card', HAventoryCard);
