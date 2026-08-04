import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { COLUMN_DEFS, normalizeColumns, tableTemplateFor } from '../store/columns';
import { getDefaultOrderFor } from '../store/sort';
import type { AreaRef } from '../store/types';
import type { ColumnKey } from '../store/columns';
import { isLowStock } from './hv-list-row';
import { itemStatus, statusLabel } from '../ui/status';
import { itemPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import type { Item, Sort, SortField } from '../store/types';

/**
 * The full view's table.
 *
 * Only the columns the backend can actually sort by get a clickable header —
 * category, location and tags have no sort field, and a header that looks
 * interactive but does nothing is worse than a plain one.
 */
@customElement('hv-data-table')
export class HVDataTable extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        /* The column template has a hard minimum — 1020px for the default set,
           1060px with the selection column — and a grid whose tracks do not fit
           overflows its own box rather than shrinking. With overflow visible
           that spilled content was simply clipped by the shell: at 375px the
           rows measured clientWidth 634 against scrollWidth 854, and the Tags,
           Due and Updated columns could not be reached by any gesture. The
           table scrolls sideways instead, which keeps whichever columns the
           user chose rather than quietly dropping them on small screens. */
        overflow-x: auto;
        overscroll-behavior-x: contain;
      }
      /* Sizing the two boxes to the grid's own minimum is what makes the
         scroll work: left at the container's width they would stay 375px wide
         while their tracks painted past the edge, so the row dividers and
         hover backgrounds would stop short of the content. Both use the same
         template, so both land on the same width and stay aligned. */
      .head,
      .body {
        min-width: min-content;
      }
      .head,
      .row {
        display: grid;
        gap: 8px;
        align-items: center;
        padding: 10px 20px;
      }
      .head {
        padding: 7px 20px;
        border-bottom: 1px solid var(--hv-divider);
        font-size: 11.5px;
        font-weight: 500;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
        flex: none;
      }
      /* This reset must stay keyed to the sort buttons' own class. Written as
         .head button it also reaches the select-all box, which is a button in
         this header too, and at 0-1-1 it outranks .box's own 0-1-0 border and
         background — leaving the checkbox with nothing drawn at all until a
         selection exists. The border-color on .box.on cannot bring back a
         border-style of none, so the outline would never return. */
      .head button.sort {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
      }
      .head button.sort.sorted {
        color: var(--hv-primary-dark);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        /*
         * Contain the vertical overscroll — a flick that runs past the last row
         * must not scroll the dashboard behind this surface — but only the
         * vertical.
         *
         * The shorthand set both axes, and that is what stopped the sideways
         * scroll above from working at all. Declaring overflow on one axis
         * makes the other compute to auto, so this box is a horizontal scroll
         * container too; it is exactly as wide as its own content, so it has
         * nothing to scroll, and contain on that axis means a horizontal swipe
         * starting over a row is neither used nor handed on. The host measured
         * scrollWidth 874 against clientWidth 390 and stayed at scrollLeft 0
         * through the whole gesture, so the Tags, Due and Updated columns could
         * not be reached by any gesture — only by setting scrollLeft in script.
         */
        overscroll-behavior-y: contain;
      }
      .row {
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 13.5px;
        color: var(--hv-text);
      }
      .row:hover {
        background: var(--hv-row-hover);
      }
      .row.selected {
        background: var(--hv-row-hover);
      }
      .name-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cell {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--hv-text-secondary);
      }
      .cell .hv-chip,
      .cell .hv-area-chip {
        margin-right: 6px;
      }
      .cell.qty {
        color: var(--hv-text);
      }
      .cell.qty.low {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .cell.due.overdue {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* Amber rather than the due column's red: a passed inspection date is a
         chore on an item still on the shelf, not an item that is late back. */
      .cell.inspection.due {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .cell.updated {
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .tags {
        display: flex;
        gap: 5px;
        overflow: hidden;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 2px;
        visibility: hidden;
      }
      .row:hover .actions,
      .row:focus-within .actions {
        visibility: visible;
      }
      .actions button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: 1px solid var(--hv-divider);
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      .actions button:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .actions button[disabled] {
        opacity: 0.35;
      }
      .box {
        display: inline-grid;
        place-items: center;
        position: relative;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1.5px solid var(--hv-text-tertiary);
        background: none;
        color: #fff;
        padding: 0;
      }
      /* Grow the hit area for touch without growing the box, which has to stay
         checkbox-sized in a dense table. Clicking the row toggles the same
         selection, so on a row the two can only ever agree; the select-all in
         the header has nothing behind it and needs the area outright. */
      .box::after {
        content: '';
        position: absolute;
        inset: calc((var(--hv-tap-min, 16px) - 16px) / -2);
      }
      .box.on,
      .box.mixed {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
      }
      .empty {
        padding: 32px 20px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
    `,
  ];

  @property({ attribute: false }) items: Item[] = [];
  @property({ attribute: false }) columns: ColumnKey[] = [];
  @property({ attribute: false }) sort!: Sort;
  @property({ type: Boolean }) selectable = false;
  /** HA areas, to name the one each item's location resolves to. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) selection: Set<string> = new Set();

  /**
   * `row`, `columnheader` and `cell` are only meaningful under a table, grid or
   * treegrid; with no such ancestor the whole structure is thrown away and a
   * screen reader reads the rows as a run of text. The host is the only element
   * that can carry it — the header and the row group are siblings at the top of
   * this shadow root, with nothing above them.
   *
   * `table` rather than `grid`: a grid promises cell-by-cell arrow-key
   * navigation, and this surface moves a row at a time.
   */
  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'table');
  }

  private get _columns(): ColumnKey[] {
    return normalizeColumns(this.columns);
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _onSort(field: SortField) {
    // Clicking the sorted column flips it; a fresh column opens on whichever
    // direction reads as "most interesting first" for that field — the same
    // table the filter panel and the store default from.
    const order =
      this.sort?.field === field
        ? this.sort.order === 'asc'
          ? 'desc'
          : 'asc'
        : getDefaultOrderFor(field);
    this._emit('sort-change', { sort: { field, order } });
  }

  private _sortHeader(field: SortField, label: string) {
    const active = this.sort?.field === field;
    return html`<button
      class="sort ${active ? 'sorted' : ''}"
      data-testid="table-sort"
      data-field=${field}
      aria-sort=${active ? (this.sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
      @click=${() => this._onSort(field)}
    >
      ${label}${active ? icon(this.sort.order === 'asc' ? 'chevronUp' : 'chevronDown', 14) : null}
    </button>`;
  }

  /**
   * The rows carry `tabindex="0"`, so the keyboard can reach them; without this
   * there is nothing to do once they are reached, and every item on this
   * surface is behind a mouse.
   *
   * Same keys and same meanings as the card's list row, so the two surfaces do
   * not teach two vocabularies for the same four actions. Enter follows this
   * table's own row click: in selection mode a click selects rather than opens,
   * and the keyboard has to land on whatever the pointer lands on.
   *
   * A key pressed on a control inside the row belongs to that control. Without
   * the guard Enter on Edit would open the editor and then fire the row's own
   * open on top of it, and Delete anywhere in the action group would ask to
   * delete the item.
   */
  private _onRowKeydown(e: KeyboardEvent, item: Item) {
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this._emit(this.selectable ? 'toggle-select' : 'open-item', { itemId: item.id });
        break;
      case 'Delete':
        e.preventDefault();
        this._emit('request-delete', { itemId: item.id });
        break;
      case '+':
      case '=':
      case 'Add':
        e.preventDefault();
        this._emit('increment', { itemId: item.id });
        break;
      case '-':
      case 'Subtract':
        e.preventDefault();
        this._emit('decrement', { itemId: item.id });
        break;
    }
  }

  private _cell(item: Item, key: ColumnKey) {
    switch (key) {
      case 'quantity':
        return html`<span
          class="cell qty ${isLowStock(item) ? 'low' : ''}"
          role="cell"
          data-testid="cell-quantity"
          >${item.quantity}</span
        >`;
      case 'status': {
        // The column names every row's status, "OK" included — that is what
        // makes it a column rather than a second copy of the exception chip.
        // "OK" is a chip too, quiet rather than amber: a column that draws half
        // its values as chips and prints the rest as bare text reads as two
        // columns interleaved.
        const status = itemStatus(item);
        return html`<span class="cell" role="cell" data-testid="cell-status"
          ><span class="hv-chip ${status === 'ok' ? 'quiet' : 'warning'}"
            >${statusLabel(status)}</span
          ></span
        >`;
      }
      case 'category':
        return html`<span class="cell" role="cell" data-testid="cell-category" title=${item.category ?? ''}>${item.category || '—'}</span>`;
      case 'location': {
        const parts = itemPathParts(item, this.areas);
        return html`<span class="cell" role="cell" data-testid="cell-location" title=${pathTitle(parts)}
          >${renderAreaChip(parts.areaName)}${parts.path || '—'}</span
        >`;
      }
      case 'tags':
        return html`<span class="tags" role="cell" data-testid="cell-tags">
          ${item.tags.length ? item.tags.map((t) => html`<span class="hv-chip">${t}</span>`) : html`<span class="cell">—</span>`}
        </span>`;
      case 'due_date':
        return html`<span
          class="cell due ${isOverdue(item.due_date) ? 'overdue' : ''}"
          role="cell"
          data-testid="cell-due_date"
          >${formatDate(item.due_date)}</span
        >`;
      case 'inspection_date':
        return html`<span
          class="cell inspection ${isOverdue(item.inspection_date) ? 'due' : ''}"
          role="cell"
          data-testid="cell-inspection_date"
          >${formatDate(item.inspection_date)}</span
        >`;
      case 'updated_at':
        return html`<span class="cell updated" role="cell" data-testid="cell-updated_at">${relativeTime(item.updated_at)}</span>`;
    }
  }

  render() {
    const columns = this._columns;
    // The name cell's chip is the flagged-status signal for a table that has no
    // Status column. With the column shown it would put the same word twice on
    // one row, so the column takes over and the chip stands down.
    const statusColumn = columns.includes('status');
    const template = tableTemplateFor(columns, { selectable: this.selectable });
    const loadedIds = this.items.map((i) => i.id);
    const selectedCount = loadedIds.filter((id) => this.selection.has(id)).length;
    const allSelected = loadedIds.length > 0 && selectedCount === loadedIds.length;
    const someSelected = selectedCount > 0 && !allSelected;

    return html`
      <div class="head" role="row" style="grid-template-columns: ${template}">
        ${this.selectable
          ? html`<button
              class="box ${allSelected ? 'on' : someSelected ? 'mixed' : ''}"
              role="checkbox"
              aria-checked=${allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
              aria-label="Select all loaded rows"
              data-testid="table-select-all"
              @click=${() => this._emit(allSelected ? 'clear-selection' : 'select-all-loaded')}
            >
              ${allSelected ? icon('check', 13) : someSelected ? icon('minus', 13) : null}
            </button>`
          : null}
        <span role="columnheader">${this._sortHeader('name', 'Name')}</span>
        ${columns.map((key) => {
          const def = COLUMN_DEFS.find((d) => d.key === key)!;
          return html`<span role="columnheader"
            >${def.sortField ? this._sortHeader(def.sortField, def.label) : def.label}</span
          >`;
        })}
        <span role="columnheader"></span>
      </div>

      <div
        class="body"
        role="rowgroup"
        data-testid="table-body"
        @scroll=${(e: Event) => {
          const el = e.currentTarget as HTMLElement;
          this._emit('near-end', {
            ratio: (el.scrollTop + el.clientHeight) / Math.max(1, el.scrollHeight),
          });
        }}
      >
        ${this.items.length
          ? repeat(
              this.items,
              (it) => it.id,
              (item) => html`
                <div
                  class="row ${this.selection.has(item.id) ? 'selected' : ''}"
                  role="row"
                  tabindex="0"
                  data-testid="table-row"
                  data-item-id=${item.id}
                  style="grid-template-columns: ${template}"
                  @keydown=${(e: KeyboardEvent) => this._onRowKeydown(e, item)}
                  @click=${() =>
                    this._emit(this.selectable ? 'toggle-select' : 'open-item', { itemId: item.id })}
                >
                  ${this.selectable
                    ? html`<button
                        class="box ${this.selection.has(item.id) ? 'on' : ''}"
                        role="checkbox"
                        aria-checked=${String(this.selection.has(item.id))}
                        aria-label=${`Select ${item.name}`}
                        data-testid="table-row-select"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._emit('toggle-select', { itemId: item.id });
                        }}
                      >
                        ${this.selection.has(item.id) ? icon('check', 13) : null}
                      </button>`
                    : null}
                  <span class="name-cell" role="cell">
                    <span class="name" data-testid="table-name" title=${item.name}>${item.name}</span>
                    ${isLowStock(item)
                      ? html`<span class="hv-chip warning" aria-label="Low stock">Low</span>`
                      : null}
                    ${!statusColumn && itemStatus(item) !== 'ok'
                      ? html`<span class="hv-chip warning" data-testid="table-status"
                          >${statusLabel(itemStatus(item))}</span
                        >`
                      : null}
                    ${item.checked_out ? html`<span class="hv-chip state">Checked out</span>` : null}
                  </span>
                  ${columns.map((key) => this._cell(item, key))}
                  <span class="actions" role="cell">
                    <button
                      data-testid="table-decrement"
                      aria-label="Decrease quantity"
                      ?disabled=${item.checked_out || item.quantity <= 0}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._emit('decrement', { itemId: item.id });
                      }}
                    >
                      ${icon('minus', 15)}
                    </button>
                    <button
                      data-testid="table-increment"
                      aria-label="Increase quantity"
                      ?disabled=${item.checked_out}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._emit('increment', { itemId: item.id });
                      }}
                    >
                      ${icon('plus', 15)}
                    </button>
                    <button
                      data-testid="table-edit"
                      aria-label=${`Edit ${item.name}`}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._emit('edit', { itemId: item.id });
                      }}
                    >
                      ${icon('pencil', 15)}
                    </button>
                  </span>
                </div>
              `,
            )
          : html`<div role="row">
              <!-- The message is a cell in a row, the way an empty HTML table
                   spans one across its width: a row group whose only child is a
                   loose message owns something a table cannot contain, and the
                   structure is dropped rather than repaired. The announcement
                   belongs to whatever fills the slot — the shared empty state
                   is a live region already, and a second one wrapped around it
                   says everything twice. -->
              <div class="empty" role="cell" data-testid="table-empty">
                <slot name="empty">No items yet</slot>
              </div>
            </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-data-table': HVDataTable;
  }
}
