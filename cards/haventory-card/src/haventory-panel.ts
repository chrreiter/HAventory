import { css, html } from 'lit';
import { property } from 'lit/decorators.js';
import { StoreHostElement } from './store-host';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import type { QuickFilterKey } from './ui/quick-filters';
import { defineCardElement } from './register';
import { HostSurfaces } from './host-surfaces';
import type { OrganizeTab } from './components/hv-organize-dialog';
import './components/hv-full-view';

/** The slice of Home Assistant's panel object this element reads. */
interface PanelInfo {
  config?: { title?: unknown } | null;
}

/**
 * HAventory as a sidebar page. HA's custom-panel loader sets `hass`, `narrow`,
 * `route` and `panel`; this element owns a `Store` and a `HostSurfaces`, and
 * embeds `hv-full-view`, since a page has nowhere to close to.
 */
export class HAventoryPanel extends StoreHostElement {
  static styles = css`
    :host {
      display: block;
      /* Nothing above this element has a height, so a percentage would collapse;
         the content area is the viewport. dvh tracks a phone's retracting
         toolbar, vh covers a browser without it. */
      height: 100vh;
      height: 100dvh;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
  `;

  /** True while Home Assistant has the sidebar collapsed. */
  @property({ type: Boolean }) narrow = false;
  /** The registration's `config` lands in `panel.config`. */
  @property({ attribute: false }) panel?: PanelInfo | null;
  /** Set on every navigation. Unread — this panel has no sub-routes. */
  @property({ attribute: false }) route?: unknown;

  /**
   * No `onItemDeleted` or `onBrowse`: the embedded view closes its own editor,
   * and is itself the page a browse would open.
   */
  readonly surfaces = new HostSurfaces(this, () => this.store);

  render() {
    return html`
      <hv-full-view
        data-testid="panel-full-view"
        embedded
        open
        ?narrow=${this.narrow}
        .store=${this.store}
        .heading=${this._heading()}
        .quickFilters=${this._quickFilters()}
        .columns=${this.surfaces.columns}
        .menuEntries=${this.surfaces.menuEntries()}
        .confirmDiscard=${this.surfaces.confirmDiscard}
        @menu-action=${this._onMenuAction}
        @request-delete=${(e: CustomEvent) =>
          this.surfaces.requestDeleteById((e.detail as { itemId: string }).itemId)}
      ></hv-full-view>

      ${this.surfaces.renderSurfaces()}
    `;
  }

  /** A panel has no dashboard config, so only the integration decides; null is every pill. */
  private _quickFilters(): QuickFilterKey[] | null {
    return this.store?.state.value.quickFilters ?? null;
  }

  /** The registered panel title, then the integration's, then the built-in default. */
  private _heading(): string {
    const configured = this.panel?.config?.title;
    return (
      (typeof configured === 'string' ? configured : undefined) ??
      this.store?.state.value.cardTitle ??
      DEFAULT_CARD_TITLE
    );
  }

  /** The view answers `select-items` itself; the shared surfaces cover the rest. */
  private _onMenuAction = (e: CustomEvent): void => {
    const { id, tab } = e.detail as { id: string; tab?: OrganizeTab };
    this.surfaces.handleAction(id, tab);
  };
}

defineCardElement('haventory-panel', HAventoryPanel);
