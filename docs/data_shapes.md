## HAventory Data Shapes

Canonical shapes used in WebSocket payloads and storage, derived from
`custom_components/haventory/models.py` and the repository serializers.

### Scalars

- ScalarValue: string | number | boolean (allowed in `custom_fields` values)

### Item

Object shape for persisted items and API results. Everything down to `attachments` is the
**one** shape `Item.to_dict()` produces: what the store holds and what an export document
carries, identically. `effective_area_id` is the single field the API adds on top. It is
resolved from the location tree per request and never stored, so it appears on WebSocket
results and service responses only.

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

`location_path` is **derived**: the backend computes it from the location tree and no client
can write it. Renaming or moving a location rewrites it on every item in that subtree
**without bumping `version` or restamping `updated_at`**. A derived-data refresh is not an
item mutation, so tokens held for optimistic concurrency survive the rename, and the
"recently updated" sort is not shuffled by rows nobody touched.

`inspection_date` is a **forward-looking** date: when the item is next due for inspection.
A value strictly before today (the day Home Assistant is configured for) means that
inspection is overdue, the population behind the `inspection_overdue_only` filter and the
`inspection_overdue_count` stat. A value on or before today means it is due, which is what
`inspection_due_only` and `inspection_due_count` report. It is independent of `checked_out`
and of `due_date`; any item can carry one.

A reminder is **three** fields, and two of them are dates on purpose:

- `reminder_date`: the next occurrence nobody has marked done. What the calendar shows
  first, what a household picks, and what `haventory/reminder/bump` advances.
- `reminder_anchor`: what the series is measured from. Equal to `reminder_date` until the
  first bump, and `null` exactly when `reminder_date` is.
- `reminder_interval`: `{unit, count}` with `unit` one of `days`, `weeks`, `months` and
  `count` an integer from 1 to 1000. `null` for a one-off. An interval with no
  `reminder_date` to count from is rejected as `validation_error`.

`reminder_anchor` is **derived on write, not client-written**: neither `ItemCreate` nor
`ItemUpdate` carries it, and every path that writes `reminder_date` sets the anchor to that
same date. `reminder/bump` and `haventory.reminder_bump` are the only writers that move the
date and keep the anchor, which is the whole reason it is stored. A document may carry one,
so a backup can restore a series mid-flight. An anchor later than its own `reminder_date`,
or one with no date to lead to, is refused on import.

Occurrences are **derived, never stored**. `calendar.haventory` expands the anchor and the
interval over whatever window is read, so the store holds three fields however long the
series runs. Month steps are measured from the anchor and clamped onto short months: a
series anchored on the 31st gives 28 February and then 31 March, rather than sticking at 28,
and that holds after any number of bumps. A past anchor is accepted and is what a reminder
nobody has bumped looks like.

A store written before the three fields existed carries none of them, and the load fills
them in: the date and the interval as `null`, and every reminder's anchor as its own date. A
store carrying a reminder but no anchor reads the same way.

`status` is a stored per-item condition: exactly one slug from the store's `statuses`
collection, seeded with `ok`, `missing` and `needs_repair`. It is **non-nullable** (setting
`ok` is how a flagged state clears) and independent of `checked_out` and `quantity`. A
store written before the field existed has it filled in on load (`ok`, unless the store's
own `statuses` collection names the value it holds), and loading tolerates a missing or
unknown value as `ok`. An explicit unknown or null value in a write is rejected as
`validation_error`.

`attachments` is **metadata only**; the files live on disk, outside the store (see
Attachments below). It is written by the attachment commands and by nothing else:
`ItemCreate` and `ItemUpdate` carry no such field, so an ordinary item save can never
rewrite it. Unlike the derived `location_path`, attaching or detaching a file *is* an item
edit and bumps `version` and `updated_at`. Absent on a payload written before the field
existed, which reads as the empty list on load.

Input shapes:
- ItemCreate (request payload subset; only `name` required):
  - `name: string`
  - `description?: string|null`
  - `quantity?: number>=0`
  - `status?: <status slug>` (defaults to `ok`; validated against the live set)
  - `checked_out?: boolean`
  - `due_date?: YYYY-MM-DD|null` (only valid when `checked_out` is true)
  - `inspection_date?: YYYY-MM-DD|null` (independent of check-out state)
  - `reminder_date?: YYYY-MM-DD|null` (also sets `reminder_anchor`)
  - `reminder_interval?: {unit, count}|null` (requires `reminder_date`)
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
  - `reminder_date?: YYYY-MM-DD|null` (null clears; refused while an interval is stored;
    re-anchors the series on the date written)
  - `reminder_interval?: {unit, count}|null` (null clears; validated against the stored
    `reminder_date` when the update does not name one)
  - `location_id?: uuid-v4|null`
  - `tags?: string[]|null` (null clears)
  - `category?: string|null`
  - `low_stock_threshold?: number>=0|null`
  - `custom_fields_set?: { [k: string]: scalar }`
  - `custom_fields_unset?: string[]`

Neither input shape carries `attachments` or `reminder_anchor`.

### Status definitions

The store's `statuses` collection, and the `statuses` array in `haventory/config` and in an
export document:
```json
{ "slug": "needs_repair", "label": "Needs repair", "order": 2, "color": "amber", "icon": "wrench" }
```

- `slug` is the immutable identity, the exact string every item stores. It is 1–64
  characters of lowercase letters, digits and underscores.
- `label` is the only part a rename touches, so renaming a status rewrites no item. The
  three a store is seeded with (`ok`, `missing`, `needs_repair`) are stored in English and
  *displayed* by the card in each reader's own language for as long as each still carries
  that seeded English. Renaming one replaces it for everyone, in every language. Nothing
  writes a translation back, so an export stays language-neutral and its built-ins import as
  built-ins on any instance.
- `order` is display order alone; ties break by slug.
- `color` is one of ten tone tokens (`neutral`, `green`, `blue`, `amber`, `red`, each also
  in a `_strong` form) **or** a `#rrggbb` literal. A token is resolved by the card against
  the active Home Assistant theme: a light form is a tint carrying deep ink, a strong form is
  a saturated fill. A literal resolves against nothing, so that one chip looks the same in
  every theme, and the card derives its text colour from the fill's own luminance. Defaults
  to `neutral`.
- `icon` is one of ten glyph names the card bundle carries: `check`, `alert`, `wrench`,
  `hand`, `box`, `truck`, `clock`, `cancel`, `star`, `help`. A name the bundle does not have
  renders no glyph; the chip keeps its label and colour. Defaults to `check`.
- Both are absent from a document written before they existed, and read as those defaults.
- `ok` is the fixed default: it is what an unknown stored value coerces to and what
  "flagged" (`status !== "ok"`) is defined against, so it is always present.
- **An absent `statuses` section means the built-in three**, permanently. That is what a
  store or an export document written before the collection existed carries. A store that
  carries one keeps exactly it: every built-in but `ok` can be deleted, so nothing seeds into
  a collection that is already there.

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

- `mime` is the **sniffed** type, derived from the file's own leading bytes rather than what
  the browser declared. Pictures accept `image/jpeg`, `image/png`, `image/webp` and
  `image/gif`; `image/svg+xml` is refused outright, because SVG carries script and the media
  view serves from the Home Assistant origin. Manuals accept `application/pdf`.
- `filename` is display metadata. The file on disk is named from `id` and the type.
- `title` is what the user called it; **empty means show `filename`**.
- `order` is position within the item's attachments of the same *kind*, counted from zero
  within it. **The picture at `order` 0 is the item's cover**; there is no separate flag.
  Adding appends: the backend assigns the next free position in the kind and ignores any
  `order` the caller sent. Both fields default (`""`, `0`) when absent, and a list where
  every entry defaults reads in stored order.
- Files live at `<config>/haventory/attachments/<item_id>/<attachment_id><ext>`, inside the
  config directory so HA backups carry them, and outside both the integration package (which
  HACS replaces on upgrade) and `<config>/www` (which is `/local`, unauthenticated). They are
  served only through the authenticated view; see `backend_api_contract.md`. An item's
  directory is removed once its last file is deleted; one that still holds anything else is
  kept. A file no stored metadata references is removed at setup — except when the store
  holds no items at all, when every file is left where it is and a warning names how many,
  because a store that was lost or has not been read yet looks the same from here.
- Caps: 10 pictures and 10 manuals per item, 8 MB per file. `haventory/config` reports all
  of them so a picker can refuse early.
- A picture also has a **row tile**: `?size=thumb` on the media route serves a 256px WebP
  written beside the original the first time something asks for one. It is derived, never
  stored metadata, and an export carries no reference to it. Pillow is not a dependency:
  where it is unavailable, or the file cannot be decoded, the original is served instead.

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

`children` is a recursive array of tree nodes with the same structure. The two `matching_*`
counts are present **only** when `location/tree` was called with a `filter`; they mirror
the two counts below over the items that filter keeps. `direct_item_count` counts items
located exactly at the node; `subtree_item_count` counts items at the node or any descendant
(so it is always >= the direct count).

### Filters and sorting

- ItemFilter:
  - `q?: string` (case- and accent-insensitive substring match, mid-word included; every
    word of the query must appear in one of name, description, category, tags or the
    location display path)
  - `tags_any?: string[]` (a value that is not a list of strings is a `validation_error`)
  - `tags_all?: string[]` (same rule)
  - `category?: string`
  - `categories?: string[]` (multi-select beside `category`; see the union rule below)
  - `status?: <status slug>` (exact match against the live status set; unknown values are
    `validation_error`)
  - `checked_out?: boolean`
  - `low_stock_only?: boolean`
  - `orphaned_only?: boolean` (only items without a location, i.e. `location_id == null`)
  - `overdue_only?: boolean` (only items whose `due_date` is strictly before today)
  - `checked_out_due_only?: boolean` (only items whose `due_date` is **on or before**
    today: `overdue_only`'s population plus the items due back today)
  - `inspection_overdue_only?: boolean` (only items whose `inspection_date` is strictly
    before today; independent of check-out state)
  - `inspection_due_only?: boolean` (only items whose `inspection_date` is **on or before**
    today; independent of check-out state)
  - `reminder_due_only?: boolean` (only items whose `reminder_date` is **on or before**
    today)
  - "today" in those five is the day Home Assistant is configured for, read once per
    query, the same day the counts, the calendar entity and the card's chips use
  - `location_id?: uuid-v4|null`
  - `location_ids?: uuid-v4[]` (multi-select beside `location_id`; see the union rule below)
  - `area_id?: string|null` (`null`, like an omitted key, is no area filter at all)
  - `include_subtree?: boolean` (governs the whole `location_id` + `location_ids`
    selection, not one entry)
  - `low_stock_first?: boolean`
  - `updated_after?: ISO8601Z` (strictly greater-than)
  - `created_after?: ISO8601Z` (strictly greater-than)
  - `updated_before?: ISO8601Z` (strictly less-than; combine with `updated_after` for a
    range)
  - `created_before?: ISO8601Z` (strictly less-than; combine with `created_after` for a
    range)

  **The multi-select rule.** `category`/`categories` and `location_id`/`location_ids` are
  each *one* selection: the scalar and the list are unioned, and an item matches if it
  carries any value in that union. They are never intersected, because an item has exactly
  one category and sits in exactly one location, so requiring both keys to hold would match
  nothing whenever they name different values. Both keys are optional and either may be sent
  alone; the card sends only the plural. An empty list does not narrow at all. Entries are
  trimmed and de-duplicated, categories case-insensitively. A value that is not a list of
  strings is a `validation_error` naming the key, the rule `tags_any` and `tags_all` follow
  too. A `location_ids` entry that is not a valid UUID v4 contributes nothing, so a
  selection of only bad ids matches nothing.

  `include_subtree` is **one flag for the whole location selection**, not one per entry.
  Set, an item matches when it sits in, or under, any selected location. A per-entry form is
  deliberately not offered, and can be added later without breaking this form.

- Sort:
  - `{ field: "updated_at"|"created_at"|"name"|"quantity"|"due_date"|"inspection_date"|"reminder_date"|"location", order: "asc"|"desc" }`
  - `due_date` / `inspection_date` / `reminder_date`: items without a date sort last in both
    orders; ties break by id asc. `reminder_date` orders on the next occurrence, not on
    `reminder_anchor`.
  - `location` orders on the item's own denormalized `location_path.sort_key`, the same key
    the Location column displays a path from. **Items with no location sort last in both
    orders.** Because an item's area is inherited from its location tree's root, a
    path-ordered list groups by root, and therefore by area.
  - There is **no area sort**, deliberately. `effective_area_id` is not stored on an item,
    and an area's *name* lives in Home Assistant's own registry, which neither the models nor
    the repository can reach. A sort field for it would still order by `area_id`, which Home
    Assistant generates from the name at creation and never changes on rename, so a renamed
    area would sort under its old name.

**Unknown keys are rejected**, in a filter and in a sort alike: the reply is
`validation_error` naming the offending key. A dropped key is worse than a refused one: a
filter that lost its only predicate returns the whole inventory, and nothing in the reply
says the filter did not apply. `sort` accepts `field` and `order` and nothing else. The
accepted filter key set is exactly the list above, read off the filter type itself, so a
filter key added later is accepted the moment it is declared.

**`area_id` is checked on its value too.** It is the one filter key answered by an index
alone (an item's area is resolved from its location tree, which the item-by-item pass cannot
walk), so a value that names no area would narrow nothing at all. Anything other than `null`
or a string with non-whitespace in it is `validation_error` ("area_id must be a non-empty
string or null"), on `item/list` and on `haventory/subscribe` alike. Leading and trailing
whitespace is trimmed off the rest. A well-formed `area_id` that no location resolves to is
a normal empty answer, not a refusal.

### Pagination

- `item/list` returns `{items: <Item[]>, next_cursor: string|null, total: number}`.
- `total` is the count of items matching the filter across all pages, independent of
  `limit`/`cursor`.
- `cursor` is an opaque base64url-encoded JSON with the last tuple and sort metadata; pass
  it back unchanged.
- A cursor that cannot be honoured is `validation_error`, never a silent restart at page
  one: empty, undecodable, longer than 2048 characters, missing `last_id` /
  `last_sort_key`, or minted under a different `sort` or a different `low_stock_first`
  setting than the request carries. Restart pagination by omitting `cursor`; sending `""`
  is refused.
- Changing the sort means dropping the cursor. A cursor addresses a position in one specific
  ordering. `filter.low_stock_first` changes the ordering the same way (it splits the list
  into a low-stock block and the rest, sorted within each), so the cursor carries the item's
  block beside its sort key, and flipping the setting mid-walk drops the cursor too.

### Stats

Counts object used in `stats` results and events:
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

`no_location_count` is the number of items without a location (`location_id == null`).
`overdue_count` is the number of items whose `due_date` is strictly before today; it moves
with the calendar, so the same data can report a different count tomorrow.
`checked_out_due_count` asks it inclusive of today, so it is `overdue_count` plus the items
due back today. `inspection_overdue_count` is the same question asked of `inspection_date`,
over the whole inventory rather than only the checked-out items. `inspection_due_count`
asks it inclusive of today. `reminder_due_count` is the `reminder_date` equivalent,
inclusive of today in the same way. Throughout, *due* includes today and *overdue* does not.
`missing_count` / `needs_repair_count` count items by their stored `status`; unlike the
calendar counts they only change on a mutation, so events keep them current.
`status_counts` is that same count for every defined slug, `ok` included. It is additive to
the two named keys, not a replacement for them.

### Distinct values

Result of `distinct_values`, used by category and tag autocomplete, the browser views, and
custom-field key suggestions:
```json
{
  "categories": [ { "value": "Books", "count": 1 }, { "value": "Tools", "count": 2 } ],
  "tags": [ { "value": "blue", "count": 2 }, { "value": "red", "count": 2 } ],
  "custom_field_keys": [ "serial", "Voltage", "warranty_until" ]
}
```

With a filter on the request, each category and tag entry also carries `matching_count`:
```json
{
  "categories": [ { "value": "Books", "count": 1, "matching_count": 0 }, { "value": "Tools", "count": 2, "matching_count": 1 } ],
  "tags": [ { "value": "blue", "count": 2, "matching_count": 1 }, { "value": "red", "count": 2, "matching_count": 0 } ],
  "custom_field_keys": [ "serial", "Voltage", "warranty_until" ]
}
```

- `DistinctValue`: `{ value: string, count: number, matching_count?: number }` where `count`
  is the number of items using that value.
- `matching_count` is how many of that value's items the request's filter keeps. Present on
  every `categories` and `tags` entry when the request carried a `filter`, absent from all
  of them when it did not, so `undefined` means "unpriced", never "nothing matches". No
  entry is dropped for matching nothing; `count` is unaffected by the filter, and
  `custom_field_keys` is never filtered.
- Categories are grouped case-insensitively; `value` is a representative display label
  (most frequent original casing, ties broken alphabetically). Tags are already normalized
  (lowercase), so `value` is the tag itself.
- Both value lists are sorted case-insensitively by `value`. Items with no category (or no
  tags) contribute nothing to the respective list.
- `custom_field_keys` is the sorted, distinct set of keys used across all items'
  `custom_fields` (keys are case-sensitive; sorted case-insensitively). Empty when no item
  has custom fields.

### Import / export (data safety)

`ExportDocument`, the versioned backup produced by `haventory/export` and accepted by
`haventory/import/preview` / `haventory/import/execute`:
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

- `haventory_export_version` versions the document envelope; `schema_version` is the
  storage schema of the embedded item and location shapes.
- `items` / `locations` are arrays of the canonical `Item` / `Location` shapes above,
  including the denormalized `location_path` / `path` (with `sort_key`) so a round-trip
  reproduces the data exactly. The document is machine-generated and best treated as
  opaque; hand-editing works but paths are recomputed on import.
- `statuses` carries the slug-to-label mapping, because items store only the slug and a
  restore onto a fresh install would otherwise lose every custom label. An absent section
  reads as the built-in three, permanently.
- Each item's `attachments` travels as **metadata only**; one WebSocket frame cannot carry
  binaries. Importing onto an install that does not hold the files leaves the references in
  place and `import/preview` reports how many are missing. The full-fidelity backup path is
  Home Assistant's own, which carries the media directory with the store.

`ImportPreview`, the result of `haventory/import/preview` (no mutation):
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
  }
}
```

- Buckets are mutually exclusive per entity: `add` (id absent), `unchanged` (present and
  identical), `update` (present, differs, resolved by `merge`/`replace`), `conflict`
  (present, differs, left as-is by `skip`). Under `merge`/`replace` `conflict` is empty;
  under `skip` `update` is empty.
- When `valid` is `false`, `errors` (each `{path, message}`) explains why and `counts` is
  empty. Envelope problems (bad or missing versions, malformed `items`/`locations`, a
  `schema_version` newer than supported), invalid entities, duplicate ids, and broken
  references (an item's `location_id` with no matching location) all surface here. "Newer
  than supported" is two errors, not one: a stamp of 2 through 9 is one this project used
  before the schema was collapsed to 1, which no newer build reads, so the message says to
  open the document on HAventory 0.8.x and export again rather than to upgrade. A document
  is held to what `Repository.load_state` accepts, not to the write path's input caps: the
  rules every release has enforced (the 120-character name limit, canonical timestamps, the
  `due_date` and `checked_out` invariant, every date's calendar validity, the `{unit, count}`
  shape of `reminder_interval` and its need for an anchor, statuses the document can name)
  are checked, and the free-text and collection caps are not, because a store written before
  those caps existed exports data that must import back. See "Input caps" below.
- A `reminder_interval` whose unit is misspelled is a **rejected row**, not a silent loss.
  The load path tolerates one it cannot read, so an unchecked import would have stored the
  item with its recurrence quietly gone.
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

- A warning **never** affects `valid` and **never** reaches `import/execute`. The preview
  tells; the id still decides.
- `code` discriminates the kind. `errors` needs none, because every error means "this
  document is unusable", while warnings accumulate kinds.
- `name_collision` is raised for an incoming entity classified `add` whose name matches that
  of a stored entity **of the same kind carrying a different id**. Names are compared
  case-insensitively, accent-folded and whitespace-collapsed, the same comparison the
  repository uses for names.
- `existing_ids` lists **every** stored entity of that name, not one of them. Location trees
  repeat leaf names ("Shelf A", "Drawer 1"), so a hand-rebuilt tree collides several deep on
  one name at once.
- `message` is one self-contained sentence, because a client renders one per clash. It names
  the incoming entity by its own `display_path` where it has one, then quotes the colliding
  stored locations' paths, or counts the colliding stored items, which have no path of their
  own. At most three stored paths are quoted and the rest are counted; `existing_ids` stays
  complete either way.
- Only the `add` bucket is checked. `update` and `unchanged` are the same entity by id, so a
  shared name there is an ordinary namesake, and a clean round trip produces **zero**
  warnings under every policy. Incoming-vs-incoming name matches are out of scope: duplicate
  ids inside one document are already an error, and two same-named entities in one document
  are the exporting inventory's business.

`ImportSummary`, the result of a successful `haventory/import/execute`:
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

Common envelope inside the HA WS event wrapper:
```json
{ "domain": "haventory", "topic": "items|locations|stats|statuses", "action": "...", "ts": "ISO8601Z", ... }
```

- Items: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`,
  `quantity_changed` with `{item: <Item>}`. `item` may be **absent** on any items event, and
  its absence means "refetch" rather than "patch this item": `reloaded` after an import
  replaces the dataset, and `updated` after `status/delete` with `reassign_to` rewrites every
  item carrying the slug at once.
- Locations: `created`, `renamed`, `moved`, `deleted` with `{location: <Location>}`; plus
  `reloaded` (no `location`) after an import. `moved` covers both ways a location is
  re-anchored, a new parent and a new area, because each rewrites `effective_area_id` for
  everything under it. The `location` payload is the one the command targeted, which for an
  area sent to a nested location is not the location whose stored `area_id` changed: a
  tree's area lives on its root. Read a `moved` event as "re-list this subtree", not as a
  patch.
- Stats: `counts` with `{counts: <Counts>}`.
- Statuses: `created`, `updated`, `deleted` with `{status: <StatusDefinition>}`, and
  `reordered` with `{statuses: <StatusDefinition[]>}`, which carries the whole vocabulary in
  its new order.
- Every topic: `unavailable` (common fields only), sent once per open subscription when the
  config entry serving it tears down. The subscription is over at that point; see the API
  contract's "While no entry is loaded".

Subscription filters (`haventory/subscribe`) are matched against the payload above, not
against the repository:

- `location_id` / `location_ids` / `include_subtree` read the item's
  `location_path.id_path` (or the location's own `path.id_path`). The scalar and the list are
  unioned exactly as `ItemFilter` unions them, and `include_subtree` (defaulting to **true**
  here, unlike the list filter) applies to the whole selection.
- `area_id` reads the item's `effective_area_id`, so it selects the same area
  `ItemFilter.area_id` does, and is refused on the same terms: anything but `null` or a
  string with non-whitespace in it answers `validation_error` when the subscription is
  opened. An item with no location carries `effective_area_id: null` and matches no area
  filter; a `null` or omitted `area_id` on the subscription means no area filter at all.
  `area_id` applies to the `items` topic only.
- Filters combine with AND, and every one of them is applied to the payload as it stands
  *after* the mutation. An item that leaves a filtered set produces no event for that
  subscription, so a client tracking one re-lists rather than waiting for a departure
  event, including after a `locations` `moved` event, which is the only signal that a
  subtree's `effective_area_id` was rewritten.

### Home Assistant bus events

Fired on the HA bus after the durable write, from WebSocket mutations and `haventory.*`
service calls alike. Separate from the WebSocket events above; see the API contract's "Home
Assistant bus events".

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
  "ts": "ISO8601Z"
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
  "ts": "ISO8601Z"
}
```

`location_path` is the **display path string**, not the object the WebSocket Item carries,
because a trigger template wants one readable value. The payload deliberately omits
`custom_fields`, `description`, `tags` and the rest; an automation that needs them calls
`haventory/item/get`. On a `cleared` fired for an item that was deleted, `name`, `quantity`
and `low_stock_threshold` come from the body the delete removed.

### Service responses

Every `haventory.*` service declares `SupportsResponse.OPTIONAL` and answers with the same
shapes as the WebSocket surface. No bespoke service shape exists:

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
- Reminders reach automations through the same services rather than through three of their
  own: `item_create` and `item_update` carry `reminder_date` and `reminder_interval` (either
  set to `null` clears it), and `reminder_bump` exists because "I have just done this" is a
  question about where the series goes next rather than a field write. It answers the item
  as the bump left it, so a script can template `reminder_date` out of the response. The
  rule lives in one place, `calendar_projection.bumped_reminder_date`, which the WebSocket
  command also calls.
- `item_delete` and `location_delete` return the entity as it last stood, read before the
  removal. Deleting an unknown id is `not_found`, not an empty envelope. `item_delete` also
  frees the item's attachment files after the write, exactly as `haventory/item/delete` does.
- The response is produced **after** the durable write, so an answer means the mutation is
  persisted, the same ordering the WebSocket contract states for events.
- `OPTIONAL`, not `ONLY`: a caller that omits `response_variable` is unaffected.

### Validation notes

- UUIDs must be version 4.
- Dates use `YYYY-MM-DD` and are validated for real calendar dates, on every write path and
  on import alike.
- The calendar derives its occurrences from those stored dates on every read. One it cannot
  parse (reachable only by hand-editing the store) costs that item its occurrences and is
  logged once; the rest of the inventory still renders.
- `name` trimmed; max length 120 for items and locations.
- `custom_fields` keys must be non-empty strings; values must be scalars.
- `tags` is a list of strings on every item write, and `null` clears the list. A value that
  is not one (a bare string, which iterates as its characters) is refused rather than read,
  on the whole-list write and on the two tag operations alike.
- Every other collection a caller writes whole follows that rule and answers it the same
  way, naming the key the caller sent: `custom_fields`, `custom_fields_set`,
  `custom_fields_unset`, `update_custom_fields`'s `set` and `unset`, `attachment_ids` and
  `slugs`. The last two name a whole set as a permutation, so nothing is trimmed or
  de-duplicated on the way in: a list naming one member twice is a client bug, and
  normalizing it would hide it.

#### Input caps

Every free-text and collection field is bounded. The store is one JSON document rewritten
in full on every mutation, so an unbounded field is a cost every later write keeps paying.
Over a cap is `validation_error`, at a cap is accepted:

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

The caps refuse *growth*, not every edit. An item that predates them (one loaded from a
store written by an earlier release) can still be edited and saved as it is, including by
the edit that trims part of the excess without clearing all of it. What an edit cannot do is
make an over-cap value larger: lengthen an over-cap text past what is stored, add to a
collection already over its cap, or introduce a *new* value over a cap. The card's editor
applies the same rule client-side, so a legacy item is never trapped behind its own history.

`import/preview` and `import/execute` do **not** apply these caps at all. A document is a
restore, held to exactly what `Repository.load_state` accepts. `load_state` deliberately
does not re-validate, because a store written before the caps existed is legal data this
integration itself wrote, and an export of such a store must import back, or a backup stops
being one. What import *does* refuse is data no store can legally carry: structural
problems, non-v4 UUIDs, the 120-character name limit, non-canonical timestamps, unknown
statuses, and a `due_date` on an item that is not checked out, each reported per field in
`report.errors` as a refused import rather than as dropped rows.
