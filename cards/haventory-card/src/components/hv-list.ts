import { t } from '../i18n';
import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../ui/tokens';
import { renderEmptyState } from '../ui/empty-state';
import type { EmptyKind, EmptyOffer } from '../ui/empty-state';
import type { AreaRef, Item, StatusDefinition } from '../store/types';
import type { MediaBindings } from '../ui/media';
import './hv-list-row';

/**
 * Placeholder rows drawn while the first page is in flight. Enough to fill the
 * scroller's default cap, so the list does not visibly grow when the real rows
 * land.
 */
const SKELETON_ROWS = 5;

/**
 * The standard card's list: skeletons while loading, a named empty state, rows,
 * and the near-end signal that drives infinite scroll.
 *
 * The empty state is deliberately specific — "no items yet", "nothing matched
 * these filters" and "nothing in this location" want different offers, and the
 * design calls for all three.
 */
@customElement('hv-list')
export class HVList extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        position: relative;
      }
      .scroller {
        overflow-y: auto;
        overscroll-behavior: contain;
        max-height: var(--hv-list-max-height, 420px);
      }
      /*
       * A refetch keeps the rows it already has, so the only thing left to say
       * is that fresher ones are on the way. Absolutely positioned over the
       * list's top edge: a bar in the flow would move every row by two pixels
       * on each keystroke in the search box.
       */
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
      /*
       * The row being edited can stop matching the filter the user just changed.
       * Pinning it keeps typed edits alive; the hint is what stops the pin from
       * reading as a list that failed to filter.
       */
      .pinned-hint {
        margin: 0;
        padding: 6px 16px;
        font-size: 12px;
        color: var(--hv-text-secondary);
        border-top: 1px solid var(--hv-row-divider);
      }
      /*
       * The inline editor renders inside this same scroller and is roughly
       * 720px tall, so the compact cap buried its Save/Cancel row and the
       * custom-fields group. While an editor is open the card grows to fit the
       * form — as the design shows — but stays bounded so a long row list
       * cannot run away with the page.
       */
      :host([editing]) .scroller {
        max-height: var(--hv-list-editing-max-height, min(80dvh, 760px));
      }
      .empty {
        display: grid;
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
  /**
   * Inline editing: the host supplies a template and says which row it belongs
   * to. Passing a callback rather than editor props keeps this component from
   * needing to know anything about the edit form.
   */
  @property({ attribute: false }) editorTemplate: ((itemId: string | null) => unknown) | null = null;
  /**
   * Opaque token the host changes when the template would draw something new.
   *
   * The template is a stable callback, so Lit re-runs it only when one of this
   * component's *own* reactive properties changes — and the form it returns
   * reads host state that has nothing to do with a list of rows. Carrying the
   * signal as a value nothing here reads is what keeps that ignorance intact:
   * the host decides what counts as a change, this component only redraws.
   */
  @property({ attribute: false }) editorEpoch: unknown = 0;
  /** Row currently expanded into the editor; its own row is hidden while it is. */
  @property({ type: String }) editingItemId: string | null = null;
  /**
   * The host's copy of the row being edited, so the open form can outlive a
   * refetch that stops listing it — see `_rows`.
   */
  @property({ attribute: false }) pinnedItem: Item | null = null;
  /** Pin an empty editor at the top of the list ("Add item"). */
  @property({ type: Boolean }) addingNew = false;
  /** Reflected so the stylesheet can give the open editor more room. */
  @property({ type: Boolean, reflect: true }) editing = false;

  protected willUpdate(changed: PropertyValues) {
    if (changed.has('editingItemId') || changed.has('addingNew') || changed.has('editorTemplate')) {
      this.editing = Boolean(this.editorTemplate) && (this.addingNew || this.editingItemId !== null);
    }
  }

  private _onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement;
    const ratio = (el.scrollTop + el.clientHeight) / Math.max(1, el.scrollHeight);
    this.dispatchEvent(new CustomEvent('near-end', { detail: { ratio }, bubbles: true, composed: true }));
  };

  /**
   * The wording and the offered actions come from ui/empty-state, so this list
   * and the expanded view's table cannot describe the same situation two
   * different ways. Only the CSS is local — style rules do not cross a shadow
   * boundary.
   */
  private _renderEmpty() {
    return renderEmptyState(this.emptyKind, {
      locationName: this.emptyLocationName,
      onAction: (id: EmptyOffer['id']) =>
        this.dispatchEvent(new CustomEvent('empty-action', { detail: { id }, bubbles: true, composed: true })),
    });
  }

  /**
   * The rows to draw: the listed ones, plus the edited row if it has fallen off
   * the page.
   *
   * Changing a filter refetches, and the row being edited can legitimately drop
   * out of the result. It is put back at the top rather than rendered beside the
   * list, because `repeat` only carries a DOM node across renders while its key
   * stays in the same keyed set — moving the open form out of it would rebuild
   * the element and discard everything typed into it, which is the whole bug.
   */
  private _rows(): { rows: Item[]; pinnedId: string | null } {
    const id = this.editingItemId;
    const pinned = this.pinnedItem;
    if (id === null || !this.editorTemplate || pinned?.id !== id) return { rows: this.items, pinnedId: null };
    if (this.items.some((it) => it.id === id)) return { rows: this.items, pinnedId: null };
    return { rows: [pinned, ...this.items], pinnedId: id };
  }

  render() {
    // An open editor outranks the skeleton: replacing the scroller is what
    // discards the form, and a filter that currently matches nothing is exactly
    // when the pinned row has to survive.
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
              ? // The expander carries the item's name in its own header, so
                // showing the collapsed row as well would just be a duplicate.
                html`${it.id === pinnedId
                  ? html`<p class="pinned-hint" data-testid="pinned-editor-hint">
                      ${t('hv.list.noLongerMatches')}
                    </p>`
                  : nothing}${this.editorTemplate(it.id)}`
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
