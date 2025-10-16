import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('hv-location-selector')
export class HVLocationSelector extends LitElement {
  static styles = css`
    :host { display: none; }
    .panel { background: white; color: black; border: 1px solid #ddd; border-radius: 8px; padding: 16px; max-width: 420px; }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    ul { list-style: none; padding-left: 12px; }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) tree: unknown[] = [];

  @state() private _q: string = '';
  @state() private _includeSubtree: boolean = true;
  @state() private _selectedId: string | null = null;

  private onCancel() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    this.open = false;
  }
  private onSelect() {
    this.dispatchEvent(new CustomEvent('select', {
      detail: { locationId: this._selectedId, includeSubtree: this._includeSubtree },
      bubbles: true, composed: true,
    }));
  }

  render() {
    if (!this.open) return null;
    return html`
      <div class="panel" role="dialog" aria-label="Location selector">
        <div class="row"><input type="search" placeholder="Search" .value=${this._q} @input=${(e: Event) => this._q = (e.target as HTMLInputElement).value} /></div>
        <ul aria-label="Location tree">
          <!-- Tree rendering TBD; skeleton only -->
          <li>Root</li>
        </ul>
        <div class="row">
          <label><input type="checkbox" .checked=${this._includeSubtree} @change=${(e: Event) => this._includeSubtree = (e.target as HTMLInputElement).checked} /> Include sublocations</label>
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px;">
          <button @click=${this.onCancel}>Cancel</button>
          <button @click=${this.onSelect}>Select</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-location-selector': HVLocationSelector;
  }
}
