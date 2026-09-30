import { t } from '../i18n';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import {
  areaMarkName,
  elideMobilePath,
  itemPathParts,
  pathTitle,
  renderAreaChip,
} from '../ui/location-path';
import { icon } from '../ui/icons';
import { onDayChange } from '../ui/day-clock';
import { formatDate, isDue, isOverdue } from '../ui/relative-time';
import { itemStatus, statusLabel } from '../ui/status';
import {
  isLowStock,
  renderNameChips,
  renderRowThumb,
  rowChrome,
  rowKeyAction,
  rowMenuEntries,
} from '../ui/row-chrome';
import { MediaUrls, PictureFallback, ROW_THUMB_SIZE_TOUCH, manuals } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import type { TemplateResult } from 'lit';
import type { AreaRef, Item, StatusDefinition } from '../store/types';
import './hv-overflow-menu';

/**
 * One row of the standard card list. Desktop reveals edit and the row menu on
 * hover; on touch the whole row opens the detail sheet. A checked-out row
 * trades its stepper for "Check in".
 */
@customElement('hv-list-row')
export class HVListRow extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    rowChrome,
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
        /* A role=row div, since it holds buttons, so it asks for the pointer. */
        cursor: pointer;
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
      .names {
        flex: 1;
        min-width: 0;
      }
      :host([mobile]) .thumb {
        width: ${unsafeCSS(ROW_THUMB_SIZE_TOUCH)}px;
        height: ${unsafeCSS(ROW_THUMB_SIZE_TOUCH)}px;
      }
      /* A mark, not a chip: a manual is a fact, not a state to act on. */
      .doc-marker {
        flex: none;
        display: inline-grid;
        place-items: center;
        color: var(--hv-text-tertiary);
      }
      /* The mark sits on the name's line and follows wherever the name ends. */
      .name-line {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      /* Both lines are blocks with a zero minimum width, or text-overflow has
         nothing to act on. */
      .name {
        display: block;
        min-width: 0;
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
      /* Beats .secondary's display:block, declared after the shared fragment. */
      .secondary.hv-chip-line {
        display: flex;
      }
      /*
       * The phone line: pieces on a row, capped at the first row of them. The
       * area pill is an atomic box an ellipsis cannot cut, so a piece that does
       * not fit wraps to a second row, which the huge row-gap pushes out of the
       * 24px cap (the pill's height).
       */
      :host([mobile]) .secondary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        align-content: flex-start;
        column-gap: 6px;
        row-gap: 200px;
        max-height: 24px;
        overflow: hidden;
      }
      /* The lead is never wrapped away; it elides only when it alone outruns the line. */
      :host([mobile]) .secondary > .lead {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The pill and its " · " travel as one piece, so a dropped pill drops the
         separator too; white-space: pre keeps the piece's own spaces. */
      :host([mobile]) .secondary > .area {
        display: flex;
        align-items: center;
        flex: 0 1 auto;
        min-width: 0;
        white-space: pre;
      }
      /* Lets the pill shrink so its label elides; the shared rule holds it at flex: none. */
      :host([mobile]) .secondary > .area > .hv-area-chip {
        flex: 0 1 auto;
        min-width: 0;
      }
      /* Below the floor the tail wraps away rather than eliding to nothing. */
      :host([mobile]) .secondary > .tail {
        flex: 1 1 0;
        min-width: 4ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The path elides; the chip ahead of it does not. */
      .secondary.hv-chip-line > .hv-chip-line-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The tone belongs to the lead, not to the location behind it. */
      .secondary.out > .lead {
        color: var(--hv-primary-dark);
      }
      /* A passed date, in the table's red. */
      .secondary.overdue > .lead {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* --hv-warn, not --hv-warn-deep, which is ink for a --hv-warn-bg tint. */
      .secondary.flagged > .lead {
        color: var(--hv-warn);
        font-weight: 500;
      }
      /* Phone line only, whose gap spaces it. */
      .dot {
        flex: none;
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
      /* Real size, not an expanded hit area that would overlap the neighbour. */
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
      /* The stepper's place and height. */
      .check-in {
        flex: none;
        border: 1px solid var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-darker);
        border-radius: var(--hv-radius-chip);
        min-height: 30px;
        padding: 0 12px;
        font: 500 13px var(--hv-font);
      }
      .check-in:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .check-in {
        min-height: var(--hv-tap-min, 40px);
        padding: 0 18px;
        font-size: 13.5px;
      }
    `,
  ];

  @property({ attribute: false }) item!: Item;
  @property({ type: Boolean, reflect: true }) mobile = false;
  /** HA areas, to name the one the item's location resolves to. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  /** Picture access; null means the row shows no thumbnail. */
  @property({ attribute: false }) media: MediaBindings | null = null;

  private readonly _urls = new MediaUrls(this);
  private readonly _thumbs = new PictureFallback(this, this._urls);

  private _dayUnsub?: () => void;

  /** The due and inspection chips read the clock, so midnight redraws them. */
  connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this._dayUnsub?.();
    this._dayUnsub = undefined;
    super.disconnectedCallback();
  }

  protected willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { itemId: this.item.id, ...detail }, bubbles: true, composed: true }),
    );
  }

  private _onKeydown = (e: KeyboardEvent) => {
    const action = rowKeyAction(e);
    if (action) this._emit(action);
  };

  /** A click handler that emits `name` without the click reaching the row. */
  private _emitOnly(name: string) {
    return (e: Event) => {
      e.stopPropagation();
      this._emit(name);
    };
  }

  /**
   * The row's trailing control: the quantity stepper, or "Check in" in its
   * place, since an item that is out has no quantity to adjust.
   */
  private _renderStepper() {
    const item = this.item;
    if (item.checked_out) {
      return html`<button class="check-in" data-testid="row-check-in" @click=${this._emitOnly('check-in')}>
        ${t('hv.action.checkIn')}
      </button>`;
    }
    return html`
      <span class="stepper" data-testid="row-stepper">
        <button
          data-testid="row-decrement"
          aria-label=${t('hv.row.decreaseQuantity')}
          @click=${this._emitOnly('decrement')}
        >
          ${icon('minus', 16)}
        </button>
        <span class="qty ${isLowStock(item) ? 'low' : ''}" data-testid="row-qty">${item.quantity}</span>
        <button
          data-testid="row-increment"
          aria-label=${t('hv.row.increaseQuantity')}
          @click=${this._emitOnly('increment')}
        >
          ${icon('plus', 16)}
        </button>
      </span>
    `;
  }

  /**
   * The phone row's second line, as up to three pieces: the lead, the area
   * pill and the location tail. The " · " before a piece sits inside it, so a
   * dropped piece takes its separator along.
   */
  private _mobileSecondary(lead: TemplateResult | null, area: string | null, tail: string) {
    return html`${lead === null
      ? null
      : html`<span class="lead" data-testid="row-lead">${lead}</span>`}${area === null
      ? null
      : html`<span class="area" data-testid="row-area"
          >${lead === null ? '' : ' · '}${renderAreaChip(area)}</span
        >`}${tail
      ? html`<span class="tail" data-testid="row-tail"
          >${lead !== null && area === null ? ' · ' : ''}${tail}</span
        >`
      : null}`;
  }

  render() {
    const item = this.item;
    if (!item) return null;
    const low = isLowStock(item);
    const overdue = isOverdue(item.due_date);
    // Inclusive, unlike the due date: the inspection day is already asking.
    const inspectionDue = isDue(item.inspection_date);
    const parts = itemPathParts(item, this.areas);
    const areaMark = areaMarkName(parts.areaName, parts.path);
    const secondary = [parts.path, item.category].filter(Boolean).join(' · ');
    // A phone line elides the path's middle, and the area comes back out of the
    // elision as a pill.
    const mobileLead = elideMobilePath(areaMark, parts.path);
    const mobileTail = [mobileLead.rest, item.category].filter(Boolean).join(' · ');
    const hasMobileSecondary = Boolean(mobileLead.area || mobileTail);
    // The tooltip carries the unelided path.
    const secondaryFull = [pathTitle(parts), item.category].filter(Boolean).join(' · ');
    // A phone line leads with the most interrupting thing it has: who has the
    // item, then its flagged status, then an inspection. The location follows.
    const status = itemStatus(item);
    const flagged = status !== 'ok';
    // The tone follows what the line says; a passed date outranks the rest.
    const mobileState = overdue || (!item.checked_out && !flagged && inspectionDue)
      ? 'overdue'
      : item.checked_out
        ? 'out'
        : flagged
          ? 'flagged'
          : '';

    return html`
      <div
        class="row ${this.mobile ? 'touch' : ''}"
        role="row"
        tabindex="0"
        aria-label=${t('hv.row.label', { name: item.name })}
        data-testid="list-row"
        data-item-id=${item.id}
        @keydown=${this._onKeydown}
        @click=${() => this._emit('open-item')}
      >
        ${renderRowThumb(item, this._urls, this._thumbs)}
        <span class="names">
          <span class="name-line">
            <span class="name" data-testid="row-name" title=${item.name}>${item.name}</span>
            ${manuals(item.attachments).length
              ? html`<span
                  class="doc-marker"
                  data-testid="row-has-document"
                  title=${t('hv.row.hasDocument')}
                  aria-label=${t('hv.row.hasDocument')}
                  >${icon('fileDocument', 14)}</span
                >`
              : null}
          </span>
          <span
            class="secondary ${this.mobile ? mobileState : 'hv-chip-line'}"
            data-testid="row-secondary"
            title=${secondaryFull}
          >
            ${this.mobile && low && !item.checked_out
              ? html`<span class="dot" data-testid="row-low-dot"></span>`
              : null}
            ${this.mobile && item.checked_out
              ? this._mobileSecondary(
                  html`${overdue ? t('hv.term.overdue') : t('hv.term.checkedOut')}${item.due_date
                    ? ` · ${t('hv.term.due', { date: formatDate(item.due_date) })}`
                    : ''}`,
                  mobileLead.area,
                  mobileTail,
                )
              : this.mobile && flagged
                ? this._mobileSecondary(
                    html`<span data-testid="row-status">${statusLabel(status, this.statuses)}</span>`,
                    mobileLead.area,
                    mobileTail,
                  )
                : this.mobile && inspectionDue
                  ? // The chore and its date take the whole line.
                    this._mobileSecondary(
                      html`<span data-testid="row-inspection-due">${t('hv.term.inspectionDue')}</span> ·
                        ${formatDate(item.inspection_date)}`,
                      null,
                      '',
                    )
                  : this.mobile
                    ? this._mobileSecondary(
                        null,
                        mobileLead.area,
                        hasMobileSecondary ? mobileTail : t('hv.term.noLocation'),
                      )
                    : html`${renderAreaChip(areaMark)}<span class="hv-chip-line-text"
                        >${secondary || t('hv.term.noLocation')}</span
                      >`}
          </span>
        </span>
        ${this.mobile
          ? // The phone row's one line has said all of this already.
            null
          : renderNameChips(item, this.statuses, {
              prefix: 'row',
              // Nothing else on the row carries the due date.
              overdueText: 'overdueOn',
            })}
        ${!this.mobile && inspectionDue
          ? html`<span class="hv-chip warning" data-testid="row-inspection-due">
              ${t('hv.term.inspectionDue')}
            </span>`
          : null}
        <span class="hover-actions">
          <button
            data-testid="row-edit"
            aria-label=${t('hv.row.editNamed', { name: item.name })}
            title=${t('hv.action.editItem')}
            @click=${this._emitOnly('edit')}
          >
            ${icon('pencil', 18)}
          </button>
          <hv-overflow-menu
            data-testid="row-menu"
            label=${t('hv.row.actionsFor', { name: item.name })}
            .entries=${rowMenuEntries(item)}
            @click=${(e: Event) => e.stopPropagation()}
            @select=${(e: CustomEvent) => {
              e.stopPropagation();
              const { id } = e.detail as { id: string };
              // The check-out popover anchors to the menu.
              const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
              this._emit('row-action', { action: id, anchor });
            }}
          ></hv-overflow-menu>
        </span>
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
