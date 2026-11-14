import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { emitter } from '../events';
import { tokens, base } from '../ui/tokens';
import { editorFields } from '../ui/editor-fields';
import { icon } from '../ui/icons';

/** The holder `aria-controls` names, so it can point at it while closed. */
const CATEGORY_LIST_ID = 'editor-category-list';
/** The category label names the listbox, which has no text of its own, and the combobox with it. */
const CATEGORY_LABEL_ID = 'editor-category-label';

/**
 * The item editor's category field: a free-text input that offers the
 * household's existing categories as a listbox under it. It owns the list's
 * open state and keyboard cursor; the value is the editor's, which this
 * element hears back as `.value` after each `change`.
 *
 * The label and its input live here together, because a `<label for>` cannot
 * name a control in another shadow root.
 */
@customElement('hv-editor-category')
export class HVEditorCategory extends LitElement {
  static override styles = [
    tokens,
    base,
    editorFields,
    css`
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
        color: var(--hv-on-primary-tint);
        font-weight: 500;
      }
      .option.active {
        box-shadow: inset 0 0 0 1px var(--hv-primary);
      }
      .option-empty {
        padding: 8px 12px;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-tertiary);
      }
    `,
  ];

  /** What the field holds, as the editor's form model has it. */
  @property({ type: String }) value = '';
  /** The categories already in use, offered in the list. */
  @property({ attribute: false }) suggestions: string[] = [];
  @property({ type: Boolean, reflect: true }) mobile = false;

  @state() private _open = false;
  /** Opened from the arrow: list everything, ignoring what is already typed. */
  @state() private _showAll = false;
  /** Keyboard cursor into the visible options; -1 = nothing active. */
  @state() private _index = -1;

  private readonly _emit = emitter<'hv-editor-category'>(this);

  /** Whether the list is showing, for the editor deciding what Escape takes back. */
  get open(): boolean {
    return this._open;
  }

  close(): void {
    this._open = false;
    this._showAll = false;
    this._index = -1;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.close();
  }

  /** What the dropdown shows: typing narrows it, the arrow and focus show all. */
  private get _options(): string[] {
    const query = this.value.trim().toLowerCase();
    if (this._showAll || !query) return this.suggestions;
    return this.suggestions.filter((c) => c.toLowerCase().includes(query));
  }

  private _openList(showAll: boolean) {
    if (!this.suggestions.length) return;
    this._showAll = showAll;
    this._open = true;
    this._index = -1;
  }

  private _choose(value: string) {
    this._emit('change', { category: value });
    this.close();
  }

  private _onKeydown(e: KeyboardEvent) {
    const options = this._options;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!this._open) {
          this._openList(false);
          this._index = 0;
          return;
        }
        if (!options.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        this._index = (this._index + step + options.length) % options.length;
        break;
      }
      case 'Enter':
        if (this._open) {
          const chosen = options[this._index];
          if (!chosen) break;
          e.preventDefault();
          e.stopPropagation();
          this._choose(chosen);
        }
        break;
      case 'Escape':
        // Dismiss the list only — the editor's own Escape would discard the edit.
        if (this._open) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  override render() {
    const typed = this.value.trim();
    const options = this._options;
    return html`
      <label class="hv-label" id=${CATEGORY_LABEL_ID} for="editor-category">${t('hv.field.category')}</label>
      <div class="combo">
        <input
          id="editor-category"
          class="hv-input"
          data-testid="editor-category"
          role="combobox"
          aria-labelledby=${CATEGORY_LABEL_ID}
          autocomplete="off"
          placeholder=${t('hv.editor.categoryPlaceholder')}
          aria-autocomplete="list"
          aria-expanded=${String(this._open)}
          aria-controls=${CATEGORY_LIST_ID}
          aria-activedescendant=${this._open && this._index >= 0 ? `editor-category-option-${this._index}` : ''}
          .value=${this.value}
          @focus=${() => this._openList(true)}
          @input=${(e: Event) => {
            this._emit('change', { category: (e.target as HTMLInputElement).value });
            this._openList(false);
          }}
          @keydown=${this._onKeydown}
          @blur=${() => this.close()}
        />
        ${
          this.suggestions.length
            ? html`<button
              class="combo-arrow"
              data-testid="editor-category-toggle"
              tabindex="-1"
              aria-label=${t('hv.editor.showAllCategories')}
              title=${t('hv.editor.showAllCategories')}
              @mousedown=${(e: Event) => e.preventDefault()}
              @click=${() => {
                // Only a second click on the *full* list closes it — pressing the
                // arrow while a typed filter is showing means "show me the rest".
                if (this._open && this._showAll) this.close();
                else this._openList(true);
              }}
            >
              ${icon('chevronDown', 18)}
            </button>`
            : null
        }
      </div>
      <div
        class="list-holder"
        role="listbox"
        id=${CATEGORY_LIST_ID}
        aria-labelledby=${CATEGORY_LABEL_ID}
        data-testid="editor-category-list"
        ?hidden=${!this._open}
      >
        ${
          this._open
            ? html`${
                options.length
                  ? options.map(
                      (c, i) => html`<button
                    class="option ${i === this._index ? 'active' : ''} ${
                      c.toLowerCase() === typed.toLowerCase() ? 'selected' : ''
                    }"
                    id=${`editor-category-option-${i}`}
                    role="option"
                    aria-selected=${String(c.toLowerCase() === typed.toLowerCase())}
                    data-testid="editor-category-option"
                    data-value=${c}
                    @mousedown=${(e: Event) => e.preventDefault()}
                    @click=${() => this._choose(c)}
                  >
                    <span class="label">${c}</span>
                    ${c.toLowerCase() === typed.toLowerCase() ? icon('check', 15) : null}
                  </button>`,
                    )
                  : html`<div class="option-empty" data-testid="editor-category-empty">
                  ${t('hv.editor.categoryEmpty', { typed })}
                </div>`
              }`
            : null
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-editor-category': HVEditorCategory;
  }
}
