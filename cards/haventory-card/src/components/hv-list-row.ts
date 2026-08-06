import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { itemPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import { icon } from '../ui/icons';
import { formatDate, isOverdue } from '../ui/relative-time';
import { itemStatus, renderStatusChip, statusLabel } from '../ui/status';
import { MediaUrls, manuals, pictureAlt, pictures } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import type { AreaRef, Item, StatusDefinition } from '../store/types';
import './hv-overflow-menu';
import type { OverflowMenuEntry } from './hv-overflow-menu';

/** True when an item is at or under its low-stock threshold. */
export function isLowStock(item: Item): boolean {
  return typeof item.low_stock_threshold === 'number' && item.quantity <= item.low_stock_threshold;
}

/**
 * Drop the middle of a long path so both ends survive a narrow row.
 *
 * A path reads root-first and clips from the right, so on a phone the half that
 * goes is the half worth keeping: "Workshop › Parts Cabinet › Drawer A › Small
 * Bin" rendered as "Workshop › Parts Cabinet › D…", naming the room but not the
 * drawer or the bin the item is actually in. The root still says which room and
 * the leaf says where in it; the ancestors between them are what a phone can
 * afford to lose, and the detail sheet still shows the path in full.
 *
 * Two, not three: a phone row has about 200px for this line, and a real
 * three-segment path ("Workshop › Parts Cabinet › Drawer A", plus a category
 * after it) needs well over that — so at three it still clipped the leaf off
 * the end, which is the whole thing this is here to prevent.
 */
export function elidePath(path: string, maxSegments = 2): string {
  const segments = path.split(' › ');
  if (segments.length <= maxSegments) return path;
  return `${segments[0]} › … › ${segments[segments.length - 1]}`;
}

/**
 * One row of the standard card list.
 *
 * Desktop reveals edit and row-menu actions on hover; touch has no hover, so the
 * whole row is the tap target and opens the detail sheet instead. Checked-out
 * rows lose the stepper — on mobile it is replaced outright by "Check in", which
 * is the only action that makes sense for an item that is out.
 */
@customElement('hv-list-row')
export class HVListRow extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        padding: 9px 16px;
        box-sizing: border-box;
        border-top: 1px solid var(--hv-row-divider);
        background: none;
        width: 100%;
        text-align: left;
        color: inherit;
        font: inherit;
      }
      :host([mobile]) .row {
        padding: 11px 14px;
      }
      :host(:first-of-type) .row {
        border-top: none;
      }
      .row:hover:not(.touch) {
        background: var(--hv-row-hover);
      }
      .row.selected {
        background: var(--hv-row-hover);
      }
      .names {
        flex: 1;
        min-width: 0;
      }
      /* A fixed box, so a portrait photo and a landscape one leave the row the
         same height and the list keeps a single rhythm. Rows without a picture
         render nothing here rather than a placeholder: a mostly photo-less
         inventory would otherwise grow a column of empty squares. */
      .thumb {
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 6px;
        object-fit: cover;
        background: var(--hv-surface-raised);
      }
      :host([mobile]) .thumb {
        width: 40px;
        height: 40px;
      }
      /* A mark, not a chip: that an item has a manual is a fact about it, not
         a state anyone has to act on, so it stays out of the hue vocabulary the
         chips next to it carry. */
      .doc-marker {
        flex: none;
        display: inline-grid;
        place-items: center;
        color: var(--hv-text-tertiary);
      }
      /* Both lines must be block containers with inline content, or the
         ellipsis is silently ignored: overflow does not apply to an inline box,
         and text-overflow does not apply to a flex container. As spans inside a
         blockified flex item these were the first case, and .secondary was
         explicitly the second — so a long path hard-cut mid-character with no
         "…" to say anything had been dropped. */
      .name {
        display: block;
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host([mobile]) .name {
        font-size: 14.5px;
      }
      .secondary {
        display: block;
        font-size: 12px;
        color: var(--hv-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Beats .secondary's own display:block, which is declared later than the
         shared fragment and would otherwise keep the row inline. */
      .secondary.hv-chip-line {
        display: flex;
      }
      /* The path elides; the chip ahead of it does not. */
      .secondary.hv-chip-line > .hv-chip-line-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .secondary.out {
        color: var(--hv-primary-dark);
      }
      /* A passed due date is the one thing on this line worth interrupting for,
         and "due Jul 2" in the same blue as "due Aug 24" said nothing. */
      .secondary.overdue {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* Amber, not that red: red here means an item is out and late back, while
         an inspection that has come due is a chore on something on the shelf. */
      .secondary.inspect {
        color: var(--hv-warn-deep);
        font-weight: 500;
      }
      .dot {
        display: inline-block;
        vertical-align: middle;
        margin-right: 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--hv-amber);
      }
      .hover-actions {
        flex: none;
        display: flex;
        gap: 2px;
        visibility: hidden;
      }
      .row:hover .hover-actions,
      .row:focus-within .hover-actions {
        visibility: visible;
      }
      :host([mobile]) .hover-actions {
        display: none;
      }
      .hover-actions button {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
        transition: opacity var(--hv-motion-fast) ease-out;
      }
      .hover-actions button:hover {
        background: var(--hv-hover-overlay);
      }
      .stepper {
        flex: none;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
      }
      .stepper.disabled {
        opacity: 0.45;
      }
      .stepper button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      /* The most-tapped control in the app, and − sits directly beside + — a
         mis-tap here moves stock the wrong way, so these get real size rather
         than an invisible expanded hit area that would overlap its neighbour. */
      :host([mobile]) .stepper button {
        width: var(--hv-tap-min, 34px);
        height: var(--hv-tap-min, 34px);
      }
      .stepper button:hover:not([disabled]) {
        background: var(--hv-hover-overlay);
      }
      .qty {
        min-width: 26px;
        text-align: center;
        font: 500 13px var(--hv-font);
      }
      .qty.low {
        color: var(--hv-warn);
      }
      .check-in {
        flex: none;
        border: 1px solid var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-darker);
        border-radius: var(--hv-radius-chip);
        min-height: var(--hv-tap-min, 40px);
        padding: 0 18px;
        font: 500 13.5px var(--hv-font);
      }
      .box {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1.5px solid var(--hv-text-tertiary);
        background: none;
        color: #fff;
        padding: 0;
      }
      .box.on {
        background: var(--hv-primary-dark);
        border-color: var(--hv-primary-dark);
      }
      /* A 16px box is far too small for a thumb. Tapping the row toggles the
         same selection, so an oversized hit area here can only ever agree with
         what is underneath it — no visual change needed. */
      :host([mobile]) .box {
        position: relative;
      }
      :host([mobile]) .box::after {
        content: '';
        position: absolute;
        inset: calc((var(--hv-tap-min, 16px) - 16px) / -2);
      }
    `,
  ];

  @property({ attribute: false }) item!: Item;
  @property({ type: Boolean, reflect: true }) mobile = false;
  /** HA areas, to name the one the item's location resolves to. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  /** Selection mode: show a checkbox and suppress row navigation. */
  @property({ type: Boolean }) selectable = false;
  @property({ type: Boolean }) selected = false;
  /** Show the optimistic-write "pending" chip. */
  @property({ type: Boolean }) pending = false;
  /** Picture access; null means the row shows no thumbnail. */
  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) media: MediaBindings | null = null;

  private readonly _urls = new MediaUrls(this);

  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
  }

  /**
   * The row's leading thumbnail: the item's first picture, or nothing.
   *
   * The full-size file is what loads — nothing is thumbnailed server-side, so
   * `loading="lazy"` and `decoding="async"` are what keep a long list from
   * fetching and decoding everything at once.
   */
  private _renderThumb() {
    const first = pictures(this.item.attachments)[0];
    if (!first) return null;
    const src = this._urls.get(this.item.id, first.id);
    if (!src) return null;
    return html`<img
      class="thumb"
      data-testid="row-thumb"
      src=${src}
      alt=${pictureAlt(this.item.name, 0, 1)}
      loading="lazy"
      decoding="async"
    />`;
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { itemId: this.item.id, ...detail }, bubbles: true, composed: true }),
    );
  }

  /** Row menu contents depend on whether the item is out, and whether it has a due date. */
  private _menuEntries(item: Item): OverflowMenuEntry[] {
    if (item.checked_out) {
      return [
        { id: 'check-in', label: 'Check in', glyph: 'account' },
        {
          id: 'set-due-date',
          label: item.due_date ? 'Change due date…' : 'Set due date…',
          glyph: 'calendar',
        },
        { divider: true },
        { id: 'delete', label: 'Delete item', glyph: 'del' },
      ];
    }
    return [
      { id: 'check-out', label: 'Check out…', glyph: 'account' },
      { id: 'edit', label: 'Edit', glyph: 'pencil' },
      { divider: true },
      { id: 'delete', label: 'Delete item', glyph: 'del' },
    ];
  }

  private _onKeydown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this._emit('open-item');
        break;
      case 'Delete':
        e.preventDefault();
        this._emit('request-delete');
        break;
      case '+':
      case '=':
      case 'Add':
        e.preventDefault();
        this._emit('increment');
        break;
      case '-':
      case 'Subtract':
        e.preventDefault();
        this._emit('decrement');
        break;
    }
  };

  private _renderStepper() {
    const item = this.item;
    const low = isLowStock(item);
    // A checked-out item's quantity is not the thing to adjust.
    const disabled = item.checked_out;
    if (this.mobile && item.checked_out) {
      return html`<button
        class="check-in"
        data-testid="row-check-in"
        @click=${(e: Event) => {
          e.stopPropagation();
          this._emit('check-in');
        }}
      >
        Check in
      </button>`;
    }
    return html`
      <span class="stepper ${disabled ? 'disabled' : ''}" data-testid="row-stepper">
        <button
          data-testid="row-decrement"
          aria-label="Decrease quantity"
          ?disabled=${disabled}
          @click=${(e: Event) => {
            e.stopPropagation();
            this._emit('decrement');
          }}
        >
          ${icon('minus', 16)}
        </button>
        <span class="qty ${low ? 'low' : ''}" data-testid="row-qty">${item.quantity}</span>
        <button
          data-testid="row-increment"
          aria-label="Increase quantity"
          ?disabled=${disabled}
          @click=${(e: Event) => {
            e.stopPropagation();
            this._emit('increment');
          }}
        >
          ${icon('plus', 16)}
        </button>
      </span>
    `;
  }

  render() {
    const item = this.item;
    if (!item) return null;
    const low = isLowStock(item);
    const overdue = isOverdue(item.due_date);
    // `inspection_date` is when the item is next due for inspection, so a date
    // already behind us means it is waiting to be done.
    const inspectionDue = isOverdue(item.inspection_date);
    const parts = itemPathParts(item, this.areas);
    // The desktop row has room for the whole path and the area chip beside it.
    const secondary = [parts.path, item.category].filter(Boolean).join(' · ');
    // A phone line fits neither, so the area goes in as the leading text
    // segment — the half elidePath keeps — and the room survives a path deep
    // enough to lose its middle.
    const mobilePath = elidePath([parts.areaName, parts.path].filter(Boolean).join(' › '));
    const mobileSecondary = [mobilePath, item.category].filter(Boolean).join(' · ');
    // The tooltip carries the *unelided* path: on a phone the middle of it is
    // dropped on purpose, and this is where the whole thing can still be read.
    const secondaryFull = [pathTitle(parts), item.category].filter(Boolean).join(' · ');
    // A phone row has one line for all of this and no room for the chips the
    // wide row hangs on the right, so the line says the most interrupting
    // thing it has: who has the item, then what state it is flagged with, then
    // what it is waiting for, then where it lives. The path is a tap away in
    // the detail sheet either way.
    const status = itemStatus(item);
    const flagged = status !== 'ok';
    const mobileState = item.checked_out ? 'out' : flagged || inspectionDue ? 'inspect' : '';

    return html`
      <div
        class="row ${this.mobile ? 'touch' : ''} ${this.selected ? 'selected' : ''}"
        role="row"
        tabindex="0"
        aria-label=${`Item ${item.name}`}
        data-testid="list-row"
        data-item-id=${item.id}
        @keydown=${this._onKeydown}
        @click=${() => {
          if (this.selectable) this._emit('toggle-select');
          else this._emit('open-item');
        }}
      >
        ${this.selectable
          ? html`<button
              class="box ${this.selected ? 'on' : ''}"
              role="checkbox"
              aria-checked=${String(this.selected)}
              aria-label=${`Select ${item.name}`}
              data-testid="row-select"
              @click=${(e: Event) => {
                e.stopPropagation();
                this._emit('toggle-select');
              }}
            >
              ${this.selected ? icon('check', 13) : null}
            </button>`
          : null}
        ${this._renderThumb()}
        <span class="names">
          <span class="name" data-testid="row-name" title=${item.name}>${item.name}</span>
          <span
            class="secondary ${this.mobile ? mobileState : 'hv-chip-line'} ${overdue &&
            this.mobile
              ? 'overdue'
              : ''}"
            data-testid="row-secondary"
            title=${secondaryFull}
          >
            ${this.mobile && low && !item.checked_out
              ? html`<span class="dot" data-testid="row-low-dot"></span>`
              : null}
            ${this.mobile && item.checked_out
              ? html`${overdue ? 'Overdue' : 'Checked out'}${item.due_date
                  ? ` · due ${formatDate(item.due_date)}`
                  : ''}`
              : this.mobile && flagged
                ? html`<span data-testid="row-status">${statusLabel(status, this.statuses)}</span>${mobileSecondary
                    ? ` · ${mobileSecondary}`
                    : ''}`
                : this.mobile && inspectionDue
                  ? html`<span data-testid="row-inspection-due">Inspection due</span> · ${formatDate(item.inspection_date)}`
                  : this.mobile
                    ? mobileSecondary || 'No location'
                    : html`${renderAreaChip(parts.areaName)}<span class="hv-chip-line-text"
                        >${secondary || 'No location'}</span
                      >`}
          </span>
        </span>
        ${manuals(item.attachments).length
          ? html`<span
              class="doc-marker"
              data-testid="row-has-document"
              title="Has a document"
              aria-label="Has a document"
              >${icon('fileDocument', 14)}</span
            >`
          : null}
        ${this.pending
          ? html`<span class="hv-chip warning" data-testid="row-pending">Pending</span>`
          : null}
        ${!this.mobile && low
          ? html`<span class="hv-chip warning" data-testid="row-low" aria-label="Low stock">Low</span>`
          : null}
        ${!this.mobile && flagged
          ? renderStatusChip(status, this.statuses, { testid: 'row-status' })
          : null}
        ${!this.mobile && item.checked_out
          ? html`<span
              class="hv-chip ${overdue ? 'error' : 'state'}"
              data-testid="row-checked-out"
            >
              ${overdue ? `Overdue · ${formatDate(item.due_date)}` : 'Checked out'}
            </span>`
          : null}
        ${!this.mobile && inspectionDue
          ? html`<span class="hv-chip warning" data-testid="row-inspection-due">
              Inspection due
            </span>`
          : null}
        ${this.selectable
          ? null
          : html`<span class="hover-actions">
              <button
                data-testid="row-edit"
                aria-label=${`Edit ${item.name}`}
                title="Edit item"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._emit('edit');
                }}
              >
                ${icon('pencil', 18)}
              </button>
              <hv-overflow-menu
                data-testid="row-menu"
                label=${`Actions for ${item.name}`}
                .entries=${this._menuEntries(item)}
                @click=${(e: Event) => e.stopPropagation()}
                @select=${(e: CustomEvent) => {
                  e.stopPropagation();
                  const { id } = e.detail as { id: string };
                  // The check-out flow needs somewhere to anchor its popover.
                  const anchor = (
                    this.shadowRoot?.querySelector('[data-testid="row-menu"]') as HTMLElement | null
                  )?.getBoundingClientRect();
                  this._emit('row-action', { action: id, anchor });
                }}
              ></hv-overflow-menu>
            </span>`}
        ${this._renderStepper()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-list-row': HVListRow;
  }
}
