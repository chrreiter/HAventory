import { LitElement, css, html } from 'lit';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host { display: block; }
  `;

  render() {
    return html`<div>HAventory card placeholder</div>`;
  }
}

customElements.define('haventory-card', HAventoryCard);
