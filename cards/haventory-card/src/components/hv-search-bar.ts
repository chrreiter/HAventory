import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Sort } from '../store/types';

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export interface SearchBarChangeDetail {
  q?: string;
  areaId?: string | null;
  locationId?: string | null;
  includeSubtree?: boolean;
  checkedOutOnly?: boolean;
  lowStockFirst?: boolean;
  sort?: Sort;
}

@customElement('hv-search-bar')
export class HVSearchBar extends LitElement {
  static styles = css`
    :host { display: block; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    input[type="search"] { flex: 1 1 220px; }
    select { min-width: 140px; }
    label { display: inline-flex; align-items: center; gap: 6px; }
  `;

  @property({ type: String }) q: string = '';
  @property({ type: String }) areaId: string | null = null;
  @property({ type: String }) locationId: string | null = null;
  @property({ type: Boolean }) includeSubtree: boolean = true;
  @property({ type: Boolean }) checkedOutOnly: boolean = false;
  @property({ type: Boolean }) lowStockFirst: boolean = false;
  @property({ attribute: false }) sort: Sort = { field: 'updated_at', order: 'desc' };

  @state() private _qLocal: string = this.q;

  private emitChange(detail: SearchBarChangeDetail) {
    this.dispatchEvent(new CustomEvent<SearchBarChangeDetail>('change', { detail, bubbles: true, composed: true }));
  }

  private emitChangeDebounced = debounce((value: string) => {
    this.emitChange({ q: value });
  }, 200);

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('q')) this._qLocal = this.q;
  }

  private onQInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this._qLocal = value;
    this.emitChangeDebounced(value);
  }

  private onAreaChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value || null;
    this.emitChange({ areaId: value });
  }

  private onLocationChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value || null;
    this.emitChange({ locationId: value });
  }

  private onIncludeSubtreeChange(e: Event) {
    this.emitChange({ includeSubtree: (e.target as HTMLInputElement).checked });
  }

  private onCheckedOutChange(e: Event) {
    this.emitChange({ checkedOutOnly: (e.target as HTMLInputElement).checked });
  }

  private onLowStockChange(e: Event) {
    this.emitChange({ lowStockFirst: (e.target as HTMLInputElement).checked });
  }

  private onSortChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as Sort['field'];
    const order = this.sort?.order ?? 'desc';
    this.emitChange({ sort: { field: value, order } });
  }

  render() {
    return html`
      <div class="row" data-testid="filters-panel" aria-label="Search and filters" role="group">
        <input
          type="search"
          placeholder="Search"
          .value=${this._qLocal}
          @input=${this.onQInput}
          aria-label="Search items"
        />

        <select @change=${this.onAreaChange} aria-label="Area">
          <option value="">Area: All</option>
          <!-- Options populated later -->
        </select>

        <select @change=${this.onLocationChange} aria-label="Location">
          <option value="">Location: Root</option>
          <!-- Options populated later -->
        </select>

        <label><input type="checkbox" .checked=${this.includeSubtree} @change=${this.onIncludeSubtreeChange} /> Include sublocations</label>
        <label><input type="checkbox" .checked=${this.checkedOutOnly} @change=${this.onCheckedOutChange} /> Checked-out only</label>
        <label><input type="checkbox" .checked=${this.lowStockFirst} @change=${this.onLowStockChange} /> Low-stock first</label>

        <select @change=${this.onSortChange} aria-label="Sort">
          <option value="name" ?selected=${(this.sort?.field ?? 'updated_at') === 'name'}>Sort: Name</option>
          <option value="updated_at" ?selected=${(this.sort?.field ?? 'updated_at') === 'updated_at'}>Sort: Updated</option>
          <option value="created_at" ?selected=${this.sort?.field === 'created_at'}>Sort: Created</option>
          <option value="quantity" ?selected=${this.sort?.field === 'quantity'}>Sort: Quantity</option>
        </select>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-search-bar': HVSearchBar;
  }
}
