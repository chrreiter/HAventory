"""Offline tests for the status WebSocket commands and the item field they describe.

Statuses are the one vocabulary items *reference*, so `status/delete` is the
only command here that can orphan data. These tests pin its refusal, the
reassign escape hatch, the two topics a reassignment has to reach — cards
showing the vocabulary, and cards showing the items that just moved — and the
payload-less shape of that second broadcast, which is what tells a client to
re-list rather than to patch one row.

The item field itself follows: what `item/create`, `item/update`, `item/list`,
`items/bulk` and `stats` do with a status, which is every command a card reaches
for to flag something and find it again.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import events as events_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DEFAULT_STATUS_COLOR, DEFAULT_STATUS_ICON
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime
from ws_helpers import ws_send


def _new_hass() -> HomeAssistant:
    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)
    return hass


Broadcast = tuple[str, str, dict | None]


def _record_broadcasts(monkeypatch) -> list[Broadcast]:
    """Capture (topic, action, payload) triples instead of delivering them."""

    seen: list[Broadcast] = []

    def fake(hass, *, topic, action, payload=None):
        seen.append((topic, action, payload))

    # The status handlers broadcast on their own; the item half of a reassigning
    # delete travels through `events.py`.
    monkeypatch.setattr(ws_mod, "broadcast_event", fake)
    monkeypatch.setattr(events_mod, "broadcast_event", fake)
    return seen


def _topics(seen: list[Broadcast]) -> list[tuple[str, str]]:
    """The (topic, action) pairs alone, for assertions the payload does not concern."""

    return [(topic, action) for topic, action, _payload in seen]


# -----------------------------
# Reading
# -----------------------------


@pytest.mark.asyncio
async def test_list_returns_the_vocabulary_in_display_order() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/list")

    assert res["success"] is True
    assert [d["slug"] for d in res["result"]] == ["ok", "missing", "needs_repair"]
    assert res["result"][0]["color"] == "green"
    assert res["result"][0]["icon"] == "check"


# -----------------------------
# Creating and updating
# -----------------------------


@pytest.mark.asyncio
async def test_create_defines_a_status_and_broadcasts(monkeypatch) -> None:
    hass = _new_hass()
    seen = _record_broadcasts(monkeypatch)

    res = await ws_send(
        hass, 1, "haventory/status/create", slug="lent_out", label="Lent out", color="blue"
    )

    assert res["success"] is True
    assert res["result"]["slug"] == "lent_out"
    assert res["result"]["color"] == "blue"
    assert res["result"]["icon"] == DEFAULT_STATUS_ICON
    assert ("statuses", "created") in _topics(seen)


@pytest.mark.asyncio
async def test_create_defaults_the_appearance_when_none_is_given() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/create", slug="lent_out", label="Lent out")

    assert res["result"]["color"] == DEFAULT_STATUS_COLOR


@pytest.mark.asyncio
async def test_create_refuses_a_duplicate_slug() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/create", slug="missing", label="Gone")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_refuses_a_colour_outside_the_palette() -> None:
    """The card can only paint a token it has a rule for, or a literal it can read."""

    hass = _new_hass()

    res = await ws_send(
        hass, 1, "haventory/status/create", slug="lent_out", label="Lent out", color="puce"
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_accepts_a_literal_colour() -> None:
    """A household colour outside the ten reaches the store as it was entered."""

    hass = _new_hass()

    res = await ws_send(
        hass, 1, "haventory/status/create", slug="lent_out", label="Lent out", color="#2F6F4F"
    )

    assert res["success"] is True, res
    assert res["result"]["color"] == "#2f6f4f"


@pytest.mark.asyncio
async def test_update_renames_without_touching_items(monkeypatch) -> None:
    hass = _new_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Saw", status="needs_repair")
    before = created["result"]["version"]
    seen = _record_broadcasts(monkeypatch)

    res = await ws_send(hass, 2, "haventory/status/update", slug="needs_repair", label="Broken")

    assert res["success"] is True
    assert res["result"]["label"] == "Broken"
    assert ("statuses", "updated") in _topics(seen)
    assert ("items", "updated") not in _topics(seen)
    still = await ws_send(hass, 3, "haventory/item/get", item_id=created["result"]["id"])
    assert still["result"]["version"] == before


@pytest.mark.asyncio
async def test_update_of_an_unknown_slug_is_not_found() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/update", slug="lent_out", label="Lent out")

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_reorder_rewrites_display_order(monkeypatch) -> None:
    hass = _new_hass()
    seen = _record_broadcasts(monkeypatch)

    res = await ws_send(
        hass, 1, "haventory/status/reorder", slugs=["needs_repair", "ok", "missing"]
    )

    assert res["success"] is True
    assert [d["slug"] for d in res["result"]] == ["needs_repair", "ok", "missing"]
    assert ("statuses", "reordered") in _topics(seen)


@pytest.mark.asyncio
async def test_reorder_refuses_a_partial_list() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/reorder", slugs=["ok", "missing"])

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# Deleting
# -----------------------------


@pytest.mark.asyncio
async def test_delete_refuses_the_default_status() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/status/delete", slug="ok")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_delete_removes_an_unused_status(monkeypatch) -> None:
    hass = _new_hass()
    seen = _record_broadcasts(monkeypatch)

    res = await ws_send(hass, 1, "haventory/status/delete", slug="needs_repair")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 0
    assert ("statuses", "deleted") in _topics(seen)
    listed = await ws_send(hass, 2, "haventory/status/list")
    assert [d["slug"] for d in listed["result"]] == ["ok", "missing"]


@pytest.mark.asyncio
async def test_delete_refuses_a_status_in_use_without_a_target() -> None:
    """An item whose status names nothing would be silently coerced on reload."""

    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Ladder", status="missing")

    res = await ws_send(hass, 2, "haventory/status/delete", slug="missing")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    listed = await ws_send(hass, 3, "haventory/status/list")
    assert "missing" in [d["slug"] for d in listed["result"]]


@pytest.mark.asyncio
async def test_delete_with_a_target_moves_the_items_and_broadcasts_both(monkeypatch) -> None:
    hass = _new_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Ladder", status="missing")
    item_id = created["result"]["id"]
    seen = _record_broadcasts(monkeypatch)

    res = await ws_send(hass, 2, "haventory/status/delete", slug="missing", reassign_to="ok")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 1
    # Both, and for different readers: one card is showing the vocabulary, the
    # other is showing the items that just changed underneath it.
    assert ("statuses", "deleted") in _topics(seen)
    assert ("items", "updated") in _topics(seen)
    # The reassignment is one bulk rewrite, so the items event names no item.
    # Clients key on that absence to mean "refetch, there is nothing to merge";
    # attaching a payload here would silently turn a refetch into a one-item
    # patch and strand every other moved row.
    assert [payload for topic, _action, payload in seen if topic == "items"] == [None]
    moved = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert moved["result"]["status"] == "ok"
    assert moved["result"]["version"] == created["result"]["version"] + 1


@pytest.mark.asyncio
async def test_delete_refuses_an_unknown_reassign_target() -> None:
    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Ladder", status="missing")

    res = await ws_send(hass, 2, "haventory/status/delete", slug="missing", reassign_to="nowhere")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# Subscribing
# -----------------------------


@pytest.mark.asyncio
async def test_statuses_is_a_subscribable_topic() -> None:
    """Without it, a card cannot learn a status was renamed while it was open."""

    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/subscribe", topic="statuses")

    assert res["success"] is True


@pytest.mark.asyncio
async def test_an_unknown_topic_is_still_refused() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/subscribe", topic="nonsense")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# The item field the vocabulary describes
# -----------------------------


@pytest.mark.asyncio
async def test_ws_item_create_and_update_status() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    assert res["success"] is True
    assert res["result"]["status"] == "missing"
    item_id = res["result"]["id"]

    res = await ws_send(hass, 2, "haventory/item/update", item_id=item_id, status="needs_repair")
    assert res["success"] is True
    assert res["result"]["status"] == "needs_repair"

    res = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert res["result"]["status"] == "needs_repair"


@pytest.mark.asyncio
async def test_ws_item_create_defaults_status_and_rejects_bad_values() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer")
    assert res["success"] is True
    assert res["result"]["status"] == "ok"
    item_id = res["result"]["id"]

    res = await ws_send(hass, 2, "haventory/item/create", name="Drill", status="lost")
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    res = await ws_send(hass, 3, "haventory/item/update", item_id=item_id, status=None)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_ws_item_list_filters_by_status() -> None:
    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    await ws_send(hass, 2, "haventory/item/create", name="Wrench")

    res = await ws_send(hass, 3, "haventory/item/list", filter={"status": "missing"})
    assert res["success"] is True
    assert [i["name"] for i in res["result"]["items"]] == ["Hammer"]
    assert res["result"]["total"] == 1

    res = await ws_send(hass, 4, "haventory/item/list", filter={"status": "bogus"})
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_ws_bulk_item_update_sets_status() -> None:
    hass = _new_hass()
    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer")
    item_id = res["result"]["id"]

    res = await ws_send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_update",
                "payload": {"item_id": item_id, "status": "missing"},
            }
        ],
    )
    assert res["success"] is True
    outcome = res["result"]["results"]["a"]
    assert outcome["success"] is True
    assert outcome["result"]["status"] == "missing"


@pytest.mark.asyncio
async def test_ws_stats_and_health_reflect_status() -> None:
    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    await ws_send(hass, 2, "haventory/item/create", name="Drill", status="needs_repair")

    res = await ws_send(hass, 3, "haventory/stats")
    assert res["result"]["missing_count"] == 1
    assert res["result"]["needs_repair_count"] == 1

    res = await ws_send(hass, 4, "haventory/health")
    assert res["result"]["healthy"] is True
    assert res["result"]["issues"] == []
