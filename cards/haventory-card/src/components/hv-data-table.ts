import { t } from '../i18n';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../ui/tokens';
import { chip, renderTagChip } from '../ui/chip';
import { icon } from '../ui/icons';
import { formatDate, isDue, isOverdue, relativeTime } from '../ui/relative-time';
import { isReminderDue, reminderSummary } from '../ui/reminder';
import {
  COLUMN_DEFS,
  columnLabel,
  SELECT_COLUMN_WIDTH,
  normalizeColumns,
  tableTemplateFor,
} from '../store/columns';
import { MediaUrls, ROW_THUMB_SIZE, attachmentNameToken, pictureAlt, pictures } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import { getDefaultOrderFor } from '../store/sort';
import type { AreaRef, StatusDefinition } from '../store/types';
import type { ColumnKey } from '../store/columns';
import { isLowStock, rowMenuEntries } from './hv-list-row';
import './hv-overflow-menu';
import { DEFAULT_STATUS, itemStatus, renderStatusChip } from '../ui/status';
import {
  areaMarkName,
  itemPathParts,
  pathTitle,
  renderAreaChip,
  renderPathSegments,
} from '../ui/location-path';
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
        /* The row's own metrics, named because the sticky offsets below are
           built from them: a pinned cell carries the row's left padding, and
           in selecting mode the name also carries the gap after the checkbox
           track. */
        --hv-table-gap: 8px;
        --hv-table-pad-x: 20px;
        /* The one scroll container on this surface, in both axes.

           Sideways because the column template has a hard minimum — about
           1366px for the default set, 1414px with the selection column — and a
           grid whose tracks do not fit overflows its own box rather than
           shrinking. With overflow visible that spilled content was simply
           clipped by the shell: at 375px the rows measured clientWidth 634
           against scrollWidth 854, and the Tags, Due and Updated columns could
           not be reached by any gesture. Scrolling keeps whichever columns the
           user chose rather than quietly dropping them on small screens.

           Vertically here rather than on the row group, because a sticky cell
           resolves its offsets against the nearest scroll container: with the
           rows inside a box of their own that scrolls, left: 0 on a name cell
           resolves against a box that never moves sideways and pins the cell to
           nothing. One container for both axes is what makes the name column
           below hold. The header keeps its place with position: sticky instead
           of by sitting outside the scrolled box. */
        overflow-x: auto;
        overflow-y: auto;
        /* A flick that runs past the last row or the last column must not
           scroll the dashboard behind this surface. */
        overscroll-behavior: contain;
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
      /* Its own height, not the leftover space: the host is what scrolls, and a
         row group stretched to the visible height would have nothing to give
         the scroll. */
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
        /* Held against the top of the scroll container the rows now share with
           it. Opaque, or the rows would read through it as they pass under. */
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--hv-surface);
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
      .row {
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 13.5px;
        color: var(--hv-text);
        /* Same as the card's list rows: the row is the target, but a role=row
           div gets none of the hand the shared button rule gives every other
           one. Body rows only — the header carries .head, and there it is the
           sort buttons that are pressable, not the row. */
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
      /* The same box the card's list rows draw, so one item is the same size
         and shape whichever surface it is browsed on. Fixed, so a portrait
         photo and a landscape one leave the row the same height; and rendered
         only where there is a picture, so a mostly photo-less inventory does
         not grow a column of empty squares — and so the name keeps its whole
         floor on every row that has no photo to spend it on. What the picture
         costs the name on the rows that do have one, and why the column's floor
         does not grow to cover it, is on NAME_COLUMN_SIZE. */
      .thumb {
        flex: none;
        width: ${unsafeCSS(ROW_THUMB_SIZE)}px;
        height: ${unsafeCSS(ROW_THUMB_SIZE)}px;
        border-radius: 6px;
        object-fit: cover;
        background: var(--hv-surface-raised);
      }
      /*
       * A phone shows about a quarter of this table — the template's floor is
       * around 1366px — so the identity column holds while the rest scrolls
       * under it, and the right edge says there is more to reach.
       *
       * The offsets are the row's own metrics, so nothing shifts as the swipe
       * starts: a cell pinned where it already sits simply stops moving. The
       * pinned cells take the row's left padding with them (negative margin,
       * matching padding) so the name never ends up flush against the edge,
       * and they stretch to the row's full height with an opaque fill, or the
       * columns passing beneath would show through them.
       *
       * These resolve against the host, which is the scroll container for both
       * axes — see the overflow note there.
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
        /* Behind the checkbox track, which is pinned first — and the gap
           between the two travels with the name, or the columns underneath
           would show through the 8px between the two pinned cells. */
        :host([selectable]) .name-head,
        :host([selectable]) .name-cell {
          left: calc(var(--hv-table-pad-x) + ${unsafeCSS(SELECT_COLUMN_WIDTH)});
          margin-left: calc(-1 * var(--hv-table-gap));
          padding-left: var(--hv-table-gap);
        }
        /* The row's wash is painted on the row, which the pinned cells cover.
           A second layer over their own fill restores it — and it has to be a
           layer rather than a colour, because the dark half of the wash is
           translucent and would take the opacity with it. */
        .row:hover .name-cell,
        .row:hover .select-cell,
        .row.selected .name-cell,
        .row.selected .select-cell {
          background-image: linear-gradient(var(--hv-row-hover), var(--hv-row-hover));
        }
        /*
         * The overflow affordance: a shade at the right edge, and a cover in
         * the surface colour parked at the right end of the *content*. The
         * cover scrolls with the rows (background-attachment: local) while the
         * shade stays with the box (scroll), so the shade shows exactly while
         * there is something further right, and the two coincide — hiding it —
         * when there is not. A table that fits shows nothing at all.
         */
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
      /*
       * The path wraps between its segments and the row grows to hold it.
       *
       * Elided as one run of text it broke wherever the pixels ran out, which
       * left a stub of a location name — "Küc…" of a five-segment path, with
       * the leaf the reader is actually after nowhere on the row. Every segment
       * survives instead, on as many lines as the column needs, and the cell's
       * title still carries the whole path for the one case below that cannot.
       *
       * The chip and the path are the two items of the outer row, so a path too
       * long to sit beside the chip takes the lines under it rather than
       * squeezing into what the chip leaves.
       */
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
      /* A segment holds its line, and elides only when one segment on its own
         is wider than the whole column — the point past which there is no break
         left to take. */
      .hv-path-seg {
        white-space: nowrap;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The separator's spaces sit at the end of a flex item's only line, where
         normal white-space processing drops them and the segments either side
         would run together. */
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
      /* One tone for a date that has passed, whichever of the three columns
         prints it. A bare date cell has no word beside it, so a second hue here
         is the whole signal and reads as a severity ranking the card never
         explains. Naming which kind of lateness it is belongs to the chips —
         "Overdue" in the name cell, "Inspection due" on the row and the sheet —
         and they keep their own two tones because the word carries what the
         colour cannot. Inspection and reminder dates include today: the day a
         date names is the day it is asking. */
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
      /* Chips wrap onto as many lines as the set needs and the row grows to
         hold them. Cut at the cell's edge instead, the column showed one chip
         of six and half of the next, with no count to say the rest existed —
         and a half-drawn chip reports nothing at all. */
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
      /* Edit and the ⋮ are the plain pair, the quantity buttons the outlined
         one — the same grammar the card's rows use, where the stepper carries
         the border and the hover actions do not. Edit was a 26px outlined
         circle here and a 30px borderless one there, which is two answers to
         one control. */
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

  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) items: Item[] = [];
  @property({ attribute: false }) columns: ColumnKey[] = [];
  @property({ attribute: false }) sort!: Sort;
  /** Reflected: the sticky name column offsets itself past the checkbox track
   * from CSS, which can only see an attribute. */
  @property({ type: Boolean, reflect: true }) selectable = false;
  /** HA areas, to name the one each item's location resolves to. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) selection: Set<string> = new Set();
  /** Picture access; null means the rows show no thumbnails. */
  @property({ attribute: false }) media: MediaBindings | null = null;

  private readonly _urls = new MediaUrls(this);

  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
  }

  /**
   * A row's leading thumbnail: the item's first picture, or nothing.
   *
   * The full-size file is what loads — nothing is thumbnailed server-side — so
   * `loading="lazy"` and `decoding="async"` are what keep a long table from
   * fetching and decoding every row's photo at once.
   */
  private _renderThumb(item: Item) {
    const first = pictures(item.attachments)[0];
    if (!first) return null;
    const src = this._urls.get(item.id, first.id, attachmentNameToken(first));
    if (!src) return null;
    return html`<img
      class="thumb"
      data-testid="row-thumb"
      src=${src}
      alt=${pictureAlt(item.name, 0, 1)}
      loading="lazy"
      decoding="async"
    />`;
  }

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
    this.addEventListener('scroll', this._onScroll);
  }

  disconnectedCallback(): void {
    this.removeEventListener('scroll', this._onScroll);
    super.disconnectedCallback();
  }

  /**
   * Paging: the host is the scrolled box, so the host is where the position can
   * be read. A scroll event fires on the box that scrolled and does not bubble,
   * which is why this is bound on the element rather than in the template.
   */
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
        return html`<span class="cell" role="cell" data-testid="cell-status"
          >${renderStatusChip(itemStatus(item), this.statuses)}</span
        >`;
      }
      case 'category':
        return html`<span class="cell" role="cell" data-testid="cell-category" title=${item.category ?? ''}>${item.category || '—'}</span>`;
      case 'location': {
        const parts = itemPathParts(item, this.areas);
        return html`<span
          class="cell path hv-chip-line"
          role="cell"
          data-testid="cell-location"
          title=${pathTitle(parts)}
          >${renderAreaChip(areaMarkName(parts.areaName, parts.path))}<span class="hv-chip-line-text"
            >${parts.path ? renderPathSegments(parts.path) : '—'}</span
          ></span
        >`;
      }
      case 'tags':
        return html`<span class="tags" role="cell" data-testid="cell-tags">
          ${item.tags.length ? item.tags.map((t) => renderTagChip(t)) : html`<span class="cell">—</span>`}
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
          class="cell inspection ${isDue(item.inspection_date) ? 'due' : ''}"
          role="cell"
          data-testid="cell-inspection_date"
          >${formatDate(item.inspection_date)}</span
        >`;
      case 'reminder_date':
        return html`<span
          class="cell reminder ${isReminderDue(item) ? 'due' : ''}"
          role="cell"
          data-testid="cell-reminder_date"
          >${reminderSummary(item) ?? '—'}</span
        >`;
      case 'updated_at':
        return html`<span class="cell updated" role="cell" data-testid="cell-updated_at">${relativeTime(item.updated_at)}</span>`;
    }
  }

  render() {
    const columns = this._columns;
    // The name cell's chip is the flagged-status signal for a table that has no
    // Status column. With the column shown it would put the same word twice on
    // one row, so the column takes over and the chip stands down. The
    // checked-out chip below has nothing to stand down for — the Due column
    // carries a date, not the word — so it names an overdue loan either way,
    // which is the only thing left saying so once the table is scrolled
    // sideways or pinned to its name column.
    const statusColumn = columns.includes('status');
    // Low stands down for Checked out in the same cell, the way a phone row's
    // one line already picks the most interrupting thing it has to say: both
    // chips are unshrinkable, and together they take 138px of a 250px track,
    // which leaves the name too short to tell two items apart. Who has the item
    // outranks how many are left, and the Qty column still draws a low count in
    // amber.
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
          >${this._sortHeader('name', t('hv.table.name'))}</span
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
                    ${this._renderThumb(item)}
                    <span class="name" data-testid="table-name" title=${item.name}>${item.name}</span>
                    ${isLowStock(item) && !item.checked_out
                      ? html`<span
                          class="hv-chip warning"
                          data-testid="table-low"
                          aria-label=${t('hv.term.lowStock')}
                          >${t('hv.term.low')}</span
                        >`
                      : null}
                    ${!statusColumn && itemStatus(item) !== DEFAULT_STATUS
                      ? renderStatusChip(itemStatus(item), this.statuses, {
                          testid: 'table-status',
                        })
                      : null}
                    ${item.checked_out
                      ? html`<span
                          class="hv-chip ${isOverdue(item.due_date) ? 'error' : 'state'}"
                          data-testid="table-checked-out"
                          >${isOverdue(item.due_date)
                            ? t('hv.term.overdue')
                            : t('hv.term.checkedOut')}</span
                        >`
                      : null}
                  </span>
                  ${columns.map((key) => this._cell(item, key))}
                  <span class="actions" role="cell">
                    <button
                      data-testid="table-decrement"
                      aria-label=${t('hv.row.decreaseQuantity')}
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
                      aria-label=${t('hv.row.increaseQuantity')}
                      ?disabled=${item.checked_out}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._emit('increment', { itemId: item.id });
                      }}
                    >
                      ${icon('plus', 15)}
                    </button>
                    <button
                      class="plain"
                      data-testid="table-edit"
                      aria-label=${t('hv.table.edit', { name: item.name })}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._emit('edit', { itemId: item.id });
                      }}
                    >
                      ${icon('pencil', 18)}
                    </button>
                    <hv-overflow-menu
                      data-testid="table-row-menu"
                      label=${t('hv.table.actionsFor', { name: item.name })}
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
              <!-- The message is a cell in a row, the way an empty HTML table
                   spans one across its width: a row group whose only child is a
                   loose message owns something a table cannot contain, and the
                   structure is dropped rather than repaired. The announcement
                   belongs to whatever fills the slot — the shared empty state
                   is a live region already, and a second one wrapped around it
                   says everything twice. -->
              <div class="empty" role="cell" data-testid="table-empty">
                <slot name="empty">${t('hv.table.empty')}</slot>
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
