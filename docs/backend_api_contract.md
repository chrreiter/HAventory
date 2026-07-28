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
- `storage_error`: Persistence or setup issue
- `rate_limited`: Command rejected by the (opt-in) WebSocket rate limiter — see "Rate limiting"
- `unknown_error`: Fallback for unexpected exceptions

Handlers map domain exceptions to these codes and log with context; `conflict` and `storage_error` log at error level; others at warning.

Guarantees (every `haventory/*` command is wrapped by the same guard):

- Domain errors carry the exception message plus structured `data` context (`op` and selected request fields).
- Any unexpected (non-domain) exception maps to `unknown_error` with the fixed message `"unexpected error; see Home Assistant logs"` and `data` context. Exception text and stack traces never reach the client; the full traceback goes to the server log only.
- In `haventory/items/bulk`, a failing operation (including an unexpectedly malformed **payload**) fails only its own per-op result; the remaining operations still run and successful ones persist. Note the batch **envelope** is validated first: a structurally malformed operation *entry* (non-object entry, missing/invalid `op_id`, non-string `kind`, non-object `payload`) cannot be reported per-op and rejects the whole command with `validation_error`.

Transport-level errors produced by Home Assistant itself (before a handler runs) are outside this taxonomy and can also be observed by clients: `invalid_format` (request failed the command's voluptuous schema) and `unknown_command` (integration not loaded or unknown `type`).

### Rate limiting

**Off by default.** Enable and tune it in the integration's options flow (Settings → Devices & services → HAventory → Configure). Token buckets (sustained rate + burst) apply per connection **and** globally, separately for commands and for subscription broadcasts:

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

- `haventory/stats`
  - Result: `{items_total: number, low_stock_count: number, checked_out_count: number, overdue_count: number, locations_total: number, no_location_count: number}`
  - `no_location_count` is the number of items without a location (`location_id == null`, i.e. the `orphaned_only` filter's population).
  - `overdue_count` is the number of items whose `due_date` is strictly before today in UTC (the `overdue_only` filter's population). It is derived from the calendar, not from stored state, so it can change without any mutation — no event is emitted when the date rolls over.

- `haventory/distinct_values`
  - Request: `{id, type: "haventory/distinct_values"}` (no payload; extra fields → `validation_error`)
  - Result: `{categories: DistinctValue[], tags: DistinctValue[], custom_field_keys: string[]}` (see data shapes)
  - `categories` are grouped case-insensitively; each `value` is a representative display label (most frequent original casing, ties broken alphabetically) and `count` is the number of items using that category. `tags` are already normalized (lowercase); each maps to one entry. Both lists are sorted case-insensitively by `value`. `custom_field_keys` is the sorted, distinct set of keys used across all items' `custom_fields` (case-sensitive keys, sorted case-insensitively).
  - Read-only: emits no events and does not mutate state.

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <stats shape>, generation: number, rate_limit: {enabled: boolean, dropped_commands: number, dropped_events: number}}`

### Subscriptions and events

- Subscribe
  - `haventory/subscribe` request: `{id, type, topic: "items"|"locations"|"stats", location_id?: string|null, include_subtree?: boolean}`
  - Result: `null` (result envelope with `result: null`)
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
  - Common: `{domain: "haventory", topic: "items"|"locations"|"stats", action: string, ts: string, ...payload}`
  - Items topic payloads include `{item: <Item>}` and actions: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`. The `reloaded` action (emitted after `import/execute`) carries **no** `item` and signals a wholesale dataset replacement.
  - Locations topic payloads include `{location: <Location>}` and actions: `created`, `renamed`, `moved`, `deleted`. The `reloaded` action (emitted after `import/execute`) carries **no** `location`.
  - Stats topic payload `action: "counts"` with `{counts: <stats shape>}`.
  - When `location_id` filter is provided on subscription:
    - Items: if `include_subtree` (default true) match any item whose `location_path.id_path` contains the filter id; otherwise only direct `location_id` matches.
    - Locations: if `include_subtree` match the location itself or descendants; otherwise only the exact location.

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

- `haventory/items/bulk`
  - Payload: `{operations: Array<{op_id: string|number, kind: string, payload: object}>}`
  - Supported `kind` values: `item_update`, `item_delete`, `item_move`, `item_adjust_quantity`, `item_set_quantity`, `item_check_out`, `item_check_in`, `item_add_tags`, `item_remove_tags`, `item_update_custom_fields`, `item_set_low_stock_threshold`.
  - Result: `{results: { [op_id: string]: {success: true, result: <Item>} | {success: false, error: {code, message, context}} }}`; if any success, a single `stats/counts` event is emitted.

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
    existing (scalar fields from incoming; item `tags` unioned; item `custom_fields`
    merged, incoming wins per key). For locations, `merge` behaves as `replace`.

Note: a successful import emits `items/reloaded` and `locations/reloaded` (no `item` /
`location` payload) to tell every subscriber the dataset was replaced wholesale.

### Versioning and concurrency

- Items include `version: number`. Mutating commands accept `expected_version?: number` and raise `conflict` on mismatch.
- Locations are not versioned in Phase 1.

### Timestamps

- All timestamps are ISO-8601 UTC without microseconds, with trailing `Z`.

### Compatibility

- Target HA: ≥ 2026.7; Python 3.14 (WP1 floors — see CLAUDE.md). The offline suite validates
  the envelope against the stubs in `tests/conftest.py`; the phacc integration suite
  (`tests/integration/`) validates it against a real in-process HA core.
