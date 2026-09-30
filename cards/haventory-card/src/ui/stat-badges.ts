import { html } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { counted } from './plural';
import { quickFilterAllowed } from './quick-filters';
import type { QuickFilterKey } from './quick-filters';
import type { StatsCounts, StoreFilters } from '../store/types';

/**
 * The five counts as pressable filters, for the card's header badges and the
 * expanded view's pills alike; each surface passes its own test-id prefix.
 */

/** The hue a pill carries; what each one means is `ui/chip`'s vocabulary. */
export type BadgeTone = 'warning' | 'error' | 'state';

type BadgeFilter =
  | 'lowStockOnly'
  | 'overdueOnly'
  | 'inspectionDueOnly'
  | 'reminderDueOnly'
  | 'checkedOutOnly';

interface BadgeSpec {
  /** The dashboard's name for this pill, which decides whether it is on offer. */
  quick: QuickFilterKey;
  /** Test-id suffix, after the surface's own prefix. */
  id: string;
  tone: BadgeTone;
  filter: BadgeFilter;
  count: (counts: StatsCounts) => number;
  label: TranslationKey;
  title: TranslationKey;
}

/** The five, in drawing order. */
const BADGES: readonly BadgeSpec[] = [
  {
    quick: 'low_stock',
    id: 'low',
    tone: 'warning',
    filter: 'lowStockOnly',
    count: (counts) => counts.low_stock_count,
    label: 'hv.card.badge.low',
    title: 'hv.card.badge.lowTitle',
  },
  {
    quick: 'overdue',
    id: 'overdue',
    tone: 'error',
    filter: 'overdueOnly',
    count: (counts) => counts.overdue_count ?? 0,
    label: 'hv.card.badge.overdue',
    title: 'hv.card.badge.overdueTitle',
  },
  {
    quick: 'inspection_due',
    id: 'inspection',
    tone: 'warning',
    filter: 'inspectionDueOnly',
    count: (counts) => counts.inspection_due_count ?? 0,
    label: 'hv.card.badge.inspection',
    title: 'hv.card.badge.inspectionTitle',
  },
  {
    quick: 'reminder_due',
    id: 'reminder',
    tone: 'warning',
    filter: 'reminderDueOnly',
    count: (counts) => counts.reminder_due_count ?? 0,
    label: 'hv.card.badge.reminder',
    title: 'hv.card.badge.reminderTitle',
  },
  {
    quick: 'checked_out',
    id: 'out',
    tone: 'state',
    filter: 'checkedOutOnly',
    count: (counts) => counts.checked_out_count,
    label: 'hv.card.badge.checkedOut',
    title: 'hv.card.badge.checkedOutTitle',
  },
];

/** How a surface names and dresses its pills. */
export interface StatBadgeOptions {
  /** `badge` on the card, `full-badge` in the expanded view. */
  prefix: string;
  /** The chip classes a pill of that hue wears, after `hv-chip`. */
  chipClass: (tone: BadgeTone) => string;
  /** Draw the inventory total as a quiet, non-filtering chip in these classes. */
  total?: string;
  setFilters: (patch: Partial<StoreFilters>) => void;
}

/** What the badges read out of the store; a whole `StoreState` satisfies it. */
export interface StatBadgeState {
  statsCounts: StatsCounts | null;
  filters: StoreFilters;
}

/** What a surface has to draw, once the counts and the config have had a say. */
export interface StatBadges {
  /** The total chip, when this surface asked for one and the config allows it. */
  total: TemplateResult | null;
  /** The five, in order, with a null wherever there is nothing to say. */
  pills: (TemplateResult | null)[];
  /** True when any pill has something to say — an empty row is still a band. */
  any: boolean;
}

/** The pills the config allows and whose count is above zero; null before any counts. */
export function renderStatBadges(
  st: StatBadgeState | null,
  quickFilters: QuickFilterKey[] | null,
  opts: StatBadgeOptions,
): StatBadges | null {
  if (!st?.statsCounts) return null;
  const counts = st.statsCounts;
  const filters = st.filters;

  const pills = BADGES.map((spec) => {
    const count = spec.count(counts);
    if (!quickFilterAllowed(quickFilters, spec.quick) || count <= 0) return null;
    const on = filters[spec.filter];
    return html`<button
      class="hv-chip ${opts.chipClass(spec.tone)} ${on ? 'on' : ''}"
      data-testid=${`${opts.prefix}-${spec.id}`}
      aria-pressed=${String(on)}
      title=${t(spec.title)}
      @click=${() => opts.setFilters({ [spec.filter]: !on } as Partial<StoreFilters>)}
    >
      ${t(spec.label, { count })}
    </button>`;
  });

  const total =
    opts.total && quickFilterAllowed(quickFilters, 'total')
      ? html`<span class="hv-chip ${opts.total}" data-testid=${`${opts.prefix}-total`}
          >${counted(counts.items_total, 'item')}</span
        >`
      : null;

  return { total, pills, any: pills.some((pill) => pill !== null) };
}
