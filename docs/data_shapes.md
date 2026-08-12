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
  "status": "slug (a status definition's slug; built-ins: ok|missing|needs_repair)",
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
  "effective_area_id": "string|null",
  "attachments": [ <Attachment>, ... ]
}
```

`location_path` is **derived**: the backend computes it from the location tree and no client
can write it. Renaming or moving a location therefore rewrites it on every item in that
subtree **without bumping `version` or restamping `updated_at`** — a derived-data refresh is
not an item mutation, so tokens held for optimistic concurrency survive the rename, and the
"recently updated" sort is not shuffled by rows nobody touched.

`inspection_date` is a **forward-looking** date: when the item is next due for inspection.
A value strictly before today (UTC) means that inspection is overdue — the population behind
the `inspection_overdue_only` filter and the `inspection_overdue_count` stat. It is
independent of `checked_out` and of `due_date`; any item can carry one.

`status` is a stored per-item condition: exactly one slug from the store's `statuses`
collection, seeded with `ok`, `missing` and `needs_repair`. It is **non-nullable** — setting
`ok` is how a flagged state clears — and independent of `checked_out`/`quantity` (a
checked-out item is not "missing"; missing means its whereabouts are unknown). Stores
written before the field existed are migrated on load (schema v5's `migrate_4_to_5`
backfills `ok`), and loading additionally tolerates a missing or unknown value as `ok`; an
explicit unknown or null value in a write is rejected as `validation_error`.

`attachments` is **metadata only** — the files live on disk, outside the store (see
Attachments below). It is written by the two attachment commands and by nothing else:
`ItemCreate` and `ItemUpdate` carry no such field, so an ordinary item save can never
rewrite it. Unlike the derived `location_path`, attaching or detaching a file *is* an item
edit and bumps `version` and `updated_at`. Absent on a payload written before schema v6,
which reads as none.

Input shapes:
- ItemCreate (request payload subset; only `name` required):
  - `name: string`
  - `description?: string|null`
  - `quantity?: number>=0`
  - `status?: <status slug>` (defaults to `ok`; validated against the live set)
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
  - `status?: <status slug>` (non-nullable; `ok` clears a flagged state)
  - `checked_out?: boolean`
  - `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
  - `inspection_date?: YYYY-MM-DD|null` (null clears)
  - `location_id?: uuid-v4|null`
  - `tags?: string[]|null` (null clears)
  - `category?: string|null`
  - `low_stock_threshold?: number>=0|null`
  - `custom_fields_set?: { [k: string]: scalar }`
  - `custom_fields_unset?: string[]`

Neither input shape carries `attachments`: the two attachment commands are its only
writers, so an item save can never rewrite the list.

### Status definitions

The store's `statuses` collection, and the `statuses` array in `haventory/config` and in an
export document:
```json
{ "slug": "needs_repair", "label": "Needs repair", "order": 2, "color": "amber", "icon": "wrench" }
```

- `slug` is the immutable identity — the exact string every item stores. It is 1–64
  characters of lowercase letters, digits and underscores.
- `label` is the only part a rename touches, so renaming a status rewrites no item and
  raises no `version` question, exactly as a location rename does not touch `location_path`
  semantics.
- `order` is display order alone; ties break by slug.
- `color` is one of ten tone tokens — `neutral`, `green`, `blue`, `amber`, `red`, each also in
  a `_strong` form. Tokens rather than CSS: the card resolves them against the active Home
  Assistant theme, which a stored colour could not survive. A light form is a tint carrying
  deep ink; a strong form is a saturated fill, so an urgent status can carry further than a
  routine one. Defaults to `neutral`.
- `icon` is one of ten glyph names the card bundle carries — `check`, `alert`, `wrench`,
  `hand`, `box`, `truck`, `clock`, `cancel`, `star`, `help`. A name the bundle does not have
  renders no glyph rather than failing; the chip keeps its label and colour. Defaults to
  `check`.
- Both are absent from a document written before they existed, and read as those defaults.
- `ok` is the fixed default: it is what an unknown stored value coerces to and what
  "flagged" (`status !== "ok"`) is defined against, so it is always present.
- **An absent `statuses` section means the built-in three**, permanently — that is what
  every store and every export document written before schema v6 carries.

### Attachments

Per-item file metadata. The bytes never enter the HA `Store`: it is one JSON document
rewritten in full on every mutation, so base64 content would multiply every save and every
`haventory/export` result.
```json
{
  "id": "uuid-v4",
  "kind": "picture|manual",
  "filename": "drill.png",
  "mime": "image/png",
  "size": 20480,
  "uploaded_at": "YYYY-MM-DDTHH:MM:SSZ",
  "title": "Dishwasher manual (EN)",
  "order": 0
}
```

- `mime` is the **sniffed** type, derived from the file's own leading bytes rather than
  what the browser declared. Pictures accept `image/jpeg`, `image/png`, `image/webp` and
  `image/gif`; `image/svg+xml` is refused outright, because SVG carries script and the
  media view serves from the Home Assistant origin. Manuals accept `application/pdf`.
- `filename` is display metadata. The file on disk is named from `id` and the type.
- `title` is what the user called it; **empty means show `filename`**, rather than storing a
  copy of it that the two could then drift apart on.
- `order` is position within the item's attachments of the same *kind*, counted from zero
  within it — an item's first manual is `0` however many pictures are stored ahead of it.
  **The picture at `order` 0 is the item's cover** — there is no separate flag, so there is
  no "exactly one cover" invariant for an import to repair. Adding appends: the backend
  assigns the next free position in the kind and ignores any `order` the caller sent. Both
  fields default (`""`, `0`) when absent, and a list where every entry defaults reads in
  stored order.
- Files live at `<config>/haventory/attachments/<item_id>/<attachment_id><ext>` — inside
  the config directory so HA backups carry them, and outside both the integration package
  (which HACS replaces on upgrade) and `<config>/www` (which is `/local`, unauthenticated).
  They are served only through the authenticated view; see `backend_api_contract.md`.
- Caps: 10 pictures and 10 manuals per item, 8 MB per file. Nothing is thumbnailed
  server-side. `haventory/config` reports all of them so a picker can refuse early.

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
  - `status?: <status slug>` (exact match against the live status set; unknown values are `validation_error`)
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

**Unknown keys are rejected**, in a filter and in a sort alike: the reply is `validation_error`
naming the offending key. A dropped key is worse than a refused one — a filter that lost its
only predicate returns the whole inventory, and nothing in the reply says the filter did not
apply. `sort` accepts `field` and `order` and nothing else. The accepted filter key set is
exactly the list above, and it is read off the filter type itself, so a filter key added later
is accepted the moment it is declared.

### Pagination

- `item/list` returns `{items: <Item[]>, next_cursor: string|null, total: number}`.
- `total` is the count of items matching the filter across all pages, independent of `limit`/`cursor`.
- `cursor` is an opaque base64url-encoded JSON with last tuple and sort metadata; pass it back unchanged.
- A cursor that cannot be honoured is `validation_error`, never a silent restart at page one:
  empty, undecodable, longer than 2048 characters, missing `last_id` / `last_sort_key`, or
  minted under a different `sort` than the request carries. Restart pagination by omitting
  `cursor` — sending `""` is refused, because a caller who meant page one had no reason to
  send the key at all.
- Changing the sort means dropping the cursor. A cursor addresses a position in one specific
  ordering, and honouring it against another would silently return a page from neither.

### Stats

Counts object used in `stats` results and events:
```json
{
  "items_total": 0,
  "low_stock_count": 0,
  "checked_out_count": 0,
  "overdue_count": 0,
  "inspection_overdue_count": 0,
  "missing_count": 0,
  "needs_repair_count": 0,
  "status_counts": { "ok": 0, "missing": 0, "needs_repair": 0 },
  "locations_total": 0,
  "no_location_count": 0
}
```

`no_location_count` is the number of items without a location (`location_id == null`).
`overdue_count` is the number of items whose `due_date` is strictly before today (UTC);
it moves with the calendar, so the same data can report a different count tomorrow.
`inspection_overdue_count` is the same question asked of `inspection_date`, over the whole
inventory rather than only the checked-out items, and moves with the calendar the same way.
`missing_count` / `needs_repair_count` count items by their stored `status`; unlike the two
calendar counts they only change on a mutation, so events keep them current.
`status_counts` is that same count for every defined slug, `ok` included. It is additive to
the two named keys, not a replacement for them.

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
  "locations": [ <Location>, ... ],
  "statuses": [ <StatusDefinition>, ... ]
}
```

- `haventory_export_version` versions the document envelope; `schema_version` is the
  storage schema of the embedded item/location shapes.
- `items` / `locations` are arrays of the canonical `Item` / `Location` shapes above,
  including the denormalized `location_path` / `path` (with `sort_key`) so a round-trip
  reproduces the data exactly. The document is machine-generated and best treated as
  opaque; hand-editing works but paths are recomputed on import.
- `statuses` carries the slug-to-label mapping, because items store only the slug and a
  restore onto a fresh install would otherwise lose every custom label. An absent section
  reads as the built-in three, permanently.
- Each item's `attachments` travels as **metadata only** — one WebSocket frame cannot carry
  binaries. Importing onto an install that does not hold the files leaves the references in
  place and `import/preview` reports how many are missing; the full-fidelity backup path is
  Home Assistant's own, which carries the media directory with the store.

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

- Items: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed` with `{item: <Item>}`. `item` may be **absent** on any items event, and its absence means "refetch" rather than "patch this item": `reloaded` after an import replaces the dataset, and `updated` after `status/delete` with `reassign_to` rewrites every item carrying the slug at once.
- Locations: `created`, `renamed`, `moved`, `deleted` with `{location: <Location>}`; plus `reloaded` (no `location`) after an import.
- Stats: `counts` with `{counts: <Counts>}`.
- Every topic: `unavailable` (common fields only), sent once per open subscription when the config entry serving it tears down. The subscription is over at that point; see the API contract's "While no entry is loaded".

### Validation notes

- UUIDs must be version 4.
- Dates use `YYYY-MM-DD` and are validated for real calendar dates.
- `name` trimmed; max length 120 for items and locations.
- `custom_fields` keys must be non-empty strings; values must be scalars.

#### Input caps

Every free-text and collection field is bounded. The store is one JSON document rewritten in
full on every mutation, so an unbounded field is a cost every later write keeps paying. Over
a cap is `validation_error`, at a cap is accepted:

| Field | Cap |
|---|---|
| `name` (item and location) | 120 characters |
| `description` | 4000 characters |
| `category` | 120 characters |
| each entry of `tags` | 64 characters |
| `tags` | 50 entries, counted after normalization |
| `custom_fields` | 50 keys |
| each `custom_fields` key | 64 characters |
| each string `custom_fields` value | 1000 characters |

The caps refuse *growth*, not every edit: an item that predates them — one loaded from a
store written by an earlier release — can still be edited, including by the edit that removes
the excess. What it cannot do is add to a collection already over its cap.

The same caps, the 120-character name limit and the `due_date` ⇔ `checked_out` invariant are
applied to `import/preview` as well, so a document cannot introduce an entity the WebSocket
API would refuse. They are reported per field in `report.errors`, as a refused import rather
than as dropped rows. `Repository.load_state` deliberately does **not** re-validate: a store
written before the caps existed is legal data this integration itself wrote, and refusing it
would turn an upgrade into a backend that will not start.
