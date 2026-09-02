## HAventory WebSocket API Contract

This document specifies the WebSocket message envelope, error codes, command catalog and
event delivery implemented by `custom_components/haventory/ws.py`, with the subscription
registry and the event fan-out in `custom_components/haventory/subscriptions.py`.

### Envelope

- Requests: an object with at least `id` and `type`; the remaining fields are the payload.
- Success responses:
```json
{"id": 1, "type": "result", "success": true, "result": {"...": "..."}}
```
- Error responses:
```json
{"id": 1, "type": "result", "success": false, "error": {"code": "validation_error", "message": "bad input", "data": {"op": "item_create", "field": "name"}}}
```

Notes:
- Error `data` carries structured context: `op` and selected request fields such as
  `item_id` or `expected_version`.
- Events use Home Assistant's event wrapper on the connection:
```json
{"id": 100, "type": "event", "event": {"domain": "haventory", "topic": "items", "action": "created", "ts": "2024-01-01T00:00:00Z", "item": {"id": "..."}}}
```

### Error codes

- `validation_error`: invalid input or an invariant violation
- `not_found`: the referenced entity does not exist
- `conflict`: version mismatch on optimistic concurrency
- `storage_error`: a persistence or setup problem, including a command that arrives while
  no config entry owns the data (see "While no entry is loaded")
- `unknown_error`: fallback for unexpected exceptions

Guarantees (every `haventory/*` command is wrapped by the same guard):

- Domain errors carry the exception message plus structured `data` context.
- Any unexpected exception maps to `unknown_error` with the fixed message
  `"unexpected error; see Home Assistant logs"`. Exception text and stack traces never reach
  the client; the full traceback goes to the server log only.
- A single-item command, the `items/bulk` row naming the same `kind` and the `haventory.*`
  service doing the same thing run one operation, so one payload gets one answer from all
  three. A value the payload is wrong about (a `quantity` that is not an integer `>= 0`, an
  `item_id` that is not a non-empty string) is refused before the item is looked up, so it
  answers `validation_error` even when the id names nothing.
- In `haventory/items/bulk`, a failing operation fails only its own per-op result; the
  remaining operations still run and successful ones persist. The batch **envelope** is
  validated first: a structurally malformed operation *entry* (non-object entry, missing or
  invalid `op_id`, non-string `kind`, non-object `payload`) rejects the whole command with
  `validation_error`.

Transport-level errors produced by Home Assistant itself, before a handler runs, are outside
this taxonomy and can also reach clients: `invalid_format` (the request failed the command's
voluptuous schema) and `unknown_command` (integration not loaded or unknown `type`).

#### Which of the two answers a wrong type

A client handles both. The split is about *where* the frame stopped, not about the field's
name.

`validation_error` is what a value earns. Most payload fields are typed `object` in their
command schema (names, quantities, ids, filters, and every collection a caller writes whole:
`tags`, `custom_fields`, `custom_fields_set`, `custom_fields_unset`, `set`, `unset`,
`attachment_ids`, `slugs`), so the model reads them and the refusal names the field at
WARNING with no traceback. A bare string where a list belongs is refused rather than
iterated as its characters.

`invalid_format` is Home Assistant's, raised before the guard runs and logged with the
client's payload at ERROR. It answers a frame the command schema refuses on shape (a missing
`id`, an unknown top-level key, a required field left out) and the scalars a schema still
types concretely: `expected_version`, the flags, the date strings, the attachment and status
handles, import's `document` and `policy`. That list is not part of the contract and will
drift with the next widening. Handle both codes.

Under either code nothing is written. The `items/bulk` payloads carry no schema at all, so
every wrong type in a row answers that row with `validation_error` and leaves the item as it
was.

### Logging

Every rejection the API boundary answers is also logged once, with the same structured
context the envelope carries. The level says who is expected to act on it:

| Level | `exc_info` | Codes |
|---|---|---|
| WARNING | no traceback | `validation_error`, `not_found`, `conflict`, and the `storage_error` raised because no config entry is loaded |
| ERROR | traceback | every other `storage_error`, and `unknown_error` |

A genuine `storage_error` wraps a lower-level failure whose cause chain is the only record
of what broke, and an `unknown_error` has no vetted message at all, so those two carry a
traceback.

The one `storage_error` that logs at WARNING is the refusal described under "While no entry
is loaded". It reports a state somebody chose rather than a fault, and a dashboard left open
retries for as long as its tab does, so logging it at ERROR with a traceback would bury the
Home Assistant log for a working system. It is graded on the exception raised
(`NotLoadedError`) rather than on the code, so a real storage failure keeps its ERROR.

The service handlers (`haventory.*`) follow the same policy; `voluptuous` schema rejections
there are graded as `validation_error`.

### While no entry is loaded

Home Assistant has no API for unregistering a WebSocket command, so every `haventory/*`
command stays dispatchable until the next restart, whether the config entry is unloaded,
disabled, removed, or halfway through a reload. Each of those drops the loaded runtime, and
the guard turns that into a refusal:

- **Every command** answers `storage_error`, `ping`, `version` and `config` included.
- **Nothing is written.** A mutation is refused before it reaches the repository.
- **Live subscriptions end**, and each is told so through the `unavailable` action under
  "Subscriptions and events".
- **The next setup restores everything.** Teardown flushes the inventory on the way out and
  setup reads it back. Removal keeps the store file too, so re-adding the integration brings
  the inventory with it (`installing.md` → "Removing HAventory").

Clients cannot tell a reload apart from a removal by code alone. Re-opening the
subscriptions on a bounded backoff covers both: a reload is answering again within seconds,
and a removal runs the budget out and leaves the client to tell the user.

### Utility commands

- `haventory/ping`
  - Request: `{id, type: "haventory/ping", echo?: any}`
  - Result: `{echo: any, ts: string}`

- `haventory/version`
  - Result: `{integration_version: string, schema_version: number}`

- `haventory/config`
  - Request: `{id, type: "haventory/config"}` (no payload)
  - Result: `{card_title: string, quick_filters: string[] | null, statuses: StatusDefinition[], media: MediaConfig}`
  - `card_title` is the heading set in the integration's options flow (Settings → Devices &
    services → HAventory → **Configure**), defaulting to `"HAventory"`.
  - `quick_filters` is which quick-filter pills the integration offers, out of `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`, set in the same options flow. `null` means no choice was made and leaves it to the client (a dashboard's own `quick_filters:` first, every pill otherwise); `[]` is an explicit choice of no pills. Names the backend does not know are dropped before sending.
  - `statuses` is the status vocabulary in display order (see data shapes). Items store only
    a slug, so this is where a surface gets the label to render one with.
  - `media` is `{picture_mime_types: string[], max_pictures_per_item: number, manual_mime_types: string[], max_manuals_per_item: number, max_attachment_bytes: number}`,
    the attachment limits, reported so a picker can refuse a doomed file before uploading it.
    **Advisory only**: every one of them is re-derived server-side from the file's own bytes.
    The media *route* is deliberately not here; it is a constant on both sides
    (`/api/haventory/media/{item_id}/{attachment_id}`), pinned by a test.
  - Read at card init and on refresh, not pushed. Changing the option emits no event, so an
    open dashboard shows the new heading after a refresh or reload.

- `haventory/stats`
  - Result: `{items_total: number, low_stock_count: number, checked_out_count: number, overdue_count: number, checked_out_due_count: number, inspection_overdue_count: number, inspection_due_count: number, reminder_due_count: number, missing_count: number, needs_repair_count: number, status_counts: {[slug]: number}, locations_total: number, no_location_count: number}`
  - `no_location_count` is the number of items without a location (`location_id == null`,
    the `orphaned_only` filter's population).
  - `overdue_count` is the number of items whose `due_date` is strictly before today (the
    `overdue_only` filter's population). It is derived from the calendar, not from stored
    state, so it changes with no mutation behind it. The backend sends one `stats/counts` at
    the instance's local midnight so a subscriber sees the rollover.
  - `checked_out_due_count` is the number of items whose `due_date` is **on or before**
    today (the `checked_out_due_only` filter's population): `overdue_count` plus the items
    due back today. Calendar-derived, and carried by the same midnight event.
  - `inspection_overdue_count` is the number of items whose `inspection_date` is strictly
    before today (the `inspection_overdue_only` filter's population). It counts the whole
    inventory, not just checked-out items. Calendar-derived, same midnight event.
  - `inspection_due_count` is the number of items whose `inspection_date` is **on or
    before** today (the `inspection_due_only` filter's population). Calendar-derived, same
    midnight event.
  - `reminder_due_count` is the number of items whose `reminder_date` is on or before today
    (the `reminder_due_only` filter's population). It **includes today**, as every *due*
    count does: a reminder names the day it is asking about. Calendar-derived, same midnight
    event.
  - "Today" in those five is the day Home Assistant is configured for, the same day
    `calendar.haventory` rolls over on, `haventory/reminder/bump` counts from and the card's
    chips read. At the instance's midnight every surface moves: the date-derived sensors
    rewrite their state, the calendar rewrites its next event, and an open `stats`
    subscription receives one `counts` event.
  - `missing_count` / `needs_repair_count` count items whose stored `status` is `missing` /
    `needs_repair`, each the population of the `status` filter set to that slug. Stored
    state: they only change on a mutation, and every mutation emits `stats/counts`.
  - `status_counts` is the same figure for **every** defined slug, including `ok`. It is
    additive to the two keys above, so a client written against the earlier shape keeps
    working.

- `haventory/distinct_values`
  - Request: `{id, type: "haventory/distinct_values", filter?: ItemFilter}` (any other
    field → `invalid_format`; an unknown key *inside* `filter` → `validation_error` naming
    it, as for `item/list`)
  - Result: `{categories: DistinctValue[], tags: DistinctValue[], custom_field_keys: string[]}`
    (see data shapes)
  - `categories` are grouped case-insensitively; each `value` is a representative display
    label (most frequent original casing, ties broken alphabetically) and `count` is the
    number of items using that category. `tags` are already normalized (lowercase). Both
    lists are sorted case-insensitively by `value`. `custom_field_keys` is the sorted,
    distinct set of keys used across all items' `custom_fields` (case-sensitive keys, sorted
    case-insensitively).
  - With a `filter`, every `categories` and `tags` entry also carries `matching_count`, how
    many of that value's items the filter keeps, beside its whole-inventory `count`. **The
    lists never shrink**: an entry the filter keeps nothing of is present at
    `matching_count: 0`, because the same payload feeds autocomplete and the organize
    dialog. Omitting `filter` (or sending `null`) leaves the key off every entry, which is
    distinct from "everything matches".
  - `custom_field_keys` is never filtered: it is a key picker, not a tally.
  - Which dimensions to leave out of `filter` is the caller's decision, as it is for
    `location/tree`. The card drops `category` and `tags_any`/`tags_all` before sending, for
    the reason it drops `location_id` from the tree's filter: a facet priced against its own
    selection reads 0 on every other row exactly when the user wants to see where else the
    matches are.
  - Read-only: emits no events and does not mutate state.

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <stats shape>}`
  - `healthy` is always `true` and `issues` is always empty. The checks they carried compared
    the repository's indexes against the entities they index, and every hit was a bug in
    this integration rather than anything a household had done, so they now run in the test
    suite (`tests/repository_invariants.py`). The two fields keep their place and types so an
    existing client still parses the result. What is worth reading is `counts`, the same
    shape `haventory/stats` returns.

### Subscriptions and events

- Subscribe
  - `haventory/subscribe` request: `{id, type, topic: "items"|"locations"|"stats"|"statuses", location_id?: string|null, location_ids?: string[], area_id?: string|null, include_subtree?: boolean, inspection_overdue_only?: boolean}`
  - Result: `null` (result envelope with `result: null`)
  - `location_ids` is the multi-select beside `location_id`, unioned with it exactly as
    `item/list`'s filter unions the same pair, and covering the `items` and `locations`
    topics alike. One `include_subtree` flag governs the whole selection (defaulting to
    **true** here, unlike the list filter). A value that is not a list of strings answers
    `validation_error`, entry by entry. A card whose location filter names several locations
    has to send this, or the socket keeps delivering the other locations' events.
  - `area_id` narrows the `items` topic to items whose `effective_area_id` equals it, the
    same area `item/list`'s `area_id` filter selects by, read off the event's own item
    payload. `null` (or an omitted key) means no area filter, not "items with no area"; an
    item with no location has `effective_area_id: null` and reaches no area-filtered
    subscription. Any other value has to be a string with non-whitespace in it, or the
    subscribe answers `validation_error`. An `area_id` naming an area nothing resolves to is
    accepted and delivers nothing. Filters combine with AND. The `locations` topic ignores
    `area_id`.
  - `inspection_overdue_only` narrows the `items` topic to items past their
    `inspection_date`, using the same rule as the `item/list` filter of that name. Like every
    subscription filter it is applied to the event's item payload as it stands *after* the
    mutation, so an item that leaves the filtered set produces no event for that
    subscription. A client that tracks a filtered set re-lists rather than relying on a
    departure event.
  - Subsequent events are delivered as HA WS events to the same connection using this `id`
    as the subscription id.

- Unsubscribe
  - `haventory/unsubscribe` request: `{id, type, subscription: number}`
  - Result: `null`
  - A subscription is also registered in Home Assistant's own connection registry under its
    `id`, so it can equally be torn down via HA core's standard `unsubscribe_events`
    (`{id, type: "unsubscribe_events", subscription: number}`). This is the path the
    frontend's `connection.subscribeMessage` lifecycle uses. Both routes cancel the
    subscription, and the connection close hook remains the backstop for dropped clients.

- Event payloads (inside `event`):
  - Common: `{domain: "haventory", topic: "items"|"locations"|"stats"|"statuses", action: string, ts: string, ...payload}`
  - Items topic payloads include `{item: <Item>}` and actions: `created`, `updated`,
    `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`. An items event
    **may omit `item`**, and its absence is a refetch signal rather than a patch: the
    dataset moved wholesale. Two cases emit one today: `reloaded` after `import/execute`,
    and `updated` after `status/delete` with `reassign_to`. A client must key on the presence
    of `item`, not on the action name. Subscription filters are not applied to a payload-less
    items event: every open items subscription receives it whatever its `location_id`.
  - Locations topic payloads include `{location: <Location>}` and actions: `created`,
    `renamed`, `moved`, `deleted`. The `reloaded` action (after `import/execute`) carries
    **no** `location`.
  - Statuses topic payloads carry `{status: <StatusDefinition>}` for actions `created`,
    `updated` and `deleted`, and `{statuses: <StatusDefinition[]>}` for `reordered`. The
    vocabulary is small and changes rarely, so a client may equally re-read `status/list`
    on any event.
  - Stats topic payload `action: "counts"` with `{counts: <stats shape>}`. Every mutation
    emits one, and so does the instance's local midnight, which is what lets a card left
    open overnight agree with the sensors. It is the one event that says nothing was edited,
    so a client must not read it as a mutation.
  - The `unavailable` action is sent on **every** topic, once per open subscription, when
    the config entry serving it tears down (an unload, a disable, a removal, or the first
    half of a reload). It carries no payload beyond the common fields. Every command is
    refused with `storage_error` from this point, so a client that re-subscribes should
    expect to be refused for as long as setup takes and back off rather than give up.
  - When a `location_id` filter is provided on subscription:
    - Items: if `include_subtree` (default true), match any item whose
      `location_path.id_path` contains the filter id; otherwise only direct `location_id`
      matches.
    - Locations: if `include_subtree`, match the location itself or descendants; otherwise
      only the exact location.
  - Re-anchoring a location under a different root rewrites `effective_area_id` for its
    whole subtree and emits a single `locations` `moved` event. Reassigning the area through
    `location/update` emits the same event, including when the `area_id` is sent for a
    location inside the tree rather than for its root. Neither emits item events, so an
    area-filtered items subscription sees no departure for the items that just left its
    area, and no arrival for those that joined it. A client tracking a filtered set re-lists
    on a `locations` event.

- **Both write paths broadcast the same events.** A `haventory.*` service call emits exactly
  what the WebSocket command doing the same thing emits, because one call in `events.py`
  covers both surfaces. An automation mutating the inventory repaints an open card, and a
  subscriber cannot tell which surface a change arrived through.

- **An event implies a durable write.** Every mutation command persists the change *before*
  it broadcasts and before it replies, so any event on any topic says the write behind it
  reached storage. When the write fails the caller receives `storage_error` and **no event
  is emitted at all**. A client may treat a received event as committed.
  - The guarantee is about the wire, not about the running repository: a failed write
    leaves the mutation applied in memory (`import/execute` is the exception and rolls the
    dataset back). Nothing announces that divergence, and it ends at the next restart, which
    reads back whatever last reached disk.
  - `items/bulk` shares one write across the whole batch, so a failed write costs the batch
    its `results` map: the command answers `storage_error` and none of its operations
    broadcast.
  - The midnight `stats/counts` event is the one exception, in the harmless direction:
    nothing was written because nothing changed, only the day the counts are measured
    against.

### Home Assistant bus events

Everything above is WebSocket traffic, delivered to subscribed clients. HAventory also fires
two event types on the **Home Assistant bus**, so an automation can trigger on the inventory
with no WebSocket client at all. Payload shapes: `docs/data_shapes.md`.

| Event type | Fired when | `action` |
|---|---|---|
| `haventory_item_changed` | an item is mutated | `created`, `updated`, `moved`, `quantity_changed`, `checked_out`, `checked_in`, `deleted` |
| `haventory_low_stock` | an item crosses its `low_stock_threshold` | `entered`, `cleared` |

- **The same "an event implies a durable write" rule holds here**: both are fired after the
  persist, on every path. A mutation that fails to persist fires nothing.
- **The `action` vocabulary is the WebSocket one**, so a trigger and a subscription describe
  the same mutation with the same word.
- **`haventory_low_stock` is a set diff, not a per-handler check.** The set of low-stock ids
  is snapshotted when the entry sets up (so a restart re-announces nothing) and diffed after
  every mutation. One `entered` on the crossing, nothing while it stays low, one `cleared`
  on restock or deletion. A wholesale `import/execute` diffs the same way rather than
  announcing every row.
- **Bus events carry no item body beyond the trigger fields.** An automation that needs the
  whole item calls `haventory/item/get`.
- **Locations fire no bus event**, but most location changes still repaint the entities. A
  create or a delete moves `locations_total`, which is a sensor. A rename or a re-parent
  rewrites `location_path` across the subtree, and every projected calendar event's
  `description` is an item's `location_path.display_path`. So `location/create`,
  `location/delete`, `location/update`, `location/move_subtree` and their
  `haventory.location_*` services dispatch the repaint signal, with one exception: an
  area-only reassignment, which moves no count and no path. `haventory_item_changed` stays
  unfired for all of them, because a derived-path rewrite moves neither an item's `version`
  nor its `updated_at`.

### Items

- `haventory/item/create`
  - Payload: any subset of `ItemCreate` (see data shapes), `name` required.
  - Result: `<Item>`; emits `items/created` and `stats/counts`.

- `haventory/item/get`
  - Payload: `{item_id: string}`
  - Result: `<Item>`

- `haventory/item/update`
  - Payload: `{item_id: string, expected_version?: number, ...ItemUpdate}`
  - Result: `<Item>`; emits `items/updated` or `items/moved` depending on whether
    `location_id` changed; emits `stats/counts`.

- `haventory/item/delete`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `null`; emits `items/deleted` with the pre-delete snapshot under `item`, and
    `stats/counts`.
  - The item's attachment files are deleted with it, after the save. A write that fails
    leaves every file where it was.

- `haventory/item/adjust_quantity`
  - Payload: `{item_id: string, delta: number, expected_version?: number}`
  - Result: `<Item>`; emits `items/quantity_changed` and `stats/counts`.

- `haventory/item/set_quantity`
  - Payload: `{item_id: string, quantity: number, expected_version?: number}`
  - Result: `<Item>`; emits `items/quantity_changed` and `stats/counts`.

- `haventory/item/check_out`
  - Payload: `{item_id: string, due_date?: YYYY-MM-DD|null, expected_version?: number}`
  - Result: `<Item>`; emits `items/checked_out` and `stats/counts`.
  - `due_date` is optional here: omitting it (or passing `null`) checks the item out with no
    due date. This differs from the `haventory.item_check_out` **service**, whose schema
    requires `due_date`.

- `haventory/item/check_in`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/checked_in` and `stats/counts`.

- `haventory/reminder/set`
  - Payload: `{item_id: string, reminder_date: YYYY-MM-DD, reminder_interval?: {unit, count}|null, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - The command names the **whole** reminder, so an omitted `reminder_interval` means "no
    recurrence" and clears a stored one. `unit` is `days`, `weeks` or `months`; `count` is
    an integer from 1 to 1000.
  - `reminder_date` and `reminder_interval` are also writable through
    `haventory/item/update`, which is how the card's editor saves them. These commands exist
    for callers with no form to carry the other fields.
  - Writing `reminder_date` through any of them sets `reminder_anchor` to the same date. No
    client writes the anchor directly.

- `haventory/reminder/clear`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - Idempotent: an item with no reminder succeeds unchanged apart from its `version`.

- `haventory/reminder/bump`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - Moves `reminder_date` to the series' next occurrence and **leaves `reminder_anchor`
    where it is**. It is the only write that does; every other path re-anchors the series
    on the date it writes. That is what keeps a series on the 31st landing on the 31st in
    every month that has one, however often it is bumped through a short one.
  - Counted from the later of the stored `reminder_date` and today, so a reminder bumped on
    the day it came round advances by exactly one interval, and one nobody bumped for a year
    lands on its next *future* occurrence. A 31st series bumped in February lands on the
    28th, and the next one is 31 March.
  - Today is the instance's local day, the one `calendar.haventory` rolls over on.
  - `validation_error` when the item has no reminder, and when it has one with no interval
    (a one-off has no next occurrence; `haventory/reminder/clear` is what ends it). Also
    when the stored dates cannot be read, which only a hand-edited store produces.
  - Takes `expected_version` like any other item edit, and answers `conflict` on a stale one.

- `haventory/item/add_tags`
  - Payload: `{item_id: string, tags: string[], expected_version?: number}` (tags
    normalized: trimmed, casefolded, deduped; a value that is not a list of strings is a
    `validation_error`)
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.

- `haventory/item/remove_tags`
  - Payload: `{item_id: string, tags: string[], expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.

- `haventory/item/update_custom_fields`
  - Payload: `{item_id: string, set?: { [k: string]: scalar }, unset?: string[], expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.

- `haventory/item/set_low_stock_threshold`
  - Payload: `{item_id: string, low_stock_threshold: number|null, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.

- `haventory/item/move`
  - Payload: `{item_id: string, location_id: string|null, expected_version?: number}`
  - Result: `<Item>`; emits `items/moved` and `stats/counts`.

- `haventory/item/attachment/add`
  - Payload: `{item_id: string, file_id: string, kind?: "picture"|"manual", filename?: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - The bytes do **not** cross the WebSocket. The client first POSTs the file to Home
    Assistant core's `/api/file_upload` (with the user's auth header) and gets back a
    `file_id`; this command consumes that handle. `kind` defaults to `"picture"`; `filename`
    is display metadata only. The stored name is derived from a fresh attachment id and the
    sniffed type.
  - Adding an attachment **is** an item edit: it bumps `version` and `updated_at`. A client
    holding the pre-upload version must take the returned item back into its model, or its
    next write comes back `conflict`.
  - The new attachment's `order` is assigned server-side as the next free position
    **within its kind**, so an upload appends rather than tying with the item's cover.
  - Refusals: `validation_error` when the sniffed content type is outside the kind's
    allow-list, when the file is empty or over `max_attachment_bytes`, when the kind is
    unknown, or when the item already holds the per-kind maximum. `not_found` for an unknown
    `item_id` **or** a `file_id` that has expired or was already consumed. `conflict` for a
    stale `expected_version`. `storage_error` when the move onto disk or the save fails.
  - Accepted types are checked against the file's own leading bytes, never the content type
    the browser declared. `image/svg+xml` is refused outright: SVG carries script and the
    media view serves from the Home Assistant origin.

- `haventory/item/attachment/remove`
  - Payload: `{item_id: string, attachment_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`. The file is deleted with the
    metadata, after the save.
  - Refusals: `not_found` for an unknown item or attachment, `conflict` for a stale
    `expected_version`.

- `haventory/item/attachment/update`
  - Payload: `{item_id: string, attachment_id: string, title: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated`.
  - Retitles one attachment; the file on disk is untouched. An empty title means "show the
    filename", so clearing one is how a caller gets back to the default.
  - Refusals: `not_found` for an unknown item or attachment, `conflict` for a stale
    `expected_version`, `validation_error` for a title over the length bound.

- `haventory/item/attachment/reorder`
  - Payload: `{item_id: string, kind: "picture"|"manual", attachment_ids: string[], expected_version?: number}`
  - Result: `<Item>`; emits `items/updated`.
  - Renumbers one kind. **The first id named takes position 0, which is what makes a
    picture the item's cover.** There is no separate cover flag, so "make cover" is this
    command. Order is per kind, so renumbering pictures never moves a manual.
  - Refusals: `validation_error` when `attachment_ids` is not a list of strings, and unless
    it names every attachment of that kind exactly once; `not_found` for an unknown item;
    `conflict` for a stale `expected_version`.

- Serving an attachment: `GET /api/haventory/media/{item_id}/{attachment_id}`
  - An authenticated `HomeAssistantView`, not `/local` and not `/haventory_static`. Both of
    those are served without authentication, and an inventory photo is as private as the
    inventory.
  - Both ids are matched against stored metadata before any path is built, so no request
    segment reaches the filesystem. Anything unmatched, and any entry whose file is absent,
    is `404`. Once no config entry owns the data the view answers `503`.
  - Responses carry the stored content type and `X-Content-Type-Options: nosniff`.
  - `?size=thumb` asks for the **row tile** rather than the stored file: a 256px WebP,
    longest edge, written beside the original the first time it is asked for. The tile
    keeps the transparency the source had. `thumb` is the only accepted value and any other
    is `400`. Omitting it serves the original, which is what the lightbox and the detail
    sheet's large picture do.
  - Making one needs Pillow, which this integration does **not** declare as a requirement,
    so `size=thumb` is a request and never a guarantee. No Pillow, an animated GIF, a
    manual, an undecodable file, a directory that will not take a write: each serves the
    original, with the stored content type. A file that cannot be encoded is remembered for
    the life of the process so it is not decoded again.
  - The tile lives at `<attachment_id>.thumb2.webp` beside the original. The orphan sweep
    knows about it; deleting the attachment deletes it. It holds no metadata, appears in no
    export, and can be deleted from disk at any time.
  - The `2` in that name is the **encoder generation**. It is raised whenever an existing
    tile must not survive an upgrade: the sweep at the next setup removes the previous
    generation's files because no metadata names them, and the next request writes the tile
    the new encoder makes. Generation 1 is `.thumb.webp`, written by the encoder that
    flattened transparency onto black.
  - `Content-Disposition` is always `inline` and names the file the attachment's `title`, or
    its `filename` when untitled. The name travels percent-encoded as RFC 5987
    `filename*=UTF-8''…`, with a quoted printable-ASCII `filename` beside it; a name with
    nothing printable in ASCII falls back to the attachment id there.
  - `Cache-Control` depends on whether the URL says which name it was fetched under. An
    attachment id addresses one fixed set of bytes, but the name in `Content-Disposition`
    is not fixed: a retitle rewrites it for that same id. A URL carrying the `v` name-token
    parameter is `private, max-age=31536000, immutable`, and one without it is
    `private, no-store`. Only the presence of `v` is read, never its value.
  - An `<img src>` carries no `Authorization` header, so a client signs the path with core's
    `auth/sign_path` first and renders the signed URL. Home Assistant signs query parameters
    along with the path, so `v` and `size` both have to be on the path *before* signing,
    which is why a tile and its original are two signatures rather than one.

- `haventory/items/bulk`
  - Payload: `{operations: Array<{op_id: string|number, kind: string, payload: object}>}`
  - Supported `kind` values: `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `item_add_tags`, `item_remove_tags`, `item_update_custom_fields`, `item_set_low_stock_threshold`.
  - Result: `{results: { [op_id: string]: {success: true, result: <Item>} | {success: false, error: {code, message, context}} }}`;
    if any operation succeeds, a single `stats/counts` event is emitted.
  - A failed op fails only itself; the batch continues and reports it under its `op_id`. A
    failed *write* fails the whole command with `storage_error` and returns no `results` map
    at all, because the batch is one write.
  - An `item_delete` row frees the item's attachment files, after the batch's one write and
    on the same terms as `item/delete`.
  - **`op_id`s must be unique within one batch**, and are compared as strings: `1` and
    `"1"` are the same id. A repeat rejects the whole command with `validation_error` and
    runs nothing.

- `haventory/item/list`
  - Payload: `{filter?: <ItemFilter>, sort?: <Sort>, limit?: number, cursor?: string}`
  - Result: `{items: <Item[]>, next_cursor: string|null, total: number}`
  - `total` is the number of items matching the filter across **all** pages, recomputed per
    request, so "Showing N of `total`" is renderable on every page.
  - **Categories and locations multi-select.** `filter.categories: string[]` sits beside
    `filter.category`, and `filter.location_ids: string[]` beside `filter.location_id`. Each
    pair is *one* selection: the scalar and the list are **unioned**, never intersected. An
    empty list does not narrow. A value that is not a list of strings answers
    `validation_error` naming the key (`tags_any` and `tags_all` answer the same way).
    `include_subtree` is **one flag for the whole location selection**. See data shapes for
    the full rule.
  - **Unknown `filter` and `sort` keys are refused** with `validation_error` naming the
    offending key, rather than dropped. A dropped key would return the whole inventory
    labelled as a filtered result. The accepted key set is exactly `<ItemFilter>`'s; `sort`
    accepts `field` and `order` only.
  - **`filter.area_id` is refused unless it names an area**: `null` (or an omitted key) is
    no area filter, a string with non-whitespace in it is the area, and everything else
    answers `validation_error` ("area_id must be a non-empty string or null"). A well-formed
    id no location resolves to is a normal empty page. `haventory/subscribe` refuses the
    same values.
  - **`sort.field` accepts `location`**, ordering on the item's denormalized
    `location_path.sort_key`; items with no location sort last in both orders. This is not
    an area sort, and one is deliberately not offered (see data shapes). The cursor carries
    the same key.
  - **A `cursor` that cannot be honoured is an error, never a silent restart.**
    `validation_error` is answered for a cursor that is empty, undecodable, longer than 2048
    characters, missing its `last_id` / `last_sort_key`, or minted under a different `sort`
    or a different `filter.low_stock_first` setting than the request carries. To restart
    pagination, omit `cursor`; do not send `""`.
  - **`filter.low_stock_first` is part of the ordering the cursor describes.** It regroups
    the sorted list (low-stock block first, the chosen sort within each block), so the
    cursor records the grouping beside the sort key.

### Locations

- `haventory/location/create`
  - Payload: `{name: string, parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `locations/created` and `stats/counts`.

- `haventory/location/get`
  - Payload: `{location_id: string}`
  - Result: `<Location>`

- `haventory/location/update`
  - Payload: `{location_id: string, name?: string, new_parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits **at most one** `locations` event, chosen by what the call
    actually changed rather than by which keys it carried: `moved` when the parent changed
    or when the area the location resolves to changed (either re-anchors the subtree),
    otherwise `renamed` when the name changed, otherwise nothing. The area comparison is on
    the resolved value, not on the row's own `area_id`: an `area_id` sent for a location
    below the root is stored on the root. An `area_id` that resolves to the area already in
    force moves nothing and announces nothing. Also emits `stats/counts`.

- `haventory/location/delete`
  - Payload: `{location_id: string}`
  - Result: `null`; emits `locations/deleted` and `stats/counts`.

### Status definitions

The vocabulary items reference by slug. A slug is immutable (it is the exact string every
item stores), so only the presentation is editable, and no command here rewrites an item
except `status/delete` with a reassign target.

- `haventory/status/list`
  - Payload: `{}`
  - Result: `<StatusDefinition[]>` in display order. The same array `haventory/config`
    carries.

- `haventory/status/create`
  - Payload: `{slug: string, label: string, color?: string, icon?: string, order?: number}`
  - Result: `<StatusDefinition>`; emits `statuses/created`.
  - Absent `order` places it last. `color` must be one of the ten tone tokens or a `#rrggbb`
    literal (folded to lowercase), and `icon` one of the ten glyph names (see data shapes);
    both default when omitted.
  - Refusals: `validation_error` for a malformed or duplicate slug, or a colour or icon
    outside its vocabulary.

- `haventory/status/update`
  - Payload: `{slug: string, label?: string, color?: string, icon?: string, order?: number}`
  - Result: `<StatusDefinition>`; emits `statuses/updated`.
  - **No item is touched and no item version moves.** The slug is the identity and the rest
    is presentation.
  - Refusals: `not_found` for an unknown slug, `validation_error` for a bad value. A `slug`
    that differs from the one being edited is `validation_error`: items store it.

- `haventory/status/reorder`
  - Payload: `{slugs: string[]}`
  - Result: `<StatusDefinition[]>` in the new order; emits `statuses/reordered`.
  - Refusals: `validation_error` when `slugs` is not a list of strings, and unless it names
    every live status exactly once.

- `haventory/status/delete`
  - Payload: `{slug: string, reassign_to?: string}`
  - Result: `{status: <StatusDefinition>, reassigned: number}`; emits `statuses/deleted`,
    and when `reassigned` is non-zero also `items/updated` and `stats/counts`. That
    `items/updated` carries **no `item`**: the move is a bulk rewrite, so the event is a
    refetch signal (see "Event payloads"). On the Home Assistant bus it is the other way
    round: one `haventory_item_changed` with action `updated` **per rewritten item**, because
    each of them took a new `version` and a new `updated_at`. The low-stock diff and the
    sensor repaint run once for the batch.
  - **Refused while items still carry the slug and no `reassign_to` is given.** With a
    target the items move and the definition is deleted in the same call, so no client can
    observe an item naming a status that no longer exists. Each moved item bumps its
    `version` and `updated_at`.
  - Refusals: `validation_error` for the default status (`ok`, which is never deletable),
    for an in-use slug with no target, or for a target that is unknown or the slug itself;
    `not_found` for an unknown slug.

- `haventory/location/list`
  - Payload: `{}`
  - Result: `<Location[]>` (flat list)

- `haventory/location/tree`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one carrying an unknown
    key, → `validation_error`).
  - Result: an array of tree nodes: `{id, name, parent_id, path: <LocationPath>, direct_item_count, subtree_item_count, children: <Node[]>}`
  - `direct_item_count` counts items whose `location_id` is exactly that node;
    `subtree_item_count` counts items in the node or any descendant. Counts change on item
    create, delete and move, so clients showing them should refresh the tree on item events
    (or on `stats/counts`), not only on location events.
  - With a `filter`, each node additionally carries `matching_direct_count` and
    `matching_subtree_count`, the same two counts restricted to items the filter keeps, so a
    location sidebar can show "4 / 37". The unfiltered counts are still returned unchanged.
    Both keys are absent when no `filter` is sent. A filter that names `location_id` is
    honoured like any other, so a sidebar wanting per-location counts should leave the
    location dimension out of the filter it sends.

- `haventory/areas/list`
  - Payload: `{}`
  - Result: `{areas: [{id: string, name: string}]}`

- `haventory/location/move_subtree`
  - Payload: `{location_id: string, new_parent_id: string|null}`
  - Result: `<Location>`; emits `locations/moved` and `stats/counts`.

### Import / export (data safety)

Backup and restore over WebSocket. Processing is in-memory. The export document embeds
`schema_version` plus all items and locations; a round-trip (export, then import into an
empty instance) reproduces the data. See `data_shapes.md` for the full document, preview and
summary shapes.

`import/preview` and `import/execute` accept a document stamped **1** (the current schema)
or lower. A higher stamp is refused with a `schema_version` error, and which error depends
on the number: **2 through 9** are the versions this project used before the schema was
collapsed, and no newer build reads one, so the message says to open the document on
HAventory 0.8.x and export again. Anything above them was written by a newer build, and the
message names both numbers and says to upgrade.

- `haventory/export`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one carrying an unknown
    key, → `validation_error`).
  - Result: `<ExportDocument>`. With no filter this is a full backup; with a filter, only
    matching items are exported together with the locations on each item's ancestry, so the
    document stays self-consistent.
  - Read-only: emits no events and does not mutate state.

- `haventory/import/preview`
  - Payload: `{document: <ExportDocument>, policy?: "merge"|"replace"|"skip"}` (default
    `merge`).
  - Result: `<ImportPreview>`. Validates and classifies **without mutating state**. Each
    incoming entity lands in exactly one bucket: `add` (id absent), `unchanged` (id present,
    identical), `update` (id present, differs, resolved by the policy), or `conflict` (id
    present, differs, left untouched by `skip`). Invalid documents return
    `{valid: false, errors: [{path, message}]}` rather than throwing.
  - **Every preview carries `warnings: <ImportWarning[]>`**, present whether or not it is
    empty and whether or not the document is valid. A warning **never affects `valid`** and
    **never reaches `import/execute`**. One code exists today, `name_collision`: an incoming
    entity classified `add` whose name matches, case- and accent-insensitively, that of a
    stored entity of the same kind carrying a *different* id. That is the
    duplicate-on-rebuilt-ids hazard described under `import/execute`, caught before the
    write. Only the `add` bucket is checked, so a clean round trip produces no warnings
    under any policy.
  - A valid preview additionally carries `attachments: {referenced: number, missing: number}`:
    how many attachment references the resulting dataset would hold, and how many of them
    name a file this install does not have. That is a caveat to show, not an error; a client
    renders a "file missing" state for those entries.

- `haventory/import/execute`
  - Payload: `{document: <ExportDocument>, policy?: "merge"|"replace"|"skip"}` (default
    `merge`).
  - Applies the document with the chosen conflict policy, persists immediately, then emits
    `items/reloaded`, `locations/reloaded`, and `stats/counts`. Result: `<ImportSummary>`.
  - An invalid document is rejected with a `validation_error` whose `data.errors` lists the
    structured problems; **state is not mutated**. If persistence fails after the in-memory
    swap, the repository is rolled back to its pre-import snapshot and the error surfaces as
    `storage_error`. A bad import never leaves partial state.
  - **Identity is the entity id, and only the id.** An incoming item or location whose id is
    already present *is* the existing entity and is resolved by the policy below; one whose
    id is absent is a new entity and is added. Names are never compared, under any policy,
    because matching by name would silently fuse two genuinely different "Shelf A"s. The
    corollary: importing a document onto entities that were deleted and recreated by hand
    (and so carry fresh ids) duplicates them rather than merging. The incoming copies
    classify as `add`, and every incoming item follows its own `location_id` onto the
    incoming location, leaving the hand-rebuilt one holding nothing. `import/preview` shows
    this before the write and flags each such name as a `name_collision` warning.
    `import/execute` applies the document either way.
  - Conflict policies (for ids already present): `skip` keeps the existing entity; `replace`
    overwrites it with the incoming one; `merge` overlays incoming onto existing (scalar
    fields from incoming; item `tags` unioned; item `attachments` unioned by attachment id;
    item `custom_fields` merged, incoming wins per key). For locations, `merge` behaves as
    `replace`.
  - **Status definitions are a vocabulary, not an entity the policies act on.** The
    document's `statuses` section overlays whatever is stored, and any slug the resulting
    items reference without a definition gets one. No policy ever deletes a definition,
    because an item on this install may still carry the slug. A document whose items
    reference a slug that is neither built-in nor defined in the document is rejected in
    preview with `{path: "items[N].status", ...}`.
  - **Attachments travel as metadata only.** An import never *drops* an item, but `replace`
    overwrites an item's attachment list, so an entry the document does not carry loses its
    only reference. `import/execute` deletes those files after the write. Home Assistant's
    own backups are the full-fidelity path: the media directory lives inside the config
    directory, so it rides them.

Note: a successful import emits `items/reloaded` and `locations/reloaded` (no `item` /
`location` payload) to tell every subscriber the dataset was replaced wholesale.

### Versioning and concurrency

- Items include `version: number`. Mutating commands accept `expected_version?: number` and
  raise `conflict` on mismatch.
- `version` counts *item* mutations only. `location/update` (and `location/move_subtree`)
  rewrites the derived `location_path` of every item in the subtree without bumping their
  `version` or `updated_at`, so an `expected_version` taken before a rename is still
  accepted after it. Clients learn about the new paths from the `locations` event; no
  per-item events are emitted for the rewrite.
- Locations carry no `version` and take no `expected_version`. A location edit is
  last-write-wins.

### Timestamps

- All timestamps are ISO-8601 UTC without microseconds, with trailing `Z`.

### Compatibility

- Target HA: ≥ 2026.6.0; Python 3.14 (see CLAUDE.md). The offline suite validates the
  envelope against the stubs in `tests/conftest.py`; the phacc integration suite
  (`tests/integration/`) validates it against a real in-process HA core.
