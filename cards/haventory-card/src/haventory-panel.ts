import { css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { StoreHostElement } from './store-host';
import { sidebarToggleLabel } from './ha-contract';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { hostTokens } from './ui/host-tokens';
import type { QuickFilterKey } from './ui/quick-filters';
import { defineCardElement } from './register';
import type { HostSurfaces } from './host-surfaces';
import type { Runtime } from './runtime-loader';
import type { HvEvent } from './events';

/** The slice of Home Assistant's panel object this element reads. */
interface PanelInfo {
  config?: { title?: unknown } | null;
}

/** `ICONS.menu`, written out: `ui/icons` is in the runtime and its whole table would come with it. */
export const MENU_ICON_PATH = 'M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z';

/**
 * HAventory as a sidebar page. HA's custom-panel loader sets `hass`, `narrow`,
 * `route` and `panel`; this element owns a `Store` and a `HostSurfaces`, and
 * embeds `hv-full-view`, since a page has nowhere to close to.
 */
export class HAventoryPanel extends StoreHostElement {
  /**
   * The placeholder's bar is the first row of hv-full-app-bar at both of its
   * widths, so the swap moves neither the title nor the toggle. The placeholder's
   * rules carry no comment inside the css`` body, which ships as written in the
   * core chunk every Home Assistant page loads.
   */
  static override styles = [
    hostTokens,
    css`
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
      .placeholder {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--hv-surface);
        color: var(--hv-text);
        font-family: var(--hv-font);
      }
      .placeholder-bar {
        flex: none;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 56px;
        padding: 10px 16px;
        background: var(--hv-primary);
        color: #fff;
      }
      .placeholder-title {
        min-width: 0;
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .placeholder-menu {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      .placeholder-menu:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      @media (max-width: 700px) {
        .placeholder-bar {
          gap: 8px;
          min-height: 60px;
          padding: 8px 12px;
        }
        .placeholder-title {
          font-size: 17px;
        }
        .placeholder-menu {
          width: 44px;
          height: 44px;
        }
      }
      .placeholder-body {
        flex: 1;
      }
    `,
  ];

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
  /** Built from the lazy runtime before the first render; a render never sees it absent. */
  surfaces!: HostSurfaces;

  protected override runtimeReady(rt: Runtime): void {
    this.surfaces = new rt.HostSurfaces(this, () => this.store);
  }

  /**
   * The app bar's first row and an empty page. The title is the registration's,
   * which is what the real bar shows, and the sidebar toggle is named by Home
   * Assistant's catalog, since the card's own is in the runtime; without that
   * name there is no button rather than a nameless one.
   */
  protected override renderPlaceholder() {
    const title = this._configuredTitle();
    const menuLabel = this.narrow ? sidebarToggleLabel(this.hass) : undefined;
    return html`
      <div class="placeholder" data-testid="panel-placeholder">
        <div class="placeholder-bar">
          ${
            menuLabel
              ? html`<button
                class="placeholder-menu"
                data-testid="panel-placeholder-menu"
                aria-label=${menuLabel}
                title=${menuLabel}
                @click=${this._toggleSidebar}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <path d=${MENU_ICON_PATH}></path>
                </svg>
              </button>`
              : nothing
          }
          ${title ? html`<h2 class="placeholder-title" data-testid="panel-placeholder-title">${title}</h2>` : nothing}
        </div>
        <div class="placeholder-body" aria-busy="true"></div>
      </div>
    `;
  }

  /** `home-assistant-main` opens and closes its drawer on this composed event, as the real bar sends it. */
  private _toggleSidebar = (): void => {
    this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }));
  };

  protected override renderReady() {
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
        @request-delete=${(e: HvEvent<'hv-full-view', 'request-delete'>) =>
          this.surfaces.requestDeleteById(e.detail.itemId)}
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
    return this._configuredTitle() ?? this.store?.state.value.cardTitle ?? DEFAULT_CARD_TITLE;
  }

  /** The title the integration registered the panel with. */
  private _configuredTitle(): string | undefined {
    const configured = this.panel?.config?.title;
    return typeof configured === 'string' ? configured : undefined;
  }

  /** The view answers `select-items` itself; the shared surfaces cover the rest. */
  private _onMenuAction = (e: HvEvent<'hv-full-view', 'menu-action'>): void => {
    const { id, tab } = e.detail;
    this.surfaces.handleAction(id, tab);
  };
}

defineCardElement('haventory-panel', HAventoryPanel);
