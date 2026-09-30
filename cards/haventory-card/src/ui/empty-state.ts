import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import type { StoreFilters } from '../store/types';

/**
 * The ways a list can have no rows, and what to say about each, shared by the
 * card's list and the expanded view's table. Headlines take no full stop;
 * detail lines are sentences.
 */
export type EmptyKind = 'loading' | 'no-items' | 'no-matches' | 'empty-location' | 'connection-lost';

/** An action offered from an empty list; the first is drawn as primary. */
export interface EmptyOffer {
  id: 'clear-filters' | 'add-item' | 'import' | 'refresh';
  label: string;
}

/**
 * Which situation an empty list is in. An outage outranks everything, and an
 * in-flight fetch outranks the filters, which have matched nothing yet. A lone
 * location filter is "nothing filed here", with its own offers.
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
        offers: [{ id: 'clear-filters', label: t('hv.action.clearAll') }],
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
          { id: 'import', label: t('hv.import.title') },
        ],
      };
  }
}

/** The block itself; `.empty`, `.headline` and `.offers` are styled by the host. */
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
