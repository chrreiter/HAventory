import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip, renderTagChip } from '../ui/chip';
import { icon } from '../ui/icons';
import { onDayChange } from '../ui/day-clock';
import { formatDate, isDue, isOverdue, relativeTime } from '../ui/relative-time';
import { customFieldLabel } from '../ui/field-label';
import { canBumpReminder, hasReminder, isReminderDue, reminderSummary } from '../ui/reminder';
import { inferType } from '../ui/item-form';
import { DEFAULT_STATUS, itemStatus, renderStatusChip } from '../ui/status';
import { isLowStock } from '../ui/row-chrome';
import {
  areaMarkName,
  itemPathParts,
  pathTitle,
  renderAreaChip,
  renderPathSegments,
} from '../ui/location-path';
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
import { docIcon, renderDocumentRow, renderLightboxHost, renderPhotoFigure } from '../ui/attachments';
import type { ConfirmDiscard } from '../ui/discard';
import { CopyFlash } from '../ui/clipboard';
import type { AreaRef, Item, Location, LocationTreeNode, MediaConfig, ScalarValue, StatusDefinition } from '../store/types';
import './hv-bottom-sheet';
import './hv-checkout-popover';
import './hv-item-editor';
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
 *   account of the save in flight, forwarded to the form. A save the host
 *   reports over without an error lands the sheet back on its read view, which
 *   is where the saved values are; a refused save leaves the form up with the
 *   message inside it.
 * - **Out**: `save` (the editor's own detail, so a host's editor-save handler
 *   takes it unchanged), `increment` / `decrement`, `check-in`,
 *   `check-out-confirmed` and `set-due-date` with the picked date,
 *   `reminder-bump`, `request-delete` — every one carrying `itemId` — and
 *   `cancel` when the sheet has finished closing.
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
    docIcon,
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
      /* A date that has passed is not a neutral fact, and every fact that
         prints one is marked the same way — the same red the table's date cells
         and the compact row's line use. The chips at the top of the sheet are
         where the kind of lateness is named, so down here the colour says only
         that the day has gone by. */
      .fact .value.late {
        color: var(--hv-error);
        font-weight: 500;
      }
      /* The path is what the crumb at the top of the sheet cuts off, so this
         row wraps it instead: the row grows and every segment survives. Each
         segment is a flex item, which is what puts a break on a "›" rather
         than inside a name. */
      .fact.location .value,
      .fact.location .hv-chip-line-text {
        flex-wrap: wrap;
        justify-content: flex-end;
        row-gap: 2px;
      }
      .fact.location .hv-chip-line-text {
        display: flex;
        align-items: center;
      }
      /* The separator's spaces sit at the end of a flex item's line, where
         normal white-space processing drops them and the two names either side
         would run together. */
      .fact.location .hv-path-sep {
        white-space: pre;
      }
      /* A household writes these names, and a flex item's automatic minimum is
         its own content — so a long one would push the row wider than the sheet
         instead of taking a second line. */
      .fact.location .hv-path-seg {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      /* The one fact row that acts. The value keeps its margin-left:auto, so the
         button sits after it at the right edge; the negative right margin pulls
         the tap target's padding back to the row's own gutter while the 44px
         touch height stays. */
      .fact .text-action {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        min-height: 44px;
        padding: 0 8px;
        margin-right: -8px;
        font: 500 13.5px var(--hv-font);
        white-space: nowrap;
      }
      .fact .text-action[disabled] {
        color: var(--hv-text-tertiary);
      }
      /* The id is not read, it is pasted — so it is printed in full and offered
         to one tap: user-select: all takes the whole uuid from a single click or
         long-press, which is the copy route left when the browser has no
         clipboard API (Home Assistant over plain http:// is not a secure
         context). A uuid carries no space to break at, so it is allowed to break
         anywhere rather than push the button off a phone's row. */
      .fact .value.id {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px;
        overflow-wrap: anywhere;
        -webkit-user-select: all;
        user-select: all;
      }
      .actions {
        display: grid;
        gap: 9px;
        padding: 12px 14px 16px;
      }
      /* Two labels, half a phone row each — about 176px at 390px. Equal halves
         while both labels fit in one, which is the look; a label a few pixels
         longer than its half takes what it needs and the other yields, rather
         than stacking onto a second line inside a 48px pill. */
      .actions .pair {
        display: grid;
        grid-template-columns: minmax(max-content, 1fr) minmax(max-content, 1fr);
        gap: 10px;
      }
      .actions .pair > button {
        white-space: nowrap;
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
      /* A picture whose file the backend no longer has: the same box, so the
         strip keeps its rhythm, carrying the amber mark the document rows below
         already use for the same fact. */
      .gallery .missing {
        display: grid;
        place-items: center;
        gap: 6px;
        box-sizing: border-box;
        width: 116px;
        height: 116px;
        border: 1px dashed var(--hv-divider);
        border-radius: 10px;
        background: var(--hv-surface-raised);
        color: var(--hv-text-tertiary);
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
  /**
   * The host's discard question, for this sheet and for the form inside it.
   *
   * Both ask it: the form for its own Cancel, this sheet for the Back arrow,
   * the scrim, a swipe and Escape. The dialog has to outlive the sheet — a
   * confirmed dismissal takes the sheet down with it — so it belongs to the
   * host, and null leaves the sheet dismissible without a question.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;
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

  private readonly _urls = new MediaUrls(this);
  /** The "Copied" label on the id fact's button. */
  private readonly _copyFlash = new CopyFlash(this);
  /**
   * The item id the sheet is showing. `undefined` until the first update, so
   * that pass settles the view the same way a move to another item does.
   */
  private _shownItemId: string | null | undefined;

  /**
   * Another item, a re-open, or a save the host has finished with: each of
   * them lands the sheet on its read view.
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
      this._copyFlash.reset();
    }
    // The read view is what shows the values a save wrote, and on a phone there
    // is no second surface to say it landed. A host settles `busy` and
    // `errorMessage` together before it asks for one render, so the fall of
    // `busy` arrives with the final message: a refusal never reads as a save
    // that landed, and the retry after one starts on a rise, not a fall.
    if (this._mode === 'edit' && changed.has('busy') && !this.busy && this.errorMessage === null) {
      this._mode = 'read';
    }
  }

  /**
   * The overdue, inspection and reminder lines are read off the clock at
   * render, and a sheet can be left open — on a phone, all evening.
   */
  connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dayUnsub?.();
    this._dayUnsub = undefined;
  }

  private _dayUnsub?: () => void;

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
   * first. `read` is the Back arrow — the sheet stays up on its read view;
   * `close` is a dismissal and takes the sheet with it. The dialog is the
   * host's, so a confirmed dismissal is still answerable once this element has
   * gone.
   */
  private _leaveEdit(to: 'read' | 'close') {
    const ask = this.confirmDiscard;
    if (this.dirty && ask) {
      ask(() => this._applyLeave(to));
      return;
    }
    this._applyLeave(to);
  }

  private _applyLeave(to: 'read' | 'close') {
    this._mode = 'read';
    if (to === 'close') this._close();
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
          ${on ? html`${icon('check', 15)} ${t('hv.term.yes')}` : t('hv.term.no')}
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
   * Each figure is a button: tapping one opens the lightbox, the only way to
   * see a photo at a useful size on a phone. A picture whose file the backend
   * cannot find is drawn as missing rather than handed to an `<img>` that can
   * only show the browser's broken-image glyph — the state a restore without
   * the media directory puts every photo in, and why the document rows probe.
   */
  private _renderGallery(item: Item) {
    const shots = pictures(item.attachments);
    if (!shots.length) return null;
    return html`<div class="gallery" data-testid="sheet-gallery">
      ${shots.map((picture, index) => {
        const alt = pictureAlt(item.name, index, shots.length);
        const missing = this._urls.presence(item.id, picture.id) === 'missing';
        return renderPhotoFigure(
          {
            src: missing ? null : this._urls.get(item.id, picture.id, attachmentNameToken(picture)),
            missing,
            alt,
            openLabel: t('hv.sheet.openPhoto', { photo: alt }),
            onOpen: () => {
              this._lightbox = index;
            },
          },
          { testid: 'sheet-photo', glyph: 24 },
        );
      })}
    </div>`;
  }

  /**
   * The documents attached to the item, or nothing when there are none.
   *
   * Each row is an anchor to the signed media URL rather than a button that
   * opens one: the URL has to be on the element before the tap, or the popup
   * blocker eats the new tab a handler would open after awaiting a signature.
   * A reference whose file the backend cannot find is shown as missing instead
   * of as a link to a 404 — a JSON export carries the metadata and not the
   * bytes, so a fresh install genuinely can hold one.
   */
  private _renderDocuments(item: Item) {
    const docs = manuals(item.attachments);
    if (!docs.length) return null;
    return html`<div class="documents" data-testid="sheet-documents">
      <h3>${t('hv.field.documents')}</h3>
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
            t('hv.sheet.documentAdded', { when: relativeTime(doc.uploaded_at) }),
          ].join(' · ');
          return renderDocumentRow(
            { src, missing },
            { testid: 'sheet-document', glyph: 20, openText: t('hv.action.open') },
            html`<span class="doc-text">
              <span class="doc-title" data-testid="sheet-document-title">${title}</span>
              <span class="doc-meta" data-testid="sheet-document-meta">${meta}</span>
            </span>`,
          );
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
    // `inspection_date` is the day the item is next due to be inspected, so
    // that day is already asking — inclusive, unlike the due date above.
    const inspectionDue = isDue(item.inspection_date);
    const parts = itemPathParts(item, this.areas);
    const customEntries = Object.entries(item.custom_fields ?? {});

    return html`
      <div class="bar">
        <button
          class="tap"
          data-testid="sheet-close"
          aria-label=${t('hv.action.close')}
          @click=${() => this._leaveEdit('close')}
        >
          ${icon('close', 22)}
        </button>
        <span class="crumb hv-chip-line" data-testid="sheet-path" title=${pathTitle(parts)}
          >${renderAreaChip(areaMarkName(parts.areaName, parts.path))}<span class="hv-chip-line-text"
            >${parts.path || t('hv.term.noLocation')}</span
          ></span
        >
        <button
          class="text-action"
          data-testid="sheet-edit"
          @click=${() => {
            this._mode = 'edit';
          }}
        >
          ${t('hv.action.edit')}
        </button>
      </div>

      <div class="title">
        <h2 data-testid="sheet-name">${item.name}</h2>
        <div class="chips">
          ${low
            ? html`<span
                class="hv-chip warning"
                data-testid="sheet-low"
                aria-label=${t('hv.term.lowStock')}
                >${t('hv.term.low')}</span
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
                ${overdue ? t('hv.term.overdue') : t('hv.term.checkedOut')}${item.due_date
                  ? ` · ${t('hv.term.due', { date: formatDate(item.due_date) })}`
                  : ''}
              </span>`
            : null}
          ${inspectionDue
            ? html`<span class="hv-chip warning" data-testid="sheet-inspection-due">
                ${t('hv.term.inspectionDueOn', { date: formatDate(item.inspection_date) })}
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
          aria-label=${t('hv.row.decreaseQuantity')}
          ?disabled=${item.checked_out || item.quantity <= 0}
          @click=${() => this._emit('decrement')}
        >
          ${icon('minus', 22)}
        </button>
        <span class="readout">
          <span class="qty ${low ? 'low' : ''}" data-testid="sheet-qty">${item.quantity}</span>
        </span>
        <button
          class="plus"
          data-testid="sheet-increment"
          aria-label=${t('hv.row.increaseQuantity')}
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
        <div class="fact location" data-testid="sheet-fact" data-key="location">
          <span>${t('hv.field.location')}</span>
          <span
            class="value hv-chip-line ${parts.path ? '' : 'unset'}"
            data-testid="sheet-location"
            >${renderAreaChip(areaMarkName(parts.areaName, parts.path))}<span
              class="hv-chip-line-text"
              >${parts.path ? renderPathSegments(parts.path) : t('hv.term.noLocation')}</span
            ></span
          >
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="due">
          <span>${t('hv.field.dueShort')}</span>
          <span class="value ${item.due_date ? '' : 'unset'} ${overdue ? 'late' : ''}"
            >${item.due_date ? formatDate(item.due_date) : t('hv.term.notSet')}</span
          >
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="inspection">
          <span>${t('hv.field.inspection_date')}</span>
          <span class="value ${item.inspection_date ? '' : 'unset'} ${inspectionDue ? 'late' : ''}"
            >${item.inspection_date ? formatDate(item.inspection_date) : t('hv.term.notSet')}</span
          >
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="reminder">
          <span>${t('hv.field.reminder_date')}</span>
          <span
            class="value ${hasReminder(item) ? '' : 'unset'} ${isReminderDue(item) ? 'late' : ''}"
            data-testid="sheet-reminder"
            >${reminderSummary(item) ?? t('hv.term.notSet')}</span
          >
          ${canBumpReminder(item)
            ? html`<button
                class="text-action"
                data-testid="sheet-reminder-bump"
                title=${t('hv.sheet.markDoneTitle')}
                ?disabled=${this.busy}
                @click=${() => this._emit('reminder-bump')}
              >
                ${t('hv.sheet.markDone')}
              </button>`
            : null}
        </div>
        <div class="fact" data-testid="sheet-fact" data-key="threshold">
          <span>${t('hv.field.lowStock')}</span>
          <span
            class="value ${item.low_stock_threshold === null ? 'unset' : ''}"
            data-testid="sheet-threshold"
            >${item.low_stock_threshold ?? t('hv.term.notSet')}</span
          >
        </div>
        ${customEntries.map(([key, value]) => this._renderCustomFact(key, value))}
        <div class="fact" data-testid="sheet-fact" data-key="updated">
          <span>${t('hv.field.updated_at')}</span>
          <span class="value" data-testid="sheet-updated"
            >${t('hv.sheet.updatedValue', {
              when: relativeTime(item.updated_at),
              version: item.version,
            })}</span
          >
        </div>
        <!-- Every haventory action that touches one item takes this string as
             item_id, and until it was printed here the only way to read one was
             to export the whole inventory as JSON and search it. Last in the
             list: it is the one fact that is not about the item itself. -->
        <div class="fact" data-testid="sheet-fact" data-key="id">
          <span>${t('hv.term.id')}</span>
          <code class="value id" data-testid="sheet-id">${item.id}</code>
          <button
            class="text-action"
            data-testid="sheet-copy-id"
            @click=${() => void this._copyFlash.copy(item.id)}
          >
            ${this._copyFlash.copied ? t('hv.action.copied') : t('hv.action.copy')}
          </button>
        </div>
      </div>

      ${this._checkoutOpen
        ? html`<div style="padding: 0 14px 14px">
            <hv-checkout-popover
              inline
              touch
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
                ${icon('account', 18)}${t('hv.action.checkIn')}
              </button>`
            : html`<button
                class="outline"
                data-testid="sheet-check-out"
                @click=${() => {
                  this._checkoutOpen = true;
                }}
              >
                ${icon('account', 18)}${t('hv.action.checkOut')}
              </button>`}
          <button
            class="hv-pill large"
            data-testid="sheet-edit-details"
            @click=${() => {
              this._mode = 'edit';
            }}
          >
            ${icon('pencil', 18)}${t('hv.sheet.editDetails')}
          </button>
        </div>
        <button class="danger" data-testid="sheet-delete" @click=${() => this._emit('request-delete')}>
          ${t('hv.action.deleteItem')}
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
          aria-label=${t('hv.action.back')}
          @click=${() => this._leaveEdit('read')}
        >
          ${icon('arrowLeft', 21)}
        </button>
        <span class="heading">${t('hv.action.editItem')}</span>
        <button
          class="save"
          data-testid="sheet-save"
          ?disabled=${this.busy}
          @click=${() => this._editor?.shadowRoot?.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click()}
        >
          ${this.busy ? t('hv.action.saving') : t('hv.action.save')}
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
        .confirmDiscard=${this.confirmDiscard}
        .busy=${this.busy}
        .errorMessage=${this.errorMessage}
        @cancel=${() => {
          this._mode = 'read';
        }}
        @delete-item=${(e: Event) => {
          // The form has a Delete of its own, and this sheet has to forward it
          // or the button does nothing. Re-emitted as `request-delete`, the
          // same event the read view's Delete sends, so the host confirms it
          // exactly once either way.
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
        label=${item?.name ?? t('hv.term.item')}
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

      ${renderLightboxHost({
        testid: 'sheet-lightbox-host',
        item,
        media: this.media,
        index: this._lightbox,
        onOpenerGone: () => this._sheet?.focusPanel(),
        onClose: () => {
          this._lightbox = null;
        },
      })}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-detail-sheet': HVDetailSheet;
  }
}
