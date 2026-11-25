import { t } from '../i18n';
import { emitter } from '../events';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../ui/tokens';
import { renderEmptyState } from '../ui/empty-state';
import type { EmptyKind, EmptyOffer } from '../ui/empty-state';
import type { AreaRef, Item, StatusDefinition } from '../store/types';
import type { MediaBindings } from '../ui/media';
import './hv-list-row';

/** Placeholder rows while the first page is in flight: about as many as the default frame shows. */
const SKELETON_ROWS = 5;

/**
 * The standard card's list: skeletons while loading, a named empty state, rows,
 * and the near-end signal that drives infinite scroll.
 */
@customElement('hv-list')
export class HVList extends LitElement {
  static override styles = [
    tokens,
    base,
    css`
      /* As tall as the card's frame leaves it; what it holds scrolls inside. */
      :host {
        display: flex;
        flex-direction: column;
        position: relative;
      }
      /* The containing block for what is placed absolutely inside it, such as
         the editor's hidden file inputs, which would otherwise hang below the
         card's frame instead of scrolling with the form. */
      .scroller {
        position: relative;
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      /* Rows that end flush with the frame read as the whole list, and a phone
         draws no scroll bar until the first swipe. So each end with rows past
         it fades its last row and casts a shadow from the frame's edge. The
         state is on the host because the shadows sit outside the scroller,
         where its mask cannot erase them. */
      :host {
        --hv-fade-size: 56px;
        --hv-fade-edge: 0.1;
        --hv-edge-shadow-size: 16px;
        --hv-edge-shadow: light-dark(rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.7));
      }
      .scroller {
        --hv-fade-top: 0px;
        --hv-fade-bottom: 0px;
        --hv-fade-top-from: #000;
        --hv-fade-bottom-to: #000;
      }
      :host([more-above]) .scroller {
        --hv-fade-top: var(--hv-fade-size);
        --hv-fade-top-from: rgba(0, 0, 0, var(--hv-fade-edge));
      }
      :host([more-below]) .scroller {
        --hv-fade-bottom: var(--hv-fade-size);
        --hv-fade-bottom-to: rgba(0, 0, 0, var(--hv-fade-edge));
      }
      :host([more-above]) .scroller,
      :host([more-below]) .scroller {
        --hv-fade: linear-gradient(
          to bottom,
          var(--hv-fade-top-from),
          #000 var(--hv-fade-top),
          #000 calc(100% - var(--hv-fade-bottom)),
          var(--hv-fade-bottom-to)
        );
        -webkit-mask-image: var(--hv-fade);
        mask-image: var(--hv-fade);
      }
      :host::before,
      :host::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: var(--hv-edge-shadow-size);
        pointer-events: none;
        opacity: 0;
        z-index: 1;
      }
      :host::before {
        top: 0;
        background: linear-gradient(to bottom, var(--hv-edge-shadow), transparent);
      }
      :host::after {
        bottom: 0;
        background: linear-gradient(to top, var(--hv-edge-shadow), transparent);
      }
      :host([more-above])::before,
      :host([more-below])::after {
        opacity: 1;
      }
      @media (prefers-reduced-motion: no-preference) {
        :host::before,
        :host::after {
          transition: opacity 150ms ease-out;
        }
      }
      /* A refetch keeps its rows; out of the flow, so the rows do not shift. */
      .refreshing {
        position: absolute;
        inset: 0 0 auto 0;
        height: 2px;
        overflow: hidden;
        background: var(--hv-row-divider);
        pointer-events: none;
      }
      .refreshing::after {
        content: '';
        display: block;
        height: 100%;
        width: 40%;
        background: var(--hv-primary);
        opacity: 0.7;
      }
      @media (prefers-reduced-motion: no-preference) {
        .refreshing::after {
          animation: sweep 1.1s ease-in-out infinite;
        }
      }
      @keyframes sweep {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(250%);
        }
      }
      /* The form stays open on a row that no longer matches the filter. */
      .pinned-hint {
        margin: 0;
        padding: 6px 16px;
        font-size: 12px;
        color: var(--hv-text-secondary);
        border-top: 1px solid var(--hv-row-divider);
      }
      /* Centred in the room the frame leaves, and scrolled where that is less
         than the offers need. */
      .empty {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        display: grid;
        align-content: safe center;
        justify-items: center;
        gap: 10px;
        padding: 32px 16px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
      .empty .headline {
        font-size: 14px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .empty .offers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .skeleton-row {
        display: grid;
        gap: 6px;
        padding: 12px 16px;
        border-top: 1px solid var(--hv-row-divider);
      }
      .skeleton-row:first-child {
        border-top: none;
      }
      .bar {
        height: 10px;
        border-radius: 4px;
        background: var(--hv-row-divider);
      }
      .bar.short {
        height: 8px;
        opacity: 0.7;
      }
      @media (prefers-reduced-motion: no-preference) {
        .bar {
          animation: pulse 1.4s ease-in-out infinite;
        }
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `,
  ];

  @property({ attribute: false }) items: Item[] = [];
  @property({ type: Boolean }) mobile = false;
  /** HA areas, forwarded to each row so it can name the item's area. */
  @property({ attribute: false }) areas: AreaRef[] = [];
  /** Picture access, forwarded to each row's thumbnail. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** The status vocabulary from `haventory/config`; passed through to each row. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) emptyKind: EmptyKind = 'no-items';
  /** Location name for the "Nothing in X" empty state. */
  @property({ type: String }) emptyLocationName: string | null = null;
  /** Inline editing: the host's template for the form, so this list knows nothing about it. */
  @property({ attribute: false }) editorTemplate: ((itemId: string | null) => unknown) | null = null;
  /** Opaque token the host changes when the stable template would draw something new. */
  @property({ attribute: false }) editorEpoch: unknown = 0;
  /** Row currently expanded into the editor; its own row is hidden while it is. */
  @property({ type: String }) editingItemId: string | null = null;
  /** The host's copy of the row being edited, so the form outlives a refetch that drops it. */
  @property({ attribute: false }) pinnedItem: Item | null = null;
  /** Pin an empty editor at the top of the list ("Add item"). */
  @property({ type: Boolean }) addingNew = false;

  private readonly _emit = emitter<'hv-list'>(this);
  /** Re-measures when the frame resizes or an expanded editor grows. */
  private readonly _resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this._measure());
  private _observed: Element | null = null;

  private _onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    const ratio = (el.scrollTop + el.clientHeight) / Math.max(1, el.scrollHeight);
    this._emit('near-end', { ratio });
    this._measure();
  };

  /**
   * Set on the host rather than through a render, so a scroll does not
   * re-render the rows. A pixel of slack, because a fractional scrollTop never
   * quite reaches either end. With no scroller (skeleton, empty state) neither
   * end has rows past it.
   */
  private _measure() {
    const el = this.renderRoot.querySelector<HTMLElement>('.scroller[role="rowgroup"]');
    this.toggleAttribute('more-above', el !== null && el.scrollTop > 1);
    this.toggleAttribute('more-below', el !== null && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }

  protected override updated() {
    const el = this.renderRoot.querySelector('.scroller[role="rowgroup"]');
    if (el !== this._observed) {
      this._resize?.disconnect();
      this._observed = el;
      if (el) this._resize?.observe(el);
    }
    // The rows' total height moves without the scroller's box moving, as when
    // an expanded editor grows. Observing an element twice is a no-op.
    if (el) for (const child of el.children) this._resize?.observe(child);
    this._measure();
  }

  override connectedCallback() {
    super.connectedCallback();
    // A re-attached list was disconnected from its observer; re-run updated().
    if (this.hasUpdated) this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._resize?.disconnect();
    this._observed = null;
  }

  /** The shared ui/empty-state, as the full view's table draws it. */
  private _renderEmpty() {
    return renderEmptyState(this.emptyKind, {
      locationName: this.emptyLocationName,
      onAction: (id: EmptyOffer['id']) => this._emit('empty-action', { id }),
    });
  }

  /**
   * The listed rows, plus the edited row at the top if a refetch dropped it.
   * It stays inside `repeat`'s keyed set, or the open form would be rebuilt and
   * lose what was typed.
   */
  private _rows(): { rows: Item[]; pinnedId: string | null } {
    const id = this.editingItemId;
    const pinned = this.pinnedItem;
    if (id === null || !this.editorTemplate || pinned?.id !== id || this.items.some((it) => it.id === id)) {
      return { rows: this.items, pinnedId: null };
    }
    return { rows: [pinned, ...this.items], pinnedId: id };
  }

  override render() {
    // An open editor outranks the skeleton, which would replace the scroller and the form.
    const editorOpen = Boolean(this.editorTemplate) && (this.addingNew || this.editingItemId !== null);
    if (this.loading && !this.items.length && !editorOpen) {
      return html`<div class="scroller" data-testid="list-skeleton" aria-busy="true">
        ${Array.from(
          { length: SKELETON_ROWS },
          () => html`<div class="skeleton-row">
            <div class="bar" style="width: 55%"></div>
            <div class="bar short" style="width: 38%"></div>
          </div>`,
        )}
      </div>`;
    }

    const newEditor = this.addingNew && this.editorTemplate ? this.editorTemplate(null) : null;
    const { rows, pinnedId } = this._rows();
    if (!rows.length && !newEditor) return this._renderEmpty();

    return html`
      ${this.loading ? html`<div class="refreshing" data-testid="list-refreshing"></div>` : null}
      <div
        class="scroller"
        role="rowgroup"
        data-testid="list-rows"
        aria-busy=${this.loading ? 'true' : 'false'}
        @scroll=${this._onScroll}
      >
        ${newEditor}
        ${repeat(
          rows,
          (it) => it.id,
          (it) =>
            this.editingItemId === it.id && this.editorTemplate
              ? // The expander's header names the item, so the row stands down.
                html`${
                  it.id === pinnedId
                    ? html`<p class="pinned-hint" data-testid="pinned-editor-hint">
                      ${t('hv.list.noLongerMatches')}
                    </p>`
                    : nothing
                }${this.editorTemplate(it.id)}`
              : html`<hv-list-row
                  .statuses=${this.statuses}
                  .item=${it}
                  .areas=${this.areas}
                  .media=${this.media}
                  ?mobile=${this.mobile}
                ></hv-list-row>`,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-list': HVList;
  }
}
