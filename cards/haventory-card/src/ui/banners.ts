import { css, html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { icon } from './icons';
import type { Store } from '../store/store';
import type { StoreState } from '../store/types';
// Registers the element this file emits. Kept here rather than left to each
// host, so a surface cannot render the stack and get four unstyled divs.
import '../components/hv-banner';

/**
 * The two stacks that say something is wrong: what the connection is doing, and
 * what the last operations came back with.
 *
 * All three surfaces render them from here, so they cannot disagree about what
 * a failure looks like or what can be done about it. The expanded view and the
 * sidebar panel need their own: each fills the screen, so the card's copy is
 * not behind them to be read.
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
 * Events carry no sequence number, so a client that missed one cannot detect
 * the gap on its own — the honest move is to say the list might be stale and
 * offer the re-read.
 */
export function renderDegradedBanners(st: StoreState | null, hooks: BannerHooks): TemplateResult | null {
  const degraded = st?.degraded;
  if (!degraded) return null;
  const banners = [];

  if (degraded.connectionLost) {
    banners.push(html`<hv-banner
      kind="error"
      glyph="wifiOff"
      heading=${t('hv.banner.connectionLost.heading')}
      message=${t('hv.banner.connectionLost.message')}
      data-testid="degraded-offline"
    >
      <button slot="actions" class="hv-pill outline" data-testid="degraded-reconnect" @click=${hooks.onRefresh}>
        ${t('hv.banner.connectionLost.action')}
      </button>
    </hv-banner>`);
  } else if (degraded.liveUpdates !== 'live') {
    const retrying = degraded.liveUpdates === 'retrying';
    const cause = t('hv.banner.liveUpdates.cause.unavailable');
    banners.push(html`<hv-banner
      kind="warning"
      glyph="clock"
      heading=${t('hv.banner.liveUpdates.heading')}
      message=${retrying
        ? t('hv.banner.liveUpdates.retrying', { cause })
        : t('hv.banner.liveUpdates.stalled', { cause })}
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
            ${t('hv.action.refresh')}
          </button>`}
    </hv-banner>`);
  }

  if (degraded.reloading) {
    banners.push(html`<hv-banner
      kind="info"
      glyph="refresh"
      heading=${t('hv.banner.reloading.heading')}
      message=${t('hv.banner.reloading.message')}
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
        const conflict = e.kind === 'conflict';
        // A conflict's own message names version numbers, which say nothing to
        // a household in any language — the heading is the whole account, the
        // way `ui/editor-error` frames the same event inside the form. The
        // queue keeps the backend's sentence either way.
        //
        // The two ways out need the item the write was refused for. A quantity
        // delta cannot be re-applied against a version somebody else moved, so
        // the store files that one with no item and it gets the sentence alone.
        const recoverable = conflict && e.itemId;
        return html`<hv-banner
          kind=${conflict ? 'warning' : 'error'}
          .heading=${conflict ? t('hv.banner.conflict.heading') : null}
          .message=${conflict ? '' : e.message}
          data-testid="banner-entry"
          data-code=${e.code}
        >
          ${recoverable
            ? html`<span slot="below">
                <button
                  class="hv-pill outline"
                  data-testid="banner-view-latest"
                  @click=${() => {
                    void store?.refreshItem(e.itemId!);
                    store?.dismissError(e.id);
                  }}
                >
                  ${t('hv.banner.conflict.viewLatest')}
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
                      ${t('hv.banner.conflict.reapply')}
                    </button>`
                  : null}
              </span>`
            : null}
          <button
            slot="actions"
            class="hv-icon-button"
            data-testid="banner-dismiss"
            aria-label=${t('hv.action.dismiss')}
            @click=${() => store?.dismissError(e.id)}
          >
            ${icon('close', 16)}
          </button>
        </hv-banner>`;
      })}
    </div>
  `;
}
