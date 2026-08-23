## HAventory WebSocket API Contract

This document specifies the WebSocket message envelope, error taxonomy, command catalog, and event delivery semantics implemented by `custom_components/haventory/ws.py`, with the subscription registry and the event fan-out in `custom_components/haventory/subscriptions.py`.

### Envelope

- Requests: object with at least `id` and `type`; remaining fields are the payload.
- Success responses:
```json
{"id": 1, "type": "result", "success": true, "result": {"...": "..."}}
```
- Error responses:
```json
{"id": 1, "type": "result", "success": false, "error": {"code": "validation_error", "message": "bad input", "data": {"op": "item_create", "field": "name"}}}
```

Notes:
- Error `data` contains structured context including `op` and selected request fields (e.g., `item_id`, `expected_version`, etc.).
- Event deliveries use Home Assistant’s event wrapper via the connection object:
```json
{"id": 100, "type": "event", "event": {"domain": "haventory", "topic": "items", "action": "created", "ts": "2024-01-01T00:00:00Z", "item": {"id": "..."}}}
```

### Error codes

- `validation_error`: Invalid input or invariant violation
- `not_found`: Referenced entity does not exist
- `conflict`: Version mismatch on optimistic concurrency
- `storage_error`: Persistence or setup issue, including a command that arrives while no config entry owns the data — see "While no entry is loaded"
- `rate_limited`: Command rejected by the (opt-in) WebSocket rate limiter — see "Rate limiting"
- `unknown_error`: Fallback for unexpected exceptions

Guarantees (every `haventory/*` command is wrapped by the same guard):

- Domain errors carry the exception message plus structured `data` context (`op` and selected request fields).
- Any unexpected (non-domain) exception maps to `unknown_error` with the fixed message `"unexpected error; see Home Assistant logs"` and `data` context. Exception text and stack traces never reach the client; the full traceback goes to the server log only.
- A single-item command, the `items/bulk` row naming the same `kind` and the `haventory.*` service doing the same thing run one operation, so one payload gets one answer from all three — the service's own schema having typed its fields first. A value the payload is wrong about — a `quantity` that is not an integer `>= 0`, an `item_id` that is not a non-empty string — is refused before the item is looked up, and so answers `validation_error` even when the id names nothing.
- In `haventory/items/bulk`, a failing operation (including an unexpectedly malformed **payload**) fails only its own per-op result; the remaining operations still run and successful ones persist. Note the batch **envelope** is validated first: a structurally malformed operation *entry* (non-object entry, missing/invalid `op_id`, non-string `kind`, non-object `payload`) cannot be reported per-op and rejects the whole command with `validation_error`.

Transport-level errors produced by Home Assistant itself (before a handler runs) are outside this taxonomy and can also be observed by clients: `invalid_format` (request failed the command's voluptuous schema) and `unknown_command` (integration not loaded or unknown `type`).

#### Which of the two answers a wrong type

A client handles both, and does not have to know which field answers which — the split is
about *where* the frame stopped, not about the field's name.

`validation_error` is what a value earns. Every field carrying data a caller composes — a
name, a quantity, an id, a filter, and every collection written whole (`tags`,
`custom_fields`, `custom_fields_set`, `custom_fields_unset`, `set`, `unset`,
`attachment_ids`, `slugs`) — is typed `object` in its command schema, so the model is what
reads it and the refusal names the field at WARNING with no traceback. A bare string where a
list belongs is the case worth naming: iterating one yields its characters, so it is refused
rather than read.

`invalid_format` is Home Assistant's, raised before the guard runs and logged with the
client's payload at ERROR. It answers a frame the command schema refuses on shape — a missing
`id`, an unknown top-level key, a required field left out — and the handful of scalars whose
schema type is still the whole of their rule, such as `expected_version` and the flags.

Under either code nothing is written. The `items/bulk` payloads carry no schema at all, so
every wrong type in a row answers that row with `validation_error` and leaves the item as it
was.

### Logging

Every rejection the API boundary answers is also logged once, with the same structured context the envelope carries. The level says who is expected to act on it, not how unusual it is:

| Level | `exc_info` | Codes |
|---|---|---|
| WARNING | no traceback | `validation_error`, `not_found`, `conflict`, `rate_limited`, and the `storage_error` raised because no config entry is loaded |
| ERROR | traceback | every other `storage_error`, and `unknown_error` |

A traceback earns its place only where it says something the message does not: a genuine `storage_error` wraps a lower-level failure whose cause chain is the only record of what broke, and an `unknown_error` has no vetted message at all.

The one `storage_error` that logs at WARNING is the refusal described under "While no entry is loaded". It answers `storage_error` on the wire, because that is what the contract has always said, but it reports a state somebody chose rather than a fault: nothing broke, there is no cause chain to print, and the fix is either the client stopping or the operator loading the entry again. A dashboard left open retries for as long as its tab does, so logging that at ERROR with a traceback would bury the Home Assistant log in stack traces for a working system. It is graded on the exception raised (`NotLoadedError`) rather than on the code it maps to, so a real storage failure keeps its ERROR and its traceback.

The service handlers (`haventory.*`) follow the identical policy; `voluptuous` schema rejections there are graded as `validation_error`.

### While no entry is loaded

Home Assistant has no API for unregistering a WebSocket command, so every `haventory/*` command stays dispatchable until the next restart — whether the config entry is unloaded, disabled, removed, or halfway through a reload. Each of those drops the loaded runtime (repository, store, limiter, subscriptions), and the guard turns that into a refusal:

- **Every command** answers `storage_error`, `ping`, `version` and `config` included: they read no inventory, but a half-answering API for a backend that owns nothing is worse than none.
- **Nothing is written.** A mutation is refused before it reaches the repository, so the store file stops changing the moment the entry goes.
- **Live subscriptions end**, and each is told so — see the `unavailable` action under "Subscriptions and events". A client that is not listening for it simply stops receiving events.
- **The next setup restores everything** — the API and the inventory, which teardown flushes on the way out and setup reads back. Removal keeps the store file too, so re-adding the integration brings the inventory with it (`installing.md` → "Removing HAventory").

Clients cannot tell a reload apart from a removal by code alone. Re-opening the subscriptions on a bounded backoff covers both: a reload is answering again within seconds, and a removal runs the budget out and leaves the client to tell the user.

### Rate limiting

**Off by default.** Enable and tune it in the integration's options flow (Settings → Devices & services → HAventory → Configure); [`rate_limiting.md`](rate_limiting.md) covers the same settings for the person filling in that form. Token buckets (sustained rate + burst) apply per connection **and** globally, separately for commands and for subscription broadcasts:

- Commands: when a budget is exhausted, the command is not executed and the client receives an error envelope with code `rate_limited`, message `"rate limit exceeded; retry later"`, and `data.op`. Retry after a short backoff.
- Broadcasts: when the global event budget is exhausted the event is dropped for all subscribers; when a connection's event budget is exhausted the event is dropped for that connection only. Event delivery is best-effort — a client that must not miss state re-lists on demand (`item/list`, `location/tree`, `stats`).
- Observability: `haventory/health` includes `rate_limit: {enabled, dropped_commands, dropped_events}`; drops log a throttled warning server-side. Changing any rate-limit option rebuilds the limiter: all buckets refill and the drop counters reset to 0.

Defaults when enabled (tokens/second, burst): commands 20/60 per connection, 100/200 global; events 50/200 per connection, 500/1000 global. Normal Lovelace-card usage stays far below these; bulk imports or stress tooling (`scripts/stress_test.py`) should keep limiting disabled.

### Utility commands

- `haventory/ping`
  - Request: `{id, type: "haventory/ping", echo?: any}`
  - Result: `{echo: any, ts: string}`

- `haventory/version`
  - Result: `{integration_version: string, schema_version: number}`

- `haventory/config`
  - Request: `{id, type: "haventory/config"}` (no payload)
  - Result: `{card_title: string, quick_filters: string[] | null, statuses: StatusDefinition[], media: MediaConfig}`
  - `card_title` is the heading set in the integration's options flow (Settings → Devices & services → HAventory → **Configure**), defaulting to `"HAventory"`. Only display settings appear here — rate-limit tunables stay server-side.
  - `quick_filters` is which quick-filter pills the integration offers, out of `total`, `low_stock`, `overdue`, `inspection_due`, `reminder_due`, `checked_out`, set in the same options flow. `null` means no choice was made and leaves it to the client — a dashboard's own `quick_filters:` first, every pill otherwise — while `[]` is an explicit choice of no pills; the two are never interchangeable. Names the backend does not know are dropped before sending.
  - `statuses` is the status vocabulary in display order (see data shapes). Items store only a slug, so this is where a surface gets the label to render one with.
  - `media` is `{picture_mime_types: string[], max_pictures_per_item: number, manual_mime_types: string[], max_manuals_per_item: number, max_attachment_bytes: number}` — the attachment limits, reported so a picker can refuse a doomed file before uploading it. **Advisory only**: every one of them is re-derived server-side from the file's own bytes. The media *route* is deliberately not here; it is a constant on both sides of the language boundary (`/api/haventory/media/{item_id}/{attachment_id}`), pinned by a test.
  - Read at card init and on refresh, not pushed: changing the option emits no event, so an open dashboard shows the new heading after a refresh or reload.

- `haventory/stats`
  - Result: `{items_total: number, low_stock_count: number, checked_out_count: number, overdue_count: number, checked_out_due_count: number, inspection_overdue_count: number, inspection_due_count: number, reminder_due_count: number, missing_count: number, needs_repair_count: number, status_counts: {[slug]: number}, locations_total: number, no_location_count: number}`
  - `no_location_count` is the number of items without a location (`location_id == null`, i.e. the `orphaned_only` filter's population).
  - `overdue_count` is the number of items whose `due_date` is strictly before today (the `overdue_only` filter's population). It is derived from the calendar, not from stored state, so it changes with no mutation behind it — the backend sends one `stats/counts` at the instance's local midnight so a subscriber sees the rollover.
  - `checked_out_due_count` is the number of items whose `due_date` is **on or before** today (the `checked_out_due_only` filter's population) — the same population as `overdue_count` plus the items due back today, so it is never smaller than it. Calendar-derived, and carried by the same midnight event.
  - `inspection_overdue_count` is the number of items whose `inspection_date` — the date the item is next due for inspection — is strictly before today (the `inspection_overdue_only` filter's population). It counts the whole inventory, not just checked-out items, because an inspection is independent of any check-out. Calendar-derived in the same way as `overdue_count`, and carried by the same midnight event.
  - `inspection_due_count` is the number of items whose `inspection_date` is **on or before** today — the same population as `inspection_overdue_count` plus the items due today, so it is never smaller than it. *Due* includes today and *overdue* does not, the same distinction `checked_out_due_count` and `reminder_due_count` draw (the `inspection_due_only` filter's population). Calendar-derived, and carried by the same midnight event.
  - `reminder_due_count` is the number of items whose `reminder_date` is on or before today (the `reminder_due_only` filter's population). It **includes today**, as every *due* count does: a reminder names the day it is asking about, so an item reminding today is still one to act on, where a due date has to pass before it is late. Calendar-derived, and carried by the same midnight event.
  - "Today" in those five is the day Home Assistant is configured for — the same day `calendar.haventory` rolls over on, `haventory/reminder/bump` counts from and the card's chips read. One boundary, at the instance's midnight, on every surface — and every surface moves there: the date-derived sensors rewrite their state, the calendar rewrites its next event, and an open `stats` subscription receives one `counts` event.
  - `missing_count` / `needs_repair_count` count items whose stored `status` is `missing` / `needs_repair` — each the population of the `status` filter set to that slug. Stored state, not calendar-derived: they only change on a mutation, and every mutation emits `stats/counts`.
  - `status_counts` is the same figure for **every** defined slug, including `ok`. Additive to the two keys above rather than a replacement for them, so a client written against the earlier shape keeps working.

- `haventory/distinct_values`
  - Request: `{id, type: "haventory/distinct_values", filter?: ItemFilter}` (any other field → `invalid_format`; an unknown key *inside* `filter` → `validation_error` naming it, as for `item/list`)
  - Result: `{categories: DistinctValue[], tags: DistinctValue[], custom_field_keys: string[]}` (see data shapes)
  - `categories` are grouped case-insensitively; each `value` is a representative display label (most frequent original casing, ties broken alphabetically) and `count` is the number of items using that category. `tags` are already normalized (lowercase); each maps to one entry. Both lists are sorted case-insensitively by `value`. `custom_field_keys` is the sorted, distinct set of keys used across all items' `custom_fields` (case-sensitive keys, sorted case-insensitively).
  - With a `filter`, every `categories` and `tags` entry also carries `matching_count` — how many of that value's items the filter keeps — beside its whole-inventory `count`, the pair `location/tree` reports as `matching_direct_count`/`matching_subtree_count`. **The lists never shrink**: an entry the filter keeps nothing of is present at `matching_count: 0`. The same payload feeds category/tag autocomplete and the organize dialog, both of which a list that dropped non-matching rows would starve. Omitting `filter` (or sending `null`) leaves the key off every entry entirely, which is what an unpriced list looks like — distinct from "everything matches".
  - `custom_field_keys` is never filtered: it is a key picker, not a tally, and narrowing it would hide keys the user is about to type.
  - Which dimensions to leave out of `filter` is the caller's decision, as it is for `location/tree`. The card drops `category` and `tags_any`/`tags_all` before sending, for the reason it drops `location_id` from the tree's filter: a facet priced against its own selection reads 0 on every other row exactly when the user wants to see where else the matches are. One request prices both facets, so a chosen category does not narrow the tag tallies.
  - Read-only: emits no events and does not mutate state.

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <stats shape>, generation: number, rate_limit: {enabled: boolean, dropped_commands: number, dropped_events: number}}`

### Subscriptions and events

- Subscribe
  - `haventory/subscribe` request: `{id, type, topic: "items"|"locations"|"stats"|"statuses", location_id?: string|null, location_ids?: string[], area_id?: string|null, include_subtree?: boolean, inspection_overdue_only?: boolean}`
  - Result: `null` (result envelope with `result: null`)
  - `location_ids` is the multi-select beside `location_id`, unioned with it exactly as `item/list`'s filter unions the same pair, and covering the `items` and `locations` topics alike. One `include_subtree` flag governs the whole selection (defaulting to **true** here, unlike the list filter). A value that is not a list of strings answers `validation_error`. A card whose location filter names several locations has to send this, or the socket keeps delivering the other locations' events.
  - `area_id` narrows the `items` topic to items whose `effective_area_id` equals it — the same area `item/list`'s `area_id` filter selects by, read off the event's own item payload. A `null` (or an omitted key) means no area filter, not "items with no area"; an item with no location has `effective_area_id: null` and therefore reaches no area-filtered subscription. An `area_id` naming an area nothing resolves to is accepted and simply delivers nothing. Filters combine with AND: a subscription carrying both `area_id` and `location_id` requires both to match. The `locations` topic ignores `area_id`.
  - `inspection_overdue_only` narrows the `items` topic to items past their `inspection_date`, using the same rule as the `item/list` filter of that name. Like every subscription filter it is applied to the event's item payload as it stands *after* the mutation, so an item that leaves the filtered set (its inspection date rescheduled or cleared) produces no event for that subscription — a client that tracks a filtered set re-lists rather than relying on a departure event.
  - Subsequent events delivered as HA WS events to the same connection using this `id` as the subscription id.

- Unsubscribe
  - `haventory/unsubscribe` request: `{id, type, subscription: number}`
  - Result: `null`
  - A subscription is also registered in Home Assistant's own connection registry
    under its `id`, so it can equally be torn down via HA core's standard
    `unsubscribe_events` (`{id, type: "unsubscribe_events", subscription: number}`).
    This is the path the frontend's `connection.subscribeMessage` lifecycle uses;
    both routes cancel the subscription and the connection close hook remains the
    backstop for dropped clients.

- Event payloads (inside `event`):
  - Common: `{domain: "haventory", topic: "items"|"locations"|"stats"|"statuses", action: string, ts: string, ...payload}`
  - Items topic payloads include `{item: <Item>}` and actions: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`. An items event **may omit `item`**, and its absence is a refetch signal rather than a patch: the dataset moved wholesale and there is nothing to merge. Two cases emit one today — `reloaded` after `import/execute` replaces the dataset, and `updated` after `status/delete` with `reassign_to` moves every item carrying the slug in a single call. A client must therefore key on the presence of `item`, not on the action name. Subscription filters are not applied to a payload-less items event: with no item to match, every open items subscription receives it whatever its `location_id`.
  - Locations topic payloads include `{location: <Location>}` and actions: `created`, `renamed`, `moved`, `deleted`. The `reloaded` action (emitted after `import/execute`) carries **no** `location`.
  - Statuses topic payloads carry `{status: <StatusDefinition>}` for actions `created`, `updated` and `deleted`, and `{statuses: <StatusDefinition[]>}` for `reordered`. The vocabulary is small and changes rarely, so a client may equally re-read `status/list` on any event rather than applying a per-action patch — which is also what keeps it correct across a reorder.
  - Stats topic payload `action: "counts"` with `{counts: <stats shape>}`. Every mutation emits one, and so does the instance's local midnight — the five calendar-derived counts move with the date, and that tick is what lets a card left open overnight agree with the sensors. It is the one event that says nothing was edited, so a client must not read it as a mutation.
  - The `unavailable` action is sent on **every** topic, once per open subscription, when the config entry serving it tears down — an unload, a disable, a removal, or the first half of a reload. It carries no payload beyond the common fields: it says this subscription has stopped, not that anything in the inventory changed. It is the only event delivered regardless of the rate limiter's event budget, because its loss cannot be recovered by re-listing — a client that never receives it has no reason to re-list at all. Every command is refused with `storage_error` from this point (see "While no entry is loaded"), so a client that re-subscribes should expect to be refused for as long as setup takes and back off rather than give up on the first attempt.
  - When `location_id` filter is provided on subscription:
    - Items: if `include_subtree` (default true) match any item whose `location_path.id_path` contains the filter id; otherwise only direct `location_id` matches.
    - Locations: if `include_subtree` match the location itself or descendants; otherwise only the exact location.
  - Re-anchoring a location under a different root rewrites `effective_area_id` for its whole subtree and emits a single `locations` `moved` event; reassigning the area through `location/update` emits the same event, for the same reason — including when the `area_id` is sent for a location inside the tree rather than for its root, which is the same re-anchoring written a different way. Neither emits item events, so an area-filtered items subscription sees no departure for the items that just left its area, and no arrival for those that joined it. A client tracking a filtered set re-lists on a `locations` event rather than waiting for one — the same rule `inspection_overdue_only` carries, and the reason there is no synthetic per-item event here.

- **Both write paths broadcast the same events.** A `haventory.*` service call emits exactly
  what the WebSocket command doing the same thing emits — the `items` or `locations` event
  and the `stats` counts — because one call in `events.py` covers both surfaces. So an
  automation mutating the inventory repaints an open card with no interaction, and a
  subscriber cannot tell which surface a change arrived through. The rate limiter's event
  budget is charged identically either way, since it is the same broadcast.

- **An event implies a durable write.** Every mutation command persists the change *before* it broadcasts and before it replies, so any event on any topic says the write behind it reached storage. When the write fails the caller receives `storage_error` and **no event is emitted at all** — subscribers are told nothing rather than told about a change that is not on disk. A client may therefore treat a received event as committed and never has to reconcile it against a `storage_error` another client saw for the same change.
  - The guarantee is about the wire, not about the running repository: a failed write leaves the mutation applied in memory (`import/execute` is the exception — it rolls the dataset back, because a wholesale swap has more to undo than one entity does). Nothing announces that divergence, and it ends at the next restart, which reads back whatever last reached disk.
  - `items/bulk` shares one write across the whole batch, so a failed write costs the batch its `results` map: the command answers `storage_error` and none of its operations broadcast.
  - The rate limiter can still drop an event that was persisted — see "Rate limiting". The implication runs one way only: an event means a durable write, but a durable write does not guarantee an event.
  - The midnight `stats/counts` event is the one exception, and it is an exception in the harmless direction: nothing was written because nothing changed, only the day the counts are measured against. It is charged and dropped like any other broadcast, which is why the card re-reads `haventory/stats` on its own day boundary as well.

### Home Assistant bus events

Everything above is WebSocket traffic, delivered to subscribed clients. HAventory also fires
two event types on the **Home Assistant bus**, so an automation can trigger on the inventory
with no WebSocket client at all. Payload shapes: `docs/data_shapes.md`.

| Event type | Fired when | `action` |
|---|---|---|
| `haventory_item_changed` | an item is mutated | `created`, `updated`, `moved`, `quantity_changed`, `checked_out`, `checked_in`, `deleted` |
| `haventory_low_stock` | an item crosses its `low_stock_threshold` | `entered`, `cleared` |

- **The same "an event implies a durable write" rule holds here**: both are fired after the
  persist, on every path — WebSocket handlers and `haventory.*` service calls alike. A
  mutation that fails to persist fires nothing.
- **The `action` vocabulary is the WebSocket one**, so a trigger and a subscription describe
  the same mutation with the same word.
- **`haventory_low_stock` is a set diff, not a per-handler check.** The set of low-stock ids
  is snapshotted when the entry sets up — so a restart re-announces nothing — and diffed
  after every mutation. One `entered` on the crossing, nothing while it stays low, one
  `cleared` on restock or deletion. A wholesale `import/execute` diffs the same way rather
  than announcing every row.
- **The rate limiter does not apply.** It budgets WebSocket subscription traffic; bus events
  are internal to Home Assistant, on the same reasoning as the `unavailable` notice.
- **Bus events carry no item body beyond the trigger fields** — no `custom_fields`, no
  `description`. An automation that needs the whole item calls `haventory/item/get`.
- **Locations fire no bus event** — but most of them still repaint the entities. Two kinds of
  location change reach something derived. A create or a delete moves `locations_total`,
  which is a sensor. A rename or a re-parent rewrites `location_path` across the subtree, and
  every projected calendar event's `description` is an item's `location_path.display_path`,
  read from a cached entity state. So `location/create`, `location/delete`,
  `location/update`, `location/move_subtree` and their `haventory.location_*` services
  dispatch the repaint signal, with one exception: an area-only reassignment, which moves no
  count and no path. `haventory_item_changed` stays unfired for all of them — a derived-path
  rewrite deliberately moves neither an item's `version` nor its `updated_at`, and the action
  vocabulary above has no location word.

### Items

- `haventory/item/create`
  - Payload: any subset of `ItemCreate` (see data shapes), `name` required.
  - Result: `<Item>`; emits `items/created` and `stats/counts`.

- `haventory/item/get`
  - Payload: `{item_id: string}`
  - Result: `<Item>`

- `haventory/item/update`
  - Payload: `{item_id: string, expected_version?: number, ...ItemUpdate}`
  - Result: `<Item>`; emits `items/updated` or `items/moved` depending on whether `location_id` changed; emits `stats/counts`.

- `haventory/item/delete`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `null`; emits `items/deleted` with the pre-delete snapshot under `item`, and `stats/counts`.
  - The item's attachment files are deleted with it, after the save. A write that fails leaves every file where it was — the item is still in the store, and its metadata still names them.

- `haventory/item/adjust_quantity`
  - Payload: `{item_id: string, delta: number, expected_version?: number}`
  - Result: `<Item>`; emits `items/quantity_changed` and `stats/counts`.

- `haventory/item/set_quantity`
  - Payload: `{item_id: string, quantity: number, expected_version?: number}`
  - Result: `<Item>`; emits `items/quantity_changed` and `stats/counts`.

- `haventory/item/check_out`
  - Payload: `{item_id: string, due_date?: YYYY-MM-DD|null, expected_version?: number}`
  - Result: `<Item>`; emits `items/checked_out` and `stats/counts`.
  - `due_date` is optional here: omitting it (or passing `null`) checks the item out with
    no due date. Note this differs from the `haventory.item_check_out` **service**, whose
    schema requires `due_date`.

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
    `haventory/item/update`, which is how the card's editor saves them beside the rest of
    an edit. These commands exist for callers with no form to carry the other fields.
  - Writing `reminder_date` through any of them sets `reminder_anchor` to the same date:
    picking a date is saying where the series starts. No client writes the anchor directly.

- `haventory/reminder/clear`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - Idempotent: an item with no reminder succeeds unchanged apart from its `version`.

- `haventory/reminder/bump`
  - Payload: `{item_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`.
  - Moves `reminder_date` to the series' next occurrence — "I have just done this" — and
    **leaves `reminder_anchor` where it is**. It is the only write that does: every other
    path re-anchors the series on the date it writes. That is what keeps a series on the
    31st landing on the 31st in every month that has one, however often it is bumped through
    a short one; writing the occurrence back as the anchor would settle it on the lowest day
    of month it ever met.
  - Counted from the later of the stored `reminder_date` and today, so a reminder bumped on
    the day it came round advances by exactly one interval, one nobody bumped for a year
    lands on its next *future* occurrence rather than another date already past, and no
    occurrence in between is skipped — a 31st series bumped in February lands on the 28th,
    and the next one is 31 March.
  - Today is the instance's local day, the one `calendar.haventory` rolls over on and the
    one the date-derived counts and filters use. A reminder is a household-facing date, and
    bumping is what somebody does in the evening.
  - `validation_error` when the item has no reminder, and when it has one with no interval:
    a one-off has no next occurrence, and `haventory/reminder/clear` is what ends it. Also
    when the stored dates cannot be read, which only a hand-edited store produces.
  - Takes `expected_version` like any other item edit, and answers `conflict` on a stale one.

- `haventory/item/add_tags`
  - Payload: `{item_id: string, tags: string[], expected_version?: number}` (tags normalized: trimmed, casefolded, deduped; a value that is not a list of strings is a `validation_error`)
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
  - The bytes do **not** cross the WebSocket. The client first POSTs the file to Home Assistant core's `/api/file_upload` (with the user's auth header) and gets back a `file_id`; this command consumes that handle. `kind` defaults to `"picture"`; `filename` is display metadata only — the stored name is derived from a fresh attachment id and the sniffed type.
  - Adding an attachment **is** an item edit: it bumps `version` and `updated_at`, unlike the derived `location_path`. A client holding the pre-upload version must take the returned item back into its model, or its next write comes back `conflict`.
  - The new attachment's `order` is assigned server-side as the next free position **within its kind**, so an upload appends rather than tying with the item's cover.
  - Refusals: `validation_error` when the sniffed content type is outside the kind's allow-list, when the file is empty or over `max_attachment_bytes`, when the kind is unknown, or when the item already holds the per-kind maximum. `not_found` for an unknown `item_id` **or** a `file_id` that has expired or was already consumed. `conflict` for a stale `expected_version`. `storage_error` when the move onto disk or the save fails.
  - Accepted types are checked against the file's own leading bytes, never the content type the browser declared. `image/svg+xml` is refused outright: SVG carries script and the media view serves from the Home Assistant origin.

- `haventory/item/attachment/remove`
  - Payload: `{item_id: string, attachment_id: string, expected_version?: number}`
  - Result: `<Item>`; emits `items/updated` and `stats/counts`. The file is deleted with the metadata, after the save.
  - Refusals: `not_found` for an unknown item or attachment, `conflict` for a stale `expected_version`.

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
  - Renumbers one kind. **The first id named takes position 0, which is what makes a picture
    the item's cover** — there is no separate cover flag, so "make cover" is this command.
    Order is per kind, so renumbering pictures never moves a manual.
  - Refusals: `validation_error` when `attachment_ids` is not a list of strings, and unless
    it names every attachment of that kind exactly once; `not_found` for an unknown item;
    `conflict` for a stale `expected_version`.

- Serving an attachment — `GET /api/haventory/media/{item_id}/{attachment_id}`
  - An authenticated `HomeAssistantView`, not `/local` and not `/haventory_static`: both of those are served without authentication, and an inventory photo is as private as the inventory.
  - Both ids are matched against stored metadata before any path is built, so no request segment reaches the filesystem. Anything unmatched — and any entry whose file is absent — is `404`. Once no config entry owns the data the view answers `503`, mirroring the WebSocket commands' refusal.
  - Responses carry the stored content type and `X-Content-Type-Options: nosniff`.
  - `?size=thumb` asks for the **row tile** rather than the stored file: a 256px WebP, longest edge, written beside the original the first time it is asked for and served from there afterwards. The tile keeps the transparency the source had: a picture with an alpha channel, or a palette one with a transparent index, is written as RGBA WebP, and everything else as RGB. `thumb` is the only accepted value and any other is `400` — the parameter selects one derived form, it does not let a caller ask the server to render arbitrary sizes. Omitting it serves the original, which is what the lightbox and the detail sheet's large picture do.
  - Making one needs Pillow, which this integration does **not** declare as a requirement, so `size=thumb` is a request and never a guarantee: no Pillow, an animated GIF, a manual, an undecodable file, a directory that will not take a write — each serves the original, with the stored content type, and the page is slower rather than broken. A file that cannot be encoded is remembered for the life of the process so it is not decoded again on the next render.
  - The tile lives at `<attachment_id>.thumb2.webp` beside the original. The orphan sweep is told about it, so it survives; deleting the attachment deletes it. It holds no metadata, appears in no export, and can be deleted from disk at any time — the next request writes it again.
  - The `2` in that name is the **encoder generation**, and it is what makes a change to the encode reach an install that already has tiles: the generation is raised whenever an existing tile must not survive the upgrade, the sweep at the next setup removes the previous generation's files because no metadata names them, and the next request writes the tile the new encoder makes. Generation 1 is `.thumb.webp`, written by the encoder that flattened transparency onto black.
  - `Content-Disposition` is always `inline` — clicking a document opens it in a tab — and names the file the attachment's `title`, or its `filename` when untitled. The name travels percent-encoded as RFC 5987 `filename*=UTF-8''…`, with a quoted printable-ASCII `filename` beside it for clients without that support; a name with nothing printable in ASCII falls back to the attachment id there.
  - `Cache-Control` depends on whether the URL says which name it was fetched under. An attachment id addresses one fixed set of bytes — a replacement is a new id — but the name in `Content-Disposition` is not fixed: a retitle rewrites it for that same id. A URL carrying the `v` name-token parameter is therefore `private, max-age=31536000, immutable`, and one without it is `private, no-store`. Only the presence of `v` is read, never its value; it is a cache key, and the name it stands for is in the response anyway. Without this a retitled file would keep being saved under its old name for as long as the cached response lived, which a signature outlasts by half an hour.
  - An `<img src>` carries no `Authorization` header, so a client signs the path with core's `auth/sign_path` first and renders the signed URL. Home Assistant signs query parameters along with the path, so `v` and `size` both have to be on the path *before* signing — a client cannot add either to a URL it was handed, which is also why a tile and its original are two signatures rather than one.

- `haventory/items/bulk`
  - Payload: `{operations: Array<{op_id: string|number, kind: string, payload: object}>}`
  - Supported `kind` values: `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `item_add_tags`, `item_remove_tags`, `item_update_custom_fields`, `item_set_low_stock_threshold`.
  - Result: `{results: { [op_id: string]: {success: true, result: <Item>} | {success: false, error: {code, message, context}} }}`; if any success, a single `stats/counts` event is emitted.
  - A failed op fails only itself; the batch continues and reports it under its `op_id`. A failed *write*, by contrast, fails the whole command with `storage_error` and returns no `results` map at all — the batch is one write.
  - An `item_delete` row frees the item's attachment files, after the batch's one write and on the same terms as `item/delete`: a row that failed keeps every file it had, and a failed write frees nothing at all.
  - **`op_id`s must be unique within one batch**, and are compared as strings — `1` and `"1"` are the same id. A repeat rejects the whole command with `validation_error` and runs nothing, because the results map is keyed by `op_id` and could only report one verdict for the two operations.

- `haventory/item/list`
  - Payload: `{filter?: <ItemFilter>, sort?: <Sort>, limit?: number, cursor?: string}`
  - Result: `{items: <Item[]>, next_cursor: string|null, total: number}`
  - `total` is the number of items matching the filter across **all** pages (not the page size), recomputed per request — so "Showing N of `total`" is renderable on every page.
  - **Categories and locations multi-select.** `filter.categories: string[]` sits beside `filter.category`, and `filter.location_ids: string[]` beside `filter.location_id`. Each pair is *one* selection: the scalar and the list are **unioned**, never intersected — an item carries exactly one category and sits in exactly one location, so requiring both to hold would match nothing whenever they name different values. An empty list does not narrow, the way an empty `tags_any` does not. A value that is not a list of strings answers `validation_error` naming the key. `include_subtree` is **one flag for the whole location selection**, not one per entry: a per-entry form is deliberately not offered, and can be added later without breaking this one. See data shapes for the full rule.
  - **Unknown `filter` and `sort` keys are refused** with `validation_error` naming the offending key, rather than dropped. A dropped key returns the whole inventory labelled as a filtered result, which no caller can tell from a filter that legitimately matched everything. The accepted key set is exactly `<ItemFilter>`'s; `sort` accepts `field` and `order` only.
  - **`sort.field` accepts `location`**, ordering on the item's denormalized `location_path.sort_key`; items with no location sort last in both orders. This is not an area sort, and one is deliberately not offered — see data shapes for why. The cursor carries the same key, so a location-ordered page boundary round-trips like every other.
  - **A `cursor` that cannot be honoured is an error, never a silent restart.** `validation_error` is answered for a cursor that is empty, undecodable, longer than 2048 characters, missing its `last_id` / `last_sort_key`, or minted under a different `sort` — or a different `filter.low_stock_first` setting — than the request carries. Answering any of those with page one makes a caller paging through the inventory loop over the first page indefinitely without being told. To restart pagination, omit `cursor` — do not send `""`.
  - **`filter.low_stock_first` is part of the ordering the cursor describes.** It regroups the sorted list (low-stock block first, the chosen sort within each block), so the cursor records the grouping beside the sort key and pages through both blocks to exhaustion.

### Locations

- `haventory/location/create`
  - Payload: `{name: string, parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `locations/created` and `stats/counts`.

- `haventory/location/get`
  - Payload: `{location_id: string}`
  - Result: `<Location>`

- `haventory/location/update`
  - Payload: `{location_id: string, name?: string, new_parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits **at most one** `locations` event, chosen by what the call actually changed rather than by which keys it carried: `moved` when the parent changed, or when the area the location resolves to changed (either re-anchors the subtree), otherwise `renamed` when the name changed, otherwise nothing. The area comparison is on the resolved value, not on the row's own `area_id`: an `area_id` sent for a location below the root is stored on the root, so the edited row's own field does not move. An `area_id` that resolves to the area already in force moves nothing and announces nothing, whichever location it was sent for. A client that submits every field on every save therefore announces a rename as a rename. Also emits `stats/counts`.

- `haventory/location/delete`
  - Payload: `{location_id: string}`
  - Result: `null`; emits `locations/deleted` and `stats/counts`.

### Status definitions

The vocabulary items reference by slug. A slug is immutable — it is the exact string every
item stores — so only the presentation is editable, and no command here rewrites an item
except `status/delete` with a reassign target.

- `haventory/status/list`
  - Payload: `{}`
  - Result: `<StatusDefinition[]>` in display order. The same array `haventory/config` carries,
    for a client that wants it without re-reading the whole config.

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
  - **No item is touched and no item version moves.** The slug is the identity and the rest is
    presentation — the same reasoning that keeps a location rename out of an item's `version`.
  - Refusals: `not_found` for an unknown slug, `validation_error` for a bad value. A `slug`
    that differs from the one being edited is `validation_error`: items store it.

- `haventory/status/reorder`
  - Payload: `{slugs: string[]}`
  - Result: `<StatusDefinition[]>` in the new order; emits `statuses/reordered`.
  - Refusals: `validation_error` when `slugs` is not a list of strings, and unless it names
    every live status exactly once — a partial list would leave two definitions claiming one
    position, and a repeat is a client bug rather than something to normalize away.

- `haventory/status/delete`
  - Payload: `{slug: string, reassign_to?: string}`
  - Result: `{status: <StatusDefinition>, reassigned: number}`; emits `statuses/deleted`, and
    when `reassigned` is non-zero also `items/updated` and `stats/counts`. That `items/updated`
    carries **no `item`**: the move is a bulk rewrite, so the event is a refetch signal rather
    than a per-item patch (see "Event payloads"). On the Home Assistant bus it is the other way
    round: one `haventory_item_changed` with action `updated` **per rewritten item**, because
    each of them took a new `version` and a new `updated_at` and an automation subscribed to
    that event is watching items rather than commands. The low-stock diff and the sensor
    repaint run once for the batch.
  - **Refused while items still carry the slug and no `reassign_to` is given.** An item whose
    status names nothing would be coerced to the default on the next load, silently. With a
    target the items move and the definition is deleted in the same call, so no client can
    observe an item naming a status that no longer exists; each moved item bumps its
    `version` and `updated_at`.
  - Refusals: `validation_error` for the default status (`ok`, which is never deletable), for
    an in-use slug with no target, or for a target that is unknown or the slug itself;
    `not_found` for an unknown slug.

- `haventory/location/list`
  - Payload: `{}`
  - Result: `<Location[]>` (flat list)

- `haventory/location/tree`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one carrying an unknown key, → `validation_error`).
  - Result: Array of tree nodes: `{id, name, parent_id, path: <LocationPath>, direct_item_count, subtree_item_count, children: <Node[]>}`
  - `direct_item_count` counts items whose `location_id` is exactly that node; `subtree_item_count` counts items in the node or any descendant (`subtree_item_count >= direct_item_count`). Counts change on item create/delete/move — clients showing them should refresh the tree on item events (or on `stats/counts`), not only on location events.
  - With a `filter`, each node additionally carries `matching_direct_count` and `matching_subtree_count` — the same two counts restricted to items the filter keeps — so a location sidebar can show "4 / 37" rather than a total that ignores the active filter. The unfiltered counts are still returned unchanged. Both keys are absent when no `filter` is sent. A filter that names `location_id` is honoured like any other, so a sidebar wanting per-location counts should leave the location dimension out of the filter it sends.

- `haventory/areas/list`
  - Payload: `{}`
  - Result: `{areas: [{id: string, name: string}]}`

- `haventory/location/move_subtree`
  - Payload: `{location_id: string, new_parent_id: string|null}`
  - Result: `<Location>`; emits `locations/moved` and `stats/counts`.

### Import / export (data safety)

Backup-and-restore over WebSocket. Processing is in-memory (add chunking only if
payload size demands it). The export document embeds `schema_version` plus all items
and locations; a round-trip (export → import into an empty instance) reproduces the
data. See `data_shapes.md` for the full document, preview, and summary shapes.

- `haventory/export`
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter`, or one carrying an unknown key, → `validation_error`).
  - Result: `<ExportDocument>`. With no filter this is a full backup; with a filter,
    only matching items are exported together with the locations on each item's
    ancestry (so the document stays referentially self-consistent).
  - Read-only: emits no events and does not mutate state.

- `haventory/import/preview`
  - Payload: `{document: <ExportDocument>, policy?: "merge"|"replace"|"skip"}` (default
    `merge`).
  - Result: `<ImportPreview>` — validates and classifies **without mutating state**.
    Each incoming entity lands in exactly one bucket: `add` (id absent), `unchanged`
    (id present, identical), `update` (id present, differs, resolved by the policy), or
    `conflict` (id present, differs, left untouched by `skip`). Invalid documents return
    `{valid: false, errors: [{path, message}]}` rather than throwing.
  - **Every preview carries `warnings: <ImportWarning[]>`**, present whether or not it is
    empty and whether or not the document is valid, so a client has one shape to render.
    A warning **never affects `valid`** and **never reaches `import/execute`**: the preview
    tells, the entity id still decides. One code exists today, `name_collision` — an incoming
    entity classified `add` whose name matches, case- and accent-insensitively, that of a
    stored entity of the same kind carrying a *different* id. That is exactly the
    duplicate-on-rebuilt-ids hazard described under `import/execute` below, caught before
    the write. Only the `add` bucket is checked: `update` and `unchanged` are the same entity
    by id, so a name they share with some third entity is an ordinary namesake and warning on
    it would fire on healthy documents. A clean round trip (export → import onto the same
    instance) therefore produces no warnings under any policy.
  - A valid preview additionally carries `attachments: {referenced: number, missing: number}` —
    how many attachment references the resulting dataset would hold, and how many of them
    name a file this install does not have. The export carries metadata and not bytes, so
    importing one onto a fresh machine leaves dangling references; that is a caveat to
    show, not an error, and a client renders a "file missing" state for those entries.

- `haventory/import/execute`
  - Payload: `{document: <ExportDocument>, policy?: "merge"|"replace"|"skip"}` (default
    `merge`).
  - Applies the document with the chosen conflict policy, persists immediately, then
    emits `items/reloaded`, `locations/reloaded`, and `stats/counts`. Result:
    `<ImportSummary>`.
  - An invalid document is rejected with a `validation_error` whose `data.errors` lists
    the structured problems; **state is not mutated**. If persistence fails after the
    in-memory swap, the repository is rolled back to its pre-import snapshot and the
    error surfaces as `storage_error` — a bad import never leaves partial state.
  - **Identity is the entity id, and only the id.** An incoming item or location whose id is
    already present *is* the existing entity and is resolved by the policy below; one whose
    id is absent is a new entity and is added. Names are never compared, under any policy —
    matching by name would silently fuse two genuinely different "Shelf A"s. The corollary
    is that importing a document onto entities that were deleted and recreated by hand (and
    so carry fresh ids) duplicates them rather than merging: the incoming copies classify as
    `add`, and every incoming item follows its own `location_id` onto the incoming location,
    leaving the hand-rebuilt one holding nothing. `import/preview` shows this before the
    write — entities you expect to already exist appear under `unchanged`/`update`, never
    under `add`, and the preview additionally flags each incoming name a different id already
    answers to as a `name_collision` warning. It flags the case rather than resolving it:
    resolving would mean matching by name, which is what identity-by-id exists to avoid.
    `import/execute` is unchanged by this and applies the document either way.
  - Conflict policies (for ids already present): `skip` keeps the existing entity;
    `replace` overwrites it with the incoming one; `merge` overlays incoming onto
    existing (scalar fields from incoming; item `tags` unioned; item `attachments`
    unioned by attachment id; item `custom_fields` merged, incoming wins per key). For
    locations, `merge` behaves as `replace`.
  - **Status definitions are a vocabulary, not an entity the policies act on.** The
    document's `statuses` section overlays whatever is stored, and any slug the resulting
    items reference without a definition gets one — no policy ever deletes a definition,
    because an item on this install may still carry the slug. A document whose items
    reference a slug that is neither built-in nor defined in the document is rejected in
    preview with `{path: "items[N].status", ...}`.
  - **Attachments travel as metadata only.** An import never *drops* an item — a document
    that omits one leaves it exactly as it stands — but `replace` overwrites an item's
    attachment list, so an entry the document does not carry loses its only reference.
    `import/execute` deletes those files after the write, because metadata is the only
    record of where a file is. Home Assistant's own backups are the full-fidelity path:
    the media directory lives inside the config directory, so it rides them with no extra
    work.

Note: a successful import emits `items/reloaded` and `locations/reloaded` (no `item` /
`location` payload) to tell every subscriber the dataset was replaced wholesale.

### Versioning and concurrency

- Items include `version: number`. Mutating commands accept `expected_version?: number` and raise `conflict` on mismatch.
- `version` counts *item* mutations only. `location/update` (and `location/move_subtree`)
  rewrites the derived `location_path` of every item in the subtree without bumping their
  `version` or `updated_at`, so an `expected_version` taken before a rename is still
  accepted after it. Clients learn about the new paths from the `locations` event, not from
  per-item events — none are emitted for the rewrite.
- Locations carry no `version` and take no `expected_version`. A location edit is
  last-write-wins; only items are under optimistic concurrency.

### Timestamps

- All timestamps are ISO-8601 UTC without microseconds, with trailing `Z`.

### Compatibility

- Target HA: ≥ 2026.6.0; Python 3.14 (see CLAUDE.md). The offline suite validates
  the envelope against the stubs in `tests/conftest.py`; the phacc integration suite
  (`tests/integration/`) validates it against a real in-process HA core.
