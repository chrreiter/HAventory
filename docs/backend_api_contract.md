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
- `unknown_error`: Fallback for unexpected exceptions

Handlers map domain exceptions to these codes and log with context; `conflict` and `storage_error` log at error level; others at warning.

### Utility commands

- `haventory/ping`
  - Request: `{id, type: "haventory/ping", echo?: any}`
  - Result: `{echo: any, ts: string}`

- `haventory/version`
  - Result: `{integration_version: string, schema_version: number}`

- `haventory/stats`
  - Result: `{items_total: number, low_stock_count: number, checked_out_count: number, locations_total: number}`

- `haventory/health`
  - Result: `{healthy: boolean, issues: string[], counts: <stats shape>}`

### Subscriptions and events

- Subscribe
  - `haventory/subscribe` request: `{id, type, topic: "items"|"locations"|"stats", location_id?: string|null, include_subtree?: boolean}`
  - Result: `null` (result envelope with `result: null`)
  - Subsequent events delivered as HA WS events to the same connection using this `id` as the subscription id.

- Unsubscribe
  - `haventory/unsubscribe` request: `{id, type, subscription: number}`
  - Result: `null`

- Event payloads (inside `event`):
  - Common: `{domain: "haventory", topic: "items"|"locations"|"stats", action: string, ts: string, ...payload}`
  - Items topic payloads include `{item: <Item>}` and actions: `created`, `updated`, `moved`, `deleted`, `checked_out`, `checked_in`, `quantity_changed`.
  - Locations topic payloads include `{location: <Location>}` and actions: `created`, `renamed`, `moved`, `deleted`.
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
  - Payload: `{item_id: string, due_date: YYYY-MM-DD, expected_version?: number}`
  - Result: `<Item>`; emits `items/checked_out` and `stats/counts`.

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
  - Result: `{items: <Item[]>, next_cursor: string|null}`

### Locations

- `haventory/location/create`
  - Payload: `{name: string, parent_id?: string|null}`
  - Result: `<Location>`; emits `locations/created` and `stats/counts`.

- `haventory/location/get`
  - Payload: `{location_id: string}`
  - Result: `<Location>`

- `haventory/location/update`
  - Payload: `{location_id: string, name?: string, new_parent_id?: string|null}`
  - Result: `<Location>`; emits `locations/moved` when parent changes and `locations/renamed` when name changes (both may emit if both fields present); also emits `stats/counts`.

- `haventory/location/delete`
  - Payload: `{location_id: string}`
  - Result: `null`; emits `locations/deleted` and `stats/counts`.

- `haventory/location/list`
  - Payload: `{}`
  - Result: `<Location[]>` (flat list)

- `haventory/location/tree`
  - Payload: `{}`
  - Result: Array of tree nodes: `{id, name, parent_id, path: <LocationPath>, children: <Node[]>}`

- `haventory/location/move_subtree`
  - Payload: `{location_id: string, new_parent_id: string|null}`
  - Result: `<Location>`; emits `locations/moved` and `stats/counts`.

### Versioning and concurrency

- Items include `version: number`. Mutating commands accept `expected_version?: number` and raise `conflict` on mismatch.
- Locations are not versioned in Phase 1.

### Timestamps

- All timestamps are ISO-8601 UTC without microseconds, with trailing `Z`.

### Compatibility

- Target HA: ≥ 2024.8; Python 3.12. Tests validate the envelope against the stubs in `tests/conftest.py`.
