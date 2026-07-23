import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { nextZBase } from '../utils/zindex';
import type { DistinctValue, Item } from '../store/types';

/**
 * Dedicated modal for browsing items by tag.
 *
 * Mirrors hv-category-browser: a filterable list of all used tags with item
 * counts (from `haventory/distinct_values`), drilling down to the items
 * carrying the selected tag. Presentational — the container owns the data.
 */
@customElement('hv-tag-browser')
export class HVTagBrowser extends LitElement {
  static styles = css`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
    .panel-wrap { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
    .panel {
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 16px;
      max-width: 460px;
      width: calc(100vw - 32px);
      box-sizing: border-box;
      font: inherit;
    }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .header h2 { font-size: 1.1em; margin: 0; flex: 1; }
    .back {
      background: transparent;
      color: var(--primary-color, #03a9f4);
      border: 1px solid var(--primary-color, #03a9f4);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font: inherit;
    }
    input[type="search"] {
      width: 100%;
      box-sizing: border-box;
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
      font: inherit;
      margin-bottom: 8px;
    }
    input[type="search"]:focus { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -1px; }
    ul { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; }
    li { margin: 0; }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      background: transparent;
      color: inherit;
      border: none;
      border-bottom: 1px solid var(--divider-color, #eee);
      padding: 8px 6px;
      cursor: pointer;
      font: inherit;
    }
    .row:hover, .row:focus-visible {
      background: var(--secondary-background-color, #f5f5f5);
      outline: none;
    }
    .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag-name::before { content: '#'; opacity: 0.6; }
    .count {
      flex: 0 0 auto;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border-radius: 10px;
      padding: 0 8px;
      font-size: 0.85em;
      min-width: 20px;
      text-align: center;
    }
    .qty { flex: 0 0 auto; color: var(--secondary-text-color, #666); }
    .loc { flex: 0 0 auto; color: var(--secondary-text-color, #666); font-size: 0.85em; }
    .empty { padding: 16px 6px; color: var(--secondary-text-color, #666); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .actions button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font: inherit;
    }
    .actions button:hover { opacity: 0.9; }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) tags: DistinctValue[] = [];
  @property({ type: String }) selectedTag: string | null = null;
  @property({ attribute: false }) items: Item[] = [];
  @property({ type: Boolean }) loading: boolean = false;

  @state() private _filter: string = '';
  @state() private _zBase: number | null = null;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this._filter = '';
    }
  }

  private _emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private _onCancel = () => {
    this._emit('cancel');
    this.open = false;
  };

  private _onBack = () => {
    this._emit('clear-tag');
  };

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.selectedTag !== null) this._onBack();
    else this._onCancel();
  };

  private _filteredTags(): DistinctValue[] {
    const q = this._filter.trim().toLowerCase();
    if (!q) return this.tags;
    return this.tags.filter((t) => t.value.toLowerCase().includes(q));
  }

  private _locationLabel(item: Item): string {
    return item.location_path?.display_path || '';
  }

  private _renderTagList() {
    const tags = this._filteredTags();
    return html`
      <input
        type="search"
        placeholder="Filter tags…"
        data-testid="tag-filter"
        aria-label="Filter tags"
        .value=${this._filter}
        @input=${(e: Event) => { this._filter = (e.target as HTMLInputElement).value; }}
      />
      ${this.tags.length === 0
        ? html`<div class="empty" data-testid="browser-empty">No tags yet.</div>`
        : tags.length === 0
          ? html`<div class="empty" data-testid="browser-empty">No matching tags.</div>`
          : html`
            <ul data-testid="tag-list" role="listbox" aria-label="Tags">
              ${tags.map((t) => html`
                <li>
                  <button
                    class="row"
                    role="option"
                    data-testid="tag-row"
                    data-value=${t.value}
                    @click=${() => this._emit('select-tag', { tag: t.value })}
                  >
                    <span class="grow tag-name">${t.value}</span>
                    <span class="count" aria-label="${t.count} items">${t.count}</span>
                  </button>
                </li>
              `)}
            </ul>
          `}
    `;
  }

  private _renderItemList() {
    if (this.loading) {
      return html`<div class="empty" data-testid="browser-loading">Loading…</div>`;
    }
    if (this.items.length === 0) {
      return html`<div class="empty" data-testid="browser-empty">No items with this tag.</div>`;
    }
    return html`
      <ul data-testid="item-list">
        ${this.items.map((it) => html`
          <li>
            <button
              class="row"
              data-testid="item-row"
              data-item-id=${it.id}
              @click=${() => this._emit('open-item', { itemId: it.id })}
            >
              <span class="grow">${it.name}</span>
              <span class="qty">×${it.quantity}</span>
              ${this._locationLabel(it) ? html`<span class="loc">${this._locationLabel(it)}</span>` : null}
            </button>
          </li>
        `)}
      </ul>
    `;
  }

  render() {
    if (!this.open) return null;
    const drilled = this.selectedTag !== null;
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 9998};" @click=${this._onCancel}></div>
      <div class="panel-wrap" role="none" style="z-index: ${(this._zBase ?? 9998) + 1};">
        <div class="panel" role="dialog" aria-modal="true" aria-label="Tag browser" @keydown=${this._onKeydown}>
          <div class="header">
            ${drilled
              ? html`<button class="back" data-testid="browser-back" @click=${this._onBack} aria-label="Back to tags">‹ Tags</button>`
              : null}
            <h2>${drilled ? `#${this.selectedTag}` : 'Browse by tag'}</h2>
          </div>
          ${drilled ? this._renderItemList() : this._renderTagList()}
          <div class="actions">
            <button data-testid="browser-close" @click=${this._onCancel}>Close</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-tag-browser': HVTagBrowser;
  }
}
