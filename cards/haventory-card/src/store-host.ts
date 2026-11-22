import { LitElement, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { loadRuntime, loadedRuntime } from './runtime-loader';
import type { Runtime } from './runtime-loader';
import type { Store } from './store/store';
import { renderLoadFailure } from './ui/load-failure';
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
 * host renders are in the lazy runtime. Until that has loaded, a host draws its
 * placeholder, which holds no word from the catalogs but the loader's own
 * (`i18n/loader-copy`), picked by `hass.language`, so the first text the card
 * writes is already in the user's language.
 */
export abstract class StoreHostElement extends LitElement {
  protected store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private _schemeFrame?: number;
  /** Set once `runtimeReady` has run, which is what `renderReady` relies on. */
  private _ready = false;
  /** Set when the runtime's import failed while this host waited for it. */
  private _loadFailed = false;

  get hass(): HassLike | undefined {
    return this._hass;
  }

  /**
   * Home Assistant assigns a fresh `hass` on every state change anywhere in the
   * instance, so this does no style work unless the theme moved, and redraws a
   * placeholder only when Home Assistant's own catalog or the language did.
   */
  set hass(h: HassLike | undefined) {
    const prev = this._hass;
    this._hass = h;
    const rt = loadedRuntime();
    if (rt) {
      // Ahead of the store, so the first render is already in the user's language.
      if (rt.setLanguage(h?.language)) this.requestUpdate();
      if (h && !this.store) this._openStore(rt, h);
    } else if (prev?.localize !== h?.localize || prev?.language !== h?.language) {
      this.requestUpdate();
    }
    if (themeChanged(prev, h)) this._scheduleColorScheme();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const rt = loadedRuntime();
    // HA re-attaches this element without handing it `hass` again.
    if (rt) this._onRuntime(rt);
    else this._awaitRuntime();
    this._syncColorScheme();
  }

  /**
   * A failed import is not final: `loadRuntime` forgets it, and every connect
   * asks again, with the body busy until the answer is in. Home Assistant
   * detaches a panel or a dashboard's cards on navigation and re-attaches them
   * on the way back, so that is when a dropped download is retried.
   */
  private _awaitRuntime(): void {
    if (this._loadFailed) {
      this._loadFailed = false;
      this.requestUpdate();
    }
    void loadRuntime().then(
      (loaded) => this._onRuntime(loaded),
      () => this._onRuntimeFailed(),
    );
  }

  private _onRuntimeFailed(): void {
    if (!this.isConnected || this._ready) return;
    this._loadFailed = true;
    this.requestUpdate();
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

  /**
   * What the host draws once the runtime has defined its elements. The
   * placeholder's template is a different one, so the update that flips
   * `_ready` replaces the one tree with the other and paints no frame between.
   */
  protected abstract renderReady(): unknown;

  /**
   * What the host draws until then, from what the entry loads eagerly: no `hv-*`
   * element and no catalog text, since both are in the runtime, other than
   * what `renderPlaceholderBody` says when the runtime fails.
   */
  protected abstract renderPlaceholder(): unknown;

  protected override render(): unknown {
    return this._ready ? this.renderReady() : this.renderPlaceholder();
  }

  /**
   * The placeholder's body, under the head each host draws: busy while the
   * runtime is on its way, and once its import has failed, the line that says
   * so and a button that reloads the page. Each host sizes `.placeholder-body`
   * and adds `loadFailureStyles`.
   */
  protected renderPlaceholderBody(): TemplateResult {
    const failed = this._loadFailed;
    return html`<div class="placeholder-body" aria-busy=${failed ? 'false' : 'true'}>
      ${failed ? renderLoadFailure(this._hass?.language, () => this.reloadPage()) : nothing}
    </div>`;
  }

  /** A new page load is what pairs the entry with chunks the server still has. */
  protected reloadPage(): void {
    window.location.reload();
  }

  /** `:host([loading])` is how a host's styles size its placeholder. */
  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    super.willUpdate(changed);
    this.toggleAttribute('loading', !this._ready);
  }

  /** A host's own setup that needs the runtime; runs once, before `renderReady`. */
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
