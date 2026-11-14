import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { editorFields } from '../ui/editor-fields';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { formatDate, isOverdue, relativeTime } from '../ui/relative-time';
import { onDayChange } from '../ui/day-clock';
import { saveShortcutLabel } from '../ui/keyboard';
import { counted } from '../ui/plural';
import type { ConfirmDiscard } from '../ui/discard';
import { CopyFlash, idRow } from '../ui/clipboard';
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
import { statusLabel, statusList } from '../ui/status';
import type { MediaBindings } from '../ui/media';
import type { AreaRef, Item, Location, LocationTreeNode, MediaConfig, StatusDefinition } from '../store/types';
import './hv-chip-input';
import './hv-editor-attachments';
import type { HVEditorAttachments } from './hv-editor-attachments';
import './hv-editor-dates';
import type { HVEditorDates } from './hv-editor-dates';
import './hv-editor-category';
import type { HVEditorCategory } from './hv-editor-category';
import './hv-editor-location';
import type { HVEditorLocation } from './hv-editor-location';

const customFieldTypes = (): { value: CustomFieldType; label: string }[] => [
  { value: 'string', label: t('hv.editor.type.string') },
  { value: 'number', label: t('hv.editor.type.number') },
  { value: 'boolean', label: t('hv.editor.type.boolean') },
  { value: 'date', label: t('hv.editor.type.date') },
];

/**
 * The one edit surface: the inline expander, the full view and the mobile
 * sheet. Every editable field lives here, and the location tree opens inside
 * the form so picking one never stacks a second modal. Mobile stacks the same
 * set into one column.
 */
@customElement('hv-item-editor')
export class HVItemEditor extends LitElement {
  static override styles = [
    tokens,
    base,
    editorFields,
    chip,
    idRow,
    css`
      :host {
        display: block;
        /* The one size of this form's small print: hints, sizes, errors, the
           upload queue. */
        --hv-editor-note: 12px;
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
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
        white-space: nowrap;
      }
      /* Name takes what is left; the two numbers take what a number needs. */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 140px 160px;
        gap: 12px;
        padding: 8px 18px 14px;
      }
      :host([mobile]) .grid {
        grid-template-columns: 1fr;
        gap: 14px;
        padding: 14px 16px;
      }
      /* Two sections that keep the grid's own gap between them. */
      .attachments {
        grid-column: 1 / -1;
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      :host([mobile]) .attachments {
        gap: 14px;
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
      /* Packed to the top: a stretched cell beside the textarea would share the
         surplus between its label and control. */
      .cell {
        display: grid;
        align-content: start;
        gap: 4px;
        min-width: 0;
      }
      /* Only the header's "checked out" chip ("hv-chip state") matches this
         here, and its layout depends on it; the dates element has its own. */
      .state {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      textarea.hv-input {
        min-height: 44px;
        line-height: 1.5;
        resize: vertical;
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
        /* Rows size from their own room: the mobile flag describes the card. */
        container-type: inline-size;
      }
      .custom-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .custom-head .hv-tally {
        margin-left: auto;
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
      /* Too tight: the value drops under its key and remove spans both rows. */
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
      /* A note inside a label steps out of its uppercase treatment. */
      .label-note {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 400;
        color: var(--hv-text-tertiary);
      }
      .key-hints {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      .key-hints button {
        border: none;
        background: none;
        padding: 0 2px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
      :host([mobile]) .key-hints button {
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
        padding: 0 8px;
      }
      /* A phone shows the bare "Delete" verb so the three buttons fit at 375px;
         wrap is the last resort. */
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 4px;
        flex-wrap: wrap;
      }
      /* The actions stay pinned at the bottom of whatever scroller hosts the
         form. Sticky goes on the cell, whose containing block is the tall grid;
         the negative margins bleed the bar over .grid's side padding. */
      .actions-cell {
        position: sticky;
        bottom: -14px;
        z-index: 1;
        background: var(--hv-surface);
        margin: 0 -18px;
        padding: 10px 18px 14px;
        border-top: 1px solid var(--hv-row-divider);
      }
      :host([mobile]) .actions-cell {
        margin: 0 -16px;
        padding: 10px 16px 14px;
      }
      /* On a spacer, not the hint, which a phone drops. */
      .actions .spacer {
        margin-left: auto;
      }
      .actions .hint {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
      /* Whether there is a keyboard is a pointer question, not a width one. */
      @media (hover: none), (pointer: coarse) {
        .actions .hint {
          display: none;
        }
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
      .banner {
        margin: 0 18px;
        padding: 9px 12px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: var(--hv-editor-note);
      }
      .attach-hint {
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
    `,
  ];

  /** null means "add item" — the same expander, empty. */
  @property({ attribute: false }) item: Item | null = null;
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** HA areas, so the location picker files its roots under the right one. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  @property({ attribute: false }) categorySuggestions: string[] = [];
  @property({ attribute: false }) tagSuggestions: string[] = [];
  @property({ attribute: false }) customFieldKeys: string[] = [];
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ type: Boolean }) busy = false;
  /** Server-side failure to show above the actions. */
  @property({ type: String }) errorMessage: string | null = null;
  /** Hide the header row when the host already provides one (the mobile sheet). */
  @property({ type: Boolean }) noHeader = false;
  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  /** Attachment access; null hides the attachment sections entirely. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Caps and accepted types, so a doomed file is refused before it is sent. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;
  /** Creates a location from inside the picker, for a first run; null offers no create. */
  @property({ attribute: false }) createLocation: ((name: string) => Promise<Location>) | null = null;

  /**
   * How this form asks before its Cancel, ✕ or Escape throws typing away. The
   * host owns the dialog, so every way out asks one question; null closes quietly.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;

  @state() private _model: ItemFormModel = formFromItem(null);
  @state() private _errors: FieldError[] = [];
  @state() private _showErrors = false;

  /** The "Copied" label on the id row's button. */
  private readonly _copyFlash = new CopyFlash(this);
  /** The item id `_model` was built from: `undefined` before the first update, `null` to create. */
  private _formItemId: string | null | undefined;
  /**
   * The item as the form was filled from it, which a save diffs against: `item`
   * may already carry another member's edit, which must stay out of the payload.
   */
  private _formItem: Item | null = null;

  /** The item to save against: whatever the last upload returned, else the input. */
  private get _current(): Item | null {
    return this._attachments?.current ?? this.item;
  }

  private readonly _emit = emitter<'hv-item-editor'>(this);

  @query('#hv-editor-name') private _nameInput!: HTMLInputElement | null;
  @query('hv-editor-category') private _category!: HVEditorCategory | null;
  @query('hv-editor-attachments') private _attachments!: HVEditorAttachments | null;
  @query('hv-editor-location') private _locationField!: HVEditorLocation | null;
  @query('hv-editor-dates') private _dates!: HVEditorDates | null;

  /** Focus inside the form so its Escape handler hears the key. */
  protected override firstUpdated() {
    this._nameInput?.focus();
  }

  /**
   * The form belongs to an item id, not to one `item` object: hosts re-bind
   * `.item` on every store broadcast, and rebuilding on that would throw away
   * the typing. A different id (including a create's null→id hop) is a new
   * form, which is a new element: every host renders this one `keyed` by item
   * id, so no state here or in the children is reset by hand. An id change on
   * a live form is a host bug, refused before a save could carry one item's
   * typing onto another.
   */
  protected override willUpdate() {
    const id = this.item?.id ?? null;
    if (this._formItemId === undefined) {
      this._formItemId = id;
      this._formItem = this.item ?? null;
      this._model = formFromItem(this.item);
      return;
    }
    if (id !== this._formItemId) {
      throw new Error('hv-item-editor: the item id changed under an open form; render it keyed by item id');
    }
  }

  /** True when the user has typed something they would lose. */
  get dirty(): boolean {
    return isDirty(this._model, this.item);
  }

  private _patch(patch: Partial<ItemFormModel>) {
    this._model = { ...this._model, ...patch };
    if (this._showErrors) this._errors = validateForm(this._model, this._current);
  }

  private _errorFor(field: string): string | null {
    if (!this._showErrors) return null;
    return this._errors.find((e) => e.field === field)?.message ?? null;
  }

  private _save = () => {
    // The caps refuse growth past the stored item, not a legacy over-cap value.
    const errors = validateForm(this._model, this._current);
    this._errors = errors;
    this._showErrors = true;
    if (errors.length) return;
    const current = this._current;
    const detail = current
      ? {
          itemId: current.id,
          expectedVersion: current.version,
          // Newest version, but diffed against the copy the form was filled from.
          changes: toUpdatePayload(this._model, this._formItem ?? current),
        }
      : { itemId: null, expectedVersion: undefined, create: toCreatePayload(this._model) };
    this._emit('save', detail);
  };

  /** What pressing Save does, including nothing while a save is in flight. */
  requestSave(): void {
    if (this.busy) return;
    this._save();
  }

  private _cancel = () => {
    this._emit('cancel');
  };

  /** Cancel, the ✕ and Escape: a dirty form asks the host first, then sends `cancel`. */
  private _requestCancel = () => {
    const ask = this.confirmDiscard;
    if (this.dirty && ask) ask(() => this._cancel());
    else this._cancel();
  };

  /** Escape closes whatever is open over the form first, then the form. */
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const category = this._category;
      if (category?.open) {
        category.close();
      } else if (this._dates?.checkoutOpen) {
        this._dates.closeCheckout();
      } else if (this._locationField?.open) {
        this._locationField.close();
      } else {
        this._requestCancel();
      }
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this._save();
    }
  };

  /** Rescue focus into the form when a surface over it closes with its opener gone. */
  private _refocus() {
    this._nameInput?.focus();
  }

  // ---------- Field renderers ----------
  private _text(
    field: 'name' | 'quantity' | 'lowStock',
    label: string,
    opts: { type?: string; id: string; testid: string },
  ) {
    const error = this._errorFor(field);
    return html`<div class="cell ${error ? 'invalid' : ''}">
      <label class="hv-label" for=${opts.id}>${label}</label>
      <input
        id=${opts.id}
        class="hv-input"
        type=${opts.type ?? 'text'}
        data-testid=${opts.testid}
        .value=${String(this._model[field] ?? '')}
        @input=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value;
          const value = opts.type !== 'number' ? raw : raw === '' ? null : Number(raw);
          this._patch({ [field]: value });
        }}
      />
      ${error ? html`<span class="field-error" data-testid=${`${opts.testid}-error`}>${error}</span>` : null}
    </div>`;
  }

  /** The description, placed differently per width, so one renderer keeps one id. */
  private _renderDescriptionField() {
    return html`<div class="cell span2">
      <label class="hv-label" for="editor-description">${t('hv.field.description')}</label>
      <textarea
        id="editor-description"
        class="hv-input"
        data-testid="editor-description"
        .value=${this._model.description}
        @input=${(e: Event) => this._patch({ description: (e.target as HTMLTextAreaElement).value })}
      ></textarea>
    </div>`;
  }

  /** Re-render at midnight, since the editor marks a past due date overdue. */
  override connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dayUnsub?.();
    this._dayUnsub = undefined;
  }

  private _dayUnsub?: () => void;

  private _renderStatusField() {
    return html`<div class="cell">
      <label class="hv-label" for="editor-status">${t('hv.field.status')}</label>
      <select
        id="editor-status"
        class="hv-input"
        data-testid="editor-status"
        @change=${(e: Event) => this._patch({ status: (e.target as HTMLSelectElement).value })}
      >
        <!-- An <option> cannot hold an SVG, so the picker carries labels
             alone; the colour and glyph appear wherever the status is shown. -->
        ${statusList(this.statuses).map(
          ({ slug: s }) =>
            html`<option value=${s} ?selected=${this._model.status === s}>
              ${statusLabel(s, this.statuses)}
            </option>`,
        )}
      </select>
    </div>`;
  }

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
          <span class="hv-label">${t('hv.editor.customFields')}</span>
          <span class="hv-tally" data-testid="editor-cf-tally"
            >${t('hv.editor.fieldsSet', { fields: counted(used, 'field') })}</span
          >
        </div>
        ${rows.map((row) => {
          const error = this._errorFor(`custom:${row.id}`);
          return html`<div class="cf-row ${error ? 'invalid' : ''}" data-testid="editor-cf-row" data-id=${row.id}>
            <input
              class="hv-input cf-key"
              data-testid="editor-cf-key"
              aria-label=${t('hv.editor.fieldKey')}
              placeholder=${t('hv.editor.fieldKeyPlaceholder')}
              .value=${row.key}
              @input=${(e: Event) => this._patchRow(row.id, { key: (e.target as HTMLInputElement).value })}
            />
            <select
              class="hv-input cf-type"
              data-testid="editor-cf-type"
              aria-label=${t('hv.editor.fieldType')}
              @change=${(e: Event) =>
                this._patchRow(row.id, { type: (e.target as HTMLSelectElement).value as CustomFieldType })}
            >
              ${customFieldTypes().map(
                (t) => html`<option value=${t.value} ?selected=${row.type === t.value}>${t.label}</option>`,
              )}
            </select>
            ${
              row.type === 'boolean'
                ? html`<button
                  class="toggle cf-value"
                  role="switch"
                  aria-checked=${String(row.value === 'true')}
                  data-testid="editor-cf-value"
                  @click=${() => this._patchRow(row.id, { value: row.value === 'true' ? 'false' : 'true' })}
                >
                  <span class="switch ${row.value === 'true' ? 'on' : ''}"></span>
                  <span>${row.value === 'true' ? t('hv.term.yes') : t('hv.term.no')}</span>
                </button>`
                : html`<input
                  class="hv-input cf-value"
                  data-testid="editor-cf-value"
                  aria-label=${t('hv.editor.fieldValue')}
                  type=${row.type === 'number' ? 'number' : row.type === 'date' ? 'date' : 'text'}
                  .value=${row.value}
                  @input=${(e: Event) => this._patchRow(row.id, { value: (e.target as HTMLInputElement).value })}
                />`
            }
            <button
              class="cf-remove"
              data-testid="editor-cf-remove"
              aria-label=${t('hv.editor.removeNamedField', {
                key: row.key || t('hv.editor.fieldFallbackName'),
              })}
              title=${t('hv.editor.removeField')}
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
          ${icon('plus', 15)}${t('hv.editor.addField')}
        </button>
        ${
          unusedKeys.length
            ? html`<span class="key-hints" data-testid="editor-cf-key-hints">
              ${t('hv.editor.keySuggestions')}
              ${unusedKeys.map(
                (k) => html`<button
                  data-testid="editor-cf-key-hint"
                  data-value=${k}
                  @click=${() => this._patch({ customFields: [...rows, newCustomFieldRow({ key: k })] })}
                >
                  ${k}
                </button>`,
              )}
              · ${t('hv.editor.clearingUnsets')}
            </span>`
            : html`<span class="key-hints">${t('hv.editor.clearingUnsets')}</span>`
        }
      </div>
    </div>`;
  }

  // ---------- Attachments ----------

  /** The photo strip and the document list; only for a saved item, which has an id. */
  private _renderAttachments() {
    if (!this.item || !this.media) return null;
    return html`<hv-editor-attachments
      class="attachments"
      ?mobile=${this.mobile}
      .item=${this.item}
      .media=${this.media}
      .mediaConfig=${this.mediaConfig}
      @focus-stranded=${(e: HvEvent<'hv-editor-attachments', 'focus-stranded'>) => {
        e.stopPropagation();
        this._refocus();
      }}
    ></hv-editor-attachments>`;
  }

  /** Why a new item has no attachment sections yet: it has no id until saved. */
  private _renderCreateAttachmentHint() {
    if (this.item !== null || !this.media) return null;
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.editor.attachmentsLater')}</span>
      <span class="attach-hint" data-testid="editor-attachment-hint">
        ${t('hv.editor.attachmentsHint')}
      </span>
    </div>`;
  }

  /** The `item_id` every `haventory.*` action takes; on a desktop only this form shows it. */
  private _renderIdRow() {
    const id = this.item?.id;
    if (!id) return null;
    return html`<div class="cell span3">
      <span class="hv-label">${t('hv.term.id')}</span>
      <div class="id-row">
        <code data-testid="editor-id">${id}</code>
        <button
          class="hv-text-button"
          data-testid="editor-copy-id"
          @click=${() => void this._copyFlash.copy(id)}
        >
          ${this._copyFlash.copied ? t('hv.action.copied') : t('hv.action.copy')}
        </button>
      </div>
    </div>`;
  }

  /**
   * An uncancelled drop navigates to the dropped file, taking the form with it,
   * and HA does not block that; so the root cancels both events on every layout.
   */
  private _onRootDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private _onRootDrop(e: DragEvent) {
    e.preventDefault();
    this._attachments?.endDrag();
  }

  override render() {
    const model = this._model;
    const creating = this.item === null;
    const overdue = isOverdue(this.item?.due_date);

    return html`
      <div
        data-testid="item-editor"
        @keydown=${this._onKeydown}
        @dragover=${this._onRootDragOver}
        @drop=${this._onRootDrop}
      >
        ${
          this.noHeader
            ? null
            : html`<div class="head">
              ${icon('chevronDown', 18)}
              <span class="name" data-testid="editor-heading">
                ${
                  creating
                    ? t('hv.editor.heading.new')
                    : t('hv.editor.heading.editing', { name: this.item?.name ?? '' })
                }
              </span>
              ${
                this.item?.checked_out
                  ? html`<span class="hv-chip ${overdue ? 'error' : 'state'}" data-testid="editor-out-chip">
                    ${overdue ? t('hv.term.overdue') : t('hv.term.checkedOut')}${
                      this.item?.due_date
                        ? ` · ${t('hv.term.due', { date: formatDate(this.item.due_date) })}`
                        : ''
                    }
                  </span>`
                  : null
              }
              ${
                this.item
                  ? html`<span class="meta" data-testid="editor-version"
                    >${t('hv.editor.version', {
                      version: this.item.version,
                      when: relativeTime(this.item.updated_at),
                    })}</span
                  >`
                  : null
              }
              <button
                class="hv-icon-button"
                data-testid="editor-close"
                aria-label=${t('hv.editor.close')}
                @click=${this._requestCancel}
              >
                ${icon('close', 18)}
              </button>
            </div>`
        }
        ${
          this.errorMessage
            ? html`<div class="banner" role="alert" data-testid="editor-error">${this.errorMessage}</div>`
            : null
        }

        <div class="grid">
          ${this._text('name', t('hv.field.name'), { id: 'hv-editor-name', testid: 'editor-name' })}
          ${this._text('quantity', t('hv.field.quantity'), {
            type: 'number',
            id: 'hv-editor-quantity',
            testid: 'editor-quantity',
          })}
          ${this._text('lowStock', t('hv.field.lowStock'), {
            type: 'number',
            id: 'hv-editor-low-stock',
            testid: 'editor-low-stock',
          })}
          ${this.mobile ? null : html`${this._renderDescriptionField()} ${this._renderStatusField()}`}
          <hv-editor-location
            class="cell span2"
            ?mobile=${this.mobile}
            .value=${model.locationId}
            .locations=${this.locations}
            .locationTree=${this.locationTree}
            .areas=${this.areas}
            .createLocation=${this.createLocation}
            @change=${(e: HvEvent<'hv-editor-location', 'change'>) => this._patch(e.detail)}
          ></hv-editor-location>
          <hv-editor-category
            class="cell"
            ?mobile=${this.mobile}
            .value=${model.category}
            .suggestions=${this.categorySuggestions}
            @change=${(e: HvEvent<'hv-editor-category', 'change'>) => this._patch(e.detail)}
          ></hv-editor-category>
          ${this.mobile ? this._renderStatusField() : null}
          <div class="cell span3">
            <span class="hv-label"
              >${t('hv.field.tags')}
              <span class="label-note">${t('hv.editor.field.tagsNote')}</span></span
            >
            <hv-chip-input
              data-testid="editor-tags"
              .values=${model.tags}
              .suggestions=${this.tagSuggestions}
              @change=${(e: HvEvent<'hv-chip-input', 'change'>) => this._patch({ tags: e.detail.values })}
            ></hv-chip-input>
          </div>
          ${this._renderAttachments()} ${this._renderCreateAttachmentHint()}
          ${this.mobile ? this._renderDescriptionField() : null}
          <hv-editor-dates
            class="cell span3"
            ?mobile=${this.mobile}
            .model=${model}
            .item=${this.item}
            @change=${(e: HvEvent<'hv-editor-dates', 'change'>) => this._patch(e.detail)}
          ></hv-editor-dates>
          ${this._renderCustomFields()}

          ${this._renderIdRow()}

          <div class="cell span3 actions-cell">
            <div class="actions">
              ${
                this.item
                  ? html`<button
                    class="hv-text-button danger"
                    data-testid="editor-delete"
                    aria-label=${t('hv.action.deleteItem')}
                    @click=${() => this._emit('delete-item', { itemId: this.item!.id, name: this.item!.name })}
                  >
                    ${t(this.mobile ? 'hv.action.delete' : 'hv.action.deleteItem')}
                  </button>`
                  : null
              }
              <span class="spacer"></span>
              ${
                this.mobile
                  ? null
                  : html`<span class="hint" data-testid="editor-key-hint">
                    ${t('hv.editor.keyHint', { chord: saveShortcutLabel() })}
                  </span>`
              }
              <button class="hv-text-button" data-testid="editor-cancel" @click=${this._requestCancel}>
                ${t('hv.action.cancel')}
              </button>
              <button class="save" data-testid="editor-save" ?disabled=${this.busy} @click=${this._save}>
                ${this.busy ? t('hv.action.saving') : t('hv.action.save')}
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
