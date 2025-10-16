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
  }
}
```

Input shapes:
- ItemCreate (request payload subset; only `name` required):
  - `name: string`
  - `description?: string|null`
  - `quantity?: number>=0`
  - `checked_out?: boolean`
  - `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
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
  "area_id": "uuid-v4|null",
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
  "area_id": "uuid-v4|null",
  "path": <LocationPath>,
  "children": [ <LocationNode> ]
}
```

### Filters and sorting

- ItemFilter:
  - `q?: string` (case-insensitive; name, description, tags, location display path)
  - `tags_any?: string[]`
  - `tags_all?: string[]`
  - `category?: string`
  - `checked_out?: boolean`
  - `low_stock_only?: boolean`
  - `location_id?: uuid-v4|null`
  - `area_id?: uuid-v4`
  - `include_subtree?: boolean`
  - `updated_after?: ISO8601Z`
  - `created_after?: ISO8601Z`

- Sort:
  - `{ field: "updated_at"|"created_at"|"name"|"quantity", order: "asc"|"desc" }`

### Pagination

- `item/list` returns `{items: <Item[]>, next_cursor: string|null}`.
- `cursor` is an opaque base64url-encoded JSON with last tuple and sort metadata; pass it back unchanged.

### Stats

Counts object used in `stats` results and events:
```json
{ "items_total": 0, "low_stock_count": 0, "checked_out_count": 0, "locations_total": 0 }
```

### Events

Common envelope inside HA WS event wrapper:
```json
{ "domain": "haventory", "topic": "items|locations|stats", "action": "...", "ts": "ISO8601Z", ... }
```

- Items: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed` with `{item: <Item>}`.
- Locations: `created`, `renamed`, `moved`, `deleted` with `{location: <Location>}`.
- Stats: `counts` with `{counts: <Counts>}`.

### Validation notes

- UUIDs must be version 4.
- Dates use `YYYY-MM-DD` and are validated for real calendar dates.
- `name` trimmed; max length 120 for items and locations.
- `custom_fields` keys must be non-empty strings; values must be scalars.
