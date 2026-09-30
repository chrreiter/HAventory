import { t } from '../i18n';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../ui/tokens';
import { chip, renderTagChip } from '../ui/chip';
import { icon } from '../ui/icons';
import { onDayChange } from '../ui/day-clock';
import { formatDate, isDue, isOverdue, relativeTime } from '../ui/relative-time';
import { isReminderDue, reminderSummary } from '../ui/reminder';
import {
  COLUMN_DEFS,
  columnLabel,
  SELECT_COLUMN_WIDTH,
  normalizeColumns,
  tableTemplateFor,
} from '../store/columns';
import { MediaUrls, PictureFallback } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import { getDefaultOrderFor } from '../store/sort';
import type { AreaRef, StatusDefinition } from '../store/types';
import type { ColumnKey } from '../store/columns';
import {
  isLowStock,
  renderNameChips,
  renderRowThumb,
  rowChrome,
  rowKeyAction,
  rowMenuEntries,
} from '../ui/row-chrome';
import './hv-overflow-menu';
import { itemStatus, renderStatusChip } from '../ui/status';
import {
  areaMarkName,
  elideMobilePath,
  itemPathParts,
  pathTitle,
  renderAreaChip,
  renderPathSegments,
} from '../ui/location-path';
import type { Item, Sort, SortField } from '../store/types';

/** The full view's table. Only columns the backend can sort by get a clickable header. */
@customElement('hv-data-table')
export class HVDataTable extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    rowChrome,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        /* The row's metrics, which the sticky offsets below are built from. */
        --hv-table-gap: 8px;
        --hv-table-pad-x: 20px;
        /* The one scroll container, in both axes. The column template has a hard
           minimum wider than a phone, and a sticky cell resolves against the
           nearest scroll container, so one box for both is what makes the
           pinned name column hold. */
        overflow-x: auto;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      /* The grid's own width, so dividers and hover fills reach the last column. */
      .head,
      .body {
        min-width: min-content;
      }
      /* Its own height; the host is what scrolls. */
      .body {
        flex: none;
      }
      .head,
      .row {
        display: grid;
        gap: var(--hv-table-gap);
        align-items: center;
        padding: 10px var(--hv-table-pad-x);
      }
      .head {
        padding: 7px var(--hv-table-pad-x);
        border-bottom: 1px solid var(--hv-divider);
        font-size: 11.5px;
        font-weight: 500;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
        flex: none;
        /* Opaque, or the rows would read through it as they pass under. */
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--hv-surface);
      }
      /* Keyed to .sort: a plain .head button would outrank .box and erase the
         select-all checkbox's border. */
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
      .row {
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 13.5px;
        color: var(--hv-text);
        /* A role=row div is the target, and gets no pointer from the button rule. */
        cursor: pointer;
      }
      .row:hover {
        background: var(--hv-row-hover);
      }
      .row.selected {
        background: var(--hv-row-hover);
      }
      .name-cell,
      .select-cell,
      .name-head {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .name-cell {
        gap: 8px;
      }
      .name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /*
       * On a phone the name column holds while the rest scrolls under it. The
       * pinned cells carry the row's left padding and an opaque full-height
       * fill, so nothing shifts and nothing shows through.
       */
      @media (max-width: 700px) {
        .name-head,
        .name-cell,
        .select-cell {
          position: sticky;
          left: 0;
          z-index: 1;
          align-self: stretch;
          margin-left: calc(-1 * var(--hv-table-pad-x));
          padding-left: var(--hv-table-pad-x);
          background: var(--hv-surface);
        }
        /* Behind the pinned checkbox track, carrying the gap between them. */
        :host([selectable]) .name-head,
        :host([selectable]) .name-cell {
          left: calc(var(--hv-table-pad-x) + ${unsafeCSS(SELECT_COLUMN_WIDTH)});
          margin-left: calc(-1 * var(--hv-table-gap));
          padding-left: var(--hv-table-gap);
        }
        /* The row's wash as a layer over the pinned fill; the dark wash is
           translucent, so a plain colour would lose the opacity. */
        .row:hover .name-cell,
        .row:hover .select-cell,
        .row.selected .name-cell,
        .row.selected .select-cell {
          background-image: linear-gradient(var(--hv-row-hover), var(--hv-row-hover));
        }
        /* A right-edge shade (scroll) that a cover at the content's end (local)
           hides once there is nothing further right. */
        :host {
          background:
            linear-gradient(var(--hv-surface), var(--hv-surface)) right / 28px 100% no-repeat
              local,
            linear-gradient(
                to left,
                light-dark(rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.5)),
                rgba(0, 0, 0, 0)
              )
              right / 28px 100% no-repeat scroll;
        }
      }
      .cell {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--hv-text-secondary);
      }
      /* The path wraps between its segments, so the leaf is never elided. */
      .cell.path {
        flex-wrap: wrap;
        row-gap: 2px;
      }
      .cell.path > .hv-chip-line-text {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        row-gap: 2px;
      }
      /* On a phone the column is off screen, so it takes one elided line rather
         than setting the row's height; a block, since text-overflow cannot act
         inside a flex container. */
      :host([narrow]) .cell.path,
      :host([narrow]) .cell.path > .hv-chip-line-text {
        flex-wrap: nowrap;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host([narrow]) .cell.path > .hv-chip-line-text {
        display: block;
      }
      /* A segment elides only when it alone is wider than the column. */
      .hv-path-seg {
        white-space: nowrap;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Otherwise a flex item's edge drops the separator's spaces. */
      .hv-path-sep {
        white-space: pre;
      }
      .cell.qty {
        color: var(--hv-text);
      }
      .cell.qty.low {
        color: var(--hv-warn);
        font-weight: 500;
      }
      /* One tone for any passed date; the chips name which kind of lateness. */
      .cell.due.overdue,
      .cell.inspection.due,
      .cell.reminder.due {
        color: var(--hv-error);
        font-weight: 500;
      }
      .cell.updated {
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      /* Chips wrap and the row grows, rather than cutting a chip in half. */
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 5px;
        min-width: 0;
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
        flex: none;
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
      /* As on the card's rows: the stepper is outlined, Edit and ⋮ are not. */
      .actions button.plain {
        width: 30px;
        height: 30px;
        border: none;
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
      /* A touch-sized hit area around a checkbox-sized box. */
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

  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) items: Item[] = [];
  @property({ attribute: false }) columns: ColumnKey[] = [];
  @property({ attribute: false }) sort!: Sort;
  /** Reflected for the sticky name column's offset past the checkbox track. */
  @property({ type: Boolean, reflect: true }) selectable = false;
  /** A phone-width viewport, as the host reads it; reflected for the location cell's clamp. */
  @property({ type: Boolean, reflect: true }) narrow = false;
  /** HA areas, to name the one each item's location resolves to. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) selection: Set<string> = new Set();
  /** Picture access; null means the rows show no thumbnails. */
  @property({ attribute: false }) media: MediaBindings | null = null;

  private readonly _urls = new MediaUrls(this);
  private readonly _thumbs = new PictureFallback(this, this._urls);

  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
  }

  /**
   * The host carries `role="table"`, the ancestor `row` and `cell` need;
   * not `grid`, which promises cell-by-cell arrow keys.
   */
  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'table');
    this.addEventListener('scroll', this._onScroll);
    // The date cells read the clock, so midnight redraws their tones.
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.removeEventListener('scroll', this._onScroll);
    this._dayUnsub?.();
    this._dayUnsub = undefined;
    super.disconnectedCallback();
  }

  private _dayUnsub?: () => void;

  /** Paging, off the host's own scroll, which does not bubble. */
  private _onScroll = () => {
    this._emit('near-end', {
      ratio: (this.scrollTop + this.clientHeight) / Math.max(1, this.scrollHeight),
    });
  };

  private get _columns(): ColumnKey[] {
    return normalizeColumns(this.columns);
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _onSort(field: SortField) {
    // The sorted column flips; a fresh one opens on its default direction.
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

  /** `rowKeyAction`, except Enter selects in selection mode, as a click does. */
  private _onRowKeydown(e: KeyboardEvent, item: Item) {
    const action = rowKeyAction(e);
    if (!action) return;
    const name = action === 'open-item' && this.selectable ? 'toggle-select' : action;
    this._emit(name, { itemId: item.id });
  }

  private _cell(item: Item, key: ColumnKey) {
    const cell = (cls: string, content: unknown, title?: string) =>
      html`<span class="cell ${cls}" role="cell" data-testid=${`cell-${key}`} title=${ifDefined(title)}
        >${content}</span
      >`;
    switch (key) {
      case 'quantity':
        return cell(`qty ${isLowStock(item) ? 'low' : ''}`, item.quantity);
      case 'status':
        // Every row's status, "OK" included, as a chip.
        return cell('', renderStatusChip(itemStatus(item), this.statuses));
      case 'category':
        return cell('', item.category || '—', item.category ?? '');
      case 'location': {
        const parts = itemPathParts(item, this.areas);
        const mark = areaMarkName(parts.areaName, parts.path);
        // On a phone the column is off screen: one elided line, as the card's phone rows write it.
        const lead = this.narrow ? elideMobilePath(mark, parts.path) : null;
        const path = lead ? lead.rest || '—' : parts.path ? renderPathSegments(parts.path) : '—';
        return cell(
          'path hv-chip-line',
          html`${renderAreaChip(lead ? lead.area : mark)}<span class="hv-chip-line-text">${path}</span>`,
          pathTitle(parts),
        );
      }
      case 'tags':
        return html`<span class="tags" role="cell" data-testid="cell-tags">
          ${item.tags.length ? item.tags.map((t) => renderTagChip(t)) : html`<span class="cell">—</span>`}
        </span>`;
      case 'due_date':
        return cell(`due ${isOverdue(item.due_date) ? 'overdue' : ''}`, formatDate(item.due_date));
      case 'inspection_date':
        return cell(`inspection ${isDue(item.inspection_date) ? 'due' : ''}`, formatDate(item.inspection_date));
      case 'reminder_date':
        return cell(`reminder ${isReminderDue(item) ? 'due' : ''}`, reminderSummary(item) ?? '—');
      case 'updated_at':
        return cell('updated', relativeTime(item.updated_at));
    }
  }

  /** A row action button: it acts on `item` without the click reaching the row. */
  private _rowButton(item: Item, event: string, label: string, glyph: unknown, disabled = false, cls = '') {
    return html`<button
      class=${cls}
      data-testid=${`table-${event}`}
      aria-label=${label}
      ?disabled=${disabled}
      @click=${(e: Event) => {
        e.stopPropagation();
        this._emit(event, { itemId: item.id });
      }}
    >
      ${glyph}
    </button>`;
  }

  render() {
    const columns = this._columns;
    // With a Status column shown, the name cell's status chip stands down.
    const statusColumn = columns.includes('status');
    const template = tableTemplateFor(columns, { selectable: this.selectable });
    const loadedIds = this.items.map((i) => i.id);
    const selectedCount = loadedIds.filter((id) => this.selection.has(id)).length;
    const allSelected = loadedIds.length > 0 && selectedCount === loadedIds.length;
    const someSelected = selectedCount > 0 && !allSelected;

    return html`
      <div class="head" role="row" style="grid-template-columns: ${template}">
        ${this.selectable
          ? html`<span class="select-cell"
              ><button
                class="box ${allSelected ? 'on' : someSelected ? 'mixed' : ''}"
                role="checkbox"
                aria-checked=${allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                aria-label=${t('hv.table.selectAll')}
                data-testid="table-select-all"
                @click=${() => this._emit(allSelected ? 'clear-selection' : 'select-all-loaded')}
              >
                ${allSelected ? icon('check', 13) : someSelected ? icon('minus', 13) : null}
              </button></span
            >`
          : null}
        <span class="name-head" role="columnheader"
          >${this._sortHeader('name', t('hv.field.name'))}</span
        >
        ${columns.map((key) => {
          const def = COLUMN_DEFS.find((d) => d.key === key)!;
          const label = columnLabel(key);
          return html`<span role="columnheader"
            >${def.sortField ? this._sortHeader(def.sortField, label) : label}</span
          >`;
        })}
        <span role="columnheader"></span>
      </div>

      <div class="body" role="rowgroup" data-testid="table-body">
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
                    ? html`<span class="select-cell"
                        ><button
                          class="box ${this.selection.has(item.id) ? 'on' : ''}"
                          role="checkbox"
                          aria-checked=${String(this.selection.has(item.id))}
                          aria-label=${t('hv.table.select', { name: item.name })}
                          data-testid="table-row-select"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this._emit('toggle-select', { itemId: item.id });
                          }}
                        >
                          ${this.selection.has(item.id) ? icon('check', 13) : null}
                        </button></span
                      >`
                    : null}
                  <span class="name-cell" role="cell">
                    ${renderRowThumb(item, this._urls, this._thumbs)}
                    <span class="name" data-testid="table-name" title=${item.name}>${item.name}</span>
                    ${renderNameChips(item, this.statuses, {
                      prefix: 'table',
                      // Both chips together leave the name too short; the Qty
                      // column still draws a low count in amber.
                      lowChip: !item.checked_out,
                      statusChip: !statusColumn,
                      // The Due column carries the date.
                      overdueText: 'overdue',
                    })}
                  </span>
                  ${columns.map((key) => this._cell(item, key))}
                  <span class="actions" role="cell">
                    ${this._rowButton(
                      item,
                      'decrement',
                      t('hv.row.decreaseQuantity'),
                      icon('minus', 15),
                      item.checked_out || item.quantity <= 0,
                    )}
                    ${this._rowButton(
                      item,
                      'increment',
                      t('hv.row.increaseQuantity'),
                      icon('plus', 15),
                      item.checked_out,
                    )}
                    ${this._rowButton(
                      item,
                      'edit',
                      t('hv.row.editNamed', { name: item.name }),
                      icon('pencil', 18),
                      false,
                      'plain',
                    )}
                    <hv-overflow-menu
                      data-testid="table-row-menu"
                      label=${t('hv.row.actionsFor', { name: item.name })}
                      .entries=${rowMenuEntries(item)}
                      @click=${(e: Event) => e.stopPropagation()}
                      @select=${(e: CustomEvent) => {
                        e.stopPropagation();
                        const { id } = e.detail as { id: string };
                        this._emit('row-action', { itemId: item.id, action: id });
                      }}
                    ></hv-overflow-menu>
                  </span>
                </div>
              `,
            )
          : html`<div role="row">
              <!-- A cell in a row, as a table requires; the slotted empty state
                   is its own live region. -->
              <div class="empty" role="cell" data-testid="table-empty">
                <slot name="empty">${t('hv.empty.noItems.headline')}</slot>
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
