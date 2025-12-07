import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { nextZBase } from '../utils/zindex';
import type { Item, Location } from '../store/types';

@customElement('hv-item-dialog')
export class HVItemDialog extends LitElement {
  static styles = css`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 10000; }
    .dialog-wrap { position: fixed; inset: 0; display: grid; place-items: center; z-index: 10001; }
    .dialog {
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 16px;
      max-width: 520px;
      width: calc(100vw - 32px);
      box-sizing: border-box;
    }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
    .row label { display: flex; flex-direction: column; gap: 4px; }
    .row input, .row textarea, .row select {
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
    }
    .row input:focus, .row textarea:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    /* Base button styling for all buttons in dialog */
    button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      opacity: 0.9;
    }
    button.btn-danger {
      background: var(--error-color, #db4437);
    }
    .actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; }
    .right-actions { display: flex; gap: 8px; }
    .actions button {
      padding: 8px 16px;
    }
    .banner { padding: 8px 10px; border-radius: 6px; background: var(--error-color, #db4437); color: #fff; margin-bottom: 8px; }
    .location-display {
      flex: 1;
      min-width: 0;
    }
    .location-display input {
      width: 100%;
      box-sizing: border-box;
    }
    .location-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .location-row .location-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .location-row .location-controls input {
      flex: 1;
      min-width: 0;
    }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) item: Item | null = null;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ type: String }) error: string | null = null;

  @state() private _name: string = '';
  @state() private _description: string = '';
  @state() private _quantity: number = 1;
  @state() private _lowStock: number | null = null;
  @state() private _category: string = '';
  @state() private _tags: string = '';
  @state() private _location: string | null = null;
  @state() private _checkedOut: boolean = false;
  @state() private _dueDate: string = '';
  @state() private _validation: string | null = null;
  @state() private _zBase: number | null = null;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('item')) {
      const it = this.item;
      this._name = it?.name ?? '';
      this._description = it?.description ?? '';
      this._quantity = it?.quantity ?? 1;
      this._lowStock = it?.low_stock_threshold ?? null;
      this._category = it?.category ?? '';
      this._tags = (it?.tags ?? []).join(', ');
      this._location = it?.location_id ?? null;
      this._checkedOut = !!it?.checked_out;
      this._dueDate = it?.due_date ?? '';
      this._validation = null;
    }
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
    }
  }

  private onCancel() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    this.open = false;
  }
  private onSave() {
    const name = (this._name || '').trim();
    if (!name) {
      this._validation = 'Name is required.';
      return;
    }
    if (typeof this._quantity !== 'number' || isNaN(this._quantity) || this._quantity < 0) {
      this._validation = 'Quantity must be an integer ≥ 0.';
      return;
    }
    if (this._lowStock !== null && (isNaN(this._lowStock) || this._lowStock < 0)) {
      this._validation = 'Low-stock threshold must be ≥ 0 or empty.';
      return;
    }
    this._validation = null;
    this.dispatchEvent(new CustomEvent('save', {
      detail: {
        name,
        description: this._description || null,
        quantity: this._quantity,
        low_stock_threshold: this._lowStock,
        category: this._category || null,
        tags: this._tags.split(',').map((t) => t.trim()).filter(Boolean),
        location_id: this._location,
        checked_out: this._checkedOut,
        due_date: this._checkedOut ? (this._dueDate || null) : null,
      },
      bubbles: true, composed: true,
    }));
  }

  private onOpenLocationSelector() {
    this.dispatchEvent(new CustomEvent('open-location-selector', { bubbles: true, composed: true }));
  }

  public setLocation(locationId: string | null) {
    this._location = locationId;
  }

  /** Resolve location ID to display path with area prefix, or return placeholder if not found */
  private getLocationDisplayPath(): string {
    if (!this._location) return '';
    if (!this.locations) return this._location;
    const loc = this.locations.find((l) => l.id === this._location);
    if (!loc) return this._location;
    const locationPath = loc.path?.display_path || loc.name || this._location;

    // First try item's effective_area_id (inherited from location hierarchy)
    if (this.item?.effective_area_id && this.areas.length > 0) {
      const area = this.areas.find((a) => a.id === this.item!.effective_area_id);
      if (area) {
        return `${area.name} > ${locationPath}`;
      }
    }
    // Fallback to location's direct area_id
    if (loc.area_id && this.areas.length > 0) {
      const area = this.areas.find((a) => a.id === loc.area_id);
      if (area) {
        return `${area.name} > ${locationPath}`;
      }
    }
    return locationPath;
  }

  private onDelete() {
    if (!this.item) return;
    this.dispatchEvent(new CustomEvent('delete-item', { detail: { itemId: this.item.id, name: this.item.name }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.open) return null;
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 10000};" @click=${this.onCancel}></div>
      <div class="dialog-wrap" role="none" style="z-index: ${(this._zBase ?? 10000) + 1};">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Item dialog" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.onCancel(); } }}>
          ${this._validation ? html`<div class="banner" role="alert">${this._validation}</div>` : null}
          ${this.error ? html`<div class="banner" role="alert">${this.error}</div>` : null}
          <div class="row"><label>Name* <input aria-required="true" type="text" .value=${this._name} @input=${(e: Event) => this._name = (e.target as HTMLInputElement).value} /></label></div>
          <div class="row"><label style="flex:1;">Description <textarea rows="2" style="width:100%; resize:vertical;" .value=${this._description} @input=${(e: Event) => this._description = (e.target as HTMLTextAreaElement).value}></textarea></label></div>
          <div class="row">
            <label>Quantity <input type="number" .value=${String(this._quantity)} @input=${(e: Event) => this._quantity = Number((e.target as HTMLInputElement).value)} /></label>
            <label>Low-stock threshold <input type="number" .value=${this._lowStock ?? ''} @input=${(e: Event) => this._lowStock = (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value)} /></label>
          </div>
          <div class="row"><label>Category <input type="text" .value=${this._category} @input=${(e: Event) => this._category = (e.target as HTMLInputElement).value} /></label></div>
          <div class="row"><label>Tags <input type="text" .value=${this._tags} @input=${(e: Event) => this._tags = (e.target as HTMLInputElement).value} /></label></div>
        <div class="row location-row">
          <span>Location</span>
          <div class="location-controls">
            <input
              type="text"
              placeholder="None"
              readonly
              .value=${this.getLocationDisplayPath()}
              @click=${this.onOpenLocationSelector}
              style="cursor: pointer;"
              aria-label="Location"
            />
            <button @click=${this.onOpenLocationSelector} aria-label="Open location selector">Select…</button>
            ${this._location ? html`<button @click=${() => this._location = null} aria-label="Clear location">Clear</button>` : null}
          </div>
        </div>
          <div class="row">
            <label><input type="checkbox" .checked=${this._checkedOut} @change=${(e: Event) => this._checkedOut = (e.target as HTMLInputElement).checked} /> Checked-out</label>
            <label>Due date <input type="date" .value=${this._dueDate} ?disabled=${!this._checkedOut} @input=${(e: Event) => this._dueDate = (e.target as HTMLInputElement).value} /></label>
          </div>
          <div class="actions">
            <div>
              ${this.item ? html`<button class="btn-danger" @click=${this.onDelete} aria-label="Delete item">Delete…</button>` : null}
            </div>
            <div class="right-actions">
              <button @click=${this.onCancel}>Cancel</button>
              <button @click=${this.onSave} aria-label="Save item">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-item-dialog': HVItemDialog;
  }
}
