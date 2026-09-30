import { css, html, unsafeCSS } from 'lit';
import type { TemplateResult } from 'lit';
import { t } from '../i18n';
import { icon } from './icons';
import { formatDate, isOverdue } from './relative-time';
import { DEFAULT_STATUS, itemStatus, renderStatusChip } from './status';
import {
  MEDIA_VARIANT_THUMB,
  ROW_THUMB_SIZE,
  attachmentNameToken,
  pictureAlt,
  pictures,
} from './media';
import type { MediaUrls, PictureFallback } from './media';
import type { Item, StatusDefinition } from '../store/types';
import type { OverflowMenuEntry } from '../components/hv-overflow-menu';

/**
 * What a row of items is made of, shared by `hv-list-row` and `hv-data-table`:
 * the picture tile, the name chips, the keys and the ⋮ list. Test ids and which
 * chips fit stay parameters.
 */

/** True when an item is at or under its low-stock threshold. */
export function isLowStock(item: Item): boolean {
  return typeof item.low_stock_threshold === 'number' && item.quantity <= item.low_stock_threshold;
}

/** What a row's ⋮ offers, with one set of ids on both surfaces. */
export function rowMenuEntries(item: Item): OverflowMenuEntry[] {
  if (item.checked_out) {
    return [
      { id: 'check-in', label: t('hv.action.checkIn'), glyph: 'account' },
      {
        id: 'set-due-date',
        label: item.due_date ? t('hv.row.menu.changeDueDate') : t('hv.row.menu.setDueDate'),
        glyph: 'calendar',
      },
      { divider: true },
      { id: 'delete', label: t('hv.action.deleteItem'), glyph: 'del' },
    ];
  }
  return [
    { id: 'check-out', label: t('hv.action.checkOutEllipsis'), glyph: 'account' },
    { id: 'edit', label: t('hv.action.edit'), glyph: 'pencil' },
    { divider: true },
    { id: 'delete', label: t('hv.action.deleteItem'), glyph: 'del' },
  ];
}

/**
 * The row's leading tile: a fixed box, so every row keeps one height, drawn only
 * where there is a picture. Its cost to the table's name column is on
 * `NAME_COLUMN_SIZE`.
 *
 * Usage: `static styles = [tokens, base, chip, rowChrome, css\`...\`]`.
 */
export const rowChrome = css`
  .thumb {
    flex: none;
    width: ${unsafeCSS(ROW_THUMB_SIZE)}px;
    height: ${unsafeCSS(ROW_THUMB_SIZE)}px;
    border-radius: 6px;
    object-fit: cover;
    background: var(--hv-surface-raised);
  }
  /* A missing file keeps the box, so a restore without media does not reflow the list. */
  .thumb.missing {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    border: 1px dashed var(--hv-divider);
    color: var(--hv-text-tertiary);
  }
  /* Until the probe answers, hide the browser's broken-image glyph and alt text. */
  .thumb.broken {
    visibility: hidden;
  }
`;

/**
 * A row's leading thumbnail, the `thumb` variant of the first picture (the
 * backend falls back to the original). A missing file is detected from the
 * failure; see `PictureFallback`.
 */
export function renderRowThumb(
  item: Item,
  urls: MediaUrls,
  thumbs: PictureFallback,
): TemplateResult | null {
  const first = pictures(item.attachments)[0];
  if (!first) return null;
  const state = thumbs.state(item.id, first.id);
  if (state === 'missing') {
    return html`<span
      class="thumb missing"
      data-testid="row-thumb-missing"
      role="img"
      aria-label=${t('hv.term.fileMissing')}
      title=${t('hv.term.fileMissing')}
      >${icon('camera', 18)}</span
    >`;
  }
  const src = urls.get(item.id, first.id, attachmentNameToken(first), MEDIA_VARIANT_THUMB);
  if (!src) return null;
  return html`<img
    class=${state === 'errored' ? 'thumb broken' : 'thumb'}
    data-testid="row-thumb"
    src=${src}
    alt=${pictureAlt(item.name, 0, 1)}
    loading="lazy"
    decoding="async"
    @error=${() => thumbs.noteError(item.id, first.id)}
    @load=${() => thumbs.noteLoad(item.id, first.id)}
  />`;
}

/** What a row does with a key, named as the event the surface emits for it. */
export type RowKeyAction = 'open-item' | 'request-delete' | 'increment' | 'decrement';

/** `=` is an unshifted `+` on a US layout; `Add` and `Subtract` are the numpad's. */
const ROW_KEYS = new Map<string, RowKeyAction>([
  ['Enter', 'open-item'],
  ['Delete', 'request-delete'],
  ['+', 'increment'],
  ['=', 'increment'],
  ['Add', 'increment'],
  ['-', 'decrement'],
  ['Subtract', 'decrement'],
]);

/**
 * What a keypress on the row itself means, or null. A key on a control inside
 * the row is that control's; an answered key is claimed, anything else left alone.
 */
export function rowKeyAction(e: KeyboardEvent): RowKeyAction | null {
  if (e.target !== e.currentTarget) return null;
  const action = ROW_KEYS.get(e.key);
  if (!action) return null;
  e.preventDefault();
  return action;
}

/** How a surface names and gates the chips beside an item's name. */
export interface NameChipOptions {
  /** Test-id prefix: `row` on the card's list, `table` in the full view. */
  prefix: string;
  lowChip?: boolean;
  /** Off where the status has a column of its own. */
  statusChip?: boolean;
  /** `overdueOn` spells the date into the chip; `overdue` leaves it to a column. */
  overdueText: 'overdue' | 'overdueOn';
}

/** The chips that qualify an item's name, in one order: low stock, status, loan. */
export function renderNameChips(
  item: Item,
  statuses: readonly StatusDefinition[] | null | undefined,
  opts: NameChipOptions,
): TemplateResult {
  const status = itemStatus(item);
  const overdue = isOverdue(item.due_date);
  return html`${opts.lowChip !== false && isLowStock(item)
    ? html`<span
        class="hv-chip warning"
        data-testid=${`${opts.prefix}-low`}
        aria-label=${t('hv.term.lowStock')}
        >${t('hv.term.low')}</span
      >`
    : null}${opts.statusChip !== false && status !== DEFAULT_STATUS
    ? renderStatusChip(status, statuses, { testid: `${opts.prefix}-status` })
    : null}${item.checked_out
    ? html`<span
        class="hv-chip ${overdue ? 'error' : 'state'}"
        data-testid=${`${opts.prefix}-checked-out`}
        >${overdue
          ? opts.overdueText === 'overdueOn'
            ? t('hv.term.overdueOn', { date: formatDate(item.due_date) })
            : t('hv.term.overdue')
          : t('hv.term.checkedOut')}</span
      >`
    : null}`;
}
