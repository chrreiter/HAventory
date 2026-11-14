import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Attachment,
  BackendUnavailableEventPayload,
  BulkOpError,
  Item,
  ItemCreate,
  ItemFilter,
  ItemUpdate,
  ItemsEventPayload,
  Location,
  LocationPath,
  LocationTreeNode,
  LocationsEventPayload,
  ReminderInterval,
  ServerError,
  Sort,
  SortField,
  SortOrder,
  StatsCounts,
  StatsEventPayload,
  StatusDefinition,
  StatusesEventPayload,
} from './types';

/**
 * The interfaces in `types.ts` against the keys the backend actually sends.
 *
 * `tests/test_wire_shapes_offline.py` drives the real commands and serializers
 * and writes what they sent to `tests/fixtures/wire_shapes.json`: per output
 * shape, the keys in every sample (`required`) and those in only some
 * (`optional`); per input shape, the keys of the `TypedDict` the backend
 * validates against. That test fails when the file is out of date, and this
 * one fails when `types.ts` disagrees with it. Each spec below is tied to its
 * interface by the compiler, so neither side can move without the gate saying
 * which field.
 */

const PINNED = JSON.parse(
  readFileSync(join(__dirname, '../../../../tests/fixtures/wire_shapes.json'), 'utf8'),
) as {
  outputs: Record<string, { required: string[]; optional: string[] }>;
  inputs: Record<string, string[]>;
  values: Record<string, string[]>;
};

type Presence = 'required' | 'optional';
type PresenceOf<T, K extends keyof T> = Record<never, never> extends Pick<T, K> ? 'optional' : 'required';
/** Every key of `T`, each marked the way `T` declares it; `satisfies` refuses a missing or extra key. */
type KeySpec<T> = { [K in keyof T]-?: PresenceOf<T, K> };
/** Every key of `T`, for an input shape, where only the key set is compared. */
type KeySet<T> = { [K in keyof T]-?: true };

/** A list of every member of a string union, and nothing else. */
function everyOf<T extends string>() {
  return <const A extends readonly T[]>(
    values: A & ([Exclude<T, A[number]>] extends [never] ? unknown : { missing: Exclude<T, A[number]> }),
  ): readonly string[] => values;
}

const LOCATION_PATH = {
  id_path: 'required',
  name_path: 'required',
  display_path: 'required',
  sort_key: 'required',
} satisfies KeySpec<LocationPath>;

const EVENT_BASE = {
  domain: 'required',
  topic: 'required',
  action: 'required',
  ts: 'required',
} as const;

const OUTPUTS: Record<string, Record<string, Presence>> = {
  Item: {
    id: 'required',
    name: 'required',
    description: 'required',
    quantity: 'required',
    status: 'required',
    checked_out: 'required',
    due_date: 'required',
    inspection_date: 'required',
    reminder_date: 'required',
    reminder_anchor: 'required',
    reminder_interval: 'required',
    location_id: 'required',
    tags: 'required',
    category: 'required',
    low_stock_threshold: 'required',
    custom_fields: 'required',
    created_at: 'required',
    updated_at: 'required',
    version: 'required',
    effective_area_id: 'required',
    location_path: 'required',
    attachments: 'required',
  } satisfies KeySpec<Item>,
  LocationPath: LOCATION_PATH,
  Attachment: {
    id: 'required',
    kind: 'required',
    filename: 'required',
    mime: 'required',
    size: 'required',
    uploaded_at: 'required',
    title: 'required',
    order: 'required',
  } satisfies KeySpec<Attachment>,
  ReminderInterval: { unit: 'required', count: 'required' } satisfies KeySpec<ReminderInterval>,
  Location: {
    id: 'required',
    parent_id: 'required',
    name: 'required',
    area_id: 'required',
    path: 'required',
  } satisfies KeySpec<Location>,
  LocationTreeNode: {
    id: 'required',
    name: 'required',
    parent_id: 'required',
    area_id: 'required',
    path: 'required',
    direct_item_count: 'required',
    subtree_item_count: 'required',
    matching_direct_count: 'optional',
    matching_subtree_count: 'optional',
    children: 'required',
  } satisfies KeySpec<LocationTreeNode>,
  StatusDefinition: {
    slug: 'required',
    label: 'required',
    order: 'required',
    color: 'required',
    icon: 'required',
  } satisfies KeySpec<StatusDefinition>,
  StatsCounts: {
    items_total: 'required',
    low_stock_count: 'required',
    checked_out_count: 'required',
    overdue_count: 'required',
    checked_out_due_count: 'required',
    inspection_overdue_count: 'required',
    inspection_due_count: 'required',
    reminder_due_count: 'required',
    missing_count: 'optional',
    needs_repair_count: 'optional',
    status_counts: 'required',
    locations_total: 'required',
    no_location_count: 'required',
  } satisfies KeySpec<StatsCounts>,
  ServerError: {
    code: 'required',
    message: 'required',
    data: 'optional',
    translation_domain: 'optional',
    translation_key: 'optional',
    translation_placeholders: 'optional',
  } satisfies KeySpec<ServerError>,
  BulkOpError: {
    code: 'required',
    message: 'required',
    context: 'required',
    translation_domain: 'optional',
    translation_key: 'optional',
    translation_placeholders: 'optional',
  } satisfies KeySpec<BulkOpError>,
  ItemsEventPayload: { ...EVENT_BASE, item: 'optional' } satisfies KeySpec<ItemsEventPayload>,
  LocationsEventPayload: { ...EVENT_BASE, location: 'optional' } satisfies KeySpec<LocationsEventPayload>,
  StatsEventPayload: { ...EVENT_BASE, counts: 'required' } satisfies KeySpec<StatsEventPayload>,
  StatusesEventPayload: {
    ...EVENT_BASE,
    status: 'optional',
    statuses: 'optional',
  } satisfies KeySpec<StatusesEventPayload>,
  BackendUnavailableEventPayload: EVENT_BASE satisfies KeySpec<BackendUnavailableEventPayload>,
};

const INPUTS: Record<string, Record<string, true>> = {
  ItemCreate: {
    name: true,
    description: true,
    quantity: true,
    status: true,
    checked_out: true,
    due_date: true,
    inspection_date: true,
    reminder_date: true,
    reminder_interval: true,
    location_id: true,
    tags: true,
    category: true,
    low_stock_threshold: true,
    custom_fields: true,
  } satisfies KeySet<ItemCreate>,
  ItemUpdate: {
    name: true,
    description: true,
    quantity: true,
    status: true,
    checked_out: true,
    due_date: true,
    inspection_date: true,
    reminder_date: true,
    reminder_interval: true,
    location_id: true,
    tags: true,
    category: true,
    low_stock_threshold: true,
    custom_fields_set: true,
    custom_fields_unset: true,
  } satisfies KeySet<ItemUpdate>,
  ItemFilter: {
    q: true,
    tags_any: true,
    tags_all: true,
    category: true,
    categories: true,
    status: true,
    checked_out: true,
    low_stock_only: true,
    low_stock_first: true,
    orphaned_only: true,
    overdue_only: true,
    checked_out_due_only: true,
    inspection_overdue_only: true,
    inspection_due_only: true,
    reminder_due_only: true,
    location_id: true,
    location_ids: true,
    area_id: true,
    include_subtree: true,
    updated_after: true,
    created_after: true,
    updated_before: true,
    created_before: true,
  } satisfies KeySet<ItemFilter>,
  Sort: { field: true, order: true } satisfies KeySet<Sort>,
};

const VALUES: Record<string, readonly string[]> = {
  SortField: everyOf<SortField>()([
    'updated_at',
    'created_at',
    'name',
    'quantity',
    'due_date',
    'inspection_date',
    'reminder_date',
    'location',
  ]),
  SortOrder: everyOf<SortOrder>()(['asc', 'desc']),
};

/**
 * Always sent, typed optional on purpose: whether these two counts stay in the
 * contract at all is undecided, and `status_counts` carries the same numbers.
 */
const KEPT_OPTIONAL: Readonly<Record<string, readonly string[]>> = {
  StatsCounts: ['missing_count', 'needs_repair_count'],
};

function outputDrift(
  shape: string,
  declared: Record<string, Presence>,
  sent: { required: string[]; optional: string[] },
): string[] {
  const problems: string[] = [];
  const presence = new Map<string, Presence>([
    ...sent.required.map((key) => [key, 'required'] as const),
    ...sent.optional.map((key) => [key, 'optional'] as const),
  ]);
  for (const [key, wire] of presence) {
    const typed = declared[key];
    if (typed === undefined)
      problems.push(`${shape}.${key}: the backend sends it, types.ts does not declare it`);
    else if (wire === 'required' && typed === 'optional' && !KEPT_OPTIONAL[shape]?.includes(key))
      problems.push(`${shape}.${key}: always sent, types.ts marks it optional`);
    else if (wire === 'optional' && typed === 'required')
      problems.push(`${shape}.${key}: not always sent, types.ts marks it required`);
  }
  for (const key of Object.keys(declared)) {
    if (!presence.has(key)) problems.push(`${shape}.${key}: types.ts declares it, the backend never sends it`);
  }
  return problems;
}

function setDrift(shape: string, declared: readonly string[], pinned: readonly string[]): string[] {
  return [
    ...pinned.filter((key) => !declared.includes(key)).map((key) => `${shape}.${key}: missing from types.ts`),
    ...declared
      .filter((key) => !pinned.includes(key))
      .map((key) => `${shape}.${key}: the backend does not know it`),
  ];
}

describe('the wire types against what the backend sends', () => {
  it('covers exactly the shapes the backend pins', () => {
    expect(Object.keys(OUTPUTS).sort()).toEqual(Object.keys(PINNED.outputs).sort());
    expect(Object.keys(INPUTS).sort()).toEqual(Object.keys(PINNED.inputs).sort());
    expect(Object.keys(VALUES).sort()).toEqual(Object.keys(PINNED.values).sort());
  });

  it.each(Object.keys(PINNED.outputs))('%s declares every key the backend sends, as it sends it', (shape) => {
    const sent = PINNED.outputs[shape];
    const declared = OUTPUTS[shape];
    if (!sent || !declared) throw new Error(`${shape}: no spec on one side`);
    expect(outputDrift(shape, declared, sent)).toEqual([]);
  });

  it.each(Object.keys(PINNED.inputs))('%s has the keys the backend validates against', (shape) => {
    expect(setDrift(shape, Object.keys(INPUTS[shape] ?? {}), PINNED.inputs[shape] ?? [])).toEqual([]);
  });

  it.each(Object.keys(PINNED.values))('%s has the values the backend accepts', (shape) => {
    expect(setDrift(shape, VALUES[shape] ?? [], PINNED.values[shape] ?? [])).toEqual([]);
  });

  it('names the field when the two sides disagree', () => {
    const declared: Record<string, Presence> = { id: 'required', status: 'optional', gone: 'required' };

    expect(outputDrift('Item', declared, { required: ['id', 'status', 'added'], optional: [] })).toEqual([
      'Item.status: always sent, types.ts marks it optional',
      'Item.added: the backend sends it, types.ts does not declare it',
      'Item.gone: types.ts declares it, the backend never sends it',
    ]);
    expect(outputDrift('Item', declared, { required: [], optional: ['id', 'status', 'gone'] })).toEqual([
      'Item.id: not always sent, types.ts marks it required',
      'Item.gone: not always sent, types.ts marks it required',
    ]);
  });
});
