import { t } from '../i18n';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { keyed } from 'lit/directives/keyed.js';
import { emitter } from '../events';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome } from '../ui/modal';
import { icon } from '../ui/icons';
import type { Store } from '../store/store';
import './hv-organize-locations';
import './hv-organize-statuses';
import './hv-organize-values';

export type OrganizeTab = 'locations' | 'categories' | 'tags' | 'statuses';

/**
 * "Organize": one dialog, four tabs (locations, categories, tags, statuses),
 * each its own element. The dialog owns the chrome, the tab strip, Escape,
 * backdrop and close, and focus through `Modal`; it closes when a tab sends
 * `browse`, after passing it on to the host.
 */
@customElement('hv-organize-dialog')
export class HVOrganizeDialog extends LitElement {
  static override styles = [
    tokens,
    base,
    modalChrome,
    css`
      :host {
        /* Every row's vertical padding, inherited into the tab elements and
           through them into the hosted hv-location-tree, so the four tabs
           cannot drift apart. */
        --hv-organize-row-pad: 8px;
      }
      .wrap {
        padding: 24px;
      }
      :host([mobile]) .wrap {
        padding: 0;
        place-items: stretch;
      }
      .panel {
        width: 620px;
        max-height: 100%;
        display: flex;
        flex-direction: column;
      }
      /* Mobile is a full-bleed page, not a floating modal. */
      :host([mobile]) .panel {
        width: 100%;
        height: 100%;
        max-height: none;
        border-radius: 0;
        box-shadow: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 15px 20px 12px;
      }
      :host([mobile]) .head {
        padding: 6px 8px 6px 4px;
        border-bottom: 1px solid var(--hv-divider);
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 18px;
        font-weight: 500;
      }
      :host([mobile]) .head h2 {
        font-size: 17px;
      }
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--hv-divider);
        padding: 0 20px;
      }
      :host([mobile]) .tabs {
        padding: 0;
      }
      .tabs button {
        border: none;
        background: none;
        padding: 8px 16px 10px;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text-secondary);
        border-bottom: 2px solid transparent;
      }
      :host([mobile]) .tabs button {
        flex: 1;
        padding: 12px 0;
      }
      .tabs button.on {
        color: var(--hv-primary-darker);
        font-weight: 500;
        border-bottom-color: var(--hv-primary);
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) tab: OrganizeTab = 'locations';
  @property({ type: Boolean, reflect: true }) mobile = false;

  private _modal = new Modal(this, { open: () => this.open });

  private readonly _emit = emitter<'hv-organize-dialog'>(this);

  /** Whether this update is the one that puts the dialog on screen. */
  private _opening = false;
  /**
   * Counts the openings. The tabs other than statuses are keyed on it, so each
   * opening builds them afresh.
   */
  private _openings = 0;

  protected override updated() {
    this._opening = false;
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._opening = true;
      this._openings += 1;
    }
  }

  private readonly _isOpening = () => this._opening;

  private _close = () => {
    this._emit('cancel');
  };

  /** A tab asks for the expanded surface; the dialog answers it and closes. */
  private _onTabBrowse = (e: Event) => {
    e.stopPropagation();
    this._browse();
  };

  /** Close, asking the host for the expanded surface to show what was picked. */
  private _browse() {
    this._emit('browse');
    this._close();
  }

  // The cache keeps the statuses tab's open editor across a close, as it is kept across a tab switch.
  override render() {
    return cache(this.open ? this._renderOpen() : nothing);
  }

  private _renderOpen() {
    return html`
      ${this._modal.render(
        { label: t('hv.organize.title'), testid: 'organize-dialog', onClose: this._close },
        html`
          <div class="head">
            ${
              this.mobile
                ? html`<button
                  class="hv-icon-button"
                  data-testid="organize-back"
                  aria-label=${t('hv.action.back')}
                  @click=${this._close}
                >
                  ${icon('arrowLeft', 21)}
                </button>`
                : null
            }
            <h2>${t('hv.organize.title')}</h2>
            ${
              this.mobile
                ? null
                : html`<button
                  class="hv-icon-button"
                  data-testid="organize-close"
                  aria-label=${t('hv.action.close')}
                  @click=${this._close}
                >
                  ${icon('close', 20)}
                </button>`
            }
          </div>
          <div class="tabs" role="tablist">
            ${(['locations', 'categories', 'tags', 'statuses'] as OrganizeTab[]).map(
              (tab) => html`<button
                class=${this.tab === tab ? 'on' : ''}
                role="tab"
                aria-selected=${String(this.tab === tab)}
                data-testid="organize-tab"
                data-tab=${tab}
                @click=${() => {
                  this.tab = tab;
                }}
              >
                ${t(`hv.field.${tab}`)}
              </button>`,
            )}
          </div>
          ${cache(
            this.tab === 'statuses'
              ? html`<hv-organize-statuses
                  ?mobile=${this.mobile}
                  .store=${this.store}
                  .opening=${this._isOpening}
                  @browse=${this._onTabBrowse}
                ></hv-organize-statuses>`
              : html`${keyed(
                  `${this._openings}:${this.tab}`,
                  this.tab === 'locations'
                    ? html`<hv-organize-locations
                        ?mobile=${this.mobile}
                        .store=${this.store}
                        .opening=${this._isOpening}
                        @browse=${this._onTabBrowse}
                      ></hv-organize-locations>`
                    : html`<hv-organize-values
                        ?mobile=${this.mobile}
                        .store=${this.store}
                        .kind=${this.tab === 'tags' ? 'tag' : 'category'}
                        .opening=${this._isOpening}
                        @browse=${this._onTabBrowse}
                      ></hv-organize-values>`,
                )}`,
          )}
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-dialog': HVOrganizeDialog;
  }
}
