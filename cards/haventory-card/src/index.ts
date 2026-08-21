import { LitElement, css, html } from 'lit';
import { registerCustomCard } from './ha-contract';
import { setLanguage } from './i18n';
import type { HassLike } from './store/types';
import { Store } from './store/store';
import { resolveColorScheme } from './ui/theme';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { normalizeQuickFilters } from './ui/quick-filters';
import type { QuickFilterKey } from './ui/quick-filters';
import { registerBrandIcon } from './ui/brand-icon';
import { defineCardElement } from './register';
import './components/hv-card-shell';
// The sidebar panel and the config editor are the bundle's other two HA-facing
// elements, so importing them here is what puts them in the build.
import './haventory-panel';
import './haventory-card-editor';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
  `;

  private config?: { title?: string; quickFilters?: QuickFilterKey[] | null };

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;

  /**
   * What the card picker writes into a new dashboard entry.
   *
   * A static on the class, not a module export: Home Assistant reads these off
   * `customElements.get(type)`, and never imports from the bundle.
   */
  public static getStubConfig(): { type: string; title: string } {
    return {
      type: 'custom:haventory-card',
      title: 'HAventory',
    };
  }

  /** The visual editor the picker opens, created by tag so HA owns its lifecycle. */
  public static getConfigElement(): HTMLElement {
    return document.createElement('haventory-card-editor');
  }

  // Lovelace interface: called by HA when the card is created/configured
  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown; quick_filters?: unknown };
    // Only `title` and `quick_filters` mean anything here. Anything else in the
    // YAML — a key from a future version, or a stale one — is ignored rather
    // than rejected, so a dashboard never breaks on a config the card simply
    // does not read. The same holds inside `quick_filters`: an unknown pill name
    // is dropped, and a value that is not a list reads as the key being absent.
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      quickFilters: normalizeQuickFilters(obj.quick_filters),
    };
    this.requestUpdate();
  }

  // Lovelace interface: approximate rows occupied to help layout
  public getCardSize(): number {
    // Approximate: header + search + list viewport
    return 6;
  }

  /**
   * Sections-view sizing. `getCardSize` above still answers the masonry view,
   * which knows nothing about columns.
   *
   * Full section width, and enough rows that the list opens with room for
   * content rather than a sliver. The minimums are what keep the card usable
   * when a dashboard hand-shrinks it — below them the list has room for no
   * rows at all.
   */
  public getGridOptions(): {
    columns: number;
    rows: number;
    min_columns: number;
    min_rows: number;
  } {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    // Ahead of the store, so the first render of every surface it feeds is
    // already in the user's language rather than flashing English first.
    if (setLanguage(h?.language)) this.requestUpdate();
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
      });
      void this.store.init().catch(() => undefined);
    }
    // A theme switch arrives as a fresh hass object, so this is the hook for it.
    this._syncColorScheme();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // If hass was already set before connectedCallback ran, ensure subscription exists
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
      });
    }
    this._syncColorScheme();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._storeUnsub) {
      this._storeUnsub();
      this._storeUnsub = undefined;
    }
  }

  firstUpdated(): void {
    this._syncColorScheme();
  }

  /**
   * Publish the active Home Assistant theme as `color-scheme` on this host.
   *
   * `light-dark()` in the design tokens resolves against it, and the browser
   * uses it to paint native controls, so both follow HA rather than the OS.
   * The value is inherited, so setting it here covers every nested component.
   * When the theme has not painted yet we leave the property alone and the OS
   * preference keeps deciding.
   */
  private _syncColorScheme(): void {
    if (!this.isConnected || typeof getComputedStyle !== 'function') return;
    const scheme = resolveColorScheme(getComputedStyle(this));
    if (scheme) this.style.colorScheme = scheme;
  }

  /**
   * `haventory-card` stays the custom element HA knows about and is a thin
   * wrapper: it owns the `Store` and the Lovelace interface, while the shell
   * owns the layout, item editing and the shared host surfaces.
   */
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
   * Which pills this card offers, most specific source first: this dashboard's
   * `quick_filters:`, then the choice made in the integration's options flow,
   * then `null` — every pill, which is what a dashboard written before either
   * setting existed still gets.
   *
   * An explicit empty list is a choice at both levels and stops the search, the
   * way an empty `title:` would not: `[]` means no pills, not "ask the next
   * source".
   */
  private _quickFilters(): QuickFilterKey[] | null {
    return this.config?.quickFilters ?? this.store?.state.value.quickFilters ?? null;
  }

  /**
   * The heading, most specific source first: this dashboard's `title:`, then
   * the name configured in the integration's options flow, then the fallback
   * that covers the moment before the store has answered.
   */
  private _heading(): string {
    return this.config?.title ?? this.store?.state.value.cardTitle ?? DEFAULT_CARD_TITLE;
  }
}

defineCardElement('haventory-card', HAventoryCard);

// From the entry module, because the sidebar entry carries the mark on every
// page — including the ones no card is on.
registerBrandIcon();

// The picker entry, so the card can be added by name rather than by typing
// `custom:haventory-card` into a YAML editor.
//
// English in every language, and it has to be: this runs when the bundle is
// evaluated, and the user's language arrives with the first `hass` — which is
// after Home Assistant has already read `window.customCards`. The name is the
// product's own either way; the description is the one line that pays for it.
registerCustomCard({
  type: 'haventory-card',
  name: 'HAventory',
  description: 'HAventory inventory card',
  preview: true,
  documentationURL: 'https://github.com/chrreiter/HAventory#readme',
});
