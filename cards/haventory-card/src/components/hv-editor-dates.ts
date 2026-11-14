import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { editorFields } from '../ui/editor-fields';
import { icon } from '../ui/icons';
import { DEFAULT_CUSTOM_DAYS } from '../ui/relative-time';
import { dayOffsets, renderDayOffsets } from '../ui/day-offsets';
import { onDayChange } from '../ui/day-clock';
import { REMINDER_UNITS } from '../ui/item-form';
import type { ItemFormModel } from '../ui/item-form';
import type { Item, ReminderUnit } from '../store/types';
import './hv-checkout-popover';

/**
 * The item editor's dates: the check-out with its due date (live only while
 * out), the unrelated inspection date, and the reminder. Checking out writes
 * `checkedOut` into the form model rather than sending the command, since a
 * new item has no id yet. It owns the check-out dialog's open state and the
 * inspection field's "+X days" row; the values are the editor's, which this
 * element hears back as `.model` after each `change`.
 *
 * The day offsets are computed from today, so it re-renders at midnight.
 */
@customElement('hv-editor-dates')
export class HVEditorDates extends LitElement {
  static override styles = [
    tokens,
    base,
    editorFields,
    dayOffsets,
    css`
      /* Check-out with its due date, and the unrelated inspection date, as two
         boxes of equal height so they read as two things, not three peers. */
      .state {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
      }
      :host([mobile]) .state {
        grid-template-columns: 1fr;
      }
      /* Three controls, so the reminder takes the whole row. */
      .state .reminder {
        grid-column: 1 / -1;
      }
      .repeat {
        display: grid;
        grid-template-columns: auto minmax(0, 4.5rem) minmax(0, 7rem);
        align-items: center;
        gap: 8px;
      }
      :host([mobile]) .repeat {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      :host([mobile]) .repeat > label {
        grid-column: 1 / -1;
      }
      /* Packed to the top, as the editor's .cell, inside a box stretched to its neighbour. */
      .group {
        display: grid;
        align-content: start;
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
      /* The date and its clear button on one line, no taller than the input. */
      .inspection-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--hv-tap-min, 34px);
        align-items: center;
        gap: 8px;
      }
      /* Shut, it would still take a grid row and a gap. */
      hv-checkout-popover:not([open]) {
        display: none;
      }
      /* The button and the due date share a row by construction: the label row
         leaves column 1 empty because the button has no label. */
      .checkout-body {
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
          '. label'
          'action field'
          'hint hint';
        gap: 4px 12px;
      }
      .due-label {
        grid-area: label;
      }
      .due-input {
        grid-area: field;
      }
      .checkout-body .group-hint {
        grid-area: hint;
      }
      /* The gap and the weight are .field-button's, from editorFields. */
      .checkout-action {
        grid-area: action;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
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
        font-size: var(--hv-editor-note);
        line-height: 1.4;
        color: var(--hv-text-tertiary);
      }
      :host([mobile]) .offset {
        min-height: var(--hv-tap-min, auto);
        padding: 0 15px;
        font-size: 13.5px;
      }
      :host([mobile]) .day-box input {
        min-height: 44px;
        width: 88px;
        font-size: var(--hv-input-font, 14.5px);
      }
      /* A native date input clips its placeholder below ~140px, so a phone stacks. */
      :host([mobile]) .checkout-body {
        grid-template-columns: 1fr;
        grid-template-areas:
          'action'
          'label'
          'field'
          'hint';
      }
      :host([mobile]) .checkout-action {
        margin-bottom: 8px;
      }
    `,
  ];

  /** The editor's whole form model; this element reads the dates, the reminder and the name. */
  @property({ attribute: false }) model!: ItemFormModel;
  /** The item being edited, for the check-out dialog's own suggestions; null while creating. */
  @property({ attribute: false }) item: Item | null = null;
  @property({ type: Boolean, reflect: true }) mobile = false;

  /** The check-out dialog, and the button it hangs from on a wide screen. */
  @state() private _checkoutOpen = false;
  @state() private _checkoutAnchor: DOMRect | null = null;
  /** The inspection field's "+X days" row is showing, and owns the date. */
  @state() private _inspectionCustomOpen = false;
  @state() private _inspectionCustomDays = DEFAULT_CUSTOM_DAYS;

  private readonly _emit = emitter<'hv-editor-dates'>(this);
  private _dayUnsub?: () => void;

  @query('#editor-inspection') private _inspectionInput!: HTMLInputElement | null;

  /** Whether the check-out dialog is showing, for the editor deciding what Escape takes back. */
  get checkoutOpen(): boolean {
    return this._checkoutOpen;
  }

  closeCheckout(): void {
    this._checkoutOpen = false;
  }

  /** Re-render at midnight, since the day offsets are worked out from today. */
  override connectedCallback(): void {
    super.connectedCallback();
    this._dayUnsub = onDayChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._dayUnsub?.();
    this._dayUnsub = undefined;
  }

  /**
   * A date that comes round again, with an optional repeat (blank is a one-off).
   * Saved with the rest of the form, not through `haventory/reminder/set`.
   */
  private _renderReminderFields() {
    const model = this.model;
    return html`<div class="group reminder" role="group" aria-labelledby="editor-reminder-caption">
      <span class="hv-label group-caption" id="editor-reminder-caption" data-testid="editor-reminder-caption">
        ${icon('clock', 14)} ${t('hv.field.reminder_date')}
      </span>
      <div class="group-body">
        <input
          id="editor-reminder-date"
          class="hv-input"
          type="date"
          aria-label=${t('hv.editor.reminderDate')}
          data-testid="editor-reminder-date"
          .value=${model.reminderDate}
          @input=${(e: Event) => this._emit('change', { reminderDate: (e.target as HTMLInputElement).value })}
        />
        <div class="repeat">
          <label class="hv-label ${model.reminderDate ? '' : 'muted'}" for="editor-reminder-count">
            ${t('hv.editor.repeatEvery')}
          </label>
          <input
            id="editor-reminder-count"
            class="hv-input repeat-count"
            type="number"
            min="1"
            max="1000"
            placeholder="—"
            data-testid="editor-reminder-count"
            ?disabled=${!model.reminderDate}
            title=${model.reminderDate ? '' : t('hv.editor.reminderHint')}
            .value=${model.reminderCount === null ? '' : String(model.reminderCount)}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value.trim();
              this._emit('change', { reminderCount: raw === '' ? null : Number(raw) });
            }}
          />
          <select
            class="hv-input repeat-unit"
            aria-label=${t('hv.editor.repeatUnit')}
            data-testid="editor-reminder-unit"
            ?disabled=${!model.reminderDate}
            .value=${model.reminderUnit}
            @change=${(e: Event) =>
              this._emit('change', { reminderUnit: (e.target as HTMLSelectElement).value as ReminderUnit })}
          >
            ${REMINDER_UNITS.map(
              (unit) => html`<option value=${unit} ?selected=${unit === model.reminderUnit}>
                ${t(`hv.editor.unit.${unit}`)}
              </option>`,
            )}
          </select>
        </div>
        ${
          model.reminderDate
            ? null
            : html`<span class="group-hint" data-testid="editor-reminder-hint">${t('hv.editor.reminderHint')}</span>`
        }
      </div>
    </div>`;
  }

  /** The `ui/day-offsets` quick jumps for the inspection date. */
  private _renderInspectionOffsets(current: string) {
    return renderDayOffsets(
      {
        current,
        customOpen: this._inspectionCustomOpen,
        customDays: this._inspectionCustomDays,
      },
      {
        prefix: 'editor-inspection',
        onPick: (date) => {
          this._inspectionCustomOpen = false;
          this._emit('change', { inspectionDate: date });
        },
        onCustom: (date) => {
          this._inspectionCustomOpen = true;
          this._emit('change', { inspectionDate: date });
        },
        onDays: (days, date) => {
          this._inspectionCustomDays = days;
          this._emit('change', { inspectionDate: date ?? '' });
        },
      },
    );
  }

  /**
   * Clear the inspection date and its custom row. Focus moves to the field,
   * since the button disables itself and would drop focus to the page body.
   */
  private _clearInspection = () => {
    this._inspectionCustomOpen = false;
    this._emit('change', { inspectionDate: '' });
    this._inspectionInput?.focus();
  };

  private _onCheckoutPressed = (e: Event) => {
    if (this.model.checkedOut) {
      this._emit('change', { checkedOut: false });
      return;
    }
    this._checkoutAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._checkoutOpen = true;
  };

  override render() {
    const model = this.model;
    return html`<div class="state">
      <div class="group" role="group" aria-labelledby="editor-checkout-caption">
        <span class="hv-label group-caption" id="editor-checkout-caption" data-testid="editor-checkout-caption">
          ${icon('account', 14)} ${t('hv.editor.checkOutCaption')}
        </span>
        <div class="group-body checkout-body">
          <button
            class="field-button checkout-action"
            data-testid="editor-checked-out"
            @click=${this._onCheckoutPressed}
          >
            ${icon(model.checkedOut ? 'check' : 'account', 16)}
            <span>${model.checkedOut ? t('hv.action.checkIn') : t('hv.action.checkOutEllipsis')}</span>
          </button>
          <label class="hv-label due-label ${model.checkedOut ? '' : 'muted'}" for="editor-due">
            ${t('hv.field.due_date')}
          </label>
          <input
            id="editor-due"
            class="hv-input due-input"
            type="date"
            data-testid="editor-due-date"
            ?disabled=${!model.checkedOut}
            title=${model.checkedOut ? '' : t('hv.editor.dueDateHint')}
            .value=${model.dueDate}
            @input=${(e: Event) => this._emit('change', { dueDate: (e.target as HTMLInputElement).value })}
          />
          ${
            model.checkedOut
              ? null
              : html`<span class="group-hint" data-testid="editor-due-hint">${t('hv.editor.dueDateHint')}</span>`
          }
        </div>
        <hv-checkout-popover
          data-testid="editor-checkout"
          .item=${this.item}
          .itemName=${model.name.trim() || t('hv.editor.thisItem')}
          .anchor=${this._checkoutAnchor}
          ?inline=${this.mobile}
          ?touch=${this.mobile}
          ?open=${this._checkoutOpen}
          @check-out=${(e: HvEvent<'hv-checkout-popover', 'check-out'>) => {
            // A form event only: the shell would send the real command.
            e.stopPropagation();
            const { dueDate } = e.detail;
            this._emit('change', { checkedOut: true, dueDate: dueDate ?? '' });
            this._checkoutOpen = false;
          }}
          @cancel=${(e: HvEvent<'hv-checkout-popover', 'cancel'>) => {
            e.stopPropagation();
            this._checkoutOpen = false;
          }}
        ></hv-checkout-popover>
      </div>
      <div class="group">
        <label class="hv-label group-caption" for="editor-inspection" data-testid="editor-inspection-caption">
          ${icon('calendar', 14)} ${t('hv.field.inspection_date')}
        </label>
        <div class="group-body">
          <div class="inspection-row">
            <input
              id="editor-inspection"
              class="hv-input"
              type="date"
              data-testid="editor-inspection-date"
              .value=${model.inspectionDate}
              @input=${(e: Event) =>
                this._emit('change', { inspectionDate: (e.target as HTMLInputElement).value })}
            />
            <button
              class="hv-icon-button"
              data-testid="editor-inspection-clear"
              aria-label=${t('hv.editor.clearInspectionDate')}
              ?disabled=${!model.inspectionDate}
              @click=${this._clearInspection}
            >
              ${icon('close', 16)}
            </button>
          </div>
          ${this._renderInspectionOffsets(model.inspectionDate)}
        </div>
      </div>
      ${this._renderReminderFields()}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-editor-dates': HVEditorDates;
  }
}
