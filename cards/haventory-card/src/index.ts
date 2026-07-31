import { LitElement, css, html } from 'lit';
import type { HassLike } from './store/types';
import { Store } from './store/store';
import type { ColumnKey } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import { resolveColorScheme } from './ui/theme';
import { defineCardElement } from './register';
import './components/hv-column-picker';
import './components/hv-card-shell';

export class HAventoryCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
      font-size: var(--mdc-typography-body2-font-size, 14px);
      line-height: var(--mdc-typography-body2-line-height, 20px);
    }
  `;

  private config?: { title?: string };

  private store?: Store;
  private _storeUnsub?: () => void;
  private _hass?: HassLike;
  private _columns: ColumnKey[] = loadColumnPrefs();
  private _columnPickerOpen = false;

  // Lovelace interface: called by HA when the card is created/configured
  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown };
    // Only `title` means anything here. Anything else in the YAML — a key from
    // a future version, or a stale one — is ignored rather than rejected, so a
    // dashboard never breaks on a config the card simply does not read.
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined,
    };
    this.requestUpdate();
  }

  // Lovelace interface: approximate rows occupied to help layout
  public getCardSize(): number {
    // Approximate: header + search + list viewport
    return 6;
  }

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
   * host: `hv-card-shell` owns the store, the layout and item editing, while
   * the surfaces that belong to the browser rather than the card — the column
   * picker and the export download — stay here.
   */
  render() {
    return html`
      <hv-card-shell
        data-testid="card-shell"
        .store=${this.store}
        .heading=${this.config?.title ?? 'Inventory'}
        .columns=${this._columns}
        @menu-action=${(e: CustomEvent) => this._onShellAction((e.detail as { id: string }).id)}
      ></hv-card-shell>

      <hv-column-picker
        .open=${this._columnPickerOpen}
        .columns=${this._columns}
        heading="Full view columns"
        @change=${(e: CustomEvent) => this._setColumns(e.detail.columns as ColumnKey[])}
        @cancel=${() => {
          this._columnPickerOpen = false;
          this.requestUpdate();
        }}
      ></hv-column-picker>
    `;
  }

  /** Actions the shell hands up because they open a host-owned surface. */
  private _onShellAction(id: string) {
    switch (id) {
      case 'columns':
        this._columnPickerOpen = true;
        this.requestUpdate();
        break;
      case 'export-all':
        void this._exportDownload('all');
        break;
      case 'export-view':
        void this._exportDownload('view');
        break;
    }
  }

  private async _exportDownload(scope: 'all' | 'view' = 'all') {
    try {
      const doc = await this.store?.exportDocument(scope);
      if (!doc) return;
      const json = JSON.stringify(doc, null, 2);
      const stamp = (doc.exported_at ?? '').replace(/[:]/g, '-') || 'backup';
      this._triggerDownload(`haventory-export-${stamp}.json`, json);
    } catch (err: unknown) {
      // The shell owns the card's error surface; export failures are rare and
      // not worth a banner, so they go to the console for diagnostics.
      console.error('HAventory export failed', err);
    }
  }

  /** Trigger a browser download of the given text as a JSON file. Isolated for testing. */
  protected _triggerDownload(filename: string, text: string) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private _setColumns(columns: ColumnKey[]) {
    this._columns = columns;
    saveColumnPrefs(columns);
    this.requestUpdate();
  }
}

defineCardElement('haventory-card', HAventoryCard);

// Lovelace card picker metadata
export function getStubConfig() {
  return {
    type: 'custom:haventory-card',
    title: 'HAventory',
  };
}

// Auto-register with Lovelace card picker when loaded via /local
interface CustomCardMeta {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
}

declare global {
  interface Window {
    customCards?: CustomCardMeta[];
  }
}

if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  const already = window.customCards.some((c) => c?.type === 'haventory-card');
  if (!already) {
    window.customCards.push({
      type: 'haventory-card',
      name: 'HAventory',
      description: 'HAventory inventory card',
      preview: true,
    });
  }
}
