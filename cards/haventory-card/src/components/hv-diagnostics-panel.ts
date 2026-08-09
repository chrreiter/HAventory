import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { dialogSheet } from '../ui/dialog-sheet';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { summarizeIssues } from '../ui/health-codes';
import { relativeTime } from '../ui/relative-time';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import type { DegradedState, HealthResult, StatsCounts, VersionInfo } from '../store/types';

/**
 * Diagnostics.
 *
 * This matters because rate limiting can drop subscription events silently —
 * events carry no sequence number, so a card cannot detect a gap — and the only
 * honest recovery is a manual re-read. The panel says whether that is
 * happening, how much has been dropped, and offers the refresh.
 */
@customElement('hv-diagnostics-panel')
export class HVDiagnosticsPanel extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
      }
      /*
       * The single implicit track of a centring grid is auto-sized, and an
       * auto track takes the width its item asks for — 470px — however narrow
       * the container is. The panel's own max-width: 100% then resolved
       * against that 470px track and never clamped, so on a 390px screen the
       * dialog stayed 470 wide: the third tile, the fact values and the Close
       * button all hung off the right edge, unreachable (the wrap measured
       * scrollWidth 494 against clientWidth 390).
       *
       * A minmax(0, 1fr) track is the container's width instead, which is what
       * gives the percentage something to bite on. Rows get the same treatment
       * so a panel with several issues in it scrolls its body rather than
       * growing past the top and bottom edges.
       */
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
        place-items: center;
        padding: 16px;
        box-sizing: border-box;
      }
      .panel {
        width: 470px;
        max-width: 100%;
        max-height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
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
      .issue {
        display: flex;
        gap: 9px;
        padding: 10px 12px;
        border: 1px solid var(--hv-warn-border);
        background: var(--hv-warn-bg);
        border-radius: 8px;
        font-size: 12.5px;
        color: var(--hv-warn-deep);
        line-height: 1.45;
      }
      .issue .glyph {
        color: var(--hv-warn);
        flex: none;
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
      .primary {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 9px 20px;
        font: 500 13.5px var(--hv-font);
      }
    `,
    dialogSheet,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  @property({ attribute: false }) health: HealthResult | null = null;
  @property({ attribute: false }) counts: StatsCounts | null = null;
  @property({ attribute: false }) version: VersionInfo | null = null;
  @property({ attribute: false }) degraded: DegradedState | null = null;
  @property({ attribute: false }) connected: { items: boolean; stats: boolean } | null = null;
  @property({ type: Number }) loadedItems = 0;
  /** ISO timestamp of the last successful refresh, for "since last refresh". */
  @property({ type: String }) lastRefresh: string | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private _zBase = 0;
  @state() private _copied = false;


  /** Opening a surface must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  protected updated() {
    this._dialogFocus.sync(this.open, () =>
      this.renderRoot.querySelector<HTMLElement>('[data-testid="diagnostics-panel"]'),
    );
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this._copied = false;
    }
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  /** Everything the panel shows, as text worth pasting into an issue. */
  get report(): string {
    const issues = summarizeIssues(this.health?.issues);
    return [
      `HAventory diagnostics`,
      `integration ${this.version?.integration_version ?? 'unknown'} · schema ${this.version?.schema_version ?? '?'}`,
      `healthy: ${this.health?.healthy ?? 'unknown'} · generation ${this.health?.generation ?? '?'}`,
      `counts: ${JSON.stringify(this.counts ?? {})}`,
      `rate limit: ${JSON.stringify(this.health?.rate_limit ?? {})}`,
      `degraded: ${JSON.stringify(this.degraded ?? {})}`,
      `subscriptions: items=${this.connected?.items ?? false} stats=${this.connected?.stats ?? false}`,
      ...issues.map((i) => `issue ${i.code} ×${i.count}: ${i.message}`),
    ].join('\n');
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const health = this.health;
    const rate = health?.rate_limit;
    const issues = summarizeIssues(health?.issues);
    const degraded = this.degraded;
    const live = !!this.connected?.items && !degraded?.connectionLost;
    const rateLimited = !!degraded?.rateLimited || !!(rate?.dropped_commands || rate?.dropped_events);
    const unhealthy = health ? !health.healthy : false;
    const bad = unhealthy || rateLimited || !live;

    return html`
      <div class="backdrop" role="presentation" style="z-index:${z}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${z + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Diagnostics"
          data-testid="diagnostics-panel"
          @keydown=${onEscape(() => this._close())}
        >
          <div class="head">
            <span style="color: var(--hv-${bad ? 'warn' : 'success'})">
              ${icon(bad ? 'alert' : 'checkCircle', 20)}
            </span>
            <h2>Diagnostics</h2>
            <button
              class="hv-pill outline"
              data-testid="health-refresh"
              ?disabled=${this.busy}
              @click=${() => this.dispatchEvent(new CustomEvent('refresh', { bubbles: true, composed: true }))}
            >
              ${icon('refresh', 15)}${this.busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div class="body">
            <div class="status ${bad ? 'bad' : 'ok'}" data-testid="diagnostics-status">
              <span class="dot"></span>
              <span>
                ${!live
                  ? html`<strong>Not live</strong> — subscriptions are down, so the list only changes when you
                      refresh.`
                  : rateLimited
                    ? html`<strong>Degraded</strong> — rate limiting is active. Some commands and live updates
                        are being dropped.`
                    : unhealthy
                      ? html`<strong>Issues found</strong> — the integration reported problems with its stored
                          data.`
                      : html`<strong>No issues</strong> · live`}
              </span>
            </div>

            <div class="tiles">
              <div class="tile">
                <div class="value ${rate?.dropped_commands ? 'bad' : ''}" data-testid="diagnostics-dropped-commands">
                  ${rate?.dropped_commands ?? 0}
                </div>
                <div class="label">Commands rejected</div>
              </div>
              <div class="tile">
                <div class="value ${rate?.dropped_events ? 'warn' : ''}" data-testid="diagnostics-dropped-events">
                  ${rate?.dropped_events ?? 0}
                </div>
                <div class="label">Events dropped</div>
              </div>
              <div class="tile">
                <div class="value" data-testid="diagnostics-since">
                  ${this.lastRefresh ? relativeTime(this.lastRefresh) : '—'}
                </div>
                <div class="label">Since last refresh</div>
              </div>
            </div>

            ${issues.length
              ? html`<div style="display:grid;gap:8px">
                  <span class="hv-label">Issues</span>
                  ${issues.map(
                    (issue) => html`<div class="issue" data-testid="diagnostics-issue" data-code=${issue.code}>
                      <span class="glyph">${icon('alert', 17)}</span>
                      <span>${issue.message}</span>
                    </div>`,
                  )}
                </div>`
              : null}

            <div class="facts">
              <div class="fact">
                <span>Subscriptions</span>
                <span class="value ${live ? 'live' : 'stale'}" data-testid="diagnostics-subscriptions">
                  ${live ? 'items · locations · stats — live' : 'not connected'}
                </span>
              </div>
              <div class="fact">
                <span>Data loaded</span>
                <span class="value" data-testid="diagnostics-loaded">
                  ${this.loadedItems} of
                  ${this.counts ? counted(this.counts.items_total, 'item') : '? items'} ·
                  ${this.counts ? counted(this.counts.locations_total, 'location') : '? locations'}
                </span>
              </div>
              <div class="fact">
                <span>Rate limiting</span>
                <span class="value">${rate?.enabled ? 'enabled' : 'off'}</span>
              </div>
              <div class="fact">
                <span>Integration version</span>
                <span class="value" data-testid="diagnostics-version">
                  ${this.version?.integration_version ?? '—'}
                </span>
              </div>
            </div>

            ${issues.length
              ? null
              : html`<span class="note">
                  A healthy integration reports nothing here. The counters stay at zero unless rate limiting is
                  enabled and tripped.
                </span>`}
          </div>

          <div class="foot">
            <span class="spacer"></span>
            <button
              class="hv-text-button"
              data-testid="diagnostics-copy"
              @click=${() => {
                void navigator.clipboard?.writeText?.(this.report).catch(() => undefined);
                this._copied = true;
              }}
            >
              ${this._copied ? 'Copied' : 'Copy report'}
            </button>
            <button class="primary" data-testid="diagnostics-close" @click=${this._close}>Close</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-diagnostics-panel': HVDiagnosticsPanel;
  }
}
