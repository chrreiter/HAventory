## HAventory WebSocket API Contract

The WebSocket API is the integration's primary surface: every `haventory/*` command, its
errors, and the events it broadcasts. The handlers are `custom_components/haventory/ws.py`,
the writes they share with the `haventory.*` services are `ops.py`, and the subscription
registry and fan-out are `subscriptions.py`. Payload and result shapes (`<Item>`,
`<ItemFilter>`, `<Counts>` and the rest) are in [`data_shapes.md`](data_shapes.md).

A change to a command moves `ws.py`, this document and `data_shapes.md` in the same pull
request. `tests/test_docs_contract_offline.py` holds two lists in this document to the code:
the `items/bulk` kinds and the `quick_filters` vocabulary.

### Envelope

- Requests: an object with at least `id` and `type`; the remaining fields are the payload.
- Success responses:
```json
{"id": 1, "type": "result", "success": true, "result": {"...": "..."}}
```
- Error responses:
```json
{"id": 1, "type": "result", "success": false, "error": {"code": "validation_error", "message": "bad input", "data": {"op": "item_create", "item_name": "..."}}}
```
- Error `data` carries structured context: `op` and selected request fields such as
  `item_id` or `expected_version`. A request `name` is reported as `item_name`,
  `location_name` or `ctx_name`, because `name` is a reserved log-record key.
- Events arrive in Home Assistant's event wrapper, under the subscription's `id`:
```json
{"id": 100, "type": "event", "event": {"domain": "haventory", "topic": "items", "action": "created", "ts": "2024-01-01T00:00:00.123456+00:00", "item": {"id": "..."}}}
```

### Errors

| Code | Meaning |
|---|---|
| `validation_error` | invalid input or an invariant violation |
| `not_found` | the referenced entity does not exist |
| `conflict` | a stale `expected_version` (see "Versioning and concurrency") |
| `storage_error` | a persistence or setup problem, including any command sent while no config entry is loaded |
| `unknown_error` | anything else; the message is always `"unexpected error; see Home Assistant logs"` |

Every `haventory/*` command runs inside the same guard (`ws_guard`):

- Domain errors carry the exception message plus the `data` context above.
- An unexpected exception answers `unknown_error`. Exception text and tracebacks never
  reach the client; the traceback goes to the server log.
- A single-item command, the `items/bulk` row naming the same `kind` and the `haventory.*`
  service doing the same thing run one function in `ops.py`, so one payload gets one answer
  from all three. A value the payload is wrong about (a `quantity` that is not an integer
  `>= 0`, an `item_id` that is not a non-empty string) is refused before the item is looked
  up, so it answers `validation_error` even when the id names nothing.

Home Assistant itself can answer two more codes before a handler runs: `invalid_format`
(the frame failed the command's voluptuous schema) and `unknown_command` (the integration
is not loaded, or the `type` is unknown).

#### `validation_error` or `invalid_format`

A client handles both. The split is about where the frame stopped, not about the field.

Most payload fields are typed `object` in their command schema (names, quantities, ids,
filters, and every collection a caller writes whole: `tags`, `custom_fields`,
`custom_fields_set`, `custom_fields_unset`, `set`, `unset`, `attachment_ids`, `slugs`), so
the model reads them and answers `validation_error` naming the field. A bare string where a
list belongs is refused rather than iterated as its characters.

`invalid_format` answers a frame the schema refuses on shape (a missing `id`, an unknown
top-level key, a required field left out) and the fields a schema still types concretely:
`expected_version`, the boolean flags, the date strings, the attachment and status handles,
and import's `document` and `policy`. Which fields those are is not part of the contract.

Under either code nothing is written. `items/bulk` rows carry no schema at all, so every
wrong type in a row answers that row with `validation_error`.

#### Logging

Every rejection is logged once, with the same context the envelope carries:

| Level | Traceback | Codes |
|---|---|---|
| WARNING | no | `validation_error`, `not_found`, `conflict`, and the `storage_error` for "no entry is loaded" |
| ERROR | yes | every other `storage_error`, and `unknown_error` |

A genuine `storage_error` wraps a lower-level failure whose cause chain is the only record of
what broke, so it keeps its traceback. The "no entry is loaded" refusal is graded on the
exception (`NotLoadedError`) rather than on the code: it reports a state somebody chose, and
a dashboard left open retries it for as long as the tab stays open. The `haventory.*`
services follow the same policy and grade their own schema rejections as
`validation_error`.

### While no entry is loaded

Home Assistant cannot unregister a WebSocket command, so every `haventory/*` command stays
dispatchable after the config entry is unloaded, disabled, removed, or halfway through a
reload. In each of those states:

- **Every command** answers `storage_error`, `ping`, `version` and `config` included.
- **Nothing is written.** A mutation is refused before it reaches the repository.
- **Live subscriptions end**, each told so by the `unavailable` action (see "Events").
- **The next setup restores everything.** Teardown flushes the inventory and setup reads it
  back. Removal keeps the store file too, so re-adding the integration brings the inventory
  with it ([`installing.md`](installing.md#removing-haventory)).

A client cannot tell a reload from a removal by code alone. Re-opening the subscriptions on
a bounded backoff covers both: a reload answers again within seconds, and a removal runs the
budget out and leaves the client to tell the user.

### Utility commands

- `haventory/ping`
  - Request: `{id, type, echo?: any}`
  - Result: `{echo: any, ts: string}`

- `haventory/version`
  - Result: `{integration_version: string, schema_version: number}`

- `haventory/config`
  - Result: `{card_title: string, quick_filters: string[] | null, statuses: StatusDefinition[], media: MediaConfig}`
  - `card_title` is the heading set in the integration's options flow (Settings → Devices &
    services → HAventory → **Configure**), `"HAventory"` when unset.
  - `quick_filters` is which quick-filter pills the integration offers, out of `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`, set in the same options flow. `null` means no choice was made and leaves it to the client (a dashboard's own `quick_filters:` first, every pill otherwise); `[]` is an explicit choice of no pills. Names the backend does not know are dropped before sending.
  - `statuses` is the status vocabulary in display order, the same array `status/list`
    returns. Items store only a slug, so this is where a client gets the label.
  - `media` is `{picture_mime_types: string[], max_pictures_per_item: number, manual_mime_types: string[], max_manuals_per_item: number, max_attachment_bytes: number}`,
    reported so a picker can refuse a doomed file before uploading it. **Advisory only**:
    the server re-checks every one of them against the file's own bytes. The media route is
    not here; it is a constant on both sides, pinned by `tests/test_frontend_registration.py`.
  - Read on demand and never pushed: changing the option emits no event, so an open
    dashboard shows the new value after a refresh.

- `haventory/stats`
  - Result: `<Counts>`. What each count means is in `data_shapes.md` → "Stats".
  - Five counts are derived from today's date and move with no mutation behind them. "Today"
    is the day Home Assistant is configured for, the same day `calendar.haventory` and
    `reminder/bump` use. At the instance's local midnight an open `stats` subscription
    receives one `counts` event, the date-derived sensors rewrite their state and the
    calendar rewrites its next event.
  - Every other count changes only on a mutation, and every mutation emits `stats/counts`.

- `haventory/distinct_values`
  - Request: `{id, type, filter?: <ItemFilter>}`. Any other field is `invalid_format`; an
    unknown key *inside* `filter` is `validation_error` naming it, as for `item/list`.
  - Result: `{categories: DistinctValue[], tags: DistinctValue[], custom_field_keys: string[]}`
  - With a `filter`, every `categories` and `tags` entry also carries `matching_count`.
    **The lists never shrink**: an entry the filter keeps nothing of is present at
    `matching_count: 0`, because the same payload feeds autocomplete and the organize dialog.
  - Which dimensions to leave out of `filter` is the caller's decision. The card drops
    `category` and `tags_any`/`tags_all` before sending: a facet priced against its own
    selection reads 0 on every other row exactly when the user wants to see where else the
    matches are.
  - Read-only.

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <Counts>}`
  - `healthy` is always `true` and `issues` always empty. Index consistency is checked by the
    test suite (`tests/repository_invariants.py`), not at runtime. `counts` is what is worth
    reading.

- `haventory/areas/list`
  - Result: `{areas: [{id: string, name: string}]}`, read from Home Assistant's area
    registry. HAventory never creates an area.

### Subscriptions and events

- `haventory/subscribe`
  - Request: `{id, type, topic: "items"|"locations"|"stats"|"statuses", location_id?: string|null, location_ids?: string[], area_id?: string|null, include_subtree?: boolean, inspection_overdue_only?: boolean}`
  - Result: `null`. Events then arrive on the same connection under this `id`.
  - An unknown `topic` is `validation_error`.
  - `location_id` and `location_ids` are one selection, unioned exactly as `ItemFilter`
    unions them, and apply to the `items` and `locations` topics. `include_subtree` governs
    the whole selection and defaults to **true** here, unlike the list filter. Items match
    when their `location_path.id_path` contains a selected id (or, without the subtree, when
    `location_id` is one); locations match themselves and, with the subtree, their
    descendants. A card filtering by several locations has to send `location_ids`, or the
    socket keeps delivering the other locations' events.
  - `area_id` narrows the `items` topic to items whose `effective_area_id` equals it, and is
    refused on the same terms as `ItemFilter.area_id`. `null` or an omitted key means no area
    filter. An item with no location has `effective_area_id: null` and reaches no
    area-filtered subscription. The `locations` topic ignores `area_id`.
  - `inspection_overdue_only` narrows the `items` topic with the `item/list` filter's rule.
  - Filters combine with AND and are applied to the event's payload as it stands **after**
    the mutation, so an item that leaves a filtered set produces no event for that
    subscription. A client tracking a filtered set re-lists rather than waiting for a
    departure event.

- `haventory/unsubscribe`
  - Request: `{id, type, subscription: number}`
  - Result: `null`
  - The subscription is also registered in Home Assistant's own connection registry, so
    core's `{type: "unsubscribe_events", subscription}` ends it too; that is what the
    frontend's `connection.subscribeMessage` uses. Closing the connection ends every
    subscription on it.

#### Events

Every event carries `{domain: "haventory", topic, action, ts}` plus a payload:

| Topic | Actions | Payload |
|---|---|---|
| `items` | `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`, `reloaded` | `{item: <Item>}`, or nothing (below) |
| `locations` | `created`, `renamed`, `moved`, `deleted`, `reloaded` | `{location: <Location>}`; nothing on `reloaded` |
| `statuses` | `created`, `updated`, `deleted` / `reordered` | `{status: <StatusDefinition>}` / `{statuses: <StatusDefinition[]>}` |
| `stats` | `counts` | `{counts: <Counts>}` |
| every topic | `unavailable` | nothing |

- **An `items` event may omit `item`.** Its absence means "refetch", not "patch": the
  dataset moved wholesale. That is `reloaded` after `import/execute`, and `updated` after
  `status/delete` with `reassign_to`. Key on the presence of `item`, not on the action name.
  Subscription filters are not applied to a payload-less event; every open `items`
  subscription receives it.
- **`deleted`** carries the item or location as it stood before the delete.
- **Locations `moved`** covers both ways a subtree is re-anchored: a new parent, and a new
  area. Either rewrites `effective_area_id` for everything under it, and neither emits item
  events, so an area-filtered `items` subscription sees no departure or arrival. The
  `location` payload is the one the command targeted, which for an area sent to a nested
  location is not the root whose `area_id` changed. Read it as "re-list this subtree".
- **`stats/counts`** follows every mutation and the instance's local midnight. It is the one
  event that says nothing was edited, so a client must not read it as a mutation.
- **`unavailable`** is sent once per open subscription when the config entry serving it
  tears down (an unload, a disable, a removal, or the first half of a reload). Every command
  is refused from then on, so a client that re-subscribes backs off rather than giving up.
- **The statuses vocabulary is small**, so a client may equally re-read `status/list` on any
  `statuses` event.
- **Events carry no sequence number.** A client that missed one cannot detect the gap;
  re-listing is the recovery.

#### What an event guarantees

- **An event implies a durable write.** Every mutation persists before it broadcasts and
  before it replies, so a received event on any topic says the write behind it reached
  storage. When the write fails the caller receives `storage_error` and no event is emitted.
  - The guarantee is about the wire, not the running repository: a failed write leaves the
    mutation applied in memory until the next restart reads back what reached disk.
    `import/execute` is the exception and rolls the dataset back.
  - `items/bulk` shares one write across the batch, so a failed write fails the whole
    command and none of its operations broadcast.
  - The midnight `stats/counts` is the one event with no write behind it.
- **Both write paths broadcast the same events.** A `haventory.*` service call emits exactly
  what the WebSocket command doing the same thing emits, because both announce through
  `events.py`. A subscriber cannot tell which surface a change arrived through.

### Home Assistant bus events

HAventory also fires two event types on the **Home Assistant bus**, so an automation can
trigger on the inventory with no WebSocket client. Payloads are in `data_shapes.md` → "Home
Assistant bus events".

| Event type | Fired when | `action` |
|---|---|---|
| `haventory_item_changed` | an item is mutated | `created`, `updated`, `moved`, `quantity_changed`, `checked_out`, `checked_in`, `deleted` |
| `haventory_low_stock` | an item crosses its `low_stock_threshold` | `entered`, `cleared` |

- Both fire after the persist, on every path. A mutation that fails to persist fires nothing.
- The `action` words are the WebSocket ones.
- `haventory_low_stock` is a set diff. The set of low-stock ids is snapshotted at setup (so a
  restart re-announces nothing) and diffed after every mutation: one `entered` on the
  crossing, nothing while it stays low, one `cleared` on restock or deletion. An import
  diffs the same way rather than announcing every row.
- `status/delete` with a reassign target fires one `haventory_item_changed` (`updated`) per
  rewritten item, because each took a new `version`.
- Locations fire no bus event. A location create, delete, rename or re-parent still makes the
  sensors and the calendar repaint, because it moves `locations_total` or the `location_path`
  a calendar event's description is written from. An area-only reassignment repaints
  nothing.

### Items

Every item mutation accepts `expected_version?: number` and answers `conflict` when it is
stale. Unless a command says otherwise it answers the updated `<Item>` and emits the named
`items` event plus `stats/counts`.

| Command | Payload beyond `item_id` and `expected_version` | Event |
|---|---|---|
| `haventory/item/create` | any subset of `ItemCreate`, `name` required; no `item_id` | `created` |
| `haventory/item/get` | none; read-only | none |
| `haventory/item/update` | any subset of `ItemUpdate` | `moved` when the payload carries `location_id`, otherwise `updated` |
| `haventory/item/delete` | none | `deleted` |
| `haventory/item/adjust_quantity` | `delta: number` | `quantity_changed` |
| `haventory/item/set_quantity` | `quantity: number` | `quantity_changed` |
| `haventory/item/check_out` | `due_date?: YYYY-MM-DD\|null` | `checked_out` |
| `haventory/item/check_in` | none | `checked_in` |
| `haventory/item/move` | `location_id: string\|null` | `moved` |
| `haventory/item/add_tags` | `tags: string[]` | `updated` |
| `haventory/item/remove_tags` | `tags: string[]` | `updated` |
| `haventory/item/update_custom_fields` | `set?: {[k: string]: scalar}`, `unset?: string[]` | `updated` |
| `haventory/item/set_low_stock_threshold` | `low_stock_threshold: number\|null` | `updated` |

- `item/delete` answers `null`. The item's attachment files are deleted after the save; a
  write that fails leaves every file where it was.
- `item/check_out` takes an optional `due_date`: omitting it (or sending `null`) checks the
  item out with none. The `haventory.item_check_out` service requires one.
- `add_tags` / `remove_tags` normalize the tags (trimmed, casefolded, deduped) before
  comparing.

#### Reminders

- `haventory/reminder/set`
  - Payload: `{item_id, reminder_date: YYYY-MM-DD, reminder_interval?: {unit, count}|null, expected_version?}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - The command names the **whole** reminder, so an omitted `reminder_interval` means "no
    recurrence" and clears a stored one.
  - `reminder_date` and `reminder_interval` are also writable through `item/update`, which
    is how the card's editor saves them. These commands serve callers with no form.

- `haventory/reminder/clear`
  - Payload: `{item_id, expected_version?}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`. An item with no reminder
    succeeds unchanged apart from its `version`.

- `haventory/reminder/bump`
  - Payload: `{item_id, expected_version?}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - Moves `reminder_date` to the series' next occurrence and **leaves `reminder_anchor`
    where it is**, the only write that does (see `data_shapes.md` → "Item"). A series on
    the 31st therefore lands on the 31st in every month that has one, however often it is
    bumped through a short one: bumped in February it lands on the 28th, and the next one
    is 31 March.
  - Counted from the later of the stored `reminder_date` and today, so a reminder bumped on
    the day it came round advances by one interval, and one nobody bumped for a year lands
    on its next *future* occurrence. Today is the instance's local day.
  - `validation_error` when the item has no reminder, when the reminder has no interval (a
    one-off has no next occurrence; `reminder/clear` ends it), or when the stored dates
    cannot be read, which only a hand-edited store produces.

#### Attachments

- `haventory/item/attachment/add`
  - Payload: `{item_id, file_id: string, kind?: "picture"|"manual", filename?: string, expected_version?}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - The bytes do **not** cross the WebSocket. The client first POSTs the file to Home
    Assistant core's `/api/file_upload` (with the user's auth header) and receives a
    `file_id`, which this command consumes. `kind` defaults to `"picture"`; `filename` is
    display metadata only.
  - Adding an attachment **is** an item edit: it bumps `version` and `updated_at`. A client
    holding the pre-upload version must take the returned item back, or its next write
    comes back `conflict`.
  - The new attachment's `order` is the next free position **within its kind**, so an upload
    appends rather than tying with the item's cover.
  - The accepted type is sniffed from the file's own leading bytes, never taken from the
    browser. `image/svg+xml` is refused outright: SVG carries script and the media view
    serves from the Home Assistant origin.
  - Refusals: `validation_error` for a type outside the kind's allow-list, an empty file or
    one over `max_attachment_bytes`, an unknown kind, or an item already at the per-kind
    maximum; `not_found` for an unknown `item_id` or a `file_id` that expired or was
    already consumed; `conflict` for a stale version; `storage_error` when the move onto
    disk or the save fails.

- `haventory/item/attachment/remove`
  - Payload: `{item_id, attachment_id: string, expected_version?}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`. The file is deleted after the
    save.
  - Refusals: `not_found` for an unknown item or attachment, `conflict` for a stale version.

- `haventory/item/attachment/update`
  - Payload: `{item_id, attachment_id: string, title: string, expected_version?}`
  - Result: `<Item>`; emits `items/updated` only (no `stats/counts`).
  - Retitles one attachment; the file is untouched. An empty title means "show the
    filename".
  - Refusals: `not_found`, `conflict`, and `validation_error` for a title over the cap in
    `data_shapes.md` → "Input caps".

- `haventory/item/attachment/reorder`
  - Payload: `{item_id, kind: "picture"|"manual", attachment_ids: string[], expected_version?}`
  - Result: `<Item>`; emits `items/updated` only (no `stats/counts`).
  - Renumbers one kind. **The first id takes position 0, which makes a picture the item's
    cover.** There is no separate cover flag, so "make cover" is this command. Renumbering
    pictures never moves a manual.
  - Refusals: `validation_error` unless `attachment_ids` is a list of strings naming every
    attachment of that kind exactly once; `not_found` for an unknown item; `conflict`.

- Serving an attachment: `GET /api/haventory/media/{item_id}/{attachment_id}`
  - An authenticated `HomeAssistantView`, not `/local` and not `/haventory_static`. Both of
    those are served without authentication, and an inventory photo is as private as the
    inventory.
  - Both ids are matched against stored metadata before any path is built, so no request
    segment reaches the filesystem. Anything unmatched, and an entry whose file is absent,
    is `404`. While no config entry is loaded the view answers `503`.
  - Responses carry the stored content type and `X-Content-Type-Options: nosniff`.
  - `?size=thumb` asks for the **row tile**: a WebP of at most 256px on its longest edge,
    written beside the original the first time it is asked for, keeping the source's
    transparency. Any other `size` value is `400`. Without it the original is served.
  - Pillow is **not** a declared requirement, so `size=thumb` is a request, never a
    guarantee. No Pillow, an animated GIF, a manual, an undecodable file or an unwritable
    directory each serve the original. A file that cannot be encoded is remembered for the
    life of the process.
  - The tile is `<attachment_id>.thumb<N>.webp`, where `N` is the encoder generation
    (`THUMBNAIL_GENERATION` in `const.py`). Raising `N` retires every existing tile: setup's
    orphan sweep deletes files no metadata names, and the next request writes a new one. A
    tile holds no metadata, appears in no export, and can be deleted at any time.
  - `Content-Disposition` is always `inline` and names the file after the attachment's
    `title`, or its `filename` when untitled, as RFC 5987 `filename*=UTF-8''…` with a quoted
    printable-ASCII `filename` beside it (the attachment id when nothing printable is left).
  - `Cache-Control` is `private, max-age=31536000, immutable` when the URL carries the `v`
    parameter and `private, no-store` without it. An attachment id addresses fixed bytes,
    but a retitle changes the name in `Content-Disposition`, so a client puts a token for
    the current name in `v`. Only the presence of `v` is read.
  - An `<img src>` carries no `Authorization` header, so a client signs the path with core's
    `auth/sign_path` and renders the signed URL. Home Assistant signs query parameters with
    the path, so `v` and `size` go on the path **before** signing, which is why a tile and
    its original are two signatures.

#### Bulk operations

- `haventory/items/bulk`
  - Payload: `{operations: Array<{op_id: string|number, kind: string, payload: object}>}`
  - Supported `kind` values: `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `item_add_tags`, `item_remove_tags`, `item_update_custom_fields`, `item_set_low_stock_threshold`.
  - Each `payload` is the payload of the single-item command of the same name, `item_id`
    and `expected_version` included.
  - Result: `{results: { [op_id: string]: {success: true, result: <Item>} | {success: false, error: {code, message, context}} }}`
  - A failing operation fails only its own row; the rest still run, and the successful ones
    persist in one shared write. Each successful row emits its own `items` event, and the
    batch emits one `stats/counts` if any row succeeded. A failed *write* fails the whole
    command with `storage_error` and returns no `results`.
  - The envelope is validated first. A malformed entry (not an object, an `op_id` that is
    missing or neither a string nor an integer, a non-string `kind`, a non-object
    `payload`) rejects the whole command with `validation_error` and runs nothing. So does a repeated `op_id`;
    ids are compared as strings, so `1` and `"1"` are the same id.
  - A successful `item_delete` row answers the item as it stood before the delete, and its
    attachment files are freed after the batch's write. An unknown `kind` fails only its
    row, with `validation_error`.

#### Listing

- `haventory/item/list`
  - Payload: `{filter?: <ItemFilter>, sort?: <Sort>, limit?: number, cursor?: string}`
  - Result: `{items: <Item[]>, next_cursor: string|null, total: number}`
  - `total` counts the matches across **all** pages, so "Showing N of `total`" renders on
    every page.
  - Without `sort` the order is `updated_at` descending. Without a positive `limit` every
    match comes back in one page with `next_cursor: null`, and `cursor` is not decoded.
  - **Unknown `filter` and `sort` keys are refused** with `validation_error` naming the key.
    The filter semantics, the multi-select union rule and the `area_id` check are in
    `data_shapes.md` → "Filters and sorting".
  - **A `cursor` that cannot be honoured is an error, never a silent restart.** Refused as
    `validation_error`: an empty string, an undecodable cursor, one longer than 2048
    characters, one missing `last_id` / `last_sort_key`, and one minted under a different
    `sort` or `filter.low_stock_first` than the request carries. To restart, omit `cursor`.
  - `filter.low_stock_first` is part of the ordering the cursor describes: it regroups the
    sorted list into a low-stock block first, with the chosen sort inside each block.

### Locations

A location has no `version`; a location edit is last-write-wins. `area_id`, where a command
takes one, must name an area in Home Assistant's registry (`validation_error` "unknown
area_id" otherwise) or be `null`.

- `haventory/location/create`
  - Payload: `{name: string, parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `locations/created` and `stats/counts`.

- `haventory/location/get`
  - Payload: `{location_id: string}`
  - Result: `<Location>`

- `haventory/location/update`
  - Payload: `{location_id: string, name?: string, new_parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `stats/counts` and **at most one** `locations` event, chosen
    by what actually changed rather than by which keys were sent: `moved` when the parent
    changed or the area the location resolves to changed, otherwise `renamed` when the name
    changed, otherwise none.
  - An area belongs to a tree: an `area_id` sent for a location below the root is stored on
    the root, and the comparison is on the resolved area. An `area_id` that resolves to the
    area already in force moves nothing and announces nothing.

- `haventory/location/move_subtree`
  - Payload: `{location_id: string, new_parent_id?: string|null}`
  - Result: `<Location>`; emits `locations/moved` and `stats/counts`. `null` moves the
    subtree to the top level; omitting `new_parent_id` moves nothing.

- `haventory/location/delete`
  - Payload: `{location_id: string}`
  - Result: `null`; emits `locations/deleted` and `stats/counts`.

- `haventory/location/list`
  - Result: `<Location[]>`, flat.

- `haventory/location/tree`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one with an unknown key, is
    `validation_error`)
  - Result: an array of root tree nodes (`data_shapes.md` → "Location"), children nested.
  - Counts change on item create, delete and move, and no event carries them, so a client
    showing them refreshes the tree on item events or on `stats/counts`, not only on
    location events.
  - With a `filter`, each node also carries `matching_direct_count` and
    `matching_subtree_count`, so a sidebar can show "4 / 37". A filter naming `location_id`
    is honoured like any other, so a sidebar wanting per-location counts leaves the location
    dimension out.

Renaming or moving a location rewrites the derived `location_path` of every item in the
subtree without an item event and without touching the items' `version` (see "Versioning
and concurrency"). Clients learn about the new paths from the `locations` event.

### Status definitions

The vocabulary items reference by slug. A slug is immutable, because it is the exact string
every item stores, so only the presentation is editable. No command here rewrites an item
except `status/delete` with a reassign target. None of them emits `stats/counts` except that
one.

- `haventory/status/list`
  - Result: `<StatusDefinition[]>` in display order.

- `haventory/status/create`
  - Payload: `{slug: string, label: string, color?: string, icon?: string, order?: number}`
  - Result: `<StatusDefinition>`; emits `statuses/created`.
  - An absent `order` places it last. The slug, colour and icon rules are in
    `data_shapes.md` → "Status definitions".
  - Refusals: `validation_error` for a malformed or duplicate slug, or a colour or icon
    outside its vocabulary.

- `haventory/status/update`
  - Payload: `{slug: string, label?: string, color?: string, icon?: string, order?: number}`
  - Result: `<StatusDefinition>`; emits `statuses/updated`. No item is touched and no item
    version moves.
  - Refusals: `not_found` for an unknown slug, `validation_error` for a bad value.

- `haventory/status/reorder`
  - Payload: `{slugs: string[]}`
  - Result: `<StatusDefinition[]>` in the new order; emits `statuses/reordered`.
  - Refusals: `validation_error` unless `slugs` is a list of strings naming every status
    exactly once.

- `haventory/status/delete`
  - Payload: `{slug: string, reassign_to?: string}`
  - Result: `{status: <StatusDefinition>, reassigned: number}`; emits `statuses/deleted`,
    and when `reassigned` is non-zero also a payload-less `items/updated` (a refetch
    signal) and `stats/counts`.
  - **Refused while items still carry the slug and no `reassign_to` is given.** With a
    target the items move and the definition is deleted in the same call, so no client can
    observe an item naming a status that no longer exists. Each moved item bumps its
    `version` and `updated_at`.
  - Refusals: `validation_error` for `ok` (never deletable), for an in-use slug with no
    target, or for a target that is unknown or the slug itself; `not_found` for an unknown
    slug.

### Import and export

Backup and restore over WebSocket, in memory. The export document embeds `schema_version`
with every item, location and status definition, so exporting and importing into an empty
instance reproduces the data. The document, preview and summary shapes are in
`data_shapes.md` → "Import / export". Home Assistant's own backups remain the
full-fidelity path: they carry the store and the attachment files.

`import/preview` and `import/execute` accept a document stamped with the current schema or
lower. A higher stamp is refused with a `schema_version` error: stamps 2 through 9 name a
schema only HAventory 0.8.x reads, so that message says to open the document there and
export again; anything higher was written by a newer HAventory, and the message says to
upgrade.

- `haventory/export`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one with an unknown key, is
    `validation_error`)
  - Result: `<ExportDocument>`. Without a filter this is a full backup. With one, only
    matching items are exported, together with the locations on each item's ancestry, so the
    document stays self-consistent.
  - Read-only.

- `haventory/import/preview`
  - Payload: `{document: <ExportDocument>, policy?: "merge"|"replace"|"skip"}` (default
    `merge`)
  - Result: `<ImportPreview>`. Validates and classifies each incoming entity **without
    changing anything**. An invalid document answers `{valid: false, errors: [...]}` rather
    than an error.
  - Every preview carries `warnings`. A warning never affects `valid` and never reaches
    `import/execute`. The one code is `name_collision`: an incoming entity classified `add`
    whose name matches a stored entity of the same kind under a different id, the
    duplicate-on-rebuilt-ids case described under `import/execute`.
  - A valid preview also carries `attachments: {referenced: number, missing: number}`: how
    many attachment references the resulting dataset would hold, and how many name a file
    this install does not have. That is a caveat to show, not an error.

- `haventory/import/execute`
  - Payload: as for `import/preview`.
  - Result: `<ImportSummary>`. Applies the document with the chosen policy, persists, then
    emits `items/reloaded`, `locations/reloaded` and `stats/counts`.
  - An invalid document is refused with `validation_error` whose `data.errors` lists the
    problems, and nothing changes. If the write fails after the in-memory swap, the
    repository is rolled back to its pre-import snapshot and the error is `storage_error`. A
    bad import never leaves partial state.
  - **Identity is the entity id, and only the id.** An incoming entity whose id is present
    *is* the stored one and is resolved by the policy; one whose id is absent is added.
    Names are never compared, because matching by name would fuse two genuinely different
    "Shelf A"s. So importing onto entities that were deleted and recreated by hand (with
    fresh ids) duplicates them: the incoming copies are added, and every incoming item
    follows its own `location_id` onto the incoming location. `import/preview` flags each
    such name as a `name_collision`.
  - Policies, for ids already present: `skip` keeps the stored entity; `replace` overwrites
    it; `merge` overlays incoming onto stored (scalar fields from incoming, `tags` unioned,
    `attachments` unioned by id, `custom_fields` merged with incoming winning per key). For
    locations `merge` behaves as `replace`.
  - **Status definitions are a vocabulary, not an entity the policies act on.** The
    document's `statuses` overlay the stored ones, and a slug the resulting items reference
    without a definition gets one. No policy deletes a definition. A document whose items
    reference a slug that is neither built-in nor defined in it is refused, with an error at
    `items[N].status`.
  - **Attachments travel as metadata only.** `replace` overwrites an item's attachment list,
    so a file the document no longer references loses its only reference, and
    `import/execute` deletes it after the write.

### Versioning and concurrency

- Items carry `version: number`. Every item mutation accepts `expected_version?: number`
  and answers `conflict` on a mismatch; omitting it skips the check.
- `version` counts *item* mutations only. `location/update` and `location/move_subtree`
  rewrite the derived `location_path` of every item in the subtree without bumping its
  `version` or `updated_at`, so an `expected_version` taken before a rename is still
  accepted after it.
- Locations carry no `version` and take no `expected_version`.

### Timestamps

- Stored and returned timestamps (`created_at`, `updated_at`, an attachment's
  `uploaded_at`, an export's `exported_at`) and the `ts` of the bus events are ISO-8601 UTC
  to the second with a trailing `Z`: `2024-01-01T00:00:00Z`.
- The `ts` of a WebSocket event and of `ping` is Python's `isoformat()` of the current UTC
  time, with microseconds and a `+00:00` offset: `2024-01-01T00:00:00.123456+00:00`. Parse
  it as ISO-8601; do not compare it as a string with the stored form.

### Testing against the contract

The offline suite validates the envelope against the stubs in `tests/conftest.py`, which
apply each command's schema before dispatch; the in-process suite (`tests/integration/`)
validates it against a real Home Assistant core. [`developing.md`](developing.md) → "Testing"
covers both.
