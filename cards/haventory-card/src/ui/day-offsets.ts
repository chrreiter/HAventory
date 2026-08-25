import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { addDays, quickDayOffsets } from './relative-time';

/**
 * The quick jumps a forward date is set by: three presets and a "+X days"
 * escape hatch.
 *
 * The check-out popover dates a borrowing and the editor dates an inspection,
 * and both are spans a household names in weeks rather than calendar squares.
 * The two controls looked identical because they are the same gesture, so the
 * presets, the states, the input's bounds and the rule that an empty box means
 * no date rather than a stale one are written here once. What each surface
 * calls its buttons is a parameter — the browser harnesses locate
 * `checkout-offset` — and one renderer is what keeps them byte-identical.
 *
 * The custom row appears only once "+X days" is pressed: it is the way out for
 * an interval the three presets do not cover, not a fourth preset.
 */

/**
 * The row and the custom box. A host adds this to its styles and keeps its own
 * touch rules on the same class names — the two surfaces grow the chips for a
 * finger by different amounts, because one is a form and the other a popover.
 */
export const dayOffsets = css`
  .offsets {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }
  .offset {
    border: 1px solid var(--hv-divider);
    background: none;
    color: var(--hv-chip-text);
    border-radius: var(--hv-radius-chip);
    padding: 6px 13px;
    font: 400 12.5px var(--hv-font);
    cursor: pointer;
  }
  .offset.on {
    background: var(--hv-primary-dark);
    border-color: var(--hv-primary-dark);
    color: #fff;
    font-weight: 500;
  }
  .day-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--hv-divider);
    border-radius: var(--hv-radius-input);
    font-size: 13px;
    color: var(--hv-text-secondary);
  }
  .day-box input {
    width: 72px;
    box-sizing: border-box;
    border: 1px solid var(--hv-input-border);
    border-radius: var(--hv-radius-input);
    background: var(--hv-surface);
    color: var(--hv-text);
    padding: 5px 8px;
    font: 400 13.5px var(--hv-font);
  }
`;

/** What the control is showing, all of it owned by the host. */
export interface DayOffsetsState {
  /** The date the field holds now; a preset reads as on when it computes this. */
  current: string | null;
  /** The custom row is showing, which is also what takes the on state off a preset. */
  customOpen: boolean;
  /** The count in the custom box. */
  customDays: number;
}

/** How a surface names its buttons, and what it does with a date. */
export interface DayOffsetsOptions {
  /**
   * Test-id stem: `checkout` gives `checkout-offset`, `checkout-offset-custom`
   * and `checkout-custom`.
   */
  prefix: string;
  /** A preset was pressed. The host also closes its custom row. */
  onPick: (date: string) => void;
  /** "+X days" was pressed. The host also opens its custom row. */
  onCustom: (date: string) => void;
  /**
   * The custom box was typed in. `date` is null for an empty or nonsense count:
   * that means no date yet rather than the last good one, so the field clears.
   */
  onDays: (days: number, date: string | null) => void;
}

export function renderDayOffsets(state: DayOffsetsState, opts: DayOffsetsOptions): TemplateResult {
  const { prefix } = opts;
  return html`
    <div class="offsets" data-testid=${`${prefix}-offsets`}>
      ${quickDayOffsets().map((offset) => {
        const value = addDays(offset.days);
        return html`<button
          class="offset ${!state.customOpen && state.current === value ? 'on' : ''}"
          data-testid=${`${prefix}-offset`}
          data-days=${offset.days}
          @click=${() => opts.onPick(value)}
        >
          ${offset.label}
        </button>`;
      })}
      <button
        class="offset ${state.customOpen ? 'on' : ''}"
        data-testid=${`${prefix}-offset-custom`}
        @click=${() => opts.onCustom(addDays(state.customDays))}
      >
        ${t('hv.editor.customDaysOffset')}
      </button>
    </div>
    ${state.customOpen
      ? html`<label class="day-box" data-testid=${`${prefix}-custom`}>
          <input
            type="number"
            min="1"
            max="3650"
            inputmode="numeric"
            aria-label=${t('hv.editor.daysFromToday')}
            .value=${String(state.customDays)}
            @input=${(e: Event) => {
              const days = Number((e.target as HTMLInputElement).value);
              opts.onDays(days, Number.isFinite(days) && days >= 1 ? addDays(Math.floor(days)) : null);
            }}
          />
          <span>${t('hv.editor.daysFromToday')}</span>
        </label>`
      : null}
  `;
}
