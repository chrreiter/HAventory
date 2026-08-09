import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { icon } from './icons';
import { counted } from './plural';
import type { Store } from '../store/store';
import type { StoreState } from '../store/types';
// Registers the element this file emits. Kept here rather than left to each
// host, so a surface cannot render the stack and get four unstyled divs.
import '../components/hv-banner';

/**
 * The two stacks that say something is wrong: what the connection is doing, and
 * what the last operations came back with.
 *
 * Both were the card's alone. On the expanded view and the sidebar panel — the
 * surfaces that fill the screen, so the card's copy is not behind them — a lost
 * connection, paused live updates and a refused operation all showed nothing at
 * all. They render from here now, so the three surfaces cannot disagree about
 * what a failure looks like or what can be done about it.
 *
 * A rejected *save* is the one failure this stack is not the primary voice for:
 * the sentence inside the open form is, because that is where the user's text
 * is. The queue still carries the entry, and the conflict actions here are what
 * gets the two copies of the item back together.
 */

/** Layout for the two stacks. Hosts add this to their own styles. */
export const bannerStack = css`
  .banners {
    display: grid;
    gap: 6px;
    padding: 0 16px 10px;
  }
`;

/** What a banner needs its host to do. */
export interface BannerHooks {
  /** The store the conflict actions act on. */
  store: Store | undefined;
  /**
   * Re-read everything. The card runs it through its `HostSurfaces`; the full
   * view asks its host for the same menu action, since the surfaces live there.
   */
  onRefresh: () => void;
}

/**
 * Conditions that make the surface untrustworthy, said out loud.
 *
 * Rate limiting can drop subscription events silently and events carry no
 * sequence number, so a client cannot detect a gap on its own — the honest move
 * is to say it might be stale and offer the re-read.
 */
export function renderDegradedBanners(st: StoreState | null, hooks: BannerHooks): TemplateResult | null {
  const degraded = st?.degraded;
  if (!degraded) return null;
  const banners = [];

  if (degraded.connectionLost) {
    banners.push(html`<hv-banner
      kind="error"
      glyph="wifiOff"
      heading="Connection lost"
      message=" · showing the data already loaded. Changes may not save."
      data-testid="degraded-offline"
    >
      <button slot="actions" class="hv-pill outline" data-testid="degraded-reconnect" @click=${hooks.onRefresh}>
        Reconnect
      </button>
    </hv-banner>`);
  } else if (degraded.liveUpdates !== 'live') {
    // Ranked above the generic rate-limit warning below: that one says events
    // *may* have been dropped, this one says there are no events at all.
    const retrying = degraded.liveUpdates === 'retrying';
    const cause = degraded.liveUpdatesReason === 'unavailable' ? 'HAventory is not available' : 'rate limited';
    banners.push(html`<hv-banner
      kind="warning"
      glyph="clock"
      heading="Live updates paused"
      message=${retrying
        ? ` · ${cause}. Retrying automatically; this list may be out of date until then.`
        : ` · ${cause}. This list may be out of date until you refresh.`}
      data-testid="degraded-live-updates"
    >
      ${retrying
        ? null
        : html`<button
            slot="actions"
            class="hv-pill outline"
            data-testid="degraded-live-refresh"
            @click=${hooks.onRefresh}
          >
            Refresh
          </button>`}
    </hv-banner>`);
  } else if (degraded.retrying > 0) {
    banners.push(html`<hv-banner
      kind="warning"
      glyph="clock"
      heading="Busy — retrying"
      message=${` · ${counted(degraded.retrying, 'change')} queued`}
      data-testid="degraded-retrying"
    ></hv-banner>`);
  } else if (degraded.rateLimited) {
    banners.push(html`<hv-banner
      kind="warning"
      glyph="clock"
      heading="Rate limited"
      message=" · some live updates may have been dropped, so this list can be out of date."
      data-testid="degraded-rate-limited"
    >
      <button slot="actions" class="hv-pill outline" data-testid="degraded-refresh" @click=${hooks.onRefresh}>
        Refresh
      </button>
    </hv-banner>`);
  }

  if (degraded.reloading) {
    banners.push(html`<hv-banner
      kind="info"
      glyph="refresh"
      heading="Inventory was replaced by an import"
      message=" · reloading…"
      data-testid="degraded-reloading"
    ></hv-banner>`);
  }

  return banners.length ? html`<div class="banners" data-testid="degraded-banners">${banners}</div>` : null;
}

/** The queue of operations that came back refused, newest last. */
export function renderErrorBanners(st: StoreState | null, hooks: BannerHooks): TemplateResult | null {
  const errors = st?.errorQueue ?? [];
  if (!errors.length) return null;
  const store = hooks.store;
  return html`
    <div class="banners" data-testid="banners">
      ${errors.map((e) => {
        const conflict = e.kind === 'conflict' && e.itemId;
        return html`<hv-banner
          kind=${conflict ? 'warning' : 'error'}
          .heading=${conflict ? 'Someone else changed this item.' : null}
          .message=${e.message}
          data-testid="banner-entry"
          data-code=${e.code}
        >
          ${conflict
            ? html`<span slot="below">
                <button
                  class="hv-pill outline"
                  data-testid="banner-view-latest"
                  @click=${() => {
                    void store?.refreshItem(e.itemId!);
                    store?.dismissError(e.id);
                  }}
                >
                  View latest
                </button>
                ${e.changes
                  ? html`<button
                      class="hv-pill"
                      data-testid="banner-reapply"
                      @click=${() => {
                        void store?.updateItem(e.itemId!, e.changes!);
                        store?.dismissError(e.id);
                      }}
                    >
                      Re-apply my change
                    </button>`
                  : null}
              </span>`
            : null}
          <button
            slot="actions"
            class="hv-icon-button"
            data-testid="banner-dismiss"
            aria-label="Dismiss"
            @click=${() => store?.dismissError(e.id)}
          >
            ${icon('close', 16)}
          </button>
        </hv-banner>`;
      })}
    </div>
  `;
}
