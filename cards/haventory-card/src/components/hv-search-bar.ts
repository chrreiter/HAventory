import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Sort } from '../store/types';
import { DEFAULT_SORT, getDefaultOrderFor } from '../store/sort';
import { debounce } from '../utils/debounce';

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
    :host {
      display: block;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    input[type="search"],
    select {
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 6px 8px;
      font: inherit;
      box-sizing: border-box;
    }
    input[type="search"] {
      flex: 1 1 220px;
    }
    select {
      min-width: 140px;
    }
    input[type="search"]:focus,
    select:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    label { display: inline-flex; align-items: center; gap: 6px; }
    .sort-wrap { display: inline-flex; align-items: center; gap: 6px; }
    button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
    }
    button:hover {
      opacity: 0.9;
    }
  `;

  @property({ type: String }) q: string = '';
  @property({ type: String }) areaId: string | null = null;
  @property({ type: String }) locationId: string | null = null;
  @property({ type: Boolean }) includeSubtree: boolean = true;
  @property({ type: Boolean }) checkedOutOnly: boolean = false;
  @property({ type: Boolean }) lowStockFirst: boolean = false;
  @property({ attribute: false }) sort: Sort = DEFAULT_SORT;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ attribute: false }) locations: Array<{ id: string; name: string; area_id?: string | null; parent_id?: string | null; path?: { display_path: string } }> = [];

  /** Get effective area by walking up location hierarchy */
  private _getEffectiveAreaId(loc: { area_id?: string | null; parent_id?: string | null }): string | null {
    if (loc.area_id) return loc.area_id;
    let parentId = loc.parent_id;
    while (parentId) {
      const parent = this.locations.find((l) => l.id === parentId);
      if (!parent) break;
      if (parent.area_id) return parent.area_id;
      parentId = parent.parent_id;
    }
    return null;
  }

  private _getAreaName(areaId: string | null): string | null {
    if (!areaId) return null;
    const area = this.areas.find((a) => a.id === areaId);
    return area?.name ?? null;
  }

  private _getLocationDisplayWithArea(loc: { id: string; name: string; area_id?: string | null; parent_id?: string | null; path?: { display_path: string } }): string {
    const effectiveAreaId = this._getEffectiveAreaId(loc);
    const areaName = this._getAreaName(effectiveAreaId);
    const locationPath = loc.path?.display_path || loc.name;
    return areaName ? `${areaName} > ${locationPath}` : locationPath;
  }

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
    const order = getDefaultOrderFor(value);
    this.sort = { field: value, order };
    this.emitChange({ sort: this.sort });
  }

  private onSortOrderToggle() {
    const current = this.sort ?? DEFAULT_SORT;
    const nextOrder = current.order === 'asc' ? 'desc' : 'asc';
    this.sort = { field: current.field, order: nextOrder };
    this.emitChange({ sort: this.sort });
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

        <select @change=${this.onAreaChange} aria-label="Area" .value=${this.areaId ?? ''}>
          <option value="">Area: All</option>
          ${this.areas.map((a) => html`<option value=${a.id} ?selected=${this.areaId === a.id}>${a.name}</option>`)}
        </select>

        <select @change=${this.onLocationChange} aria-label="Location" .value=${this.locationId ?? ''}>
          <option value="">Location: All</option>
          ${this.locations.map((l) => html`<option value=${l.id} ?selected=${this.locationId === l.id}>${this._getLocationDisplayWithArea(l)}</option>`)}
        </select>

        <label><input type="checkbox" .checked=${this.includeSubtree} @change=${this.onIncludeSubtreeChange} /> Include sublocations</label>
        <label><input type="checkbox" .checked=${this.checkedOutOnly} @change=${this.onCheckedOutChange} /> Checked-out only</label>
        <label><input type="checkbox" .checked=${this.lowStockFirst} @change=${this.onLowStockChange} /> Low-stock first</label>

        <span class="sort-wrap">
          <select @change=${this.onSortChange} aria-label="Sort">
            <option value="name" ?selected=${(this.sort?.field ?? 'updated_at') === 'name'}>Sort: Name</option>
            <option value="updated_at" ?selected=${(this.sort?.field ?? 'updated_at') === 'updated_at'}>Sort: Updated</option>
            <option value="created_at" ?selected=${this.sort?.field === 'created_at'}>Sort: Created</option>
            <option value="quantity" ?selected=${this.sort?.field === 'quantity'}>Sort: Quantity</option>
          </select>
          <button
            type="button"
            data-testid="sort-order-toggle"
            @click=${this.onSortOrderToggle}
            aria-label=${this.sort?.order === 'asc' ? 'Ascending' : 'Descending'}
            title=${this.sort?.order === 'asc' ? 'Ascending' : 'Descending'}
          >${this.sort?.order === 'asc' ? 'A→Z' : 'Z→A'}</button>
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-search-bar': HVSearchBar;
  }
}
