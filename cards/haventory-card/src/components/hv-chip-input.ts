import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { chip, tagLabel } from '../ui/chip';
import { icon } from '../ui/icons';
import { normalizeTags } from '../ui/item-form';

/**
 * Tag editor: removable chips plus a ghost "Add tag…" input with suggestions.
 *
 * Values are lowercased on commit because the backend normalizes tags anyway
 * (trimmed, lowercased, deduplicated) — doing it here means what the user sees
 * is what ends up stored.
 */
@customElement('hv-chip-input')
export class HVChipInput extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 7px 11px;
      }
      .field:focus-within {
        border-color: var(--hv-primary);
      }
      .chip svg {
        opacity: 0.75;
      }
      /* The one control that does not reach 44px. It is a 14px glyph living
         inside a chip that wraps with a 6px gap, so a 44px hit area would reach
         well into the chip beside it and remove the wrong tag. 24px is the
         widest it can grow while still belonging to its own chip, which meets
         WCAG 2.5.8 even though it misses the 2.5.5 target the rest of the
         mobile controls now hit.

         The pill around it is not a target at all, which is why it takes the
         shared chip metrics untouched: the hit area below is set by this
         ::after and a taller pill would not grow it by a pixel — it would only
         make a tag in this field bigger than the same tag in the table. The
         field still reaches a full tap height, from the input beside them. */
      .chip-remove {
        position: relative;
        width: 14px;
        height: 14px;
        color: inherit;
      }
      .chip-remove::after {
        content: '';
        position: absolute;
        inset: -5px;
      }
      input {
        flex: 1;
        min-width: 90px;
        min-height: var(--hv-tap-min, auto);
        border: none;
        outline: none;
        background: none;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      .suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 5px;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .suggestion {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--hv-tap-min, auto);
        /* A three-letter tag is otherwise a 23px-wide target. */
        min-width: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0 6px;
        font: inherit;
        color: var(--hv-primary-dark);
      }
    `,
  ];

  @property({ attribute: false }) values: string[] = [];
  @property({ attribute: false }) suggestions: string[] = [];
  @property({ type: String }) placeholder = t('hv.chipInput.placeholder');

  @state() private _draft = '';

  private _emit(values: string[]) {
    this.dispatchEvent(new CustomEvent('change', { detail: { values }, bubbles: true, composed: true }));
  }

  private _add(raw: string) {
    const next = normalizeTags([...this.values, raw]);
    this._draft = '';
    if (next.length !== this.values.length || next.join(' ') !== this.values.join(' ')) this._emit(next);
  }

  private _remove(tag: string) {
    this._emit(this.values.filter((t) => t !== tag));
  }

  private get _visibleSuggestions(): string[] {
    const needle = this._draft.trim().toLowerCase();
    return this.suggestions
      .filter((s) => !this.values.includes(s.toLowerCase()))
      .filter((s) => !needle || s.toLowerCase().includes(needle))
      .slice(0, 3);
  }

  render() {
    const suggestions = this._visibleSuggestions;
    return html`
      <div class="field" data-testid="chip-field">
        ${this.values.map(
          (tag) => html`<span class="hv-chip tag chip" data-testid="chip" data-value=${tag}>
            ${tagLabel(tag)}
            <button
              class="hv-icon-button chip-remove"
              data-testid="chip-remove"
              data-value=${tag}
              aria-label=${t('hv.action.removeTag', { tag })}
              @click=${() => this._remove(tag)}
            >
              ${icon('close', 12)}
            </button>
          </span>`,
        )}
        <input
          type="text"
          data-testid="chip-input"
          placeholder=${this.placeholder}
          .value=${this._draft}
          @input=${(e: Event) => {
            this._draft = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              this._add(this._draft);
            } else if (e.key === 'Backspace' && !this._draft && this.values.length) {
              e.preventDefault();
              this._remove(this.values[this.values.length - 1]);
            }
          }}
          @blur=${() => this._add(this._draft)}
        />
      </div>
      ${suggestions.length
        ? html`<div class="suggestions" data-testid="chip-suggestions">
            ${suggestions.map(
              (s) => html`<button
                class="suggestion"
                data-testid="chip-suggestion"
                data-value=${s}
                @mousedown=${(e: Event) => e.preventDefault()}
                @click=${() => this._add(s)}
              >
                ${s}
              </button>`,
            )}
          </div>`
        : null}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-chip-input': HVChipInput;
  }
}
