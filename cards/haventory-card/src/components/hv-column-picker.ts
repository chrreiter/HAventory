import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import type { ColumnKey } from '../store/columns';
import { COLUMN_DEFS, normalizeColumns } from '../store/columns';

/**
 * Small modal to choose which optional columns show in a given view.
 *
 * Presentational: it reflects `columns` (the current selection) and emits a
 * `change` event with the new selection whenever a column is toggled. The
 * container owns persistence.
 */
@customElement('hv-column-picker')
export class HVColumnPicker extends LitElement {
  static styles = css`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
    .panel-wrap { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
    .panel {
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 16px;
      max-width: 320px;
      width: calc(100vw - 32px);
      box-sizing: border-box;
      font: inherit;
    }
    h2 { font-size: 1.1em; margin: 0 0 8px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { margin: 0; }
    label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 4px;
      cursor: pointer;
    }
    input[type="checkbox"] { accent-color: var(--primary-color, #03a9f4); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .actions button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font: inherit;
    }
    .actions button:hover { opacity: 0.9; }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  @property({ attribute: false }) columns: ColumnKey[] = [];
  @property({ type: String }) heading: string = 'Columns';

  @state() private _zBase: number | null = null;


  /** Opening a surface must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  protected updated() {
    this._dialogFocus.sync(this.open, () =>
      this.renderRoot.querySelector<HTMLElement>('[role="dialog"]'),
    );
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
    }
  }

  private _onCancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    this.open = false;
  };

  private _toggle(key: ColumnKey, checked: boolean) {
    const current = new Set(normalizeColumns(this.columns));
    if (checked) current.add(key);
    else current.delete(key);
    const next = normalizeColumns([...current]);
    this.dispatchEvent(new CustomEvent('change', { detail: { columns: next }, bubbles: true, composed: true }));
  }

  render() {
    if (!this.open) return null;
    const selected = new Set(normalizeColumns(this.columns));
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 9998};" @click=${this._onCancel}></div>
      <div class="panel-wrap" role="none" style="z-index: ${(this._zBase ?? 9998) + 1};">
        <div class="panel" role="dialog" aria-modal="true" aria-label="Column selection"
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this._onCancel(); } }}>
          <h2>${this.heading}</h2>
          <ul data-testid="column-options">
            ${COLUMN_DEFS.map((c) => html`
              <li>
                <label>
                  <input
                    type="checkbox"
                    data-testid="column-option"
                    data-key=${c.key}
                    .checked=${selected.has(c.key)}
                    @change=${(e: Event) => this._toggle(c.key, (e.target as HTMLInputElement).checked)}
                  />
                  <span>${c.label}</span>
                </label>
              </li>
            `)}
          </ul>
          <div class="actions">
            <button data-testid="column-picker-done" @click=${this._onCancel}>Done</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-column-picker': HVColumnPicker;
  }
}
