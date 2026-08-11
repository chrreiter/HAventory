import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip, renderTagChip } from '../ui/chip';
import { icon } from '../ui/icons';
import { formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { customFieldLabel } from '../ui/field-label';
import { inferType } from '../ui/item-form';
import { DEFAULT_STATUS, itemStatus, renderStatusChip } from '../ui/status';
import { isLowStock } from './hv-list-row';
import { itemPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import {
  MediaUrls,
  attachmentNameToken,
  attachmentTitle,
  formatBytes,
  manuals,
  pictureAlt,
  pictures,
} from '../ui/media';
import type { MediaBindings } from '../ui/media';
import { DISCARD_PROMPT } from '../ui/discard';
import { ViewportNarrow } from '../ui/responsive';
import type { AreaRef, Item, Location, LocationTreeNode, MediaConfig, ScalarValue, StatusDefinition } from '../store/types';
import './hv-bottom-sheet';
import './hv-checkout-popover';
import './hv-confirm';
import './hv-item-editor';
import './hv-lightbox';
import type { HVBottomSheet } from './hv-bottom-sheet';
import type { HVItemEditor } from './hv-item-editor';

/**
 * The narrow item surface: tap a row, get one sheet.
 *
 * It lands on a read view — chips summarise state, the quantity hero is the
 * primary action — and swaps in place to the edit form. Nothing here opens a
 * second dialog; that is the whole point of the sheet.
 *
 * Both narrow surfaces host it — the card and the full view (and through it the
 * sidebar panel) — so the contract is worth stating rather than reading off one
 * host's bindings:
 *
 * - **In**: `item` and `open` say what to show; `locations`, `locationTree`,
 *   `areas`, `statuses`, `categorySuggestions`, `tagSuggestions`,
 *   `customFieldKeys`, `media` and `mediaConfig` are the store slices the read
 *   view and the form it hosts read; `busy` and `errorMessage` are the host's
 *   account of the save in flight, forwarded to the form.
 * - **Out**: `save` (the editor's own detail, so a host's editor-save handler
 *   takes it unchanged), `increment` / `decrement`, `check-in`,
 *   `check-out-confirmed` and `set-due-date` with the picked date,
 *   `request-delete` — every one carrying `itemId` — and `cancel` when the
 *   sheet has finished closing.
 * - The sheet answers for the form inside it: a dismissal with unsaved typing
 *   raises the discard question here, and `cancel` follows only if it is
 *   answered yes. A host must not try to guard the form from outside; it cannot
 *   see into this shadow root.
 */
@customElement('hv-detail-sheet')
export class HVDetailSheet extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 4px;
      }
      .bar.edit {
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .bar .crumb {
        flex: 1;
        min-width: 0;
        /* This and the quantity below are the two things the read view is for,
           and they were 12.5px and 34px — a factor of 2.7 apart, with the path
           the smallest text on the sheet and the number half again bigger than
           anything else on it. Both now sit on the sheet's own scale: the path
           reads at body size, like the description under it. */
        font-size: 13.5px;
        color: var(--hv-text-secondary);
        overflow: hidden;
      }
      /* The path elides; the chip ahead of it does not. */
      .bar .crumb > .hv-chip-line-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .bar .heading {
        flex: 1;
        font-size: 16px;
        font-weight: 500;
      }
      .bar button.tap {
        min-width: 44px;
        min-height: 44px;
        border: none;
        background: none;
        color: var(--hv-text-secondary);
        display: inline-grid;
        place-items: center;
        border-radius: 50%;
      }
      .bar .text-action {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        min-height: 44px;
        padding: 0 14px;
        font: 500 14px var(--hv-font);
      }
      .bar .save {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        border-radius: var(--hv-radius-chip);
        height: 40px;
        padding: 0 20px;
        margin-right: 8px;
        font: 500 14px var(--hv-font);
      }
      .title {
        padding: 2px 18px 10px;
      }
      .title h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 500;
        line-height: 1.25;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .hero {
        margin: 0 14px 14px;
        background: var(--hv-surface-raised);
        border-radius: 14px;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
      }
      .hero button {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: inline-grid;
        place-items: center;
        flex: none;
        padding: 0;
      }
      .hero .minus {
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
      }
      .hero .plus {
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
      }
      .hero button[disabled] {
        opacity: 0.4;
      }
      .hero .readout {
        text-align: center;
        min-width: 90px;
      }
      .hero .qty {
        /* The top of the sheet's scale, which is the item's own name — the
           readout is still the biggest number on the surface and still the
           thing the two 52px buttons point at, without out-shouting the item
           it belongs to. See the note on .bar .crumb. */
        font-size: 22px;
        font-weight: 500;
        line-height: 1;
      }
      .hero .qty.low {
        color: var(--hv-warn);
      }
      .hero .caption {
        font-size: 11.5px;
        color: var(--hv-text-secondary);
        margin-top: 6px;
      }
      .description {
        padding: 0 18px 12px;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--hv-text-secondary);
      }
      .facts {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
      }
      .fact {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 8px 18px;
        background: var(--hv-surface);
        font-size: 13.5px;
        color: var(--hv-text-secondary);
      }
      .fact .value {
        margin-left: auto;
        color: var(--hv-text);
        text-align: right;
      }
      .fact .value.unset {
        color: var(--hv-text-tertiary);
      }
      .fact .value.yes {
        color: var(--hv-success);
      }
      /* An inspection date that has passed asks for something to be done, so
         it does not read as a neutral fact. Same amber as the chip above it. */
      .fact .value.late {
        color: var(--hv-warn-deep);
        font-weight: 500;
      }
      .actions {
        display: grid;
        gap: 9px;
        padding: 12px 14px 16px;
      }
      .actions .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      /* The pair's other half. It shares the row with an .hv-pill.large, and a
         stretch grid gives both the taller one's height — so a private height
         here would silently override the modifier that exists to keep every
         thumb-sized action the same size. */
      .actions .outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 48px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .danger {
        min-height: 48px;
        border: none;
        background: none;
        color: var(--hv-error-soft);
        font: 400 14px var(--hv-font);
      }
      /* One row that scrolls sideways rather than a grid that grows the sheet:
         the sheet's own vertical scroll is how you reach the facts below, and a
         wrapping gallery would push them off a phone screen entirely. */
      .gallery {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 0 14px 14px;
        margin: 0;
        scroll-snap-type: x mandatory;
      }
      .gallery figure {
        margin: 0;
        flex: none;
        scroll-snap-align: start;
      }
      .gallery button {
        display: block;
        padding: 0;
        border: none;
        background: none;
        border-radius: 10px;
        overflow: hidden;
      }
      .gallery img {
        display: block;
        width: 116px;
        height: 116px;
        object-fit: cover;
        background: var(--hv-surface-raised);
      }
      .documents {
        padding: 0 18px 14px;
      }
      .documents h3 {
        margin: 0 0 6px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
      }
      .documents ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        /* One track the width of the list, not the width of its widest row. An
           implicit track sizes itself from the rows, and a row's tail — the
           Open link and the "File missing" chip — cannot shrink, so the track
           runs past the list and the hidden overflow below cuts off exactly the
           two elements the row exists to offer. */
        grid-template-columns: minmax(0, 1fr);
        gap: 1px;
        background: var(--hv-row-divider);
        border-radius: 10px;
        overflow: hidden;
      }
      .documents li {
        display: flex;
        align-items: center;
        gap: 10px;
        /* A grid item's automatic minimum is its own content, which would put
           the row straight back outside the track above. */
        min-width: 0;
        min-height: 52px;
        padding: 8px 12px;
        background: var(--hv-surface);
      }
      .documents .doc-icon {
        display: inline-grid;
        place-items: center;
        flex: none;
        color: var(--hv-text-secondary);
      }
      .documents .doc-text {
        flex: 1;
        min-width: 0;
      }
      .documents .doc-title {
        display: block;
        font-size: 13.5px;
        color: var(--hv-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .documents .doc-meta {
        display: block;
        font-size: 11.5px;
        color: var(--hv-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .documents .doc-open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: none;
        min-height: 40px;
        padding: 0 12px;
        border-radius: var(--hv-radius-chip);
        color: var(--hv-primary-dark);
        text-decoration: none;
        font: 500 13px var(--hv-font);
      }
      /* The row still names the document; only what it promised to open is
         struck through, so the reference reads as a record rather than as
         something broken beyond recognition. */
      .documents li.missing .doc-title {
        color: var(--hv-text-secondary);
        text-decoration: line-through;
      }
    `,
  ];

  @property({ attribute: false }) item: Item | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** HA areas, for the editor this sheet hosts. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) categorySuggestions: string[] = [];
  @property({ attribute: false }) tagSuggestions: string[] = [];
  @property({ attribute: false }) customFieldKeys: string[] = [];
  /** Passed straight to the editor: creating a first location from its picker. */
  @property({ attribute: false }) createLocation: ((name: string) => Promise<Location>) | null =
    null;
  @property({ type: Boolean }) busy = false;
  @property({ type: String }) errorMessage: string | null = null;

  /** Picture access for the gallery, the lightbox and the editor it hosts. */
  /** The status vocabulary from `haventory/config`; the built-ins stand in
   * until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Attachment caps and accepted types, forwarded to the editor's picker. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;

  @state() private _mode: 'read' | 'edit' = 'read';
  /** The check-out date step, shown inline in the sheet rather than as a popup. */
  @state() private _checkoutOpen = false;
  /** Which picture the lightbox was opened on, or null when it is closed. */
  @state() private _lightbox: number | null = null;
  /**
   * Where the sheet goes once a discard is confirmed, or null while nothing is
   * being asked. The two answers differ: leaving the form lands on the read
   * view, dismissing the sheet takes the whole surface down.
   */
  @state() private _pendingDiscard: 'read' | 'close' | null = null;

  private readonly _urls = new MediaUrls(this);
  /** Window width, for the confirm this sheet raises over itself. */
  private readonly _viewport = new ViewportNarrow(this);
  /**
   * The item id the sheet is showing. `undefined` until the first update, so
   * that pass settles the view the same way a move to another item does.
   */
  private _shownItemId: string | null | undefined;

  /**
   * Another item, or a re-open, always lands on the read view.
   *
   * Keyed on the item *id*, not on the `item` object: the host re-binds it from
   * a fresh lookup on every store broadcast, so each attachment mutation hands
   * the sheet a new object for the item it is already showing. Resetting on
   * that would close the edit form — and the lightbox — under the user mid-tap.
   */
  protected willUpdate(changed: Map<string, unknown>) {
    this._urls.configure(this.media?.sign ?? null);
    const id = this.item?.id ?? null;
    const moved = id !== this._shownItemId;
    this._shownItemId = id;
    if (moved || (changed.has('open') && this.open)) {
      this._mode = 'read';
      this._checkoutOpen = false;
      this._lightbox = null;
      this._pendingDiscard = null;
    }
  }

  /** True when the edit form is open with unsaved changes. */
  get dirty(): boolean {
    if (this._mode !== 'edit') return false;
    return this._editor?.dirty ?? false;
  }

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  private get _sheet(): HVBottomSheet | null {
    return this.shadowRoot?.querySelector('hv-bottom-sheet') ?? null;
  }

  private _emit(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: { itemId: this.item?.id, ...detail },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  /**
   * Every way out of this sheet, with the form's typing accounted for.
   *
   * The sheet answers for the editor it hosts: a host outside cannot see into
   * this shadow root, and the scrim, the swipe and Escape all arrive here
   * first. `read` is the Back arrow and the form's own cancel — the sheet stays
   * up on its read view; `close` is a dismissal and takes the sheet with it.
   */
  private _leaveEdit(to: 'read' | 'close') {
    if (this.dirty) {
      this._pendingDiscard = to;
      return;
    }
    if (to === 'read') this._mode = 'read';
    else this._close();
  }

  /**
   * One custom field, as a fact rather than as a stored pair.
   *
   * The label is written for reading; `data-key` still carries the key itself,
   * which is what the editor shows and what an export document and an
   * automation name.
   */
  private _renderCustomFact(key: string, value: ScalarValue) {
    const type = inferType(value);
    const label = customFieldLabel(key);
    if (type === 'boolean') {
      const on = value === true;
      return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
        <span>${label}</span>
        <span class="value ${on ? 'yes' : 'unset'}">
          ${on ? html`${icon('check', 15)} Yes` : 'No'}
        </span>
      </div>`;
    }
    return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
      <span>${label}</span>
      <span class="value">${type === 'date' ? formatDate(String(value)) : String(value)}</span>
    </div>`;
  }

  /**
   * The picture strip, or nothing at all when the item has none.
   *
   * Each figure is a button: tapping one opens the lightbox, which is the only
   * way to see a photo at a useful size on a phone.
   */
  private _renderGallery(item: Item) {
    const shots = pictures(item.attachments);
    if (!shots.length) return null;
    return html`<div class="gallery" data-testid="sheet-gallery">
      ${shots.map((picture, index) => {
        const src = this._urls.get(item.id, picture.id, attachmentNameToken(picture));
        if (!src) return null;
        return html`<figure data-testid="sheet-photo">
          <button
            data-testid="sheet-photo-open"
            aria-label=${`Open ${pictureAlt(item.name, index, shots.length)}`}
            @click=${() => {
              this._lightbox = index;
            }}
          >
            <img
              src=${src}
              alt=${pictureAlt(item.name, index, shots.length)}
              loading="lazy"
              decoding="async"
            />
          </button>
        </figure>`;
      })}
    </div>`;
  }

  /**
   * The documents attached to the item, or nothing when there are none.
   *
   * Each row is an anchor to the signed media URL rather than a button that
   * opens one: the URL has to be on the element before the tap, or the popup
   * blocker eats the new tab a handler would open after awaiting a signature.
   *
   * A reference whose file the backend cannot find is shown as missing instead
   * of as a link that leads to a 404 — a JSON export carries the metadata and
   * not the bytes, so a fresh install genuinely can hold one.
   */
  private _renderDocuments(item: Item) {
    const docs = manuals(item.attachments);
    if (!docs.length) return null;
    return html`<div class="documents" data-testid="sheet-documents">
      <h3>Documents</h3>
      <ul>
        ${docs.map((doc) => {
          const src = this._urls.get(item.id, doc.id, attachmentNameToken(doc));
          const missing = this._urls.presence(item.id, doc.id) === 'missing';
          const title = attachmentTitle(doc);
          // The title falls back to the filename, which is the state every
          // document is in until someone renames it — naming the file again
          // underneath prints the same string twice and costs a line.
          const meta = [
            ...(title === doc.filename ? [] : [doc.filename]),
            formatBytes(doc.size),
            `added ${relativeTime(doc.uploaded_at)}`,
          ].join(' · ');
          return html`<li class=${missing ? 'missing' : ''} data-testid="sheet-document">
            <span class="doc-icon">${icon('fileDocument', 20)}</span>
            <span class="doc-text">
              <span class="doc-title" data-testid="sheet-document-title">${title}</span>
              <span class="doc-meta" data-testid="sheet-document-meta">${meta}</span>
            </span>
            ${missing
              ? html`<span class="hv-chip warning" data-testid="sheet-document-missing"
                  >File missing</span
                >`
              : src
                ? html`<a
                    class="doc-open"
                    data-testid="sheet-document-open"
                    href=${src}
                    target="_blank"
                    rel="noopener noreferrer"
                    >${icon('openInNew', 15)}Open</a
                  >`
                : null}
          </li>`;
        })}
      </ul>
    </div>`;
  }

  /**
   * One picture at full size, with a way through the rest of the strip.
   *
   * Stepping wraps rather than stopping at the ends: these are one item's
   * photos and comparing them is what the surface is for, so no press is ever a
   * no-op — and a control that disabled itself under the finger that pressed it
   * would drop focus to the document, taking Escape and the arrow keys with it.
   */
  private _renderRead(item: Item) {
    const low = isLowStock(item);
    const overdue = isOverdue(item.due_date);
    // `inspection_date` is when the item is next due for inspection, so the
    // same passed-date test the due date gets answers "needs inspecting".
    const inspectionDue = isOverdue(item.inspection_date);
    const parts = itemPathParts(item, this.areas);
    const customEntries = Object.entries(item.custom_fields ?? {});

    return html`
      <div class="bar">
        <button class="tap" data-testid="sheet-close" aria-label="Close" @click=${() => this._leaveEdit('close')}>
          ${icon('close', 22)}
        </button>
        <span class="crumb hv-chip-line" data-testid="sheet-path" title=${pathTitle(parts)}
          >${renderAreaChip(parts.areaName)}<span class="hv-chip-line-text"
            >${parts.path || 'No location'}</span
          ></span
        >
        <button
          class="text-action"
          data-testid="sheet-edit"
          @click=${() => {
            this._mode = 'edit';
          }}
        >
          Edit
        </button>
      </div>

      <div class="title">
        <h2 data-testid="sheet-name">${item.name}</h2>
        <div class="chips">
          ${low
            ? html`<span class="hv-chip warning" data-testid="sheet-low" aria-label="Low stock"
                >Low</span
              >`
            : null}
          ${itemStatus(item) !== DEFAULT_STATUS
            ? renderStatusChip(itemStatus(item), this.statuses, { testid: 'sheet-status' })
            : null}
          ${item.checked_out
            ? html`<span
                class="hv-chip ${overdue ? 'error' : 'state'}"
                data-testid="sheet-out"
              >
                ${overdue ? 'Overdue' : 'Checked out'}${item.due_date
                  ? ` · due ${formatDate(item.due_date)}`
                  : ''}
              </span>`
            : null}
          ${inspectionDue
            ? html`<span class="hv-chip warning" data-testid="sheet-inspection-due">
                Inspection due · ${formatDate(item.inspection_date)}
              </span>`
            : null}
          ${item.category ? html`<span class="hv-chip" data-testid="sheet-category">${item.category}</span>` : null}
          ${item.tags.map((t) => renderTagChip(t, 'sheet-tag'))}
        </div>
      </div>

      <div class="hero">
        <button
          class="minus"
          data-testid="sheet-decrement"
          aria-label="Decrease quantity"
          ?disabled=${item.checked_out || item.quantity <= 0}
          @click=${() => this._emit('decrement')}
        >
          ${icon('minus', 22)}
        </button>
        <span class="readout">
          <span class="qty ${low ? 'low' : ''}" data-testid="sheet-qty">${item.quantity}</span>
          ${item.low_stock_threshold !== null
            ? html`<span class="caption" data-testid="sheet-threshold"
                >low-stock at ${item.low_stock_threshold}</span
              >`
            : null}
        </span>
        <button
          class="plus"
          data-testid="sheet-increment"
          aria-label="Increase quantity"
          ?disabled=${item.checked_out}
          @click=${() => this._emit('increment')}
        >
          ${icon('plus', 22)}
        </button>
      </div>

      ${this._renderGallery(item)} ${this._renderDocuments(item)}

      ${item.description
        ? html`<div class="description" data-testid="sheet-description">${item.description}</div>`
        : null}

      <div class="facts">
        <div class="fact" data-testid="sheet-fact" data-key="due">
          <span>Due</span>
          <span class="value ${item.due_date ? '' : 'unset'}">${item.due_date ? formatDate(item.due_date) : 'Not set'}</span>
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="inspection">
          <span>Next inspection</span>
          <span class="value ${item.inspection_date ? '' : 'unset'} ${inspectionDue ? 'late' : ''}"
            >${item.inspection_date ? formatDate(item.inspection_date) : 'Not set'}</span
          >
        </div>
        ${customEntries.map(([key, value]) => this._renderCustomFact(key, value))}
        <div class="fact" data-testid="sheet-fact" data-key="updated">
          <span>Updated</span>
          <span class="value" data-testid="sheet-updated"
            >${relativeTime(item.updated_at)} · v${item.version}</span
          >
        </div>
      </div>

      ${this._checkoutOpen
        ? html`<div style="padding: 0 14px 14px">
            <hv-checkout-popover
              mobile
              open
              data-testid="sheet-checkout"
              .item=${item}
              .mode=${item.checked_out ? 'set-due-date' : 'check-out'}
              @check-out=${(e: CustomEvent) => {
                this._checkoutOpen = false;
                this._emit('check-out-confirmed', {
                  dueDate: (e.detail as { dueDate: string | null }).dueDate,
                });
              }}
              @set-due-date=${(e: CustomEvent) => {
                this._checkoutOpen = false;
                this._emit('set-due-date', { dueDate: (e.detail as { dueDate: string | null }).dueDate });
              }}
              @cancel=${(e: Event) => {
                // Composed, like every cancel in the card: unstopped it reaches
                // the host as "the sheet closed" and takes the item down with
                // the date step the user was only backing out of.
                e.stopPropagation();
                this._checkoutOpen = false;
              }}
            ></hv-checkout-popover>
          </div>`
        : null}

      <div class="actions">
        <div class="pair">
          ${item.checked_out
            ? html`<button class="outline" data-testid="sheet-check-in" @click=${() => this._emit('check-in')}>
                ${icon('account', 18)}Check in
              </button>`
            : html`<button
                class="outline"
                data-testid="sheet-check-out"
                @click=${() => {
                  this._checkoutOpen = true;
                }}
              >
                ${icon('account', 18)}Check out
              </button>`}
          <button
            class="hv-pill large"
            data-testid="sheet-edit-details"
            @click=${() => {
              this._mode = 'edit';
            }}
          >
            ${icon('pencil', 18)}Edit details
          </button>
        </div>
        <button class="danger" data-testid="sheet-delete" @click=${() => this._emit('request-delete')}>
          Delete item
        </button>
      </div>
    `;
  }

  private _renderEdit(item: Item) {
    return html`
      <div class="bar edit">
        <button
          class="tap"
          data-testid="sheet-back"
          aria-label="Back"
          @click=${() => this._leaveEdit('read')}
        >
          ${icon('arrowLeft', 21)}
        </button>
        <span class="heading">Edit item</span>
        <button
          class="save"
          data-testid="sheet-save"
          ?disabled=${this.busy}
          @click=${() => this._editor?.shadowRoot?.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click()}
        >
          ${this.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <hv-item-editor
        .statuses=${this.statuses}
        .areas=${this.areas}
        .media=${this.media}
        .mediaConfig=${this.mediaConfig}
        data-testid="sheet-editor"
        mobile
        noHeader
        .item=${item}
        .locations=${this.locations}
        .locationTree=${this.locationTree}
        .categorySuggestions=${this.categorySuggestions}
        .tagSuggestions=${this.tagSuggestions}
        .customFieldKeys=${this.customFieldKeys}
        .createLocation=${this.createLocation}
        .busy=${this.busy}
        .errorMessage=${this.errorMessage}
        @cancel=${() => {
          this._mode = 'read';
        }}
        @delete-item=${(e: Event) => {
          // The form has a Delete of its own, and this sheet is the only host
          // that never forwarded it — so the button sat there doing nothing.
          // Re-emitted as `request-delete`, the same event the read view's
          // Delete sends, so the host confirms it exactly once either way.
          e.stopPropagation();
          this._emit('request-delete');
        }}
      ></hv-item-editor>
    `;
  }

  render() {
    const item = this.item;
    return html`<hv-bottom-sheet
        data-testid="detail-sheet"
        ?open=${this.open && !!item}
        ?noHandle=${this._mode === 'edit'}
        label=${item?.name ?? 'Item'}
        @cancel=${(e: Event) => {
          // The inner sheet's cancel is composed, so it would reach the host as
          // "the detail sheet closed" — before this sheet has decided whether it
          // is closing at all. The host hears only the one _close sends.
          e.stopPropagation();
          this._leaveEdit('close');
        }}
      >
        ${item ? (this._mode === 'edit' ? this._renderEdit(item) : this._renderRead(item)) : null}
      </hv-bottom-sheet>

      <hv-lightbox
        data-testid="sheet-lightbox-host"
        .item=${item}
        .media=${this.media}
        .index=${this._lightbox}
        .onOpenerGone=${() => this._sheet?.focusPanel()}
        @close=${(e: Event) => {
          e.stopPropagation();
          this._lightbox = null;
        }}
      ></hv-lightbox>

      <!-- Outside the sheet, and its events stopped here: the host listens for
           a cancel event on this element to take the sheet down, and an answer
           of "no, keep my typing" must not read as that. -->
      <hv-confirm
        data-testid="sheet-discard-confirm"
        ?open=${this._pendingDiscard !== null}
        ?mobile=${this._viewport.narrow}
        .heading=${DISCARD_PROMPT.heading}
        .message=${DISCARD_PROMPT.message}
        .confirmLabel=${DISCARD_PROMPT.confirmLabel}
        destructive
        @confirm=${(e: Event) => {
          e.stopPropagation();
          const to = this._pendingDiscard;
          this._pendingDiscard = null;
          this._mode = 'read';
          if (to === 'close') this._close();
        }}
        @cancel=${(e: Event) => {
          e.stopPropagation();
          this._pendingDiscard = null;
        }}
      ></hv-confirm>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-detail-sheet': HVDetailSheet;
  }
}
