import { css, html, nothing } from 'lit';
import { registerCustomCard } from './ha-contract';
import { StoreHostElement } from './store-host';
import { DEFAULT_CARD_TITLE } from './ui/card-title';
import { hostTokens } from './ui/host-tokens';
import { loadFailureStyles } from './ui/load-failure';
import { normalizeQuickFilters } from './ui/quick-filters';
import type { QuickFilterKey } from './ui/quick-filters';
import { registerBrandIcon } from './ui/brand-icon';
import { defineCardElement } from './register';
import { loadRuntime } from './runtime-loader';
// The panel's host is eager like this one; the editor is in the lazy runtime.
import './haventory-panel';

/** Home Assistant's masonry view counts `getCardSize` in rows of this many pixels. */
export const MASONRY_ROW_PX = 50;

/**
 * The card's height in a masonry view, in those rows, whatever the inventory
 * holds: the masonry view places cards by `getCardSize` before they have drawn
 * anything. 500px is, to the nearest row, the 504px of the eight rows
 * `getGridOptions` asks a sections view for at Home Assistant's 56px row and
 * 8px gap, so the card is one size on either kind of view.
 */
export const MASONRY_ROWS = 10;

/**
 * hv-card-shell's header row: 14px and 10px of padding around its 36px buttons,
 * or around the 44px ones it takes on a card `ui/responsive` calls mobile.
 */
export const PLACEHOLDER_HEAD_PX = { wide: 60, mobile: 68 } as const;

/**
 * `MOBILE_BREAKPOINT`, which the shell measures on its content box, as the
 * host's width: the shell's two 1px borders wider.
 */
export const PLACEHOLDER_MOBILE_MAX_PX = 602;

export class HAventoryCard extends StoreHostElement {
  /**
   * The placeholder is hv-card-shell's frame and header row, so the swap moves
   * neither, and one rule sizes the two: whichever is drawn is the host's one
   * flex item. The host takes `height: 100%`, which in a sections view is the
   * cell getGridOptions sized, the nearest block ancestor with a definite
   * height, since HA's `hui-card` wrapper between them is inline; the frame
   * grows or shrinks to fill it exactly. Anywhere else 100% is auto, and the
   * frame's flex basis makes it the MASONRY_ROWS rows getCardSize reports.
   * Inside the shell the list takes what the rows above it leave, and scrolls.
   *
   * The host is a size container only while it waits: one would be the
   * containing block for the real tree's `position: fixed` surfaces.
   *
   * These rules explain themselves here rather than in the css`` body, which
   * ships as written in the entry every Home Assistant page loads.
   */
  static override styles = [
    hostTokens,
    loadFailureStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: var(--paper-font-body1_-_font-family, var(--ha-card-font-family, Arial, sans-serif));
        font-size: var(--mdc-typography-body2-font-size, 14px);
        line-height: var(--mdc-typography-body2-line-height, 20px);
      }
      :host([loading]) {
        container-type: inline-size;
      }
      .placeholder,
      hv-card-shell {
        flex: 1 1 ${MASONRY_ROWS * MASONRY_ROW_PX}px;
        min-height: 0;
      }
      .placeholder {
        --hv-placeholder-head: ${PLACEHOLDER_HEAD_PX.wide}px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        font-family: var(--hv-font);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-card);
      }
      .placeholder-head {
        flex: none;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        height: var(--hv-placeholder-head);
        padding: 14px 16px 10px;
      }
      @container (max-width: ${PLACEHOLDER_MOBILE_MAX_PX}px) {
        .placeholder {
          --hv-placeholder-head: ${PLACEHOLDER_HEAD_PX.mobile}px;
        }
      }
      .placeholder-title {
        min-width: 0;
        margin: 0;
        font-size: 20px;
        font-weight: 400;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .placeholder-body {
        flex: 1 1 0;
      }
    `,
  ];

  private config?: { title?: string; quickFilters?: QuickFilterKey[] | null };

  /** What the card picker writes into a new dashboard entry; HA reads it off the class. */
  public static getStubConfig(): { type: string; title: string } {
    return { type: 'custom:haventory-card', title: 'HAventory' };
  }

  /**
   * The visual editor the picker opens, created by tag so HA owns its lifecycle.
   * HA awaits this, which is what lets the editor live in the lazy runtime.
   */
  public static async getConfigElement(): Promise<HTMLElement> {
    await loadRuntime();
    return document.createElement('haventory-card-editor');
  }

  public setConfig(cfg: unknown): void {
    if (cfg !== null && typeof cfg !== 'object') {
      throw new Error('Invalid config');
    }
    const obj = (cfg || {}) as { title?: unknown; quick_filters?: unknown };
    // Unknown keys and pill names are ignored rather than rejected, so a
    // dashboard never breaks on config the card does not read.
    this.config = {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      quickFilters: normalizeQuickFilters(obj.quick_filters),
    };
    this.requestUpdate();
  }

  /** The masonry-view height the frame's flex basis holds the card to. */
  public getCardSize(): number {
    return MASONRY_ROWS;
  }

  /**
   * Sections-view sizing. `min_rows` is the smallest cell that still shows a
   * few full list rows on a narrow card; below the minimums the list has room
   * for none.
   */
  public getGridOptions(): {
    columns: number;
    rows: number;
    min_columns: number;
    min_rows: number;
  } {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 6 };
  }

  /**
   * The card's frame, with the dashboard's `title:` and nothing else: the
   * integration's title and the default arrive with the store and the catalogs,
   * and a heading that changed at the swap would be the flash this avoids.
   */
  protected override renderPlaceholder() {
    const title = this.config?.title;
    return html`
      <div class="placeholder" data-testid="card-placeholder">
        <div class="placeholder-head">
          ${title ? html`<h2 class="placeholder-title" data-testid="card-placeholder-title">${title}</h2>` : nothing}
        </div>
        ${this.renderPlaceholderBody()}
      </div>
    `;
  }

  /** This element owns the `Store` and the Lovelace interface; the shell owns the rest. */
  protected override renderReady() {
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
   * The dashboard's `quick_filters:`, then the integration's choice, then null
   * (every pill). An explicit `[]` is a choice of no pills and stops the search.
   */
  private _quickFilters(): QuickFilterKey[] | null {
    return this.config?.quickFilters ?? this.store?.state.value.quickFilters ?? null;
  }

  /** The dashboard's `title:`, then the integration's, then the built-in default. */
  private _heading(): string {
    return this.config?.title ?? this.store?.state.value.cardTitle ?? DEFAULT_CARD_TITLE;
  }
}

defineCardElement('haventory-card', HAventoryCard);

// Here, because the sidebar entry shows the mark on pages with no card on them.
registerBrandIcon();

// English in every language: HA reads `window.customCards` before the first
// `hass` brings the user's language.
registerCustomCard({
  type: 'haventory-card',
  name: 'HAventory',
  description: 'HAventory inventory card',
  preview: true,
  documentationURL: 'https://github.com/chrreiter/HAventory#readme',
});
