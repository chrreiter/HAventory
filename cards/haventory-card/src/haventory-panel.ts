import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { HassLike } from './store/types';
import { Store, activeFilterCount, defaultFilters } from './store/store';
import { resolveColorScheme } from './ui/theme';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { defineCardElement } from './register';
import { HostSurfaces } from './host-surfaces';
import type { OverflowMenuEntry } from './components/hv-overflow-menu';
import './components/hv-full-view';

/** The slice of Home Assistant's panel object this element reads. */
interface PanelInfo {
  config?: { title?: unknown } | null;
}

/**
 * HAventory as a page of its own, for the sidebar.
 *
 * Home Assistant's custom-panel loader creates this element, sets `hass`,
 * `narrow`, `route` and `panel` on it, and gives it the whole content area.
 * That makes it a host in the same sense `haventory-card` is: it owns the
 * `Store` and the surfaces that belong to the browser, and hands the inventory
 * itself to `hv-full-view` — embedded rather than modal, since a page has
 * nowhere to close to.
 */
export class HAventoryPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      /* Home Assistant gives a custom panel the content area but puts no height
         on anything between the drawer and this element, so a percentage would
         resolve against an auto-height chain and collapse the grid inside. The
         sidebar is a drawer beside the content rather than a bar above it, so
         the content area is the viewport — which is how the frontend sizes its
         own iframe-hosted custom panels, second declaration and all: dvh tracks
         a phone's retracting toolbar, vh covers a browser without it. */
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

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  readonly surfaces = new HostSurfaces(this, () => this.store);

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
      });
      void this.store.init().catch(() => undefined);
      // The loader sets `hass` after the element is in the DOM, so the first
      // render can already be behind us — and a plain field carries no
      // reactivity of its own. Without this the view holds no store until the
      // first state change happens to arrive.
      this.requestUpdate();
    }
    // A theme switch arrives as a fresh hass object, so this is the hook for it.
    this._syncColorScheme();
  }

  connectedCallback(): void {
    super.connectedCallback();
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
   * Publish the active Home Assistant theme as `color-scheme` on this host, so
   * the `light-dark()` design tokens and the browser's native controls follow
   * the frontend rather than the operating system. Inherited, so it covers
   * every nested component.
   */
  private _syncColorScheme(): void {
    if (!this.isConnected || typeof getComputedStyle !== 'function') return;
    const scheme = resolveColorScheme(getComputedStyle(this));
    if (scheme) this.style.colorScheme = scheme;
  }

  render() {
    return html`
      <hv-full-view
        data-testid="panel-full-view"
        embedded
        open
        ?narrow=${this.narrow}
        .store=${this.store}
        .heading=${this._heading()}
        .columns=${this.surfaces.columns}
        .menuEntries=${this._menuEntries()}
        @menu-action=${(e: CustomEvent) => this._onMenuAction((e.detail as { id: string }).id)}
      ></hv-full-view>

      ${this.surfaces.renderColumnPicker()}
    `;
  }

  /**
   * The heading, most specific source first: the title the panel was registered
   * with, then the name configured in the integration's options flow, then the
   * fallback that covers the moment before the store has answered.
   */
  private _heading(): string {
    const configured = this.panel?.config?.title;
    return (
      (typeof configured === 'string' ? configured : undefined) ??
      this.store?.state.value.cardTitle ??
      DEFAULT_CARD_TITLE
    );
  }

  /**
   * The ⋮ menu, holding only what this host can answer.
   *
   * Organize, Import and Diagnostics open dialogs that `hv-card-shell` owns, and
   * there is no shell on this page — an entry naming one would do nothing.
   */
  private _menuEntries(): OverflowMenuEntry[] {
    const st = this.store?.state.value;
    const filtersOn = activeFilterCount(st?.filters ?? defaultFilters()) > 0;
    return [
      { id: 'select-items', label: 'Select items…', glyph: 'select' },
      { id: 'columns', label: 'Columns…', glyph: 'viewColumn' },
      { divider: true },
      { id: 'refresh', label: 'Refresh data', glyph: 'refresh', meta: 'Items · locations · stats' },
      { divider: true },
      { caption: 'Data' },
      { id: 'export-all', label: 'Export backup', glyph: 'download', sub: 'All items · all locations' },
      {
        id: 'export-view',
        label: 'Export current view',
        glyph: 'download',
        sub: 'Active filter · keeps location paths',
        disabled: !filtersOn,
      },
    ];
  }

  private _onMenuAction(id: string): void {
    if (this.surfaces.handleAction(id)) return;
    if (id === 'refresh') void this.store?.refreshAll();
  }
}

defineCardElement('haventory-panel', HAventoryPanel);
