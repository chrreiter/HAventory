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
 * What a row of items is made of, on the card's own `hv-list-row` and on the
 * full view's `hv-data-table`.
 *
 * Both answer the same questions about an item — what it is called, what it is
 * flagged with, what can be done to it — and have to answer them identically:
 * one tile for a picture and one mark for a picture whose file is gone, one
 * order for the low / status / loan chips, one set of keys, one ⋮ list.
 *
 * What each surface asks for stays a parameter: the test ids, because the
 * browser harnesses locate `row-*` and `table-*` separately and one renderer is
 * what keeps them byte-identical; which chips it has room for; and whether an
 * overdue loan spells its date. The quantity stepper, the inspection chip, the
 * tags cell and the card row's phone line stay with their surfaces — those are
 * the parts that genuinely differ.
 */

/** True when an item is at or under its low-stock threshold. */
export function isLowStock(item: Item): boolean {
  return typeof item.low_stock_threshold === 'number' && item.quantity <= item.low_stock_threshold;
}

/**
 * What a row's ⋮ offers, which depends on whether the item is out and whether
 * it has a due date.
 *
 * One list and one set of ids for both surfaces, so the hosts' existing
 * `row-action` handlers answer either of them.
 */
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
 * The tile a row leads with, at one size on every surface that draws one.
 *
 * A fixed box, so a portrait photo and a landscape one leave the row the same
 * height and a list keeps a single rhythm; and drawn only where there is a
 * picture, so a mostly photo-less inventory does not grow a column of empty
 * squares. The table reserves exactly this much inside its name column — what
 * the tile costs the name there, and why the column's floor does not grow to
 * cover it, is on `NAME_COLUMN_SIZE`.
 *
 * Usage: `static styles = [tokens, base, chip, rowChrome, css\`...\`]`. A
 * surface that draws the tile at another size overrides the box on its own
 * rule.
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
  /* The tile of a picture whose file the backend no longer has. It keeps the
     box, because a restore without the media directory leaves every row in this
     state and a list that dropped them all would reflow entirely. The glyph says
     a picture belongs here; the title and the label say why it is not being
     shown. */
  .thumb.missing {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    border: 1px dashed var(--hv-divider);
    color: var(--hv-text-tertiary);
  }
  /* Between the failure and the probe's answer. Hidden rather than removed:
     what an errored <img> draws is the browser's broken-image glyph with the alt
     text spilling out of a 34px square, which is the whole thing this state
     exists to keep off the row. */
  .thumb.broken {
    visibility: hidden;
  }
`;

/**
 * A row's leading thumbnail: the item's first picture, or nothing.
 *
 * Asks for the `thumb` variant, so the tile costs a few KB rather than the
 * whole stored file; the backend serves the original whenever it cannot make
 * one, so this never decides whether the picture appears. `loading="lazy"` and
 * `decoding="async"` still matter — a long list would otherwise fetch and decode
 * everything at once.
 *
 * A file the backend no longer has is answered from the failure rather than
 * probed for up front — see `PictureFallback`.
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

/**
 * The four actions a row answers to, and every spelling each arrives under —
 * `=` is what an unshifted `+` reports on a US layout, `Add` and `Subtract` are
 * the numpad's.
 */
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
 * What a keypress on a row means, or null when the row has nothing to do with
 * it.
 *
 * Rows carry `tabindex="0"` so the keyboard can reach them; without these there
 * is nothing to do once one is reached, and every item on the surface is behind
 * a mouse.
 *
 * A key pressed on a control inside the row belongs to that control: Enter on
 * Edit opens the editor, and an open ⋮ menu holds the keyboard. One that is
 * answered is claimed, so the surface underneath does not act on it too;
 * anything else is left to the browser, or Tab stops leaving the row.
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
  /**
   * Whether the low chip is on offer. A surface with one narrow cell for name
   * and chips together drops it in favour of the loan, which is the more
   * interrupting of the two.
   */
  lowChip?: boolean;
  /**
   * Whether the flagged-status chip is on offer. A surface already showing the
   * status in a column of its own says it once.
   */
  statusChip?: boolean;
  /**
   * What an overdue loan is called: `overdueOn` spells the date into the chip,
   * `overdue` leaves it to the column that carries it.
   */
  overdueText: 'overdue' | 'overdueOn';
}

/**
 * The chips that qualify an item's name: low stock, a flagged status, and who
 * has the item — in that order, on both surfaces.
 *
 * Each is drawn when the item earns it and the surface has room for it. The
 * order is the order the facts interrupt in, so a row carrying several of them
 * reads the same way wherever it is browsed.
 */
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
