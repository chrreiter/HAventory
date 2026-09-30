import { LitElement } from 'lit';
import { setLanguage } from './i18n';
import { Store } from './store/store';
import { resolveColorScheme } from './ui/theme';
import type { HassLike } from './store/types';

/**
 * What the card and the sidebar panel share: one `Store` built from the `hass`
 * they are handed, alive while the element is in the DOM, with the language set
 * ahead of it and the active theme published.
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
    // Ahead of the store, so the first render is already in the user's language.
    if (setLanguage(h?.language)) this.requestUpdate();
    if (h && !this.store) this._openStore(h);
    // A theme switch arrives as a fresh hass object.
    this._syncColorScheme();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // HA re-attaches this element without handing it `hass` again.
    if (this._hass && !this.store) this._openStore(this._hass);
    this._syncColorScheme();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
    // The store's subscriptions live on HA's connection, which outlives the element.
    this.store?.dispose();
    this.store = undefined;
  }

  private _openStore(h: HassLike): void {
    const store = new Store(h);
    this.store = store;
    this._storeUnsub = store.state.onChange(() => this.requestUpdate());
    void store.init().catch(() => undefined);
    // `store` is a plain field, so its arrival needs a render of its own.
    this.requestUpdate();
  }

  protected firstUpdated(): void {
    this._syncColorScheme();
  }

  /**
   * Publish the HA theme as the inherited `color-scheme`, which `light-dark()`
   * tokens and native controls resolve against. Before the theme paints, the OS
   * preference keeps deciding.
   */
  private _syncColorScheme(): void {
    if (!this.isConnected) return;
    const scheme = resolveColorScheme(getComputedStyle(this));
    if (scheme) this.style.colorScheme = scheme;
  }
}
