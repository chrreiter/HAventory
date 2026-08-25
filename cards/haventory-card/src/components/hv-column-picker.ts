import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome, modalSheet } from '../ui/modal';
import { icon } from '../ui/icons';
import type { ColumnKey } from '../store/columns';
import { COLUMN_DEFS, canonicalOrder, columnLabel, moveColumn, normalizeColumns } from '../store/columns';

/**
 * Small modal to choose which optional columns show in a given view, and in
 * which order.
 *
 * Presentational: it reflects `columns` (the current selection, in the order it
 * is drawn) and emits a `change` event with the new selection whenever a column
 * is toggled or moved. The container owns persistence.
 *
 * Up/down buttons rather than a drag handle, matching the organize dialog's
 * status rows and the editor's photo strip: they work from the keyboard without
 * a second implementation beside the pointer one.
 *
 * Styled from the card's design tokens alone — nothing here reaches past them
 * to Home Assistant's own variables, and every row and button honours the touch
 * minimum a narrow host declares, the same as any other target in the card.
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
      /* The same control the filter panel's checkboxes use, so a tick means the
         same thing — and picks up --hv-tap-min on a phone. */
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
      /* WCAG 2.2 asks 24px of every pointer target; the token is what a host
         declares when the card is narrow, and the fallback covers the panel,
         which declares none. */
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
      /* Left of the confirming button, because it undoes work inside the dialog
         rather than closing it. */
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

  /**
   * A column switched on joins the list at the end rather than at its canonical
   * index: the order on screen is the user's, and dropping a re-enabled column
   * back into the middle of it would move a column they never touched.
   */
  private _toggle(key: ColumnKey, checked: boolean): void {
    const current = normalizeColumns(this.columns);
    this._emit(checked ? [...current, key] : current.filter((k) => k !== key));
  }

  private _move(key: ColumnKey, delta: -1 | 1): void {
    this._emit(moveColumn(this.columns, key, delta));
  }

  /**
   * The rows to draw: the chosen columns in their chosen order, then the ones
   * that are off, in canonical order.
   *
   * Only a shown column has a position, so only those carry move buttons —
   * ordering an invisible column is a promise about where it would land that
   * the toggle then does not keep.
   */
  private _rows(): { key: ColumnKey; label: string; on: boolean }[] {
    const selected = normalizeColumns(this.columns);
    return [
      ...selected.map((key) => ({ key, label: columnLabel(key), on: true })),
      ...COLUMN_DEFS.filter((c) => !selected.includes(c.key)).map((c) => ({
        key: c.key,
        label: columnLabel(c.key),
        on: false,
      })),
    ];
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
                      <button
                        data-testid="column-up"
                        data-key=${r.key}
                        aria-label=${t('hv.columns.moveUp', { column: r.label })}
                        title=${t('hv.term.moveUp')}
                        ?disabled=${index === 0}
                        @click=${() => this._move(r.key, -1)}
                      >
                        ${icon('chevronUp', 15)}
                      </button>
                      <button
                        data-testid="column-down"
                        data-key=${r.key}
                        aria-label=${t('hv.columns.moveDown', { column: r.label })}
                        title=${t('hv.term.moveDown')}
                        ?disabled=${index === shown - 1}
                        @click=${() => this._move(r.key, 1)}
                      >
                        ${icon('chevronDown', 15)}
                      </button>
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
