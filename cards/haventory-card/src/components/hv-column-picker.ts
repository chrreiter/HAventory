import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome, modalSheet } from '../ui/modal';
import { icon } from '../ui/icons';
import type { ColumnKey } from '../store/columns';
import { COLUMN_DEFS, canonicalOrder, columnLabel, moveColumn, normalizeColumns } from '../store/columns';

/**
 * Small modal to choose which optional columns show, and in which order. It
 * reflects `columns` and emits `change` with the new selection; the container
 * persists it. Up/down buttons rather than dragging, so the keyboard needs no
 * second implementation.
 */
@customElement('hv-column-picker')
export class HVColumnPicker extends LitElement {
  static styles = [
    tokens,
    base,
    modalChrome,
    css`
      .panel {
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
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .option {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
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
      .move {
        display: flex;
        flex: none;
        gap: 2px;
      }
      /* At least WCAG 2.2's 24px where no host declares --hv-tap-min. */
      .move button {
        display: inline-grid;
        place-items: center;
        width: var(--hv-tap-min, 28px);
        height: var(--hv-tap-min, 28px);
        border: none;
        background: none;
        color: var(--hv-text-tertiary);
        cursor: pointer;
        padding: 0;
        line-height: 0;
      }
      .move button:hover:not([disabled]) {
        color: var(--hv-text);
      }
      .move button[disabled] {
        opacity: 0.3;
        cursor: default;
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
      .actions .reset {
        margin-right: auto;
      }
    `,
    modalSheet,
  ];

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ attribute: false }) columns: ColumnKey[] = [];
  @property({ type: String }) heading: string = t('hv.columns.heading');

  private _modal = new Modal(this, { open: () => this.open });

  private _close = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _emit(columns: ColumnKey[]): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { columns }, bubbles: true, composed: true }));
  }

  /** A column switched on joins at the end, so the user's order is not disturbed. */
  private _toggle(key: ColumnKey, checked: boolean): void {
    const current = normalizeColumns(this.columns);
    this._emit(checked ? [...current, key] : current.filter((k) => k !== key));
  }

  /**
   * The chosen columns in their order, then the others in canonical order. Only
   * a shown column has a position, so only those carry move buttons.
   */
  private _rows(): { key: ColumnKey; label: string; on: boolean }[] {
    const selected = normalizeColumns(this.columns);
    const off = COLUMN_DEFS.map((c) => c.key).filter((key) => !selected.includes(key));
    return [...selected, ...off].map((key) => ({ key, label: columnLabel(key), on: selected.includes(key) }));
  }

  render() {
    if (!this.open) return null;
    const rows = this._rows();
    const shown = rows.filter((r) => r.on).length;
    const ordered = normalizeColumns(this.columns);
    const isCanonical = ordered.join() === canonicalOrder(ordered).join();
    return this._modal.render(
      { label: t('hv.columns.dialogLabel'), testid: 'column-picker', onClose: this._close },
      html`
        <h2>${this.heading}</h2>
        <ul data-testid="column-options">
          ${rows.map(
            (r, index) => html`
              <li>
                <button
                  class="option"
                  role="checkbox"
                  aria-checked=${String(r.on)}
                  data-testid="column-option"
                  data-key=${r.key}
                  @click=${() => this._toggle(r.key, !r.on)}
                >
                  <span class="box ${r.on ? 'on' : ''}">${r.on ? icon('check', 12) : null}</span>
                  <span>${r.label}</span>
                </button>
                ${r.on
                  ? html`<span class="move">
                      ${([-1, 1] as const).map((delta) => {
                        const up = delta === -1;
                        return html`<button
                          data-testid=${up ? 'column-up' : 'column-down'}
                          data-key=${r.key}
                          aria-label=${up
                            ? t('hv.columns.moveUp', { column: r.label })
                            : t('hv.columns.moveDown', { column: r.label })}
                          title=${up ? t('hv.term.moveUp') : t('hv.term.moveDown')}
                          ?disabled=${up ? index === 0 : index === shown - 1}
                          @click=${() => this._emit(moveColumn(this.columns, r.key, delta))}
                        >
                          ${icon(up ? 'chevronUp' : 'chevronDown', 15)}
                        </button>`;
                      })}
                    </span>`
                  : null}
              </li>
              `,
            )}
          </ul>
          <div class="actions">
            <button
              class="hv-text-button reset"
              data-testid="column-picker-reset-order"
              ?disabled=${isCanonical}
              @click=${() => this._emit(canonicalOrder(ordered))}
            >
              ${t('hv.columns.resetOrder')}
            </button>
            <button class="hv-pill" data-testid="column-picker-done" @click=${this._close}>
              ${t('hv.action.done')}
            </button>
          </div>
      `,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-column-picker': HVColumnPicker;
  }
}
