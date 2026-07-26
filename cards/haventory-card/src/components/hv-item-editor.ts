import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { relativeTime, formatDate, isOverdue } from '../ui/relative-time';
import { saveShortcutLabel } from '../ui/keyboard';
import { counted } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import {
  customFieldsFrom,
  formFromItem,
  isDirty,
  newCustomFieldRow,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
} from '../ui/item-form';
import type { CustomFieldRow, CustomFieldType, FieldError, ItemFormModel } from '../ui/item-form';
import type { Item, Location, LocationTreeNode } from '../store/types';
import './hv-chip-input';
import './hv-location-tree';
import './hv-checkout-popover';

/**
 * Why the due date is dead until the item is out. Shown as a note under the
 * checkout, and as the field's `title` — a tooltip alone never reaches a phone,
 * which is where the whole block hides behind a disclosure to begin with.
 */
const DUE_DATE_HINT = 'A due date applies while the item is checked out.';

const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes/No' },
  { value: 'date', label: 'Date' },
];

/**
 * The one edit surface (mocks 1f / 4h on desktop, 4i's edit view on mobile).
 *
 * It replaces the modal chain the POC had — editing an item opened a dialog,
 * which opened a second dialog to pick a location. Here the row expands in
 * place and the location tree opens *inside* the form.
 *
 * Full field parity with the old modal: name, description, quantity, low-stock
 * threshold, category (with suggestions), tags, location, checked-out plus due
 * date, inspection date and typed custom fields. On mobile the rarely-touched
 * half collapses behind one "More fields" disclosure rather than being dropped.
 */
@customElement('hv-item-editor')
export class HVItemEditor extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        background: var(--hv-row-hover);
        border-left: 3px solid var(--hv-primary);
      }
      :host([mobile]) {
        background: transparent;
        border-left: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px 4px;
      }
      .head .name {
        font-size: 15px;
        font-weight: 500;
        color: var(--hv-primary-darker);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .head .meta {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        white-space: nowrap;
      }
      .out-chip {
        flex: none;
        font: 500 11px var(--hv-font);
        color: var(--hv-primary-darker);
        background: var(--hv-surface);
        border: 1px solid var(--hv-primary-tint-border);
        border-radius: var(--hv-radius-chip);
        padding: 2px 8px;
      }
      .out-chip.overdue {
        color: #fff;
        background: var(--hv-error);
        border-color: var(--hv-error);
      }
      .grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr;
        gap: 12px;
        padding: 8px 18px 14px;
      }
      :host([mobile]) .grid {
        grid-template-columns: 1fr;
        gap: 14px;
        padding: 14px 16px;
      }
      .cell.span2 {
        grid-column: span 2;
      }
      .cell.span3 {
        grid-column: span 3;
      }
      :host([mobile]) .cell.span2,
      :host([mobile]) .cell.span3 {
        grid-column: span 1;
      }
      .cell {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      /* Checked out, Due date and Inspection date used to be three equal thirds
         of one row, which said they were three peers. Two of them are not. The
         boxes below say which belongs to which before a word is read. */
      .state {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 12px;
        align-items: start;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      .group {
        display: grid;
        gap: 9px;
        min-width: 0;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px 11px;
      }
      .group-caption {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
      }
      .group-caption .hv-icon {
        flex: none;
        opacity: 0.8;
      }
      .group-body {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .checkout-body {
        grid-template-columns: 1fr 1fr;
        align-items: end;
      }
      /* Checking out is something you do, not a setting you hold — the same
         button the detail sheet has offered all along, in the same words. */
      .checkout-action {
        justify-content: center;
        gap: 7px;
        min-height: var(--hv-tap-min, auto);
        font-weight: 500;
        cursor: pointer;
      }
      .checkout-action:hover {
        background: var(--hv-row-hover);
      }
      .checkout-action .hv-icon {
        flex: none;
        opacity: 0.85;
      }
      .group-hint {
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--hv-text-tertiary);
      }
      /* A native date input clips its own placeholder much below ~140px, and
         half of a 375px screen minus the box padding is under that. */
      :host([mobile]) .checkout-body {
        grid-template-columns: 1fr;
      }
      label.hv-label {
        display: block;
      }
      .hv-input,
      .field-button {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      :host([mobile]) .hv-input,
      :host([mobile]) .field-button {
        min-height: 48px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A disabled date input keeps the browser's own colour, which against a
         dark HA theme is all but indistinguishable from an enabled one. */
      .hv-input:disabled {
        background: var(--hv-input-bg);
        border-color: var(--hv-divider);
        color: var(--hv-text-tertiary);
        -webkit-text-fill-color: var(--hv-text-tertiary);
        cursor: not-allowed;
      }
      .cell.muted .hv-label {
        color: var(--hv-text-tertiary);
      }
      textarea.hv-input {
        min-height: 44px;
        line-height: 1.5;
        resize: vertical;
      }
      .field-button {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
      }
      .field-button .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .field-button.empty .value {
        color: var(--hv-text-tertiary);
      }
      .invalid .hv-input,
      .invalid .field-button {
        border-color: var(--hv-error);
      }
      .field-error {
        font-size: 12px;
        color: var(--hv-error);
      }
      .tree-holder,
      .list-holder {
        margin-top: 6px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 220px;
        overflow: auto;
        padding: 4px 0;
      }
      /* The category list is the one holder that must NOT take part in the
         layout. In flow it grew its own grid cell, which grew the row, which
         stretched the Location button beside it to ~130px — the form visibly
         came apart every time the suggestions opened. The location tree below
         is the opposite case: it is meant to push the form open, so it keeps
         the in-flow rule above.

         Fixed rather than absolute, because the expanded view puts the whole
         form inside an editor-holder that is max-height 70dvh with
         overflow-y auto, and an absolute list would be clipped by it. Same
         technique the checkout popover and the overflow menu already use. */
      .list-holder.floating {
        position: fixed;
        margin-top: 0;
        box-shadow: var(--hv-shadow-menu);
      }
      /* The category field is a text input plus its own dropdown affordance —
         without the arrow the existing values were only findable by guessing. */
      .combo {
        position: relative;
        display: flex;
        align-items: center;
      }
      .combo .hv-input {
        padding-right: 34px;
      }
      .combo-arrow {
        position: absolute;
        right: 4px;
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .combo-arrow:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .combo-arrow {
        right: 2px;
        width: var(--hv-tap-min, 32px);
        height: var(--hv-tap-min, 32px);
      }
      .option {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px;
        border-radius: var(--hv-radius-input);
      }
      .option .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option:hover,
      .option.active {
        background: var(--hv-hover-overlay);
      }
      .option.selected {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        font-weight: 500;
      }
      .option.active {
        box-shadow: inset 0 0 0 1px var(--hv-primary);
      }
      .option-empty {
        padding: 8px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 9px 0;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .switch {
        width: 34px;
        height: 18px;
        border-radius: 999px;
        background: var(--hv-divider);
        position: relative;
        flex: none;
        transition: background var(--hv-motion-fast) ease-out;
      }
      .switch.on {
        background: var(--hv-primary);
      }
      .switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform var(--hv-motion-fast) ease-out;
      }
      .switch.on::after {
        transform: translateX(16px);
      }
      .custom {
        border-top: 1px solid var(--hv-divider);
        padding-top: 12px;
        display: grid;
        gap: 8px;
        /* The rows size themselves from the room they actually have. The mobile
           flag describes the *card*, and the same editor runs inside a desktop
           row and inside a sheet far wider than the card that opened it. */
        container-type: inline-size;
      }
      .custom-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .custom-head .tally {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .cf-row {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) 110px minmax(0, 1.6fr) var(--hv-tap-min, 34px);
        gap: 8px;
        align-items: center;
      }
      /* No named area: it auto-places into the row below whatever came before. */
      .cf-row .field-error {
        grid-column: 1 / -1;
      }
      /* Too tight for one line: the value drops under its key, and the remove
         button spans both rows so it still reads as belonging to that field
         rather than floating under the one before it. */
      @container (max-width: 520px) {
        .cf-row {
          grid-template-columns: minmax(0, 1fr) 104px var(--hv-tap-min, 34px);
          grid-template-areas:
            'key type remove'
            'value value remove';
        }
        .cf-row .cf-key {
          grid-area: key;
        }
        .cf-row .cf-type {
          grid-area: type;
        }
        .cf-row .cf-value {
          grid-area: value;
        }
        .cf-row .cf-remove {
          grid-area: remove;
        }
      }
      .cf-remove {
        display: inline-grid;
        place-items: center;
        width: var(--hv-tap-min, 30px);
        height: var(--hv-tap-min, 30px);
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-tertiary);
        padding: 0;
      }
      .cf-remove:hover {
        background: var(--hv-hover-overlay);
      }
      .cf-add {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--hv-tap-min, auto);
        border: 1px dashed var(--hv-primary-tint-border);
        background: none;
        color: var(--hv-primary-dark);
        border-radius: var(--hv-radius-input);
        padding: 8px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .key-hints {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .key-hints button {
        border: none;
        background: none;
        padding: 0 2px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
      /* These sit inline inside a sentence, so they get height and breathing
         room rather than becoming blocks that break the line up. */
      :host([mobile]) .key-hints button {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 8px;
      }
      .more-toggle {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-top: 1px solid var(--hv-divider);
        background: none;
        padding: 12px 0 0;
        font: 500 14.5px var(--hv-font);
        color: var(--hv-text);
        text-align: left;
      }
      .more-toggle .summary {
        margin-left: auto;
        font: 400 12px var(--hv-font);
        color: var(--hv-text-secondary);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      /* Save and Cancel sat at the bottom of a form inside a nested scroller,
         so on a phone they were reliably below the fold — you had to scroll an
         inner container to commit an edit you had already finished.
         Sticky goes on the wrapping cell rather than on .actions itself: an
         element only sticks within its containing block, and .actions' parent
         is exactly as tall as .actions, so it would have had nowhere to move.
         The cell's containing block is the form grid, which is tall. */
      :host([mobile]) .actions-cell {
        position: sticky;
        bottom: -14px;
        z-index: 1;
        background: var(--hv-surface);
        padding: 10px 0 14px;
        border-top: 1px solid var(--hv-row-divider);
      }
      /* The auto margin lives on a spacer of its own, not on the hint: the hint
         is gone on a phone (no keyboard to press Esc with), and with the margin
         attached to it Cancel and Save fell back to the left edge — right next
         to Delete. */
      .actions .spacer {
        margin-left: auto;
      }
      .actions .hint {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .save {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 8px 20px;
        font: 500 13px var(--hv-font);
      }
      .save[disabled] {
        opacity: 0.5;
      }
      .delete {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        border: 1px solid var(--hv-error-border);
        background: none;
        color: var(--hv-error-soft);
        border-radius: var(--hv-radius-chip);
        padding: 7px 14px;
        font: 400 12.5px var(--hv-font);
      }
      .banner {
        margin: 0 18px;
        padding: 9px 12px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: 12.5px;
      }
    `,
  ];

  /** null means "add item" — the same expander, empty. */
  @property({ attribute: false }) item: Item | null = null;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  @property({ attribute: false }) categorySuggestions: string[] = [];
  @property({ attribute: false }) tagSuggestions: string[] = [];
  @property({ attribute: false }) customFieldKeys: string[] = [];
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ type: Boolean }) busy = false;
  /** Server-side failure to show above the actions. */
  @property({ type: String }) errorMessage: string | null = null;
  /** Hide the header row when the host already provides one (the mobile sheet). */
  @property({ type: Boolean }) noHeader = false;

  @state() private _model: ItemFormModel = formFromItem(null);
  @state() private _errors: FieldError[] = [];
  @state() private _showErrors = false;
  @state() private _locationOpen = false;
  @state() private _moreOpen = false;
  @state() private _categoryOpen = false;
  /** Opened from the arrow: list everything, ignoring what is already typed. */
  @state() private _categoryShowAll = false;
  /** Keyboard cursor into the visible category options; -1 = nothing active. */
  @state() private _categoryIndex = -1;
  /** Viewport placement of the floating category list, while it is open. */
  @state() private _categoryBox: {
    left: number;
    width: number;
    edge: number;
    flip: boolean;
    room: number;
  } | null = null;
  private _categoryZ = 0;
  /** The check-out dialog, and the button it hangs from on a wide screen. */
  @state() private _checkoutOpen = false;
  @state() private _checkoutAnchor: DOMRect | null = null;

  /**
   * The footer promises "Esc discards", but that is a keydown handler on the
   * editor root — it never fires while focus is still on the page body, which
   * is where it stayed when a row expanded. Focusing the name field also
   * scrolls the expander into view inside the list's scroller.
   */
  protected firstUpdated() {
    this.renderRoot.querySelector<HTMLInputElement>('[data-testid="editor-name"]')?.focus();
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('item')) {
      this._model = formFromItem(this.item);
      this._errors = [];
      this._showErrors = false;
      this._locationOpen = false;
      this._moreOpen = false;
      this._checkoutOpen = false;
      this._closeCategory();
    }
  }

  /** True when the user has typed something they would lose. */
  get dirty(): boolean {
    return isDirty(this._model, this.item);
  }

  private _patch(patch: Partial<ItemFormModel>) {
    this._model = { ...this._model, ...patch };
    if (this._showErrors) this._errors = validateForm(this._model);
  }

  private _errorFor(field: string): string | null {
    if (!this._showErrors) return null;
    return this._errors.find((e) => e.field === field)?.message ?? null;
  }

  private _save = () => {
    const errors = validateForm(this._model);
    this._errors = errors;
    this._showErrors = true;
    if (errors.length) return;
    const detail = this.item
      ? { itemId: this.item.id, expectedVersion: this.item.version, changes: toUpdatePayload(this._model, this.item) }
      : { itemId: null, expectedVersion: undefined, create: toCreatePayload(this._model) };
    this.dispatchEvent(new CustomEvent('save', { detail, bubbles: true, composed: true }));
  };

  private _cancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this._save();
    }
  };

  // ---------- Field renderers ----------
  private _text(
    field: keyof ItemFormModel,
    label: string,
    opts: { type?: string; span?: number; testid: string; placeholder?: string } = { testid: '' },
  ) {
    const error = this._errorFor(field as string);
    return html`<div class="cell ${opts.span === 2 ? 'span2' : opts.span === 3 ? 'span3' : ''} ${error ? 'invalid' : ''}">
      <label class="hv-label" for=${opts.testid}>${label}</label>
      <input
        id=${opts.testid}
        class="hv-input"
        type=${opts.type ?? 'text'}
        data-testid=${opts.testid}
        placeholder=${opts.placeholder ?? ''}
        .value=${String(this._model[field] ?? '')}
        @input=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          if (opts.type === 'number') {
            this._patch({ [field]: raw === '' ? null : Number(raw) } as Partial<ItemFormModel>);
          } else {
            this._patch({ [field]: raw } as Partial<ItemFormModel>);
          }
        }}
      />
      ${error ? html`<span class="field-error" data-testid=${`${opts.testid}-error`}>${error}</span>` : null}
    </div>`;
  }

  private _renderLocationField() {
    const loc = (this.locations ?? []).find((l) => l.id === this._model.locationId);
    const label = loc ? (loc.path?.display_path ?? loc.name).replace(/\s*\/\s*/g, ' › ') : 'No location';
    return html`<div class="cell span2">
      <span class="hv-label">Location</span>
      <button
        class="field-button ${this._model.locationId ? '' : 'empty'}"
        data-testid="editor-location"
        aria-expanded=${String(this._locationOpen)}
        @click=${() => {
          this._locationOpen = !this._locationOpen;
        }}
      >
        ${icon('mapMarker', 15)}<span class="value">${label}</span>${icon('chevronDown', 15)}
      </button>
      ${this._locationOpen
        ? html`<div class="tree-holder">
            <hv-location-tree
              data-testid="editor-location-tree"
              .nodes=${this.locationTree}
              .selectedId=${this._model.locationId}
              showAll
              allLabel="No location"
              allIcon="close"
              @select=${(e: CustomEvent) => {
                this._patch({ locationId: (e.detail as { locationId: string | null }).locationId });
                this._locationOpen = false;
              }}
            ></hv-location-tree>
          </div>`
        : null}
    </div>`;
  }

  /**
   * What the dropdown shows right now. Typing narrows the list; the arrow
   * (and re-focusing the field) puts every category back, because a native
   * `<datalist>` only ever revealed matches for what you had already guessed.
   */
  private get _categoryOptions(): string[] {
    const query = this._model.category.trim().toLowerCase();
    if (this._categoryShowAll || !query) return this.categorySuggestions;
    return this.categorySuggestions.filter((c) => c.toLowerCase().includes(query));
  }

  /**
   * Where the floating category list goes, in viewport coordinates.
   *
   * Recomputed on every scroll and resize while the list is open: `position:
   * fixed` is measured against the viewport, and the form it belongs to sits in
   * a scroll box of its own, so the list would otherwise drift off its input.
   */
  private _placeCategory = () => {
    const combo = this.renderRoot?.querySelector<HTMLElement>('.combo');
    if (!combo) return;
    const rect = combo.getBoundingClientRect();
    const gap = 6;
    const viewport = window.innerHeight;
    const roomBelow = viewport - rect.bottom - gap - 8;
    const roomAbove = rect.top - gap - 8;
    // Flip up only when below is genuinely too tight and above is roomier.
    const flip = roomBelow < 120 && roomAbove > roomBelow;
    this._categoryBox = {
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      edge: flip ? Math.round(viewport - rect.top + gap) : Math.round(rect.bottom + gap),
      flip,
      room: Math.max(80, Math.round(flip ? roomAbove : roomBelow)),
    };
  };

  private get _categoryStyle(): string {
    const box = this._categoryBox;
    if (!box) return '';
    const edge = box.flip ? `bottom: ${box.edge}px` : `top: ${box.edge}px`;
    return `${edge}; left: ${box.left}px; width: ${box.width}px; max-height: min(220px, ${box.room}px); z-index: ${this._categoryZ || 9999};`;
  }

  private _openCategory(showAll: boolean) {
    if (!this.categorySuggestions.length) return;
    this._categoryShowAll = showAll;
    if (!this._categoryOpen) {
      this._categoryZ = nextZBase();
      // Capture phase: the scrolling ancestor is a shadow-DOM box of another
      // component, and a bubbling listener on this element never sees it.
      window.addEventListener('scroll', this._placeCategory, true);
      window.addEventListener('resize', this._placeCategory);
    }
    this._categoryOpen = true;
    this._categoryIndex = -1;
    this._placeCategory();
  }

  private _closeCategory() {
    if (this._categoryOpen) {
      window.removeEventListener('scroll', this._placeCategory, true);
      window.removeEventListener('resize', this._placeCategory);
    }
    this._categoryOpen = false;
    this._categoryShowAll = false;
    this._categoryIndex = -1;
    this._categoryBox = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._closeCategory();
  }

  private _chooseCategory(value: string) {
    this._patch({ category: value });
    this._closeCategory();
  }

  private _onCategoryKeydown(e: KeyboardEvent) {
    const options = this._categoryOptions;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!this._categoryOpen) {
          this._openCategory(false);
          this._categoryIndex = 0;
          return;
        }
        if (!options.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        this._categoryIndex = (this._categoryIndex + step + options.length) % options.length;
        break;
      }
      case 'Enter':
        if (this._categoryOpen && options[this._categoryIndex]) {
          e.preventDefault();
          e.stopPropagation();
          this._chooseCategory(options[this._categoryIndex]);
        }
        break;
      case 'Escape':
        // Dismiss the list only — the editor's own Escape would discard the edit.
        if (this._categoryOpen) {
          e.preventDefault();
          e.stopPropagation();
          this._closeCategory();
        }
        break;
      case 'Tab':
        this._closeCategory();
        break;
    }
  }

  private _renderCategoryField() {
    const typed = this._model.category.trim();
    const options = this._categoryOptions;
    return html`<div class="cell">
      <label class="hv-label" for="editor-category">Category</label>
      <div class="combo">
        <input
          id="editor-category"
          class="hv-input"
          data-testid="editor-category"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-expanded=${String(this._categoryOpen)}
          aria-controls="editor-category-list"
          aria-activedescendant=${this._categoryOpen && this._categoryIndex >= 0
            ? `editor-category-option-${this._categoryIndex}`
            : ''}
          .value=${this._model.category}
          @focus=${() => this._openCategory(true)}
          @input=${(e: Event) => {
            this._patch({ category: (e.target as HTMLInputElement).value });
            this._openCategory(false);
          }}
          @keydown=${this._onCategoryKeydown}
          @blur=${() => this._closeCategory()}
        />
        ${this.categorySuggestions.length
          ? html`<button
              class="combo-arrow"
              data-testid="editor-category-toggle"
              tabindex="-1"
              aria-label="Show all categories"
              title="Show all categories"
              @mousedown=${(e: Event) => e.preventDefault()}
              @click=${() => {
                // Only a second click on the *full* list closes it — pressing the
                // arrow while a typed filter is showing means "show me the rest".
                if (this._categoryOpen && this._categoryShowAll) this._closeCategory();
                else this._openCategory(true);
              }}
            >
              ${icon('chevronDown', 18)}
            </button>`
          : null}
      </div>
      ${this._categoryOpen
        ? html`<div
            class="list-holder floating"
            role="listbox"
            id="editor-category-list"
            data-testid="editor-category-list"
            style=${this._categoryStyle}
          >
            ${options.length
              ? options.map(
                  (c, i) => html`<button
                    class="option ${i === this._categoryIndex ? 'active' : ''} ${
                      c.toLowerCase() === typed.toLowerCase() ? 'selected' : ''
                    }"
                    id=${`editor-category-option-${i}`}
                    role="option"
                    aria-selected=${String(c.toLowerCase() === typed.toLowerCase())}
                    data-testid="editor-category-option"
                    data-value=${c}
                    @mousedown=${(e: Event) => e.preventDefault()}
                    @click=${() => this._chooseCategory(c)}
                  >
                    <span class="label">${c}</span>
                    ${c.toLowerCase() === typed.toLowerCase() ? icon('check', 15) : null}
                  </button>`,
                )
              : html`<div class="option-empty" data-testid="editor-category-empty">
                  No existing category matches “${typed}” — saving adds it as a new one.
                </div>`}
          </div>`
        : null}
    </div>`;
  }

  /**
   * The checkout, and the one date that is not part of it.
   *
   * A due date is half of the checkout — it only means anything while an item
   * is out, which is why it is disabled otherwise and why `commonFields()`
   * nulls it on save. An inspection date is an unrelated fact about the item.
   * Laid out as three equal thirds of a row they read as three settings of the
   * same kind, so the two boxes below carry the distinction visually, on both
   * widths.
   *
   * The state itself is a button rather than a switch. A switch says "this is
   * a property of the item, set it either way"; checking something out is an
   * act, and the detail sheet has always put it that way — same words, same
   * icons, so the two surfaces cannot teach different things. It still writes
   * `checkedOut` into the form model rather than firing the WS command: this
   * editor also creates items, which have no id to check out yet.
   */
  private _renderStateFields() {
    const model = this._model;
    return html`<div class="cell span3">
      <div class="state">
        <div class="group" role="group" aria-labelledby="editor-checkout-caption">
          <span class="group-caption" id="editor-checkout-caption" data-testid="editor-checkout-caption">
            ${icon('account', 14)} Checkout
          </span>
          <div class="group-body checkout-body">
            <div class="cell">
              <button
                class="field-button checkout-action"
                data-testid="editor-checked-out"
                @click=${this._onCheckoutPressed}
              >
                ${icon(model.checkedOut ? 'check' : 'account', 16)}
                <span>${model.checkedOut ? 'Check in' : 'Check out…'}</span>
              </button>
            </div>
            <div class="cell ${model.checkedOut ? '' : 'muted'}">
              <label class="hv-label" for="editor-due">Due date</label>
              <input
                id="editor-due"
                class="hv-input"
                type="date"
                data-testid="editor-due-date"
                ?disabled=${!model.checkedOut}
                title=${model.checkedOut ? '' : DUE_DATE_HINT}
                .value=${model.dueDate}
                @input=${(e: Event) => this._patch({ dueDate: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          ${model.checkedOut
            ? null
            : html`<span class="group-hint" data-testid="editor-due-hint">${DUE_DATE_HINT}</span>`}
          <hv-checkout-popover
            data-testid="editor-checkout"
            .item=${this.item}
            .itemName=${model.name.trim() || 'this item'}
            .anchor=${this._checkoutAnchor}
            ?mobile=${this.mobile}
            ?open=${this._checkoutOpen}
            @check-out=${(e: CustomEvent) => {
              // Purely a form event: nothing outside this editor should act on
              // it, and the shell would fire the real WS command if it did.
              e.stopPropagation();
              const { dueDate } = e.detail as { dueDate: string | null };
              this._patch({ checkedOut: true, dueDate: dueDate ?? '' });
              this._checkoutOpen = false;
            }}
            @cancel=${(e: Event) => {
              e.stopPropagation();
              this._checkoutOpen = false;
            }}
          ></hv-checkout-popover>
        </div>
        <div class="group">
          <label class="group-caption" for="editor-inspection" data-testid="editor-inspection-caption">
            ${icon('calendar', 14)} Inspection date
          </label>
          <div class="group-body">
            <input
              id="editor-inspection"
              class="hv-input"
              type="date"
              data-testid="editor-inspection-date"
              .value=${model.inspectionDate}
              @input=${(e: Event) => this._patch({ inspectionDate: (e.target as HTMLInputElement).value })}
            />
          </div>
        </div>
      </div>
    </div>`;
  }

  /**
   * Checking out asks for a due date; checking in just happens.
   *
   * The mobile detail sheet has offered this dialog — quick offsets, a date, a
   * "no due date" way out — since the revamp, while the editor flipped a flag
   * and left you to find the date field yourself. It is the same component, so
   * on a wide screen it anchors under the button and on a phone it expands
   * inside the box. Confirming only patches the form model; the item is written
   * when the form is saved, which is what lets it work while creating an item
   * that has no id to check out yet.
   */
  private _onCheckoutPressed = (e: Event) => {
    if (this._model.checkedOut) {
      this._patch({ checkedOut: false });
      return;
    }
    this._checkoutAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._checkoutOpen = true;
  };

  private _patchRow(id: number, patch: Partial<CustomFieldRow>) {
    this._patch({
      customFields: this._model.customFields.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }

  private _renderCustomFields() {
    const rows = this._model.customFields;
    const used = Object.keys(customFieldsFrom(this._model)).length;
    const unusedKeys = this.customFieldKeys.filter((k) => !rows.some((r) => r.key === k)).slice(0, 3);
    return html`<div class="cell span3">
      <div class="custom">
        <div class="custom-head">
          <span class="hv-label">Custom fields</span>
          <span class="tally" data-testid="editor-cf-tally">
            ${used} of ${counted(this.customFieldKeys.length || used, 'key')} in use
          </span>
        </div>
        ${rows.map((row) => {
          const error = this._errorFor(`custom:${row.id}`);
          return html`<div class="cf-row ${error ? 'invalid' : ''}" data-testid="editor-cf-row" data-id=${row.id}>
            <input
              class="hv-input cf-key"
              data-testid="editor-cf-key"
              aria-label="Field key"
              placeholder="key"
              .value=${row.key}
              @input=${(e: Event) => this._patchRow(row.id, { key: (e.target as HTMLInputElement).value })}
            />
            <select
              class="hv-input cf-type"
              data-testid="editor-cf-type"
              aria-label="Field type"
              @change=${(e: Event) =>
                this._patchRow(row.id, { type: (e.target as HTMLSelectElement).value as CustomFieldType })}
            >
              ${CUSTOM_FIELD_TYPES.map(
                (t) => html`<option value=${t.value} ?selected=${row.type === t.value}>${t.label}</option>`,
              )}
            </select>
            ${row.type === 'boolean'
              ? html`<button
                  class="toggle cf-value"
                  role="switch"
                  aria-checked=${String(row.value === 'true')}
                  data-testid="editor-cf-value"
                  @click=${() => this._patchRow(row.id, { value: row.value === 'true' ? 'false' : 'true' })}
                >
                  <span class="switch ${row.value === 'true' ? 'on' : ''}"></span>
                  <span>${row.value === 'true' ? 'Yes' : 'No'}</span>
                </button>`
              : html`<input
                  class="hv-input cf-value"
                  data-testid="editor-cf-value"
                  aria-label="Field value"
                  type=${row.type === 'number' ? 'number' : row.type === 'date' ? 'date' : 'text'}
                  .value=${row.value}
                  @input=${(e: Event) => this._patchRow(row.id, { value: (e.target as HTMLInputElement).value })}
                />`}
            <button
              class="cf-remove"
              data-testid="editor-cf-remove"
              aria-label=${`Remove ${row.key || 'field'}`}
              title="Remove field"
              @click=${() => this._patch({ customFields: rows.filter((r) => r.id !== row.id) })}
            >
              ${icon('close', 16)}
            </button>
            ${error ? html`<span class="field-error" data-testid="editor-cf-error">${error}</span>` : null}
          </div>`;
        })}
        <button
          class="cf-add"
          data-testid="editor-cf-add"
          @click=${() => this._patch({ customFields: [...rows, newCustomFieldRow()] })}
        >
          ${icon('plus', 15)}Add field
        </button>
        ${unusedKeys.length
          ? html`<span class="key-hints" data-testid="editor-cf-key-hints">
              Key suggestions:
              ${unusedKeys.map(
                (k) => html`<button
                  data-testid="editor-cf-key-hint"
                  data-value=${k}
                  @click=${() => this._patch({ customFields: [...rows, newCustomFieldRow({ key: k })] })}
                >
                  ${k}
                </button>`,
              )}
              · Clearing a value unsets the key on save.
            </span>`
          : html`<span class="key-hints">Clearing a value unsets the key on save.</span>`}
      </div>
    </div>`;
  }

  private _renderMoreFields() {
    const model = this._model;
    const summary = [
      model.description ? 'description' : null,
      model.dueDate || model.inspectionDate ? 'dates' : null,
      model.customFields.length ? `${model.customFields.length} custom` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return html`
      <button
        class="more-toggle"
        data-testid="editor-more-toggle"
        aria-expanded=${String(this._moreOpen)}
        @click=${() => {
          this._moreOpen = !this._moreOpen;
        }}
      >
        ${icon(this._moreOpen ? 'chevronDown' : 'chevronRight', 19)} More fields
        <span class="summary">${summary || 'description · dates · custom fields'}</span>
      </button>
      ${this._moreOpen
        ? html`
            <div class="cell span3">
              <label class="hv-label" for="editor-description">Description</label>
              <textarea
                id="editor-description"
                class="hv-input"
                data-testid="editor-description"
                .value=${model.description}
                @input=${(e: Event) => this._patch({ description: (e.target as HTMLTextAreaElement).value })}
              ></textarea>
            </div>
            ${this._renderStateFields()} ${this._renderCustomFields()}
          `
        : null}
    `;
  }

  render() {
    const model = this._model;
    const creating = this.item === null;
    const overdue = isOverdue(this.item?.due_date);

    return html`
      <div data-testid="item-editor" @keydown=${this._onKeydown}>
        ${this.noHeader
          ? null
          : html`<div class="head">
              ${icon('chevronDown', 18)}
              <span class="name" data-testid="editor-heading">
                ${creating ? 'New item' : `${this.item?.name} — editing`}
              </span>
              ${this.item?.checked_out
                ? html`<span class="out-chip ${overdue ? 'overdue' : ''}" data-testid="editor-out-chip">
                    ${overdue ? 'Overdue' : 'Checked out'}${this.item?.due_date
                      ? ` · due ${formatDate(this.item.due_date)}`
                      : ''}
                  </span>`
                : null}
              ${this.item
                ? html`<span class="meta" data-testid="editor-version"
                    >v${this.item.version} · updated ${relativeTime(this.item.updated_at)}</span
                  >`
                : null}
              <button
                class="hv-icon-button"
                data-testid="editor-close"
                aria-label="Close editor"
                @click=${this._cancel}
              >
                ${icon('close', 18)}
              </button>
            </div>`}
        ${this.errorMessage
          ? html`<div class="banner" role="alert" data-testid="editor-error">${this.errorMessage}</div>`
          : null}

        <div class="grid">
          ${this._text('name', 'Name', { testid: 'editor-name' })}
          ${this._text('quantity', 'Quantity', { type: 'number', testid: 'editor-quantity' })}
          ${this._text('lowStock', 'Low-stock at', { type: 'number', testid: 'editor-low-stock' })}
          ${this.mobile
            ? null
            : html`<div class="cell span3">
                <label class="hv-label" for="editor-description-desktop">Description</label>
                <textarea
                  id="editor-description-desktop"
                  class="hv-input"
                  data-testid="editor-description"
                  .value=${model.description}
                  @input=${(e: Event) => this._patch({ description: (e.target as HTMLTextAreaElement).value })}
                ></textarea>
              </div>`}
          ${this._renderLocationField()} ${this._renderCategoryField()}
          <div class="cell span3">
            <span class="hv-label">Tags <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">· stored lowercase</span></span>
            <hv-chip-input
              data-testid="editor-tags"
              .values=${model.tags}
              .suggestions=${this.tagSuggestions}
              @change=${(e: CustomEvent) => this._patch({ tags: (e.detail as { values: string[] }).values })}
            ></hv-chip-input>
          </div>
          ${this.mobile
            ? html`<div class="cell span3">${this._renderMoreFields()}</div>`
            : html`${this._renderStateFields()} ${this._renderCustomFields()}`}

          <div class="cell span3 actions-cell">
            <div class="actions">
              ${this.item
                ? html`<button
                    class="delete"
                    data-testid="editor-delete"
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent('delete-item', {
                          detail: { itemId: this.item!.id, name: this.item!.name },
                          bubbles: true,
                          composed: true,
                        }),
                      )}
                  >
                    Delete item
                  </button>`
                : null}
              <span class="spacer"></span>
              ${this.mobile
                ? null
                : html`<span class="hint" data-testid="editor-key-hint">
                    Esc discards · ${saveShortcutLabel()} saves
                  </span>`}
              <button class="hv-text-button" data-testid="editor-cancel" @click=${this._cancel}>Cancel</button>
              <button class="save" data-testid="editor-save" ?disabled=${this.busy} @click=${this._save}>
                ${this.busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-item-editor': HVItemEditor;
  }
}
