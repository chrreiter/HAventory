import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Item } from '../store/types';

@customElement('hv-item-dialog')
export class HVItemDialog extends LitElement {
  static styles = css`
    :host { display: none; }
    .dialog { background: white; color: black; border: 1px solid #ddd; border-radius: 8px; padding: 16px; max-width: 520px; }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) item: Item | null = null;

  @state() private _name: string = '';
  @state() private _quantity: number = 1;
  @state() private _lowStock: number | null = null;
  @state() private _category: string = '';
  @state() private _tags: string = '';
  @state() private _location: string | null = null;
  @state() private _checkedOut: boolean = false;
  @state() private _dueDate: string = '';

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('item')) {
      const it = this.item;
      this._name = it?.name ?? '';
      this._quantity = it?.quantity ?? 1;
      this._lowStock = it?.low_stock_threshold ?? null;
      this._category = it?.category ?? '';
      this._tags = (it?.tags ?? []).join(', ');
      this._location = it?.location_id ?? null;
      this._checkedOut = !!it?.checked_out;
      this._dueDate = it?.due_date ?? '';
    }
  }

  private onCancel() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    this.open = false;
  }
  private onSave() {
    this.dispatchEvent(new CustomEvent('save', {
      detail: {
        name: this._name,
        quantity: this._quantity,
        low_stock_threshold: this._lowStock,
        category: this._category,
        tags: this._tags.split(',').map((t) => t.trim()).filter(Boolean),
        location_id: this._location,
        checked_out: this._checkedOut,
        due_date: this._checkedOut ? (this._dueDate || null) : null,
      },
      bubbles: true, composed: true,
    }));
  }

  render() {
    if (!this.open) return null;
    return html`
      <div class="dialog" role="dialog" aria-label="Item dialog">
        <div class="row"><label>Name* <input type="text" .value=${this._name} @input=${(e: Event) => this._name = (e.target as HTMLInputElement).value} /></label></div>
        <div class="row">
          <label>Quantity <input type="number" .value=${String(this._quantity)} @input=${(e: Event) => this._quantity = Number((e.target as HTMLInputElement).value)} /></label>
          <label>Low-stock threshold <input type="number" .value=${this._lowStock ?? ''} @input=${(e: Event) => this._lowStock = (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value)} /></label>
        </div>
        <div class="row"><label>Category <input type="text" .value=${this._category} @input=${(e: Event) => this._category = (e.target as HTMLInputElement).value} /></label></div>
        <div class="row"><label>Tags <input type="text" .value=${this._tags} @input=${(e: Event) => this._tags = (e.target as HTMLInputElement).value} /></label></div>
        <div class="row"><label>Location <input type="text" placeholder="Select…" .value=${this._location ?? ''} @input=${(e: Event) => this._location = (e.target as HTMLInputElement).value || null} /></label></div>
        <div class="row">
          <label><input type="checkbox" .checked=${this._checkedOut} @change=${(e: Event) => this._checkedOut = (e.target as HTMLInputElement).checked} /> Checked-out</label>
          <label>Due date <input type="date" .value=${this._dueDate} ?disabled=${!this._checkedOut} @input=${(e: Event) => this._dueDate = (e.target as HTMLInputElement).value} /></label>
        </div>
        <div class="actions">
          <button @click=${this.onCancel}>Cancel</button>
          <button @click=${this.onSave}>Save</button>
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
