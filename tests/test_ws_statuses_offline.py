"""Offline tests for the status-definition WebSocket commands.

Statuses are the one vocabulary items *reference*, so `status/delete` is the
only command here that can orphan data. These tests pin its refusal, the
reassign escape hatch, and the two topics a reassignment has to reach: cards
showing the vocabulary, and cards showing the items that just moved.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DEFAULT_STATUS_COLOR, DEFAULT_STATUS_ICON, DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


def _new_hass() -> HomeAssistant:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    for h in hass.data.get("__ws_commands__", []):
        if not callable(h) or getattr(h, "_ws_command", None) != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        return await h(hass, None, req)
    raise AssertionError("No handler responded for type " + type_)


def _record_broadcasts(monkeypatch) -> list[tuple[str, str]]:
    """Capture (topic, action) pairs instead of delivering them."""

    seen: list[tuple[str, str]] = []

    def fake(hass, *, topic, action, payload=None):
        seen.append((topic, action))

    monkeypatch.setattr(ws_mod, "_broadcast_event", fake)
    return seen


# -----------------------------
# Reading
# -----------------------------


@pytest.mark.asyncio
async def test_list_returns_the_vocabulary_in_display_order() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/list")

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

    res = await _send(
        hass, 1, "haventory/status/create", slug="lent_out", label="Lent out", color="blue"
    )

    assert res["success"] is True
    assert res["result"]["slug"] == "lent_out"
    assert res["result"]["color"] == "blue"
    assert res["result"]["icon"] == DEFAULT_STATUS_ICON
    assert ("statuses", "created") in seen


@pytest.mark.asyncio
async def test_create_defaults_the_appearance_when_none_is_given() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/create", slug="lent_out", label="Lent out")

    assert res["result"]["color"] == DEFAULT_STATUS_COLOR


@pytest.mark.asyncio
async def test_create_refuses_a_duplicate_slug() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/create", slug="missing", label="Gone")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_refuses_a_colour_outside_the_palette() -> None:
    """The card can only paint the tokens it has rules for."""

    hass = _new_hass()

    res = await _send(
        hass, 1, "haventory/status/create", slug="lent_out", label="Lent out", color="puce"
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_update_renames_without_touching_items(monkeypatch) -> None:
    hass = _new_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Saw", status="needs_repair")
    before = created["result"]["version"]
    seen = _record_broadcasts(monkeypatch)

    res = await _send(hass, 2, "haventory/status/update", slug="needs_repair", label="Broken")

    assert res["success"] is True
    assert res["result"]["label"] == "Broken"
    assert ("statuses", "updated") in seen
    assert ("items", "updated") not in seen
    still = await _send(hass, 3, "haventory/item/get", item_id=created["result"]["id"])
    assert still["result"]["version"] == before


@pytest.mark.asyncio
async def test_update_of_an_unknown_slug_is_not_found() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/update", slug="lent_out", label="Lent out")

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_reorder_rewrites_display_order(monkeypatch) -> None:
    hass = _new_hass()
    seen = _record_broadcasts(monkeypatch)

    res = await _send(hass, 1, "haventory/status/reorder", slugs=["needs_repair", "ok", "missing"])

    assert res["success"] is True
    assert [d["slug"] for d in res["result"]] == ["needs_repair", "ok", "missing"]
    assert ("statuses", "reordered") in seen


@pytest.mark.asyncio
async def test_reorder_refuses_a_partial_list() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/reorder", slugs=["ok", "missing"])

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# Deleting
# -----------------------------


@pytest.mark.asyncio
async def test_delete_refuses_the_default_status() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/status/delete", slug="ok")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_delete_removes_an_unused_status(monkeypatch) -> None:
    hass = _new_hass()
    seen = _record_broadcasts(monkeypatch)

    res = await _send(hass, 1, "haventory/status/delete", slug="needs_repair")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 0
    assert ("statuses", "deleted") in seen
    listed = await _send(hass, 2, "haventory/status/list")
    assert [d["slug"] for d in listed["result"]] == ["ok", "missing"]


@pytest.mark.asyncio
async def test_delete_refuses_a_status_in_use_without_a_target() -> None:
    """An item whose status names nothing would be silently coerced on reload."""

    hass = _new_hass()
    await _send(hass, 1, "haventory/item/create", name="Ladder", status="missing")

    res = await _send(hass, 2, "haventory/status/delete", slug="missing")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    listed = await _send(hass, 3, "haventory/status/list")
    assert "missing" in [d["slug"] for d in listed["result"]]


@pytest.mark.asyncio
async def test_delete_with_a_target_moves_the_items_and_broadcasts_both(monkeypatch) -> None:
    hass = _new_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Ladder", status="missing")
    item_id = created["result"]["id"]
    seen = _record_broadcasts(monkeypatch)

    res = await _send(hass, 2, "haventory/status/delete", slug="missing", reassign_to="ok")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 1
    # Both, and for different readers: one card is showing the vocabulary, the
    # other is showing the items that just changed underneath it.
    assert ("statuses", "deleted") in seen
    assert ("items", "updated") in seen
    moved = await _send(hass, 3, "haventory/item/get", item_id=item_id)
    assert moved["result"]["status"] == "ok"
    assert moved["result"]["version"] == created["result"]["version"] + 1


@pytest.mark.asyncio
async def test_delete_refuses_an_unknown_reassign_target() -> None:
    hass = _new_hass()
    await _send(hass, 1, "haventory/item/create", name="Ladder", status="missing")

    res = await _send(hass, 2, "haventory/status/delete", slug="missing", reassign_to="nowhere")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# Subscribing
# -----------------------------


@pytest.mark.asyncio
async def test_statuses_is_a_subscribable_topic() -> None:
    """Without it, a card cannot learn a status was renamed while it was open."""

    hass = _new_hass()

    res = await _send(hass, 1, "haventory/subscribe", topic="statuses")

    assert res["success"] is True


@pytest.mark.asyncio
async def test_an_unknown_topic_is_still_refused() -> None:
    hass = _new_hass()

    res = await _send(hass, 1, "haventory/subscribe", topic="nonsense")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
