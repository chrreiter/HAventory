## HAventory Data Shapes

The shapes the WebSocket API, the `haventory.*` services and the store exchange. The source
of truth is `custom_components/haventory/models.py` (the entities, the input `TypedDict`s and
the validation) and `serialization.py` (what goes on the wire). What each command does with
them is [`backend_api_contract.md`](backend_api_contract.md).

`ScalarValue` below is `string | number | boolean`, the values `custom_fields` accepts.

### Item

Everything down to `attachments` is the **one** shape `Item.to_dict()` produces: what the
store holds and what an export document carries. `effective_area_id` is the one field the
API adds. It is resolved from the location tree per request and never stored, so it appears
on WebSocket results, events and service responses only.

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
  "reminder_date": "YYYY-MM-DD|null",
  "reminder_anchor": "YYYY-MM-DD|null",
  "reminder_interval": {"unit": "days|weeks|months", "count": 1},
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
  "attachments": [ <Attachment>, ... ],

  "effective_area_id": "string|null"
}
```

- `location_path` is **derived**: the backend computes it from the location tree and no
  client writes it. A location rename or move rewrites it across the subtree **without**
  bumping `version` or restamping `updated_at` (see the contract's "Versioning and
  concurrency").
- `inspection_date` is **forward-looking**: when the item is next due for inspection. It is
  independent of `checked_out` and `due_date`. Before today it is overdue; on or before today
  it is due.
- `status` is exactly one slug from the store's `statuses` collection. It is non-nullable:
  setting `ok` is how a flagged state clears. It is independent of `checked_out` and
  `quantity`. A stored item with no status, or one the collection does not define, loads as
  `ok`; an explicit unknown or `null` value in a write is `validation_error`.
- An item is **low on stock** when it has a `low_stock_threshold` and `quantity` is at or
  below it.
- `attachments` is **metadata only**; the files live on disk (see "Attachments"). Only the
  attachment commands write it, so an ordinary item save cannot rewrite it. Unlike the
  derived path, attaching or detaching a file *is* an item edit and bumps `version` and
  `updated_at`. A stored item with no list loads with an empty one.

#### Reminders

A reminder is **three** fields, and two of them are dates on purpose:

- `reminder_date`: the next occurrence nobody has marked done. What the calendar shows first
  and what `reminder/bump` advances.
- `reminder_anchor`: what the series is measured from. Equal to `reminder_date` until the
  first bump, and `null` exactly when `reminder_date` is.
- `reminder_interval`: `{unit, count}`, `unit` one of `days`, `weeks`, `months` and `count`
  an integer from 1 to 1000; `null` for a one-off. An interval with no `reminder_date` is
  `validation_error`.

`reminder_anchor` is **derived on write**: no input shape carries it, and every write of
`reminder_date` sets the anchor to that same date. `reminder/bump` and
`haventory.reminder_bump` are the only writes that move the date and keep the anchor, which
is why it is stored. An export document may carry one, so a restore keeps a series
mid-flight; an import refuses an anchor later than its own date, or one with no date.

Occurrences are **derived on read, never stored**. `calendar.haventory` expands the anchor
and the interval over whatever window is read. Month steps are measured from the anchor and
clamped onto short months: a series anchored on the 31st gives 28 February and then 31
March, after any number of bumps. A past anchor is what a reminder nobody has bumped looks
like. A stored item missing any of the three fields loads with the date and interval `null`
and the anchor equal to the date.

#### Input shapes

`ItemCreate` (only `name` required):

- `name: string`
- `description?: string|null`
- `quantity?: integer >= 0` (default 1)
- `status?: <status slug>` (default `ok`; checked against the live set)
- `checked_out?: boolean`
- `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
- `inspection_date?: YYYY-MM-DD|null`
- `reminder_date?: YYYY-MM-DD|null` (also sets `reminder_anchor`)
- `reminder_interval?: {unit, count}|null` (requires `reminder_date`)
- `location_id?: uuid-v4|null`
- `tags?: string[]` (trimmed, casefolded, de-duplicated)
- `category?: string|null`
- `low_stock_threshold?: integer >= 0|null`
- `custom_fields?: { [k: string]: ScalarValue }`

`ItemUpdate` (all optional; `null` clears a nullable field):

- the `ItemCreate` fields except `custom_fields`, with `status` non-nullable and
  `tags?: string[]|null`
- `reminder_date` re-anchors the series on the date written. `null` is refused while an
  interval is stored; clear both together.
- `reminder_interval` is checked against the stored `reminder_date` when the update does
  not name one
- `custom_fields_set?: { [k: string]: ScalarValue }`
- `custom_fields_unset?: string[]`

Neither shape carries `attachments` or `reminder_anchor`.

### Status definitions

The store's `statuses` collection, and the `statuses` array in `haventory/config` and in an
export document:
```json
{ "slug": "needs_repair", "label": "Needs repair", "order": 2, "color": "amber", "icon": "wrench" }
```

- `slug` is the immutable identity, the exact string every item stores: 1–64 characters of
  lowercase letters, digits and underscores.
- `label` is the only part a rename touches, so renaming a status rewrites no item. The
  three seeded statuses (`ok`, `missing`, `needs_repair`) are stored in English, and the card
  *displays* each in the reader's own language for as long as its label is still the seeded
  English. A rename replaces it for everyone. Nothing writes a translation back, so an export
  stays language-neutral.
- `order` is display order; ties break by slug.
- `color` is one of ten tone tokens (`neutral`, `green`, `blue`, `amber`, `red`, each also
  in a `_strong` form) **or** a `#rrggbb` literal, folded to lowercase. The card resolves a
  token against the active Home Assistant theme: a light form is a tint with deep ink, a
  strong form a saturated fill. A literal looks the same in every theme, and the card picks
  its text colour from the fill's luminance. Default `neutral`.
- `icon` is one of ten glyph names the card bundle carries: `check`, `alert`, `wrench`,
  `hand`, `box`, `truck`, `clock`, `cancel`, `star`, `help`. Default `check`.
- An absent `color` or `icon` reads as its default.
- `ok` is the fixed default: what an unknown stored value loads as, and what "flagged"
  (`status !== "ok"`) is defined against, so it always exists and cannot be deleted.
- **An absent `statuses` section means the built-in three**, in a store and in an export
  document alike. A store that carries one keeps exactly it: every built-in but `ok` can be
  deleted, and nothing seeds back into a collection that exists.

### Attachments

Per-item file metadata. The bytes never enter the HA `Store`, which is one JSON document
rewritten in full on every mutation.
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

- `mime` is the **sniffed** type, read from the file's own leading bytes. Pictures accept
  `image/jpeg`, `image/png`, `image/webp` and `image/gif`; manuals accept
  `application/pdf`. `image/svg+xml` is refused.
- `filename` is display metadata. The file on disk is named from `id` and the type.
- `title` is what the user called it; **empty means show `filename`**.
- `order` is the position among the item's attachments of the same *kind*, from zero. **The
  picture at `order` 0 is the item's cover**; there is no separate flag. An upload takes the
  next free position in its kind. An absent `title` or `order` reads as `""` or `0`, and a
  list whose entries all default keeps its stored order.
- Caps: 10 pictures and 10 manuals per item, 8 MB per file. `haventory/config` reports them.
- Files live at `<config>/haventory/attachments/<item_id>/<attachment_id><ext>`: inside the
  config directory so Home Assistant backups carry them, and outside both the integration
  package (which HACS replaces on upgrade) and `<config>/www` (which is `/local`, served
  without authentication). They are served only through the authenticated media view, which
  also serves a derived row tile; both are in the contract under "Attachments".
- An item's directory is removed once its last file is deleted. At setup, a file no stored
  metadata references is deleted, except when the store holds no items at all: then every
  file is left alone and a warning says how many there are, because a store that was lost or
  not read yet looks the same.

### Location

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

A tree's area lives on its root: setting an area on a nested location stores it on the root
and clears it below, so `area_id` is non-null only on roots. The items under a root report
it as `effective_area_id`.

Location tree node, as `location/tree` returns it:
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

`direct_item_count` counts the items located exactly at the node, `subtree_item_count` the
items at the node or any descendant. The two `matching_*` counts are present **only** when
the request carried a `filter`, and count the same populations over the items the filter
keeps.

### Filters and sorting

`ItemFilter`:

- `q?: string`: case- and accent-insensitive substring match, mid-word included. Every word
  of the query must appear in one of name, description, category, tags or the location
  display path.
- `tags_any?: string[]`, `tags_all?: string[]`
- `category?: string`, `categories?: string[]` (one selection; see the multi-select rule)
- `status?: <status slug>` (exact match; an undefined slug is `validation_error`)
- `checked_out?: boolean`
- `low_stock_only?: boolean`
- `orphaned_only?: boolean`: items with no location
- `overdue_only?: boolean`: `due_date` strictly before today
- `checked_out_due_only?: boolean`: `due_date` on or before today
- `inspection_overdue_only?: boolean`: `inspection_date` strictly before today
- `inspection_due_only?: boolean`: `inspection_date` on or before today
- `reminder_due_only?: boolean`: `reminder_date` on or before today
- `location_id?: uuid-v4|null`, `location_ids?: uuid-v4[]` (one selection; see the
  multi-select rule)
- `area_id?: string|null` (`null`, like an omitted key, is no area filter)
- `include_subtree?: boolean`: governs the whole location selection; default `false` here
  and `true` on a subscription
- `low_stock_first?: boolean`: not a filter; sorts the low-stock items first
- `updated_after?`, `created_after?`: `ISO8601Z`, strictly greater-than
- `updated_before?`, `created_before?`: `ISO8601Z`, strictly less-than

Throughout, *overdue* excludes today and *due* includes it, and "today" is the day Home
Assistant is configured for, read once per query.

**The multi-select rule.** `category`/`categories` and `location_id`/`location_ids` are
each *one* selection: the scalar and the list are unioned, and an item matches if it carries
any value in the union. They are never intersected, because an item has one category and
one location. Either key may be sent alone; the card sends only the plural. An empty list
does not narrow. Entries are trimmed and de-duplicated, categories case-insensitively. A
`location_ids` entry that is not a UUID v4 matches nothing. With `include_subtree`, an item
matches when it sits in or under any selected location.

**Collections are checked on type.** `tags_any`, `tags_all`, `categories` and `location_ids`
must each be a list of strings; anything else is `validation_error` naming the key.

**Unknown keys are refused**, in a filter and in a sort alike, with `validation_error`
naming the key. A dropped key would be worse: a filter that lost its only predicate returns
the whole inventory, and nothing in the reply says so. The accepted filter keys are read off
the `ItemFilter` type itself, so declaring a key there is what makes it accepted.

**`area_id` is checked on its value.** Anything other than `null` or a string with
non-whitespace in it is `validation_error` ("area_id must be a non-empty string or null"),
on `item/list` and `haventory/subscribe` alike; surrounding whitespace is trimmed. A
well-formed id that no location resolves to is an empty answer, not a refusal.

`Sort`: `{ field: "updated_at"|"created_at"|"name"|"quantity"|"due_date"|"inspection_date"|"reminder_date"|"location", order: "asc"|"desc" }`

- Without a sort, `item/list` orders by `updated_at` descending.
- `due_date`, `inspection_date` and `reminder_date` put items without the date last in both
  orders; ties break by id ascending. `reminder_date` orders on the next occurrence, not on
  the anchor.
- `location` orders on the item's `location_path.sort_key`. **Items with no location sort
  last in both orders.** An item's area comes from its tree's root, so a list sorted by path
  groups by root and therefore by area.
- There is **no area sort**. An area's name lives in Home Assistant's registry, which the
  repository cannot reach, and sorting on `area_id` would keep a renamed area under its old
  name, since Home Assistant derives the id from the name at creation and never changes it.

### Pagination

- `cursor` is an opaque base64url-encoded JSON holding the last row's sort tuple and the
  sort it was minted under. Pass it back unchanged.
- A cursor addresses a position in one ordering, so changing the sort or
  `filter.low_stock_first` means dropping it; sending it anyway is `validation_error`. The
  full refusal list is under `item/list` in the contract.

### Stats

`<Counts>`, the result of `haventory/stats`, the `counts` of `haventory/health`, the payload
of a `stats/counts` event and the `totals` of an import summary:
```json
{
  "items_total": 0,
  "low_stock_count": 0,
  "checked_out_count": 0,
  "overdue_count": 0,
  "checked_out_due_count": 0,
  "inspection_overdue_count": 0,
  "inspection_due_count": 0,
  "reminder_due_count": 0,
  "missing_count": 0,
  "needs_repair_count": 0,
  "status_counts": { "ok": 0, "missing": 0, "needs_repair": 0 },
  "locations_total": 0,
  "no_location_count": 0
}
```

Each count is the population of the filter of the same name:

| Count | Items | Filter |
|---|---|---|
| `low_stock_count` | at or below their threshold | `low_stock_only` |
| `checked_out_count` | checked out | `checked_out` |
| `overdue_count` | checked out, `due_date` before today | `overdue_only` |
| `checked_out_due_count` | checked out, `due_date` on or before today | `checked_out_due_only` |
| `inspection_overdue_count` | `inspection_date` before today, whole inventory | `inspection_overdue_only` |
| `inspection_due_count` | `inspection_date` on or before today | `inspection_due_only` |
| `reminder_due_count` | `reminder_date` on or before today | `reminder_due_only` |
| `missing_count`, `needs_repair_count` | stored `status` is that slug | `status` |
| `no_location_count` | no location | `orphaned_only` |

`status_counts` holds the same figure for **every** defined slug, `ok` included, beside the
two named keys. The five date-derived counts move with the calendar; the rest change only on
a mutation.

### Distinct values

The result of `haventory/distinct_values`, which feeds category and tag autocomplete, the
browser views and custom-field key suggestions:
```json
{
  "categories": [ { "value": "Books", "count": 1, "matching_count": 0 }, { "value": "Tools", "count": 2, "matching_count": 1 } ],
  "tags": [ { "value": "blue", "count": 2, "matching_count": 1 }, { "value": "red", "count": 2, "matching_count": 0 } ],
  "custom_field_keys": [ "serial", "Voltage", "warranty_until" ]
}
```

- `DistinctValue`: `{ value: string, count: number, matching_count?: number }`. `count` is
  the number of items carrying the value, over the whole inventory.
- `matching_count` is how many of those the request's filter keeps. It is on every entry
  when the request carried a `filter` and on none when it did not, so its absence means
  "not priced", never "nothing matches". No entry is dropped for matching nothing.
- Categories are grouped case-insensitively; `value` is the most frequent original casing,
  ties broken alphabetically. Tags are stored casefolded, so `value` is the tag itself.
- Both lists are sorted case-insensitively by `value`.
- `custom_field_keys` is the distinct set of keys across all items' `custom_fields`: keys
  are case-sensitive and sorted case-insensitively. It is never filtered.

### Import / export

`ExportDocument`, produced by `haventory/export` and accepted by `import/preview` and
`import/execute`:
```json
{
  "haventory_export_version": 1,
  "schema_version": 1,
  "exported_at": "YYYY-MM-DDTHH:MM:SSZ",
  "integration_version": "X.Y.Z",
  "items": [ <Item>, ... ],
  "locations": [ <Location>, ... ],
  "statuses": [ <StatusDefinition>, ... ]
}
```

- `haventory_export_version` versions the envelope; `schema_version` is the storage schema
  of the embedded shapes.
- `items` and `locations` are the stored shapes above (no `effective_area_id`), derived paths
  included, so a round trip reproduces the data. Paths are recomputed on import, so a
  hand-edited document need not keep them right.
- `statuses` carries the slug-to-label mapping, because items store only the slug.
- Attachments travel as **metadata only**. Importing onto an install without the files
  keeps the references, and `import/preview` counts the missing ones.

`ImportPreview`, the result of `haventory/import/preview`:
```json
{
  "valid": true,
  "errors": [ { "path": "items[2].id", "message": "must be a UUID v4 string" } ],
  "warnings": [ <ImportWarning>, ... ],
  "policy": "merge",
  "document": {
    "haventory_export_version": 1, "schema_version": 1,
    "exported_at": "…", "integration_version": "…"
  },
  "items":     { "add": ["uuid"], "update": [], "conflict": [], "unchanged": [] },
  "locations": { "add": [], "update": [], "conflict": [], "unchanged": [] },
  "counts": {
    "items":     { "total": 1, "add": 1, "update": 0, "conflict": 0, "unchanged": 0 },
    "locations": { "total": 0, "add": 0, "update": 0, "conflict": 0, "unchanged": 0 }
  },
  "attachments": { "referenced": 0, "missing": 0 }
}
```

- Each incoming entity lands in exactly one bucket: `add` (id absent), `unchanged` (present
  and identical), `update` (present, differs, and `merge`/`replace` will change it) or
  `conflict` (present, differs, and `skip` leaves it). Under `merge`/`replace` `conflict` is
  empty; under `skip` `update` is empty.
- When `valid` is `false`, `errors` (each `{path, message}`) says why, `counts` is empty and
  `attachments` is absent. Envelope problems (a missing or unsupported version, malformed
  `items`/`locations`), invalid entities, duplicate ids and broken references (an item's
  `location_id` naming no location) all land here.
- A document is held to what the store's own load accepts, not to the write path's input
  caps: the 120-character name limit, UUID v4 ids, canonical timestamps, real calendar
  dates, `due_date` only on a checked-out item, the `reminder_interval` shape (a misspelled
  unit is a refused row, not a silent loss) and its need for a date, and statuses the
  document can name. The free-text and collection caps are not applied, because an export of
  a store holding over-cap data must import back.
- `warnings` is present on every preview, empty or not, valid or not.

`ImportWarning`, a non-blocking finding about an otherwise usable document:
```json
{
  "code": "name_collision",
  "path": "locations[3]",
  "message": "\"Garage / Shelf A\" would be added while \"Cellar / Shelf A\" is already here, under a different id.",
  "name": "Shelf A",
  "existing_ids": [ "uuid-v4", ... ]
}
```

- A warning **never** affects `valid` and never reaches `import/execute`. The preview tells;
  the id still decides.
- `code` discriminates the kind; `name_collision` is the only one. It is raised for an
  incoming entity in the `add` bucket whose name matches a stored entity **of the same kind
  under a different id**, compared case-insensitively, accent-folded and
  whitespace-collapsed. `update` and `unchanged` are the same entity by id, so a clean round
  trip produces no warnings under any policy.
- `existing_ids` lists **every** stored entity of that name, because location trees repeat
  leaf names ("Shelf A", "Drawer 1").
- `message` is one self-contained sentence. It names the incoming entity by its
  `display_path` where it has one, then quotes up to three colliding stored locations' paths
  and counts the rest (items, which have no path of their own, are counted).

`ImportSummary`, the result of a successful `haventory/import/execute`:
```json
{
  "applied": true,
  "policy": "merge",
  "items":     { "total": 2, "add": 2, "update": 0, "conflict": 0, "unchanged": 0 },
  "locations": { "total": 1, "add": 1, "update": 0, "conflict": 0, "unchanged": 0 },
  "totals": <Counts>
}
```

`items` and `locations` are the preview's `counts`; `totals` is the full counts object after
the import.

### Events

WebSocket event payloads, inside Home Assistant's event wrapper. Which actions exist and
when each is sent is the contract's "Events".
```json
{ "domain": "haventory", "topic": "items|locations|stats|statuses", "action": "...", "ts": "ISO-8601", ... }
```

- `items`: `{item: <Item>}`, or no `item` at all on a refetch signal.
- `locations`: `{location: <Location>}`, or none on `reloaded`.
- `statuses`: `{status: <StatusDefinition>}`, or `{statuses: <StatusDefinition[]>}` on
  `reordered`.
- `stats`: `{counts: <Counts>}`.
- `unavailable`: the common fields only.

### Home Assistant bus events

Fired after the durable write, from WebSocket commands and `haventory.*` services alike.
When they fire is the contract's "Home Assistant bus events".

`haventory_item_changed`:
```json
{
  "action": "created|updated|moved|quantity_changed|checked_out|checked_in|deleted",
  "item_id": "uuid-v4",
  "name": "string",
  "quantity": 0,
  "location_id": "uuid-v4|null",
  "location_path": "Garage / Shelf A",
  "effective_area_id": "string|null",
  "version": 1,
  "ts": "YYYY-MM-DDTHH:MM:SSZ"
}
```

`haventory_low_stock`:
```json
{
  "action": "entered|cleared",
  "item_id": "uuid-v4",
  "name": "string|null",
  "quantity": 0,
  "low_stock_threshold": 0,
  "ts": "YYYY-MM-DDTHH:MM:SSZ"
}
```

- `location_path` is the **display path string**, not the object an `<Item>` carries,
  because a trigger template wants one readable value.
- The payloads omit `description`, `tags`, `custom_fields` and the rest; an automation that
  needs them calls `haventory/item/get`.
- On a `cleared` fired by a delete, `name`, `quantity` and `low_stock_threshold` come from
  the body the delete removed. `name` is `null` only when the item can no longer be read.

### Service responses

Every `haventory.*` service declares `SupportsResponse.OPTIONAL` and answers with the
WebSocket shapes; there is no service-only shape:

```yaml
- action: haventory.item_create
  data: { name: Torch }
  response_variable: created
- action: haventory.item_move
  data:
    item_id: "{{ created.item.id }}"
    new_location_id: "{{ shed_id }}"
    expected_version: "{{ created.item.version }}"
```

- The eight `item_*` services and `reminder_bump` return `{"item": <Item>}`; the three
  `location_*` ones return `{"location": <Location>}`.
- `item_move` takes `new_location_id`; every other surface calls that field `location_id`.
- Reminders need no services of their own: `item_create` and `item_update` carry
  `reminder_date` and `reminder_interval` (`null` clears either), and `reminder_bump`
  answers the item as the bump left it, so a script can read the new `reminder_date` from
  the response. The rule is `Repository.bump_reminder`, which the WebSocket command reaches
  through the same `ops.py` entry.
- `item_delete` and `location_delete` return the entity as it last stood. Deleting an unknown
  id is `not_found`. `item_delete` frees the item's attachment files after the write, as
  `item/delete` does.
- The response is produced **after** the durable write, so an answer means the mutation is
  persisted.
- `OPTIONAL`, not `ONLY`: a caller that omits `response_variable` is unaffected.

### Validation notes

- UUIDs must be version 4.
- Dates are `YYYY-MM-DD` and must be real calendar dates, on every write path and on import.
  The calendar re-derives occurrences on every read; a stored date it cannot parse (only a
  hand-edited store has one) costs that item its occurrences and is logged once.
- `name` is trimmed; see the caps below.
- `custom_fields` keys are non-empty strings and values are scalars.
- Every collection a caller writes whole is checked on type and refused, naming the key the
  caller sent, when it is not a list (or, for `custom_fields`, `custom_fields_set` and
  `set`, an object): `tags`, `custom_fields`, `custom_fields_set`, `custom_fields_unset`,
  `update_custom_fields`'s `set` and `unset`, `attachment_ids` and `slugs`. A bare string
  would otherwise iterate as its characters. `null` clears `tags`.
- `attachment_ids` and `slugs` name a whole set as a permutation, so nothing is trimmed or
  de-duplicated: a list naming one member twice is a client bug and is refused.

#### Input caps

Every free-text and collection field is bounded, because the store is one JSON document
rewritten in full on every mutation. Over a cap is `validation_error`; at a cap is accepted.

| Field | Cap |
|---|---|
| `name` (item and location) | 120 characters |
| status `label` | 120 characters |
| attachment `title` | 200 characters |
| `description` | 4000 characters |
| `category` | 120 characters |
| each entry of `tags` | 64 characters |
| `tags` | 50 entries, counted after normalization |
| `custom_fields` | 50 keys |
| each `custom_fields` key | 64 characters |
| each string `custom_fields` value | 1000 characters |

The caps refuse *growth*, not every edit. An item already over a cap can still be edited and
saved, including by an edit that trims part of the excess. What an edit cannot do is make an
over-cap value larger, add to a collection already over its cap, or introduce a *new* value
over a cap. The card's editor applies the same rule, so an over-cap item is never trapped
behind its own data.

`import/preview` and `import/execute` apply none of these caps (see `ImportPreview` above).
The 120-character name limit is the one exception: no store can legally carry a longer
name.
