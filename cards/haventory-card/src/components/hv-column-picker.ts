import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
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
 *
 * This was the one surface that never adopted the card's design tokens: it
 * styled itself straight from HA's variables, with its own 8px radius, native
 * checkboxes and a filled "Done" at a fourth border radius — so it read as a
 * different application, and its 32px rows were the only targets on a phone
 * that ignored the 44px minimum everything else honours.
 */
@customElement('hv-column-picker')
export class HVColumnPicker extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      .panel-wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 330px;
        max-width: 100%;
        box-sizing: border-box;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        padding: 14px 14px 12px;
      }
      h2 {
        margin: 0 0 6px;
        padding: 0 4px;
        font-size: 15px;
        font-weight: 500;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        margin: 0;
      }
      /* The same control the filter panel's checkboxes use, so a tick means the
         same thing — and picks up --hv-tap-min on a phone. */
      .option {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        box-sizing: border-box;
        min-height: var(--hv-tap-min, 34px);
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 4px 6px;
        border-radius: var(--hv-radius-input);
      }
      .option:hover {
        background: var(--hv-hover-overlay);
      }
      .box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border-radius: 4px;
        border: 1.5px solid var(--hv-text-tertiary);
        color: #fff;
        flex: none;
      }
      .box.on {
        background: var(--hv-primary);
        border-color: var(--hv-primary);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding-top: 8px;
      }
    `,
  ];

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

  private _toggle(key: ColumnKey, checked: boolean): void {
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
            ${COLUMN_DEFS.map((c) => {
              const on = selected.has(c.key);
              return html`
                <li>
                  <button
                    class="option"
                    role="checkbox"
                    aria-checked=${String(on)}
                    data-testid="column-option"
                    data-key=${c.key}
                    @click=${() => this._toggle(c.key, !on)}
                  >
                    <span class="box ${on ? 'on' : ''}">${on ? icon('check', 12) : null}</span>
                    <span>${c.label}</span>
                  </button>
                </li>
              `;
            })}
          </ul>
          <div class="actions">
            <button class="hv-pill" data-testid="column-picker-done" @click=${this._onCancel}>Done</button>
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
