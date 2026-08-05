import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { inferType } from '../ui/item-form';
import { itemStatus, statusLabel } from '../ui/status';
import { isLowStock } from './hv-list-row';
import { itemPathParts, pathTitle, renderAreaChip } from '../ui/location-path';
import { MediaUrls, pictureAlt, pictures } from '../ui/media';
import type { MediaBindings } from '../ui/media';
import { DialogFocus } from '../ui/dialog-focus';
import type {
  AreaRef,
  Item,
  Location,
  LocationTreeNode,
  MediaConfig,
  ScalarValue,
} from '../store/types';
import './hv-bottom-sheet';
import './hv-checkout-popover';
import './hv-item-editor';
import type { HVItemEditor } from './hv-item-editor';

/**
 * The mobile item surface: tap a row, get one sheet.
 *
 * It lands on a read view — chips summarise state, the quantity hero is the
 * primary action — and swaps in place to the edit form. Nothing here opens a
 * second dialog; that is the whole point of the sheet.
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
      .actions .outline {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: 1px solid var(--hv-input-border);
        background: none;
        color: var(--hv-text);
        border-radius: var(--hv-radius-chip);
        font: 500 14.5px var(--hv-font);
      }
      .actions .primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 50px;
        border: none;
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
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
      .lightbox {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        /* Opaque rather than a scrim: a photo is what the surface is for, and
           the sheet behind it competes at any transparency. */
        background: #000;
        z-index: 10;
      }
      .lightbox img {
        max-width: 100vw;
        max-height: 100vh;
        object-fit: contain;
      }
      .lightbox .close {
        position: absolute;
        top: 8px;
        right: 8px;
        min-width: 44px;
        min-height: 44px;
        display: inline-grid;
        place-items: center;
        border: none;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.5);
        color: #fff;
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
  @property({ type: Boolean }) busy = false;
  @property({ type: String }) errorMessage: string | null = null;

  /** Picture access for the gallery, the lightbox and the editor it hosts. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Attachment caps and accepted types, forwarded to the editor's picker. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;

  @state() private _mode: 'read' | 'edit' = 'read';
  /** The check-out date step, shown inline in the sheet rather than as a popup. */
  @state() private _checkoutOpen = false;
  /** Index of the picture shown full-size, or null when the lightbox is closed. */
  @state() private _lightbox: number | null = null;

  private readonly _urls = new MediaUrls(this);
  /** Returns focus to the thumbnail the lightbox was opened from. */
  private readonly _lightboxFocus = new DialogFocus();

  protected willUpdate(changed: Map<string, unknown>) {
    this._urls.configure(this.media?.sign ?? null);
    // A fresh item, or a re-open, always lands on the read view.
    if (changed.has('item') || (changed.has('open') && this.open)) {
      this._mode = 'read';
      this._checkoutOpen = false;
      this._lightbox = null;
    }
  }

  protected updated() {
    this._lightboxFocus.sync(this._lightbox !== null, () =>
      this.shadowRoot?.querySelector<HTMLElement>('[data-testid="sheet-lightbox"]'),
    );
  }

  /** True when the edit form is open with unsaved changes. */
  get dirty(): boolean {
    if (this._mode !== 'edit') return false;
    return this._editor?.dirty ?? false;
  }

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
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

  private _renderCustomFact(key: string, value: ScalarValue) {
    const type = inferType(value);
    if (type === 'boolean') {
      const on = value === true;
      return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
        <span>${key}</span>
        <span class="value ${on ? 'yes' : 'unset'}">
          ${on ? html`${icon('check', 15)} Yes` : 'No'}
        </span>
      </div>`;
    }
    return html`<div class="fact" data-testid="sheet-fact" data-key=${key}>
      <span>${key}</span>
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
        const src = this._urls.get(item.id, picture.id);
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

  private _renderLightbox(item: Item) {
    const shots = pictures(item.attachments);
    const index = this._lightbox;
    if (index === null || !shots[index]) return null;
    const src = this._urls.get(item.id, shots[index].id);
    if (!src) return null;
    const close = () => {
      this._lightbox = null;
    };
    return html`<div
      class="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label=${pictureAlt(item.name, index, shots.length)}
      data-testid="sheet-lightbox"
      tabindex="-1"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        // Stopped here, or the bottom sheet under it takes the same Escape and
        // closes the whole item rather than the photo on top of it.
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      @click=${close}
    >
      <img src=${src} alt=${pictureAlt(item.name, index, shots.length)} />
      <button class="close" data-testid="sheet-lightbox-close" aria-label="Close photo" @click=${close}>
        ${icon('close', 22)}
      </button>
    </div>`;
  }

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
        <button class="tap" data-testid="sheet-close" aria-label="Close" @click=${this._close}>
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
          ${itemStatus(item) !== 'ok'
            ? html`<span class="hv-chip warning" data-testid="sheet-status"
                >${statusLabel(itemStatus(item))}</span
              >`
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
          ${item.tags.map((t) => html`<span class="hv-chip" data-testid="sheet-tag">${t}</span>`)}
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

      ${this._renderGallery(item)}

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
              @cancel=${() => {
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
            class="primary"
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
          @click=${() => {
            this._mode = 'read';
          }}
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
      @cancel=${this._close}
    >
      ${item ? (this._mode === 'edit' ? this._renderEdit(item) : this._renderRead(item)) : null}
      ${item ? this._renderLightbox(item) : null}
    </hv-bottom-sheet>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-detail-sheet': HVDetailSheet;
  }
}
