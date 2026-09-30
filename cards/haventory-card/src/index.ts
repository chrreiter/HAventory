import { css, html } from 'lit';
import { registerCustomCard } from './ha-contract';
import { StoreHostElement } from './store-host';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { normalizeQuickFilters } from './ui/quick-filters';
import type { QuickFilterKey } from './ui/quick-filters';
import { registerBrandIcon } from './ui/brand-icon';
import { defineCardElement } from './register';
import './components/hv-card-shell';
// Importing the bundle's other two HA-facing elements puts them in the build.
import './haventory-panel';
import './haventory-card-editor';

export class HAventoryCard extends StoreHostElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
  `;

  private config?: { title?: string; quickFilters?: QuickFilterKey[] | null };

  /** What the card picker writes into a new dashboard entry; HA reads it off the class. */
  public static getStubConfig(): { type: string; title: string } {
    return { type: 'custom:haventory-card', title: 'HAventory' };
  }

  /** The visual editor the picker opens, created by tag so HA owns its lifecycle. */
  public static getConfigElement(): HTMLElement {
    return document.createElement('haventory-card-editor');
  }

  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown; quick_filters?: unknown };
    // Unknown keys and pill names are ignored rather than rejected, so a
    // dashboard never breaks on config the card does not read.
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      quickFilters: normalizeQuickFilters(obj.quick_filters),
    };
    this.requestUpdate();
  }

  /** Masonry-view height estimate. */
  public getCardSize(): number {
    return 6;
  }

  /** Sections-view sizing; below the minimums the list has room for no rows. */
  public getGridOptions(): {
    columns: number;
    rows: number;
    min_columns: number;
    min_rows: number;
  } {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  /** This element owns the `Store` and the Lovelace interface; the shell owns the rest. */
  render() {
    return html`
      <hv-card-shell
        data-testid="card-shell"
        .store=${this.store}
        .heading=${this._heading()}
        .quickFilters=${this._quickFilters()}
      ></hv-card-shell>
    `;
  }

  /**
   * The dashboard's `quick_filters:`, then the integration's choice, then null
   * (every pill). An explicit `[]` is a choice of no pills and stops the search.
   */
  private _quickFilters(): QuickFilterKey[] | null {
    return this.config?.quickFilters ?? this.store?.state.value.quickFilters ?? null;
  }

  /** The dashboard's `title:`, then the integration's, then the built-in default. */
  private _heading(): string {
    return this.config?.title ?? this.store?.state.value.cardTitle ?? DEFAULT_CARD_TITLE;
  }
}

defineCardElement('haventory-card', HAventoryCard);

// Here, because the sidebar entry shows the mark on pages with no card on them.
registerBrandIcon();

// English in every language: HA reads `window.customCards` before the first
// `hass` brings the user's language.
registerCustomCard({
  type: 'haventory-card',
  name: 'HAventory',
  description: 'HAventory inventory card',
  preview: true,
  documentationURL: 'https://github.com/chrreiter/HAventory#readme',
});
