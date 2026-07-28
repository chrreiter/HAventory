## HAventory Data Shapes

Canonical shapes used in WebSocket payloads and storage, derived from `custom_components/haventory/models.py` and repository serializers.

### Scalars

- ScalarValue: string | number | boolean (allowed in `custom_fields` values)

### Item

Object shape for persisted items and API results:
```json
{
  "id": "uuid-v4",
  "name": "string",
  "description": "string|null",
  "quantity": 0,
  "checked_out": false,
  "due_date": "YYYY-MM-DD|null",
  "inspection_date": "YYYY-MM-DD|null",
  "location_id": "uuid-v4|null",
  "tags": ["string", "..."],
  "category": "string|null",
  "low_stock_threshold": 0,
  "custom_fields": {"k": "scalar"},
  "created_at": "YYYY-MM-DDTHH:MM:SSZ",
  "updated_at": "YYYY-MM-DDTHH:MM:SSZ",
  "version": 1,
  "location_path": {
    "id_path": ["uuid-v4", "..."],
    "name_path": ["string", "..."],
    "display_path": "Garage / Shelf A",
    "sort_key": "garage / shelf a"
  },
  "effective_area_id": "string|null"
}
```

`inspection_date` is a **forward-looking** date: when the item is next due for inspection.
A value strictly before today (UTC) means that inspection is overdue — the population behind
the `inspection_overdue_only` filter and the `inspection_overdue_count` stat. It is
independent of `checked_out` and of `due_date`; any item can carry one.

Input shapes:
- ItemCreate (request payload subset; only `name` required):
  - `name: string`
  - `description?: string|null`
  - `quantity?: number>=0`
  - `checked_out?: boolean`
  - `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
  - `inspection_date?: YYYY-MM-DD|null` (independent of check-out state)
  - `location_id?: uuid-v4|null`
  - `tags?: string[]` (normalized: trimmed, lowercased, deduped)
  - `category?: string|null`
  - `low_stock_threshold?: number>=0|null`
  - `custom_fields?: { [k: string]: scalar }`

- ItemUpdate (all optional; `None` clears nullable fields):
  - `name?: string`
  - `description?: string|null`
  - `quantity?: number>=0`
  - `checked_out?: boolean`
  - `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
  - `inspection_date?: YYYY-MM-DD|null` (null clears)
  - `location_id?: uuid-v4|null`
  - `tags?: string[]|null` (null clears)
  - `category?: string|null`
  - `low_stock_threshold?: number>=0|null`
  - `custom_fields_set?: { [k: string]: scalar }`
  - `custom_fields_unset?: string[]`

### Location

Object shape:
```json
{
  "id": "uuid-v4",
  "name": "string",
  "parent_id": "uuid-v4|null",
  "area_id": "string|null",
  "path": {
    "id_path": ["uuid-v4", "..."],
    "name_path": ["string", "..."],
    "display_path": "Garage / Shelf A",
    "sort_key": "garage / shelf a"
  }
}
```

Location tree node (returned by `location/tree`):
```json
{
  "id": "uuid-v4",
  "name": "string",
  "parent_id": "uuid-v4|null",
  "area_id": "string|null",
  "path": <LocationPath>,
  "direct_item_count": 0,
  "subtree_item_count": 0,
  "matching_direct_count": 0,
  "matching_subtree_count": 0,
  "children": [ <tree node>, ... ]
}
```

Note: `children` is a recursive array of tree nodes with the same structure.
The two `matching_*` counts are present **only** when `location/tree` was called with a
`filter`; they mirror the two counts below over the items that filter keeps.
`direct_item_count` counts items located exactly at the node; `subtree_item_count`
counts items at the node or any descendant (so it is always >= the direct count).

### Filters and sorting

- ItemFilter:
  - `q?: string` (case-insensitive; name, description, tags, location display path)
  - `tags_any?: string[]`
  - `tags_all?: string[]`
  - `category?: string`
  - `checked_out?: boolean`
  - `low_stock_only?: boolean`
  - `orphaned_only?: boolean` (only items without a location, i.e. `location_id == null`)
  - `overdue_only?: boolean` (only items whose `due_date` is strictly before today, UTC)
  - `inspection_overdue_only?: boolean` (only items whose `inspection_date` is strictly before today, UTC; independent of check-out state)
  - `location_id?: uuid-v4|null`
  - `area_id?: string`
  - `include_subtree?: boolean`
  - `low_stock_first?: boolean`
  - `updated_after?: ISO8601Z` (strictly greater-than)
  - `created_after?: ISO8601Z` (strictly greater-than)
  - `updated_before?: ISO8601Z` (strictly less-than; combine with `updated_after` for a range)
  - `created_before?: ISO8601Z` (strictly less-than; combine with `created_after` for a range)

- Sort:
  - `{ field: "updated_at"|"created_at"|"name"|"quantity"|"due_date"|"inspection_date", order: "asc"|"desc" }`
  - `due_date` / `inspection_date`: items without a date sort last in both orders; ties break by id asc.

### Pagination

- `item/list` returns `{items: <Item[]>, next_cursor: string|null, total: number}`.
- `total` is the count of items matching the filter across all pages, independent of `limit`/`cursor`.
- `cursor` is an opaque base64url-encoded JSON with last tuple and sort metadata; pass it back unchanged.

### Stats

Counts object used in `stats` results and events:
```json
{
  "items_total": 0,
  "low_stock_count": 0,
  "checked_out_count": 0,
  "overdue_count": 0,
  "inspection_overdue_count": 0,
  "locations_total": 0,
  "no_location_count": 0
}
```

`no_location_count` is the number of items without a location (`location_id == null`).
`overdue_count` is the number of items whose `due_date` is strictly before today (UTC);
it moves with the calendar, so the same data can report a different count tomorrow.
`inspection_overdue_count` is the same question asked of `inspection_date`, over the whole
inventory rather than only the checked-out items, and moves with the calendar the same way.

### Distinct values

Result of `distinct_values`, used by category/tag autocomplete, the browser views, and custom-field key suggestions:
```json
{
  "categories": [ { "value": "Books", "count": 1 }, { "value": "Tools", "count": 2 } ],
  "tags": [ { "value": "blue", "count": 2 }, { "value": "red", "count": 2 } ],
  "custom_field_keys": [ "serial", "Voltage", "warranty_until" ]
}
```

- `DistinctValue`: `{ value: string, count: number }` where `count` is the number of items using that value.
- Categories are grouped case-insensitively; `value` is a representative display label (most frequent original casing, ties broken alphabetically). Tags are already normalized (lowercase), so `value` is the tag itself.
- Both value lists are sorted case-insensitively by `value`. Items with no category (or no tags) contribute nothing to the respective list.
- `custom_field_keys` is the sorted, distinct set of keys used across all items' `custom_fields` (keys are case-sensitive; sorted case-insensitively). Empty when no item has custom fields.

### Import / export (data safety)

`ExportDocument` — the versioned backup produced by `haventory/export` and accepted by
`haventory/import/preview` / `haventory/import/execute`:
```json
{
  "haventory_export_version": 1,
  "schema_version": 4,
  "exported_at": "YYYY-MM-DDTHH:MM:SSZ",
  "integration_version": "0.0.1",
  "items": [ <Item>, ... ],
  "locations": [ <Location>, ... ]
}
```

- `haventory_export_version` versions the document envelope; `schema_version` is the
  storage schema of the embedded item/location shapes.
- `items` / `locations` are arrays of the canonical `Item` / `Location` shapes above,
  including the denormalized `location_path` / `path` (with `sort_key`) so a round-trip
  reproduces the data exactly. The document is machine-generated and best treated as
  opaque; hand-editing works but paths are recomputed on import.

`ImportPreview` — result of `haventory/import/preview` (no mutation):
```json
{
  "valid": true,
  "errors": [ { "path": "items[2].id", "message": "must be a UUID v4 string" } ],
  "policy": "merge",
  "document": {
    "haventory_export_version": 1, "schema_version": 4,
    "exported_at": "…", "integration_version": "0.0.1"
  },
  "items":     { "add": ["uuid"], "update": [], "conflict": [], "unchanged": [] },
  "locations": { "add": [], "update": [], "conflict": [], "unchanged": [] },
  "counts": {
    "items":     { "total": 1, "add": 1, "update": 0, "conflict": 0, "unchanged": 0 },
    "locations": { "total": 0, "add": 0, "update": 0, "conflict": 0, "unchanged": 0 }
  }
}
```

- Buckets are mutually exclusive per entity: `add` (id absent), `unchanged` (present &
  identical), `update` (present, differs, resolved by `merge`/`replace`), `conflict`
  (present, differs, left as-is by `skip`). Under `merge`/`replace` `conflict` is empty;
  under `skip` `update` is empty.
- When `valid` is `false`, `errors` (each `{path, message}`) explains why and `counts` is
  empty. Envelope problems (bad/missing versions, malformed `items`/`locations`, a
  `schema_version` newer than supported), invalid entities, duplicate ids, and broken
  references (e.g. an item's `location_id` with no matching location) all surface here.

`ImportSummary` — result of a successful `haventory/import/execute`:
```json
{
  "applied": true,
  "policy": "merge",
  "items":     { "total": 2, "add": 2, "update": 0, "conflict": 0, "unchanged": 0 },
  "locations": { "total": 1, "add": 1, "update": 0, "conflict": 0, "unchanged": 0 },
  "totals": { "items_total": 2, "low_stock_count": 0, "checked_out_count": 0, "locations_total": 1, "no_location_count": 0 }
}
```

### Events

Common envelope inside HA WS event wrapper:
```json
{ "domain": "haventory", "topic": "items|locations|stats", "action": "...", "ts": "ISO8601Z", ... }
```

- Items: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed` with `{item: <Item>}`; plus `reloaded` (no `item`) after an import replaces the dataset.
- Locations: `created`, `renamed`, `moved`, `deleted` with `{location: <Location>}`; plus `reloaded` (no `location`) after an import.
- Stats: `counts` with `{counts: <Counts>}`.

### Validation notes

- UUIDs must be version 4.
- Dates use `YYYY-MM-DD` and are validated for real calendar dates.
- `name` trimmed; max length 120 for items and locations.
- `custom_fields` keys must be non-empty strings; values must be scalars.
