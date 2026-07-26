import { html } from 'lit';
import type { TemplateResult } from 'lit';

/**
 * The four ways a list of items can be empty, and what to say about each.
 *
 * The card's list said it properly — a headline, a line of explanation and
 * something to press ("No items match these filters" + Clear all). The expanded
 * view's table, reached from the same card and holding the same items, answered
 * with one bare sentence and no way out: "No items match these filters." with a
 * full stop and nothing to click. That is the surface with a sidebar, an app-bar
 * search and a filter panel — the one where you are most likely to filter
 * yourself down to nothing and least able to see which control did it.
 *
 * Both now render from here, so the wording cannot drift again. Convention:
 * the headline is a fragment with no full stop, the detail line is a sentence
 * with one.
 */
export type EmptyKind = 'no-items' | 'no-matches' | 'empty-location' | 'connection-lost';

/** An action offered from an empty list; the first is drawn as primary. */
export interface EmptyOffer {
  id: 'clear-filters' | 'add-item' | 'import' | 'refresh';
  label: string;
}

export interface EmptyStateCopy {
  headline: string;
  detail?: string;
  offers: EmptyOffer[];
}

export function emptyStateCopy(kind: EmptyKind, locationName?: string | null): EmptyStateCopy {
  switch (kind) {
    case 'connection-lost':
      return {
        headline: "Can't reach Home Assistant",
        detail: 'The list will fill in once the connection is back.',
        offers: [{ id: 'refresh', label: 'Try again' }],
      };
    case 'no-matches':
      return {
        headline: 'No items match these filters',
        offers: [{ id: 'clear-filters', label: 'Clear all' }],
      };
    case 'empty-location':
      return {
        headline: `Nothing in ${locationName ?? 'this location'}`,
        offers: [
          { id: 'add-item', label: 'Add item here' },
          { id: 'clear-filters', label: 'Show everything' },
        ],
      };
    default:
      return {
        headline: 'No items yet',
        detail: 'Add your first item, or restore a backup.',
        offers: [
          { id: 'add-item', label: 'Add your first item' },
          { id: 'import', label: 'Import backup' },
        ],
      };
  }
}

/**
 * The block itself. `.empty`, `.headline` and `.offers` are styled by whichever
 * shadow root renders it — the rules cannot be shared across that boundary, but
 * the words and the offered actions can.
 */
export function renderEmptyState(
  kind: EmptyKind,
  opts: { locationName?: string | null; onAction: (id: EmptyOffer['id']) => void },
): TemplateResult {
  const copy = emptyStateCopy(kind, opts.locationName);
  return html`<div class="empty" role="status" data-testid="empty-state" data-kind=${kind}>
    <span class="headline">${copy.headline}</span>
    ${copy.detail ? html`<span>${copy.detail}</span>` : null}
    <div class="offers">
      ${copy.offers.map(
        (offer, i) => html`<button
          class=${i === 0 ? 'hv-pill' : 'hv-pill outline'}
          data-testid="empty-action"
          data-id=${offer.id}
          @click=${() => opts.onAction(offer.id)}
        >
          ${offer.label}
        </button>`,
      )}
    </div>
  </div>`;
}
