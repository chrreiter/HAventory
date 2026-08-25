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
import { itemStatus, renderStatusChip, statusLabel } from '../ui/status';
import {
  MEDIA_VARIANT_THUMB,
  MediaUrls,
  PictureFallback,
  ROW_THUMB_SIZE,
  ROW_THUMB_SIZE_TOUCH,
  attachmentNameToken,
  manuals,
  pictureAlt,
  pictures,
} from '../ui/media';
import type { MediaBindings } from '../ui/media';
import type { TemplateResult } from 'lit';
import type { AreaRef, Item, StatusDefinition } from '../store/types';
import './hv-overflow-menu';
import type { OverflowMenuEntry } from './hv-overflow-menu';

/** True when an item is at or under its low-stock threshold. */
export function isLowStock(item: Item): boolean {
  return typeof item.low_stock_threshold === 'number' && item.quantity <= item.low_stock_threshold;
}

/**
 * What a row's ⋮ offers, which depends on whether the item is out and whether
 * it has a due date.
 *
 * Shared with the full view's table rows: one list, one set of ids, and the
 * hosts' existing `row-action` handlers answer both surfaces.
 */
export function rowMenuEntries(item: Item): OverflowMenuEntry[] {
  if (item.checked_out) {
    return [
      { id: 'check-in', label: t('hv.action.checkIn'), glyph: 'account' },
      {
        id: 'set-due-date',
        label: item.due_date ? t('hv.row.menu.changeDueDate') : t('hv.row.menu.setDueDate'),
        glyph: 'calendar',
      },
      { divider: true },
      { id: 'delete', label: t('hv.action.deleteItem'), glyph: 'del' },
    ];
  }
  return [
    { id: 'check-out', label: t('hv.action.checkOutEllipsis'), glyph: 'account' },
    { id: 'edit', label: t('hv.action.edit'), glyph: 'pencil' },
    { divider: true },
    { id: 'delete', label: t('hv.action.deleteItem'), glyph: 'del' },
  ];
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
        /* A row opens the item it names, but it is a role=row div rather than a
           button — it has to hold the chips and controls a button cannot
           legally contain — so the hand that the shared button rule gives every
           other target has to be asked for here. */
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
      /* A fixed box, so a portrait photo and a landscape one leave the row the
         same height and the list keeps a single rhythm. Rows without a picture
         render nothing here rather than a placeholder: a mostly photo-less
         inventory would otherwise grow a column of empty squares. */
      .thumb {
        flex: none;
        width: ${unsafeCSS(ROW_THUMB_SIZE)}px;
        height: ${unsafeCSS(ROW_THUMB_SIZE)}px;
        border-radius: 6px;
        object-fit: cover;
        background: var(--hv-surface-raised);
      }
      :host([mobile]) .thumb {
        width: ${unsafeCSS(ROW_THUMB_SIZE_TOUCH)}px;
        height: ${unsafeCSS(ROW_THUMB_SIZE_TOUCH)}px;
      }
      /* The tile of a picture whose file the backend no longer has. It keeps
         the box, because a restore without the media directory leaves every row
         in this state and a list that dropped them all would reflow entirely.
         The glyph says a picture belongs here; the title and the label say why
         it is not being shown. */
      .thumb.missing {
        display: inline-grid;
        place-items: center;
        box-sizing: border-box;
        border: 1px dashed var(--hv-divider);
        color: var(--hv-text-tertiary);
      }
      /* Between the failure and the probe's answer. Hidden rather than removed:
         what an errored <img> draws is the browser's broken-image glyph with the
         alt text spilling out of a 34px square, which is the whole thing this
         state exists to keep off the row. */
      .thumb.broken {
        visibility: hidden;
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
      /* The mark belongs to the name, so it sits on the name's own line and
         follows wherever the name ends. Left on the row it was anchored to the
         free space instead: on a row with a thumbnail it landed against the
         truncated name, and on one without it floated out to the far edge,
         where it read as part of the quantity stepper. */
      .name-line {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      /* Both lines must be block containers with inline content, or the
         ellipsis is silently ignored: overflow does not apply to an inline box,
         and text-overflow does not apply to a flex container. .name is a flex
         item on the line above, which blockifies it and gives it an automatic
         minimum width it must give up to shrink at all; .secondary is a span
         inside a blockified flex item and was explicitly the second case — so
         a long path hard-cut mid-character with no "…" to say anything had
         been dropped. */
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
      /* Beats .secondary's own display:block, which is declared later than the
         shared fragment and would otherwise keep the row inline. */
      .secondary.hv-chip-line {
        display: flex;
      }
      /*
       * The phone line: pieces on a row, capped at the first row of them.
       *
       * An ellipsis only ever replaces text, and the area pill in the middle of
       * this line is an atomic box — inside one elided text run it was cut where
       * the edge fell, so a row leading with an overdue loan ended in half a
       * room name with nothing to say it had been cut. As flex items the pieces
       * are placed whole or not at all: the lead elides in place, and a pill or
       * tail the line cannot afford wraps onto a second row.
       *
       * That second row is what the cap hides, and the row-gap is what makes the
       * cap safe: it pushes the wrapped pieces far below the first row, so the
       * cap only has to clear the tallest piece instead of matching whatever
       * line-height the line inherits. A line with nothing to drop keeps its own
       * height, so a row without an area does not grow to meet the cap. 24px
       * clears the pill, which is the tallest thing here — 11.5px of text at
       * 1.4, plus its padding and border.
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
      /* First on the line and never wrapped away: what the row is flagged with
         is why the line is being read at all. It elides only when it alone
         outruns the line. */
      :host([mobile]) .secondary > .lead {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The pill and the " · " that introduces it travel as one piece, so a line
         with no room for the pill drops the separator with it rather than ending
         on a dot. Those two spaces are the piece's own text, and white-space:
         pre is what keeps them — a flex item's leading and trailing spaces are
         dropped otherwise.

         The pill's fill is what separates the area from the path after it: as
         plain text in the same colour and weight, a root location named after
         its own area prints the word twice with a single space between them and
         nothing to say which was which. */
      :host([mobile]) .secondary > .area {
        display: flex;
        align-items: center;
        flex: 0 1 auto;
        min-width: 0;
        white-space: pre;
      }
      /* A room name long enough to outrun the whole line elides inside the pill
         rather than being cut at the line's edge — the shared chip rule elides
         the label, and reaching it needs the pill to be allowed to shrink, which
         that rule holds at flex: none for the rows of chips elsewhere. */
      :host([mobile]) .secondary > .area > .hv-area-chip {
        flex: 0 1 auto;
        min-width: 0;
      }
      /* Takes what the pieces before it leave and elides inside it; below the
         floor it wraps away instead, because two characters of a location name
         and an ellipsis name nothing. */
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
      .secondary.out {
        color: var(--hv-primary-dark);
      }
      /* A date that has passed is the one thing on this line worth interrupting
         for — in the blue an upcoming date takes it reads as neither — and it
         is the same red the table's date cells and the sheet's facts use. The
         line names the date it is talking about, so the colour is left saying
         only that it has gone by. */
      .secondary.overdue {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* A flagged status is not a date and stays out of that vocabulary. Plain
         --hv-warn rather than --hv-warn-deep, which is the ink for text laid on
         --hv-warn-bg and is a shade meant for a tint, not for the row's own
         surface. */
      .secondary.flagged {
        color: var(--hv-warn);
        font-weight: 500;
      }
      /* Only ever drawn on the phone line, which is a flex row — so the space
         after it is that row's gap, and a margin of its own would double it. */
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
      /* Takes the stepper's place at both widths, so it is sized against the
         stepper it replaces — 30px is that control's height with its border. */
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
      /* A finger needs the platform minimum, and the phone row has the width for
         the padding to go with it. */
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
  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  /** Picture access; null means the row shows no thumbnail. */
  @property({ attribute: false }) media: MediaBindings | null = null;

  private readonly _urls = new MediaUrls(this);
  private readonly _thumbs = new PictureFallback(this, this._urls);

  private _dayUnsub?: () => void;

  /**
   * The due and inspection chips are read off the clock at render, so a row
   * whose date fell overdue overnight would keep yesterday's look until
   * something else made it redraw.
   */
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

  /**
   * The row's leading thumbnail: the item's first picture, or nothing.
   *
   * Asks for the `thumb` variant, so the tile costs a few KB rather than the
   * whole stored file; the backend serves the original whenever it cannot make
   * one, so this never decides whether the picture appears. `loading="lazy"`
   * and `decoding="async"` still matter — a long list would otherwise fetch and
   * decode everything at once.
   *
   * A file the backend no longer has is answered from the failure rather than
   * probed for up front — see `PictureFallback`.
   */
  private _renderThumb() {
    const first = pictures(this.item.attachments)[0];
    if (!first) return null;
    const state = this._thumbs.state(this.item.id, first.id);
    if (state === 'missing') {
      return html`<span
        class="thumb missing"
        data-testid="row-thumb-missing"
        role="img"
        aria-label=${t('hv.term.fileMissing')}
        title=${t('hv.term.fileMissing')}
        >${icon('camera', 18)}</span
      >`;
    }
    const src = this._urls.get(
      this.item.id,
      first.id,
      attachmentNameToken(first),
      MEDIA_VARIANT_THUMB,
    );
    if (!src) return null;
    return html`<img
      class=${state === 'errored' ? 'thumb broken' : 'thumb'}
      data-testid="row-thumb"
      src=${src}
      alt=${pictureAlt(this.item.name, 0, 1)}
      loading="lazy"
      decoding="async"
      @error=${() => this._thumbs.noteError(this.item.id, first.id)}
      @load=${() => this._thumbs.noteLoad(this.item.id, first.id)}
    />`;
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, { detail: { itemId: this.item.id, ...detail }, bubbles: true, composed: true }),
    );
  }

  /**
   * A key pressed on a control inside the row belongs to that control: Enter on
   * Edit opens the editor, and an open ⋮ menu holds the keyboard. Without the
   * guard the row answers those presses too — opening the item behind the menu,
   * or asking to delete it.
   */
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
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

  /**
   * The row's trailing control: the quantity stepper, or the way to take the
   * item back.
   *
   * A checked-out item's quantity is not the thing to adjust, and that holds at
   * any width — so the stepper gives its place to "Check in" rather than sitting
   * there greyed. The ⋮ menu still offers the same action, and on a wide row it
   * only appears on hover: a user who never hovers had no visible way to check
   * anything in from the list at all.
   */
  private _renderStepper() {
    const item = this.item;
    const low = isLowStock(item);
    if (item.checked_out) {
      return html`<button
        class="check-in"
        data-testid="row-check-in"
        @click=${(e: Event) => {
          e.stopPropagation();
          this._emit('check-in');
        }}
      >
        ${t('hv.action.checkIn')}
      </button>`;
    }
    return html`
      <span class="stepper" data-testid="row-stepper">
        <button
          data-testid="row-decrement"
          aria-label=${t('hv.row.decreaseQuantity')}
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
          aria-label=${t('hv.row.increaseQuantity')}
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

  /**
   * The phone row's second line, as up to three pieces: what the row leads
   * with, the area pill, and the location tail.
   *
   * Three elements rather than one run of text, because an ellipsis only
   * replaces text and the pill between them is an atomic box — see the
   * `:host([mobile]) .secondary` rule for what the pieces buy. The " · " that
   * introduces whichever piece follows the lead sits inside that piece, so a
   * line that drops it drops the separator with it; a line that has no lead
   * opens on the pill, which is how it always read.
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
    // `inspection_date` is the day the item is next due to be inspected, so
    // that day is already asking — inclusive, unlike the due date above.
    const inspectionDue = isDue(item.inspection_date);
    const parts = itemPathParts(item, this.areas);
    const areaMark = areaMarkName(parts.areaName, parts.path);
    // The desktop row has room for the whole path and the area chip beside it.
    const secondary = [parts.path, item.category].filter(Boolean).join(' · ');
    // A phone line has no room for the whole path, so the area travels through
    // the elision as the leading segment — the half elidePath keeps — and comes
    // back out of it as the same pill the wide row hangs beside a path. The
    // pill's fill is what marks the boundary: as plain text in the path's own
    // colour and weight, a root named after its area read as one word twice.
    const mobileLead = elideMobilePath(areaMark, parts.path);
    const mobileTail = [mobileLead.rest, item.category].filter(Boolean).join(' · ');
    const hasMobileSecondary = Boolean(mobileLead.area || mobileTail);
    // The tooltip carries the *unelided* path: on a phone the middle of it is
    // dropped on purpose, and this is where the whole thing can still be read.
    const secondaryFull = [pathTitle(parts), item.category].filter(Boolean).join(' · ');
    // A phone row has one line for all of this and no room for the chips the
    // wide row hangs on the right, so the line leads with the most interrupting
    // thing it has: who has the item, then what state it is flagged with, then
    // what it is waiting for. Being out and being flagged put the location
    // behind them rather than in place of them — the wide row shows both, and a
    // borrowed item is exactly the one whose shelf you want to read. What runs
    // past the edge elides, so the width decides how much of it survives.
    const status = itemStatus(item);
    const flagged = status !== 'ok';
    // The line takes its tone from what it ends up saying, which follows the
    // same order the branches below do. A date that has passed outranks the
    // rest: an inspection line only ever prints one, and a check-out line
    // prints one whenever the loan carries a due date it has gone past.
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
        ${this._renderThumb()}
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
                  ? // The one phone line that says nothing about where the item
                    // is: the chore and its date take all of it.
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
        ${!this.mobile && low
          ? html`<span class="hv-chip warning" data-testid="row-low" aria-label=${t('hv.term.lowStock')}
              >${t('hv.term.low')}</span
            >`
          : null}
        ${!this.mobile && flagged
          ? renderStatusChip(status, this.statuses, { testid: 'row-status' })
          : null}
        ${!this.mobile && item.checked_out
          ? html`<span
              class="hv-chip ${overdue ? 'error' : 'state'}"
              data-testid="row-checked-out"
            >
              ${overdue
                ? t('hv.term.overdueOn', { date: formatDate(item.due_date) })
                : t('hv.term.checkedOut')}
            </span>`
          : null}
        ${!this.mobile && inspectionDue
          ? html`<span class="hv-chip warning" data-testid="row-inspection-due">
              ${t('hv.term.inspectionDue')}
            </span>`
          : null}
        <span class="hover-actions">
          <button
            data-testid="row-edit"
            aria-label=${t('hv.row.editNamed', { name: item.name })}
            title=${t('hv.row.editItem')}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._emit('edit');
            }}
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
              // The check-out flow needs somewhere to anchor its popover.
              const anchor = (
                this.shadowRoot?.querySelector('[data-testid="row-menu"]') as HTMLElement | null
              )?.getBoundingClientRect();
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
