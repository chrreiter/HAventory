import { t } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome, modalSheet } from '../ui/modal';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { relativeTime } from '../ui/relative-time';
import { copyText } from '../ui/clipboard';
import type { DegradedState, StatsCounts, VersionInfo } from '../store/types';

/**
 * Diagnostics.
 *
 * This matters because a missed subscription event is undetectable — events
 * carry no sequence number — and the only honest recovery is a manual re-read.
 * The panel says whether live updates are arriving at all, and offers the
 * refresh.
 */
@customElement('hv-diagnostics-panel')
export class HVDiagnosticsPanel extends LitElement {
  static styles = [
    tokens,
    base,
    modalChrome,
    css`
      /*
       * The single implicit track of a centring grid is auto-sized, and an
       * auto track takes the width its item asks for — 470px — however narrow
       * the container is. The panel's own max-width: 100% resolves against
       * that track and never clamps, so on a phone the dialog stays 470 wide
       * and its right edge hangs off the screen, out of reach.
       *
       * A minmax(0, 1fr) track is the container's width instead, which is what
       * gives the percentage something to bite on. Rows get the same treatment
       * so a panel taller than the viewport scrolls its body rather than
       * growing past the top and bottom edges.
       */
      .wrap {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
      }
      .panel {
        width: 470px;
        max-height: 100%;
        display: flex;
        flex-direction: column;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 15px 20px 12px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 17px;
        font-weight: 500;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 14px 20px;
        display: grid;
        gap: 14px;
      }
      .status {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 13px;
        line-height: 1.45;
      }
      .status.ok {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .status.bad {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .dot {
        flex: none;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: currentColor;
      }
      /* Three fixed columns fit 470px. Once the panel is allowed to be as
         narrow as the screen, three tiles of "Commands rejected" width no
         longer do, so they wrap to two rows instead of overflowing. */
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 10px;
      }
      .tile {
        border: 1px solid var(--hv-divider);
        border-radius: 10px;
        padding: 11px 13px;
      }
      .tile .value {
        font-size: 21px;
        font-weight: 500;
      }
      .tile .value.bad {
        color: var(--hv-error);
      }
      .tile .value.warn {
        color: var(--hv-warn);
      }
      .tile .label {
        font-size: 11.5px;
        color: var(--hv-text-secondary);
      }
      .facts {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        border: 1px solid var(--hv-row-divider);
        border-radius: 8px;
        overflow: hidden;
      }
      .fact {
        display: flex;
        padding: 9px 12px;
        background: var(--hv-surface);
        font-size: 12.5px;
        color: var(--hv-text-secondary);
      }
      .fact .value {
        margin-left: auto;
        color: var(--hv-text);
      }
      .fact .value.live {
        color: var(--hv-success);
        font-weight: 500;
      }
      .fact .value.stale {
        color: var(--hv-warn);
        font-weight: 500;
      }
      .note {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px 16px;
      }
      .foot .spacer {
        margin-left: auto;
      }
    `,
    modalSheet,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ attribute: false }) counts: StatsCounts | null = null;
  @property({ attribute: false }) version: VersionInfo | null = null;
  @property({ attribute: false }) degraded: DegradedState | null = null;
  @property({ attribute: false }) connected: { items: boolean; stats: boolean } | null = null;
  @property({ type: Number }) loadedItems = 0;
  /** ISO timestamp of the last successful refresh, for "since last refresh". */
  @property({ type: String }) lastRefresh: string | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private _copied = false;

  private _modal = new Modal(this, { open: () => this.open });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) this._copied = false;
  }

  private _close = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  /** Everything the panel shows, as text worth pasting into an issue. */
  get report(): string {
    return [
      `HAventory diagnostics`,
      `integration ${this.version?.integration_version ?? 'unknown'} · schema ${this.version?.schema_version ?? '?'}`,
      `counts: ${JSON.stringify(this.counts ?? {})}`,
      `degraded: ${JSON.stringify(this.degraded ?? {})}`,
      `subscriptions: items=${this.connected?.items ?? false} stats=${this.connected?.stats ?? false}`,
    ].join('\n');
  }

  render() {
    if (!this.open) return null;
    const live = !!this.connected?.items && !this.degraded?.connectionLost;

    return this._modal.render(
      {
        label: t('hv.diagnostics.title'),
        testid: 'diagnostics-panel',
        onClose: this._close,
      },
      html`
        <div class="head">
          <span style="color: var(--hv-${live ? 'success' : 'warn'})">
            ${icon(live ? 'checkCircle' : 'alert', 20)}
          </span>
          <h2>${t('hv.diagnostics.title')}</h2>
          <button
            class="hv-pill outline"
            data-testid="health-refresh"
            ?disabled=${this.busy}
            @click=${() => this.dispatchEvent(new CustomEvent('refresh', { bubbles: true, composed: true }))}
          >
            ${icon('refresh', 15)}${this.busy
              ? t('hv.diagnostics.refreshing')
              : t('hv.action.refresh')}
          </button>
        </div>

        <div class="body">
          <div class="status ${live ? 'ok' : 'bad'}" data-testid="diagnostics-status">
            <span class="dot"></span>
            <span>
              ${live
                ? html`<strong>${t('hv.diagnostics.noIssues')}</strong
                    >${t('hv.diagnostics.noIssuesDetail')}`
                : html`<strong>${t('hv.diagnostics.notLive')}</strong
                    >${t('hv.diagnostics.notLiveDetail')}`}
            </span>
          </div>

          <div class="tiles">
            <div class="tile">
              <div class="value" data-testid="diagnostics-since">
                ${this.lastRefresh ? relativeTime(this.lastRefresh) : '—'}
              </div>
              <div class="label">${t('hv.diagnostics.sinceLastRefresh')}</div>
            </div>
          </div>

          <div class="facts">
            <div class="fact">
              <span>${t('hv.diagnostics.subscriptions')}</span>
              <span class="value ${live ? 'live' : 'stale'}" data-testid="diagnostics-subscriptions">
                ${live
                  ? t('hv.diagnostics.subscriptionsLive')
                  : t('hv.diagnostics.subscriptionsDown')}
              </span>
            </div>
            <div class="fact">
              <span>${t('hv.diagnostics.dataLoaded')}</span>
              <span class="value" data-testid="diagnostics-loaded">
                ${t('hv.diagnostics.loadedValue', {
                  loaded: this.loadedItems,
                  items: this.counts
                    ? counted(this.counts.items_total, 'item')
                    : t('hv.diagnostics.unknownItems'),
                  locations: this.counts
                    ? counted(this.counts.locations_total, 'location')
                    : t('hv.diagnostics.unknownLocations'),
                })}
              </span>
            </div>
            <div class="fact">
              <span>${t('hv.diagnostics.integrationVersion')}</span>
              <span class="value" data-testid="diagnostics-version">
                ${this.version?.integration_version ?? '—'}
              </span>
            </div>
          </div>

          <span class="note">${t('hv.diagnostics.healthyNote')}</span>
        </div>

        <div class="foot">
          <span class="spacer"></span>
          <button
            class="hv-text-button"
            data-testid="diagnostics-copy"
            @click=${async () => {
              this._copied = await copyText(this.report);
            }}
          >
            ${this._copied ? t('hv.action.copied') : t('hv.diagnostics.copyReport')}
          </button>
          <!-- This panel reports; it commits nothing. Its way out is drawn as
               an outline so the filled shape keeps meaning "this writes". -->
          <button class="hv-pill outline" data-testid="diagnostics-close" @click=${this._close}>
            ${t('hv.action.close')}
          </button>
        </div>
      `,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-diagnostics-panel': HVDiagnosticsPanel;
  }
}
