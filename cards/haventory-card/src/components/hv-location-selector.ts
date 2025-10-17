import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Location } from '../store/types';

@customElement('hv-location-selector')
export class HVLocationSelector extends LitElement {
  static styles = css`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
    .panel-wrap { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
    .panel { background: white; color: black; border: 1px solid #ddd; border-radius: 8px; padding: 16px; max-width: 420px; width: calc(100vw - 32px); box-sizing: border-box; }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    ul { list-style: none; padding-left: 12px; max-height: 320px; overflow: auto; }
    li { padding: 2px 0; }
    .node { display: flex; align-items: center; gap: 6px; }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) tree: unknown[] = [];
  @property({ attribute: false }) locations: Location[] | null = null;

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

  private renderList() {
    const list = (this.locations ?? []).filter((l) => {
      const q = this._q.trim().toLowerCase();
      if (!q) return true;
      return (
        (l.name || '').toLowerCase().includes(q) ||
        (l.path?.display_path || '').toLowerCase().includes(q)
      );
    });
    return html`
      <ul aria-label="Location list">
        ${list.map((l) => html`
          <li>
            <label class="node">
              <input type="radio" name="loc" .checked=${this._selectedId === l.id} @change=${() => this._selectedId = l.id} />
              <span>${l.path?.display_path || l.name}</span>
            </label>
          </li>
        `)}
      </ul>
    `;
  }

  render() {
    if (!this.open) return null;
    return html`
      <div class="backdrop" role="presentation" @click=${this.onCancel}></div>
      <div class="panel-wrap" role="none">
        <div class="panel" role="dialog" aria-label="Location selector" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.onCancel(); } }}>
          <div class="row"><input type="search" placeholder="Search" .value=${this._q} @input=${(e: Event) => this._q = (e.target as HTMLInputElement).value} /></div>
          ${this.renderList()}
          <div class="row">
            <label><input type="checkbox" .checked=${this._includeSubtree} @change=${(e: Event) => this._includeSubtree = (e.target as HTMLInputElement).checked} /> Include sublocations</label>
          </div>
          <div class="row" style="justify-content: flex-end; gap: 8px;">
            <button @click=${this.onCancel}>Cancel</button>
            <button @click=${this.onSelect}>Select</button>
          </div>
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
