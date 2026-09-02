import { LitElement } from 'lit';
import { setLanguage } from './i18n';
import { Store } from './store/store';
import { resolveColorScheme } from './ui/theme';
import type { HassLike } from './store/types';

/**
 * What the two elements Home Assistant instantiates itself share.
 *
 * The Lovelace card and the sidebar panel are each handed a `hass` object and
 * nothing else, and each owns a `Store` built from it. The lifecycle around
 * that store is the same on both: one store while the element is in the DOM,
 * released when it leaves and rebuilt when it comes back, the language set
 * ahead of it and the active theme published. What differs is what they render
 * and what configuration they read.
 */
export abstract class StoreHostElement extends LitElement {
  protected store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;

  get hass(): HassLike | undefined {
    return this._hass;
  }

  set hass(h: HassLike | undefined) {
    this._hass = h;
    // Ahead of the store, so the first render of every surface it feeds is
    // already in the user's language rather than flashing English first.
    if (setLanguage(h?.language)) this.requestUpdate();
    if (h && !this.store) this._openStore(h);
    // A theme switch arrives as a fresh hass object, so this is the hook for it.
    this._syncColorScheme();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Home Assistant detaches and re-attaches this element — while a dashboard
    // is being edited, and when the same element is moved — without handing it
    // `hass` again, so the store the disconnect released is rebuilt from the
    // one already held rather than waited for.
    if (this._hass && !this.store) this._openStore(this._hass);
    this._syncColorScheme();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._storeUnsub) {
      this._storeUnsub();
      this._storeUnsub = undefined;
    }
    // Home Assistant unmounts this element on every in-app navigation away and
    // builds a fresh one on the way back. The store's topic subscriptions and
    // its area-registry watch live on Home Assistant's connection, which
    // outlives the element, so a store left behind here goes on receiving every
    // event for as long as the page is open.
    this.store?.dispose();
    this.store = undefined;
  }

  /** Start a store over `h`, watch it, and draw with it. */
  private _openStore(h: HassLike): void {
    const store = new Store(h);
    this.store = store;
    this._storeUnsub = store.state.onChange(() => {
      this.requestUpdate();
    });
    void store.init().catch(() => undefined);
    // The element can already have rendered by the time `hass` arrives, and
    // a plain field carries no reactivity of its own — without this the
    // surface below holds no store until the first state change happens to
    // arrive.
    this.requestUpdate();
  }

  protected firstUpdated(): void {
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
}
