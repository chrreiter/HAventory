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
 * that store is the same on both: build it once, watch it for as long as the
 * element is in the DOM, set the language ahead of it, and publish the active
 * theme. What differs is what they render and what configuration they read.
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
    if (h && !this.store) {
      this.store = new Store(h);
      this._storeUnsub = this.store.state.onChange(() => {
        this.requestUpdate();
      });
      void this.store.init().catch(() => undefined);
      // The element can already have rendered by the time `hass` arrives, and
      // a plain field carries no reactivity of its own — without this the
      // surface below holds no store until the first state change happens to
      // arrive.
      this.requestUpdate();
    }
    // A theme switch arrives as a fresh hass object, so this is the hook for it.
    this._syncColorScheme();
  }

  connectedCallback(): void {
    super.connectedCallback();
    // `hass` can have been set before this element was in the DOM.
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
