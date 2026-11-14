/**
 * Every custom event the card's elements send, by element tag and event name, with the
 * detail each one carries.
 *
 * An element's entry lists what a listener bound on that element hears: its own events, and
 * the ones a nested element sends that it lets bubble out on purpose (`save` from the form
 * inside `hv-detail-sheet`, the row events from the rows inside `hv-list`). Every event is
 * `bubbles: true, composed: true`, so a nested element's event that is not listed here still
 * crosses the host unless a listener inside stops it.
 *
 * `cancel`, `change`, `select` and `close` are native event names too. A native one does not
 * reach these listeners: it is not composed, so it stops at the shadow root of the control
 * that fired it, and no `hv-*` element has a native control in its light DOM. `cancel` and
 * `close` have no native source here at all, because the card renders no `<dialog>`. A
 * listener for one of these names bound on a plain element, rather than on the `hv-*`
 * element that sends it, would hear a native control inside that element too.
 */
import type { HAventoryCardConfig } from './haventory-card-editor';
import type { FilterChipKey } from './components/hv-filter-chips';
import type { BulkRunDetail } from './components/hv-bulk-bar';
import type { OrganizeTab } from './components/hv-organize-dialog';
import type { EmptyOffer } from './ui/empty-state';
import type { ColumnKey } from './store/columns';
import type { ItemFormModel } from './ui/item-form';
import type { ImportPolicy, ItemCreate, ItemUpdate, LocationTreeNode, Sort, StoreFilters } from './store/types';

/** No detail: the element sends `detail: null`. */
type None = null;

/** A row, table or read-sheet event about one item. `action` and `anchor` ride on `row-action`. */
export interface RowEventDetail {
  itemId: string;
  action?: string;
  anchor?: DOMRect;
}

/** The row-level events a list row, a table row and the read sheet share. */
interface RowEvents {
  increment: RowEventDetail;
  decrement: RowEventDetail;
  'check-in': RowEventDetail;
  'request-delete': RowEventDetail;
  edit: RowEventDetail;
  'open-item': RowEventDetail;
  'row-action': RowEventDetail;
}

export interface DueDateDetail {
  itemId: string;
  dueDate: string | null;
}

/** The popover also runs with no item: for a bulk check-out, and in a form for an item not created yet. */
export interface CheckoutDetail {
  itemId: string | null;
  dueDate: string | null;
}

/** A pick in the location tree; clearing the pick sends both as `null`. */
export type LocationSelectDetail =
  { locationId: string; node: LocationTreeNode } | { locationId: null; node: null };

export interface LocationRowDetail {
  locationId: string;
  node: LocationTreeNode;
}

export interface SaveDetail {
  itemId: string | null;
  expectedVersion?: number;
  changes?: ItemUpdate;
  create?: ItemCreate;
}

export interface ImportDetail {
  document: unknown;
  policy: ImportPolicy;
}

/** A ⋮ entry or a toolbar button handed to the host's surfaces. */
export interface MenuActionDetail {
  id: string;
  tab?: OrganizeTab;
}

export interface HvEventMap {
  'haventory-card-editor': {
    /** Home Assistant's card-editor event; its name and shape are HA's. */
    'config-changed': { config: HAventoryCardConfig };
  };
  'hv-bottom-sheet': { cancel: None };
  'hv-bulk-bar': {
    run: BulkRunDetail;
    'cancel-run': None;
    'dismiss-result': None;
    'retry-failed': None;
  };
  'hv-checkout-popover': {
    'check-out': CheckoutDetail;
    'set-due-date': CheckoutDetail;
    cancel: None;
  };
  'hv-chip-input': { change: { values: string[] } };
  'hv-column-picker': {
    change: { columns: ColumnKey[] };
    cancel: None;
  };
  'hv-confirm': { confirm: None; cancel: None };
  'hv-data-table': Omit<RowEvents, 'check-in'> & {
    'near-end': { ratio: number };
    'sort-change': { sort: Sort };
    'toggle-select': { itemId: string };
    'select-all-loaded': None;
    'clear-selection': None;
  };
  'hv-detail-sheet': Pick<RowEvents, 'increment' | 'decrement' | 'check-in' | 'request-delete'> & {
    'reminder-bump': RowEventDetail;
    'check-out-confirmed': DueDateDetail;
    'set-due-date': DueDateDetail;
    /** From the form inside the sheet. */
    save: SaveDetail;
    cancel: None;
  };
  'hv-diagnostics-panel': { refresh: None; cancel: None };
  /** The item editor's attachments; focus lost to a surface that closed is the editor's to catch. */
  'hv-editor-attachments': { 'focus-stranded': None };
  /** The item editor's own fields, each sending the slice of the form it changed. */
  'hv-editor-category': { change: Partial<ItemFormModel> };
  'hv-editor-location': { change: Partial<ItemFormModel> };
  'hv-filter-chips': {
    'remove-filter': { key: FilterChipKey; patch: Partial<StoreFilters> };
    'clear-filters': None;
  };
  'hv-filter-panel': {
    /** A desktop edit, applied at once. */
    change: Partial<StoreFilters>;
    /** A phone edit, staged until Apply. */
    stage: { filters: StoreFilters };
    apply: StoreFilters;
    'clear-filters': None;
  };
  'hv-full-view': {
    close: None;
    'menu-action': MenuActionDetail;
    /** Its own delete hook, and the table's Delete key. */
    'request-delete': { itemId: string; name?: string };
  };
  'hv-import-sheet': {
    preview: ImportDetail;
    execute: ImportDetail;
    'invalidate-preview': None;
    cancel: None;
  };
  'hv-item-editor': {
    save: SaveDetail;
    cancel: None;
    'delete-item': { itemId: string; name: string };
  };
  'hv-lightbox': { close: None };
  /** Its own two, and the row events of the rows inside it. */
  'hv-list': RowEvents & {
    'near-end': { ratio: number };
    'empty-action': { id: EmptyOffer['id'] };
  };
  'hv-list-row': RowEvents;
  'hv-location-tree': {
    select: LocationSelectDetail;
    'select-area': { areaId: string };
    'select-orphans': None;
    'more-location': LocationRowDetail;
    'edit-location': LocationRowDetail;
    'merge-location': LocationRowDetail;
    'delete-location': LocationRowDetail;
    'create-location': { name: string };
  };
  'hv-organize-dialog': { cancel: None; browse: None };
  'hv-overflow-menu': { select: { id: string } };
}

export type HvTag = keyof HvEventMap;
export type HvEventName<T extends HvTag> = keyof HvEventMap[T] & string;
export type HvDetail<T extends HvTag, N extends HvEventName<T>> = HvEventMap[T][N];

/** The event a listener bound on `<T>` receives for `N`; annotate the handler's parameter with it. */
export type HvEvent<T extends HvTag, N extends HvEventName<T>> = CustomEvent<HvDetail<T, N>>;

/** An event with no detail is sent without one; every other event must carry its declared detail. */
type DetailArgs<D> = [D] extends [None] ? [] : [detail: D];

/** The element class registered for `T`, which ties a component's tag to its own class. */
type HostOf<T extends HvTag> = T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : HTMLElement;

/** Sends `T`'s declared events from `host`, each bubbling and composed. */
export type Emitter<T extends HvTag> = <N extends HvEventName<T>>(
  name: N,
  ...detail: DetailArgs<HvDetail<T, N>>
) => boolean;

/**
 * The one way a component sends a custom event, bound once to its own tag:
 * `private readonly _send = emitter<'hv-confirm'>(this);` then `this._send('cancel')`.
 */
export function emitter<T extends HvTag>(host: HostOf<T>): Emitter<T> {
  return (name, ...detail) =>
    host.dispatchEvent(new CustomEvent(name, { detail: detail[0] ?? null, bubbles: true, composed: true }));
}
