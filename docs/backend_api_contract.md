## HAventory WebSocket API Contract

This document specifies the WebSocket message envelope, error taxonomy, command catalog, and event delivery semantics implemented by `custom_components/haventory/ws.py`.

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
- In `haventory/items/bulk`, a failing operation (including an unexpectedly malformed **payload**) fails only its own per-op result; the remaining operations still run and successful ones persist. Note the batch **envelope** is validated first: a structurally malformed operation *entry* (non-object entry, missing/invalid `op_id`, non-string `kind`, non-object `payload`) cannot be reported per-op and rejects the whole command with `validation_error`.

Transport-level errors produced by Home Assistant itself (before a handler runs) are outside this taxonomy and can also be observed by clients: `invalid_format` (request failed the command's voluptuous schema) and `unknown_command` (integration not loaded or unknown `type`).

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
- **The next setup restores everything** — the API and the inventory, which teardown flushes on the way out and setup reads back. Removal keeps the store file too, so re-adding the integration brings the inventory with it (README → "Removing HAventory").

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
  - Result: `{card_title: string, statuses: StatusDefinition[], media: MediaConfig}`
  - `card_title` is the heading set in the integration's options flow (Settings → Devices & services → HAventory → **Configure**), defaulting to `"HAventory"`. Only display settings appear here — rate-limit tunables stay server-side.
  - `statuses` is the status vocabulary in display order (see data shapes). Items store only a slug, so this is where a surface gets the label to render one with.
  - `media` is `{picture_mime_types: string[], max_pictures_per_item: number, manual_mime_types: string[], max_manuals_per_item: number, max_attachment_bytes: number}` — the attachment limits, reported so a picker can refuse a doomed file before uploading it. **Advisory only**: every one of them is re-derived server-side from the file's own bytes. The media *route* is deliberately not here; it is a constant on both sides of the language boundary (`/api/haventory/media/{item_id}/{attachment_id}`), pinned by a test.
  - Read at card init and on refresh, not pushed: changing the option emits no event, so an open dashboard shows the new heading after a refresh or reload.

- `haventory/stats`
  - Result: `{items_total: number, low_stock_count: number, checked_out_count: number, overdue_count: number, inspection_overdue_count: number, missing_count: number, needs_repair_count: number, status_counts: {[slug]: number}, locations_total: number, no_location_count: number}`
  - `no_location_count` is the number of items without a location (`location_id == null`, i.e. the `orphaned_only` filter's population).
  - `overdue_count` is the number of items whose `due_date` is strictly before today in UTC (the `overdue_only` filter's population). It is derived from the calendar, not from stored state, so it can change without any mutation — no event is emitted when the date rolls over.
  - `inspection_overdue_count` is the number of items whose `inspection_date` — the date the item is next due for inspection — is strictly before today in UTC (the `inspection_overdue_only` filter's population). It counts the whole inventory, not just checked-out items, because an inspection is independent of any check-out. Calendar-derived in the same way as `overdue_count`, with the same no-event caveat.
  - `missing_count` / `needs_repair_count` count items whose stored `status` is `missing` / `needs_repair` (the populations of the `status` filter's two non-default values). Stored state, not calendar-derived: they only change on a mutation, and every mutation emits `stats/counts`.
  - `status_counts` is the same figure for **every** defined slug, including `ok`. Additive to the two keys above rather than a replacement for them, so a client written against the earlier shape keeps working.

- `haventory/distinct_values`
  - Request: `{id, type: "haventory/distinct_values"}` (no payload; extra fields → `validation_error`)
  - Result: `{categories: DistinctValue[], tags: DistinctValue[], custom_field_keys: string[]}` (see data shapes)
  - `categories` are grouped case-insensitively; each `value` is a representative display label (most frequent original casing, ties broken alphabetically) and `count` is the number of items using that category. `tags` are already normalized (lowercase); each maps to one entry. Both lists are sorted case-insensitively by `value`. `custom_field_keys` is the sorted, distinct set of keys used across all items' `custom_fields` (case-sensitive keys, sorted case-insensitively).
  - Read-only: emits no events and does not mutate state.

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <stats shape>, generation: number, rate_limit: {enabled: boolean, dropped_commands: number, dropped_events: number}}`

### Subscriptions and events

- Subscribe
  - `haventory/subscribe` request: `{id, type, topic: "items"|"locations"|"stats"|"statuses", location_id?: string|null, include_subtree?: boolean, inspection_overdue_only?: boolean}`
  - Result: `null` (result envelope with `result: null`)
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
  - Items topic payloads include `{item: <Item>}` and actions: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`. The `reloaded` action (emitted after `import/execute`) carries **no** `item` and signals a wholesale dataset replacement.
  - Locations topic payloads include `{location: <Location>}` and actions: `created`, `renamed`, `moved`, `deleted`. The `reloaded` action (emitted after `import/execute`) carries **no** `location`.
  - Statuses topic payloads carry `{status: <StatusDefinition>}` for actions `created`, `updated` and `deleted`, and `{statuses: <StatusDefinition[]>}` for `reordered`. The vocabulary is small and changes rarely, so a client may equally re-read `status/list` on any event rather than applying a per-action patch — which is also what keeps it correct across a reorder.
  - Stats topic payload `action: "counts"` with `{counts: <stats shape>}`.
  - The `unavailable` action is sent on **every** topic, once per open subscription, when the config entry serving it tears down — an unload, a disable, a removal, or the first half of a reload. It carries no payload beyond the common fields: it says this subscription has stopped, not that anything in the inventory changed. It is the only event delivered regardless of the rate limiter's event budget, because its loss cannot be recovered by re-listing — a client that never receives it has no reason to re-list at all. Every command is refused with `storage_error` from this point (see "While no entry is loaded"), so a client that re-subscribes should expect to be refused for as long as setup takes and back off rather than give up on the first attempt.
  - When `location_id` filter is provided on subscription:
    - Items: if `include_subtree` (default true) match any item whose `location_path.id_path` contains the filter id; otherwise only direct `location_id` matches.
    - Locations: if `include_subtree` match the location itself or descendants; otherwise only the exact location.

- **An event implies a durable write.** Every mutation command persists the change *before* it broadcasts and before it replies, so any event on any topic says the write behind it reached storage. When the write fails the caller receives `storage_error` and **no event is emitted at all** — subscribers are told nothing rather than told about a change that is not on disk. A client may therefore treat a received event as committed and never has to reconcile it against a `storage_error` another client saw for the same change.
  - The guarantee is about the wire, not about the running repository: a failed write leaves the mutation applied in memory (`import/execute` is the exception — it rolls the dataset back, because a wholesale swap has more to undo than one entity does). Nothing announces that divergence, and it ends at the next restart, which reads back whatever last reached disk.
  - `items/bulk` shares one write across the whole batch, so a failed write costs the batch its `results` map: the command answers `storage_error` and none of its operations broadcast.
  - The rate limiter can still drop an event that was persisted — see "Rate limiting". The implication runs one way only: an event means a durable write, but a durable write does not guarantee an event.

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

- `haventory/item/add_tags`
  - Payload: `{item_id: string, tags: string[], expected_version?: number}` (tags normalized: trimmed, casefolded, deduped)
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
  - Refusals: `validation_error` unless `attachment_ids` names every attachment of that kind
    exactly once, `not_found` for an unknown item, `conflict` for a stale `expected_version`.

- Serving an attachment — `GET /api/haventory/media/{item_id}/{attachment_id}`
  - An authenticated `HomeAssistantView`, not `/local` and not `/haventory_static`: both of those are served without authentication, and an inventory photo is as private as the inventory.
  - Both ids are matched against stored metadata before any path is built, so no request segment reaches the filesystem. Anything unmatched — and any entry whose file is absent — is `404`. Once no config entry owns the data the view answers `503`, mirroring the WebSocket commands' refusal.
  - Responses carry the stored content type, `X-Content-Type-Options: nosniff`, and a long immutable `Cache-Control`: an attachment id addresses one fixed set of bytes, and a replacement is a new id.
  - An `<img src>` carries no `Authorization` header, so a client signs the path with core's `auth/sign_path` first and renders the signed URL.

- `haventory/items/bulk`
  - Payload: `{operations: Array<{op_id: string|number, kind: string, payload: object}>}`
  - Supported `kind` values: `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `item_add_tags`, `item_remove_tags`, `item_update_custom_fields`, `item_set_low_stock_threshold`.
  - Result: `{results: { [op_id: string]: {success: true, result: <Item>} | {success: false, error: {code, message, context}} }}`; if any success, a single `stats/counts` event is emitted.
  - A failed op fails only itself; the batch continues and reports it under its `op_id`. A failed *write*, by contrast, fails the whole command with `storage_error` and returns no `results` map at all — the batch is one write.

- `haventory/item/list`
  - Payload: `{filter?: <ItemFilter>, sort?: <Sort>, limit?: number, cursor?: string}`
  - Result: `{items: <Item[]>, next_cursor: string|null, total: number}`
  - `total` is the number of items matching the filter across **all** pages (not the page size), recomputed per request — so "Showing N of `total`" is renderable on every page.

### Locations

- `haventory/location/create`
  - Payload: `{name: string, parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `locations/created` and `stats/counts`.

- `haventory/location/get`
  - Payload: `{location_id: string}`
  - Result: `<Location>`

- `haventory/location/update`
  - Payload: `{location_id: string, name?: string, new_parent_id?: string|null, area_id?: string|null}`
  - Result: `<Location>`; emits `locations/moved` when parent changes and `locations/renamed` when name changes (both may emit if both fields present); also emits `stats/counts`.

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
  - Absent `order` places it last. `color` must be one of the ten tone tokens and `icon` one
    of the ten glyph names (see data shapes); both default when omitted.
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
  - Refusals: `validation_error` unless `slugs` names every live status exactly once — a
    partial list would leave two definitions claiming one position.

- `haventory/status/delete`
  - Payload: `{slug: string, reassign_to?: string}`
  - Result: `{status: <StatusDefinition>, reassigned: number}`; emits `statuses/deleted`, and
    when `reassigned` is non-zero also `items/updated` and `stats/counts`.
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
  - Payload: `{filter?: <ItemFilter>}`
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
  - Payload: `{filter?: <ItemFilter>}` (a non-object `filter` → `validation_error`).
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
    under `add`.
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
- Locations are not versioned in Phase 1.

### Timestamps

- All timestamps are ISO-8601 UTC without microseconds, with trailing `Z`.

### Compatibility

- Target HA: ≥ 2026.6.0; Python 3.14 (see CLAUDE.md). The offline suite validates
  the envelope against the stubs in `tests/conftest.py`; the phacc integration suite
  (`tests/integration/`) validates it against a real in-process HA core.
