import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

export type BannerKind = 'warning' | 'error' | 'info' | 'success';

const DEFAULT_ICON: Record<BannerKind, IconName> = {
  warning: 'alert',
  error: 'alertCircle',
  info: 'refresh',
  success: 'checkCircle',
};

/**
 * The one alert treatment for the revamped card: conflicts, storage failures,
 * rate limiting, connection loss and import reloads all render through this.
 *
 * Purely presentational — the caller supplies the copy and slots in whatever
 * actions belong to that state (`slot="actions"` for trailing buttons,
 * `slot="below"` for the stacked button rows the conflict alert uses).
 */
@customElement('hv-banner')
export class HVBanner extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .banner.warning {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .banner.warning .glyph {
        color: var(--hv-warn);
      }
      .banner.error {
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
      }
      .banner.error .glyph {
        color: var(--hv-error);
      }
      .banner.info {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      .banner.info .glyph {
        color: var(--hv-primary-dark);
      }
      .banner.success {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .banner.success .glyph {
        color: var(--hv-success);
      }
      .glyph {
        flex: none;
        margin-top: 1px;
      }
      .body {
        flex: 1;
        min-width: 0;
      }
      .heading {
        font-weight: 500;
      }
      slot[name='below'] {
        display: flex;
        gap: 8px;
      }
      /* Spacing lives on the slotted children so an empty slot adds nothing. */
      slot[name='below']::slotted(*) {
        margin-top: 8px;
      }
      .actions {
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
    `,
  ];

  @property({ type: String }) kind: BannerKind = 'warning';
  /** Bold lead-in, rendered before `message` on the same line. */
  @property({ type: String }) heading: string | null = null;
  @property({ type: String }) message = '';
  /** Override the kind's default glyph. */
  @property({ attribute: false }) glyph: IconName | null = null;

  render() {
    const kind: BannerKind = DEFAULT_ICON[this.kind] ? this.kind : 'warning';
    return html`
      <div class="banner ${kind}" role="alert" data-testid="banner" data-kind=${kind}>
        <span class="glyph">${icon(this.glyph ?? DEFAULT_ICON[kind], 18)}</span>
        <div class="body">
          ${this.heading ? html`<span class="heading">${this.heading}</span> ` : null}<span
            data-testid="banner-message"
            >${this.message}</span
          ><slot></slot>
          <slot name="below"></slot>
        </div>
        <div class="actions"><slot name="actions"></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-banner': HVBanner;
  }
}
