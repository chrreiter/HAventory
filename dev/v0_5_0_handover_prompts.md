# V0.5.0 — handovers to a local session

Cloud sessions have no Home Assistant. Each section below is one thing a V0.5.0 PR could
not verify offline, written to be run in front of the dev Docker instance the
`run-haventory` and `test-haventory` skills drive.

Appended in session order, per `dev/V0_5_0_implementation.md` §5. Deleted with that plan
when the milestone closes.

---

## H1 — #197 the widened frames stop HA core logging the client payload at ERROR

**Branch / PR**: `claude/v0-5-0-w1a-input-hardening` / #TBD
**Why this needs a real HA**: the log line comes from Home Assistant core, not from this
integration. `homeassistant.components.websocket_api.http.connection` logs a schema
rejection at ERROR *with the client's payload in the message* — the whole point of typing
`name` / `quantity` / `delta` / `operations` / `filter` / `sort` / `limit` / `cursor` as
`object` is that they no longer take that path. The in-process suite proves the frames now
answer `validation_error`; only a running instance shows what its log does about it.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Seed one item so the batch case has something to address:

    uv run python scripts/create_test_items.py --count 1

### Steps

1. Start following the log: `docker logs -f home-assistant 2>&1 | grep -i websocket_api`.
2. Send each of these over the WebSocket (`uv run python scripts/ws_probe.py` drives it):
   - `{"type": "haventory/item/create", "name": "Hammer", "quantity": 1.5}`
   - `{"type": "haventory/item/create", "name": 42}`
   - `{"type": "haventory/item/adjust_quantity", "item_id": "<id>", "delta": "two"}`
   - `{"type": "haventory/items/bulk", "operations": "oops"}`
   - `{"type": "haventory/item/list", "filter": {"query": "hammer"}}`
   - `{"type": "haventory/item/list", "limit": 2, "cursor": ""}`
3. For contrast, send one frame that is *still* schema-typed and must still be refused by
   core: `{"type": "haventory/item/create", "name": "Hammer", "tags": "chisel"}`.

### What "pass" looks like

- Every frame in step 2 answers `{"success": false, "error": {"code": "validation_error"}}`,
  and the message names the field.
- **No `ERROR` line from `homeassistant.components.websocket_api.http.connection`** for any
  of them. Each appears once at WARNING from `custom_components.haventory.ws`, with no
  traceback and with the payload absent from the message.
- The frame in step 3 still answers `invalid_format` and still logs at ERROR from core —
  that contrast is what shows the widening is what changed the behaviour, rather than a
  logging config difference.
- The inventory is unchanged afterwards: `haventory/stats` reports the same `items_total`
  it did before step 2.

### What to send back

- The grepped log excerpt covering steps 2 and 3, and the six error envelopes.
- Paste the result as a comment on #197 and reply on the PR thread.
