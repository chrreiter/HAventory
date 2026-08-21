import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import type { StoreFilters } from '../store/types';

/**
 * The ways a list of items can have no rows, and what to say about each.
 *
 * The card's list said it properly — a headline, a line of explanation and
 * something to press ("No items match these filters" + Clear all). The expanded
 * view's table, reached from the same card and holding the same items, answered
 * with one bare sentence and no way out: "No items match these filters." with a
 * full stop and nothing to click. That is the surface with a sidebar, an app-bar
 * search and a filter panel — the one where you are most likely to filter
 * yourself down to nothing and least able to see which control did it.
 *
 * Both now render from here, so the wording cannot drift again.
 *
 * The card's punctuation convention, of which this is the busiest example:
 * headlines, hints and short empty lines are captions and take no terminal full
 * stop; a detail line or a prose note is written as sentences and punctuated as
 * such.
 */
export type EmptyKind = 'loading' | 'no-items' | 'no-matches' | 'empty-location' | 'connection-lost';

/** An action offered from an empty list; the first is drawn as primary. */
export interface EmptyOffer {
  id: 'clear-filters' | 'add-item' | 'import' | 'refresh';
  label: string;
}

/**
 * Which situation a list with no rows is in.
 *
 * An outage outranks everything else: clearing a filter would not bring the
 * rows back, and a request that cannot be sent is not in flight.
 *
 * An in-flight fetch outranks both filter-derived reasons, because changing a
 * filter empties the list on purpose and refills it when the answer arrives —
 * naming the filters as the reason during that gap accuses a filter of
 * matching nothing before anything has been counted.
 *
 * A lone location filter is "nothing filed here" rather than "nothing
 * matched", because the location is the thing the user chose and the offer
 * differs.
 *
 * Lives here rather than on the components so the card's list and the expanded
 * view's table cannot answer the same situation two different ways.
 */
export function emptyKindFor(state: {
  degraded: { connectionLost: boolean };
  filters: StoreFilters;
  loading: boolean;
} | null | undefined): EmptyKind {
  if (state?.degraded.connectionLost) return 'connection-lost';
  if (state?.loading) return 'loading';
  const filters = state?.filters ?? defaultFilters();
  if (soleLocationId(filters) && activeFilterCount(filters) === 1) return 'empty-location';
  if (activeFilterCount(filters) > 0) return 'no-matches';
  return 'no-items';
}

export interface EmptyStateCopy {
  headline: string;
  detail?: string;
  offers: EmptyOffer[];
}

export function emptyStateCopy(kind: EmptyKind, locationName?: string | null): EmptyStateCopy {
  switch (kind) {
    // The one kind with nothing to offer: the rows are on their way, and every
    // action the other kinds offer would be an answer to a question that has
    // not been asked yet.
    case 'loading':
      return { headline: t('hv.empty.loading.headline'), offers: [] };
    case 'connection-lost':
      return {
        headline: t('hv.empty.connectionLost.headline'),
        detail: t('hv.empty.connectionLost.detail'),
        offers: [{ id: 'refresh', label: t('hv.action.retry') }],
      };
    case 'no-matches':
      return {
        headline: t('hv.empty.noMatches.headline'),
        offers: [{ id: 'clear-filters', label: t('hv.empty.noMatches.clearAction') }],
      };
    case 'empty-location':
      return {
        headline: locationName
          ? t('hv.empty.emptyLocation.headline', { location: locationName })
          : t('hv.empty.emptyLocation.headlineUnnamed'),
        offers: [
          { id: 'add-item', label: t('hv.empty.emptyLocation.addAction') },
          { id: 'clear-filters', label: t('hv.empty.emptyLocation.clearAction') },
        ],
      };
    default:
      return {
        headline: t('hv.empty.noItems.headline'),
        detail: t('hv.empty.noItems.detail'),
        offers: [
          { id: 'add-item', label: t('hv.empty.noItems.addAction') },
          { id: 'import', label: t('hv.empty.noItems.importAction') },
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
    ${copy.offers.length
      ? html`<div class="offers">
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
        </div>`
      : null}
  </div>`;
}
