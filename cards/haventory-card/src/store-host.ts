import { LitElement } from 'lit';
import { loadRuntime, loadedRuntime } from './runtime-loader';
import type { Runtime } from './runtime-loader';
import type { Store } from './store/store';
import { resolveColorScheme } from './ui/theme';
import type { HassLike } from './store/types';

/** HA builds a new `themes` object, or a new `selectedTheme`, when the theme or dark mode changes. */
function themeChanged(prev: HassLike | undefined, next: HassLike | undefined): boolean {
  return prev?.themes !== next?.themes || prev?.selectedTheme !== next?.selectedTheme;
}

/**
 * What the card and the sidebar panel share: one `Store` built from the `hass`
 * they are handed, alive while the element is in the DOM, with the language set
 * ahead of it and the active theme published.
 *
 * This class is in the eager entry; the store, the catalogs and the elements a
 * host renders are in the lazy runtime. Until that has loaded, a host renders
 * nothing, so its first render is already in the user's language.
 */
export abstract class StoreHostElement extends LitElement {
  protected store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private _schemeFrame?: number;
  /** Set once `runtimeReady` has run, which is what a host's render relies on. */
  private _ready = false;

  get hass(): HassLike | undefined {
    return this._hass;
  }

  /**
   * Home Assistant assigns a fresh `hass` on every state change anywhere in the
   * instance, so this does no style work unless the theme moved.
   */
  set hass(h: HassLike | undefined) {
    const prev = this._hass;
    this._hass = h;
    const rt = loadedRuntime();
    if (rt) {
      // Ahead of the store, so the first render is already in the user's language.
      if (rt.setLanguage(h?.language)) this.requestUpdate();
      if (h && !this.store) this._openStore(rt, h);
    }
    if (themeChanged(prev, h)) this._scheduleColorScheme();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const rt = loadedRuntime();
    // HA re-attaches this element without handing it `hass` again.
    if (rt) this._onRuntime(rt);
    else
      void loadRuntime().then(
        (loaded) => this._onRuntime(loaded),
        () => undefined,
      );
    this._syncColorScheme();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
    // The store's subscriptions live on HA's connection, which outlives the element.
    this.store?.dispose();
    this.store = undefined;
    if (this._schemeFrame !== undefined) cancelAnimationFrame(this._schemeFrame);
    this._schemeFrame = undefined;
  }

  /** Nothing to draw with until the runtime has defined the elements a host renders. */
  protected override shouldUpdate(changed: Map<PropertyKey, unknown>): boolean {
    return this._ready && super.shouldUpdate(changed);
  }

  /** A host's own setup that needs the runtime; runs once, before its first render. */
  protected runtimeReady?(rt: Runtime): void;

  private _onRuntime(rt: Runtime): void {
    if (!this.isConnected) return;
    if (!this._ready) this.runtimeReady?.(rt);
    this._ready = true;
    rt.setLanguage(this._hass?.language);
    if (this._hass && !this.store) this._openStore(rt, this._hass);
    this.requestUpdate();
  }

  private _openStore(rt: Runtime, h: HassLike): void {
    const store = new rt.Store(h);
    this.store = store;
    this._storeUnsub = store.state.onChange(() => this.requestUpdate());
    void store.init().catch(() => undefined);
    // `store` is a plain field, so its arrival needs a render of its own.
    this.requestUpdate();
  }

  protected override firstUpdated(): void {
    this._syncColorScheme();
  }

  /**
   * HA applies a new theme's variables after it has handed the new `hass` down,
   * so the read waits a frame; a burst of assignments shares one read.
   */
  private _scheduleColorScheme(): void {
    if (this._schemeFrame !== undefined || !this.isConnected) return;
    this._schemeFrame = requestAnimationFrame(() => {
      this._schemeFrame = undefined;
      this._syncColorScheme();
    });
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
