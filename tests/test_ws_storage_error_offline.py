"""Offline tests: a save failure maps to storage_error and lets no event escape.

Every mutation handler persists before it broadcasts, so a broadcast is a promise
that the write behind it succeeded. These tests hold both halves of that:

- a failing persist returns ``storage_error`` to the caller and delivers nothing
  to subscribers, across every mutation shape the API exposes;
- a *succeeding* persist delivers the event only once the store write resolved,
  not merely at some point after the mutation was applied.

The mutation does remain applied in memory when the write fails — the handlers do
not roll back (``import/execute`` does, because a wholesale dataset swap has more
to undo than one entity does). That divergence is documented at the bottom of this
file: it survives only until restart, and no client is told about it.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

import pytest
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant

from runtime_helpers import runtime_of, ws_hass
from ws_helpers import RecordingConn, ws_send


def _make_hass() -> tuple[HomeAssistant, Repository, DomainStore]:
    repo = Repository()
    hass = ws_hass(repository=repo)
    return hass, repo, runtime_of(hass).store


def _fail_next_save(monkeypatch: pytest.MonkeyPatch, store: DomainStore) -> None:
    async def _raise(*_args, **_kwargs):
        raise StorageError("disk full")

    monkeypatch.setattr(store, "async_save", _raise)


@pytest.mark.asyncio
async def test_ws_maps_storage_error_and_logs(caplog, monkeypatch) -> None:
    """WS should return storage_error when persist fails and log at ERROR level."""

    hass, _repo, store = _make_hass()
    _fail_next_save(monkeypatch, store)

    caplog.set_level(logging.ERROR, logger="custom_components.haventory.ws")

    res = await ws_send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    # Exactly one ERROR boundary log for this op
    logs = [r for r in caplog.records if r.name == "custom_components.haventory.ws"]
    assert len(logs) == 1 and logs[0].levelno == logging.ERROR
    assert getattr(logs[0], "op", None) == "item_create"


# -----------------------------------------------------------------------------
# A failing persist lets nothing onto the wire — every mutation shape
# -----------------------------------------------------------------------------


# One entry per distinct mutation shape in ws.py: everything that persists.
# (command, payload builder over the seeded ids)
MUTATIONS: list[tuple[str, str, Callable[[str, str], dict[str, Any]]]] = [
    ("item_create", "haventory/item/create", lambda _i, _l: {"name": "Fresh"}),
    ("item_update", "haventory/item/update", lambda i, _l: {"item_id": i, "quantity": 5}),
    ("item_delete", "haventory/item/delete", lambda i, _l: {"item_id": i}),
    (
        "item_adjust_quantity",
        "haventory/item/adjust_quantity",
        lambda i, _l: {"item_id": i, "delta": 1},
    ),
    (
        "item_set_quantity",
        "haventory/item/set_quantity",
        lambda i, _l: {"item_id": i, "quantity": 7},
    ),
    ("item_check_out", "haventory/item/check_out", lambda i, _l: {"item_id": i}),
    ("item_check_in", "haventory/item/check_in", lambda i, _l: {"item_id": i}),
    ("item_add_tags", "haventory/item/add_tags", lambda i, _l: {"item_id": i, "tags": ["new"]}),
    (
        "item_remove_tags",
        "haventory/item/remove_tags",
        lambda i, _l: {"item_id": i, "tags": ["seed"]},
    ),
    (
        "item_update_custom_fields",
        "haventory/item/update_custom_fields",
        lambda i, _l: {"item_id": i, "set": {"k": "v"}},
    ),
    (
        "item_set_low_stock_threshold",
        "haventory/item/set_low_stock_threshold",
        lambda i, _l: {"item_id": i, "low_stock_threshold": 2},
    ),
    ("item_move", "haventory/item/move", lambda i, loc: {"item_id": i, "location_id": loc}),
    (
        "items_bulk",
        "haventory/items/bulk",
        lambda i, _l: {
            "operations": [
                {
                    "op_id": "a",
                    "kind": "item_adjust_quantity",
                    "payload": {"item_id": i, "delta": 1},
                }
            ]
        },
    ),
    ("location_create", "haventory/location/create", lambda _i, _l: {"name": "Shed"}),
    (
        "location_rename",
        "haventory/location/update",
        lambda _i, loc: {"location_id": loc, "name": "Renamed"},
    ),
    (
        "location_reparent",
        "haventory/location/update",
        lambda _i, loc: {"location_id": loc, "new_parent_id": None},
    ),
    ("location_delete", "haventory/location/delete", lambda _i, loc: {"location_id": loc}),
    (
        "location_move_subtree",
        "haventory/location/move_subtree",
        lambda _i, loc: {"location_id": loc, "new_parent_id": None},
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("shape", "command", "build"), MUTATIONS, ids=[m[0] for m in MUTATIONS])
async def test_failed_persist_delivers_no_event(
    shape: str,
    command: str,
    build: Callable[[str, str], dict[str, Any]],
    monkeypatch,
    caplog,
) -> None:
    """No mutation shape may broadcast a change whose write failed.

    The caller still learns the truth (``storage_error``); the subscribers learn
    nothing at all, which is the correct thing to tell them about a change that
    did not reach disk.
    """

    hass, repo, store = _make_hass()

    # Seed a target for the mutations that need one. The location is a child so
    # the reparent/move shapes have somewhere to move *from*.
    parent = repo.create_location(name="House")
    child = repo.create_location(name="Garage", parent_id=str(parent.id))
    item = repo.create_item({"name": "Seeded", "quantity": 3, "tags": ["seed"]})

    conn = RecordingConn()
    for sub_id, topic in ((901, "items"), (902, "locations"), (903, "stats")):
        res = await ws_send(hass, sub_id, "haventory/subscribe", conn=conn, topic=topic)
        assert res["success"] is True
    conn.messages.clear()

    _fail_next_save(monkeypatch, store)
    caplog.set_level(logging.ERROR)

    res = await ws_send(hass, 1, command, conn=conn, **build(str(item.id), str(child.id)))

    assert res["success"] is False, f"{shape} should have failed"
    assert res["error"]["code"] == "storage_error"
    assert conn.events() == [], f"{shape} leaked an event for a write that failed"


@pytest.mark.asyncio
async def test_failed_persist_in_bulk_discards_the_whole_batch(monkeypatch, caplog) -> None:
    """A bulk whose write fails reports storage_error, not per-op successes.

    Every op in the batch shares one write, so a caller that received per-op
    ``success: true`` alongside a failed save could not tell which half to trust.
    """

    hass, repo, store = _make_hass()
    first = repo.create_item({"name": "One", "quantity": 1})
    second = repo.create_item({"name": "Two", "quantity": 1})

    conn = RecordingConn()
    await ws_send(hass, 901, "haventory/subscribe", conn=conn, topic="items")
    conn.messages.clear()

    _fail_next_save(monkeypatch, store)
    caplog.set_level(logging.ERROR)

    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        conn=conn,
        operations=[
            {
                "op_id": "a",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": str(first.id), "delta": 1},
            },
            {
                "op_id": "b",
                "kind": "item_set_quantity",
                "payload": {"item_id": str(second.id), "quantity": 9},
            },
        ],
    )

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert conn.events() == []


# -----------------------------------------------------------------------------
# A succeeding persist broadcasts only once the write has resolved
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_event_reaches_subscriber_only_after_the_write_resolves(monkeypatch) -> None:
    """Assert the ordering directly, not just the absence of a broadcast.

    A store write that is *in flight* — entered but not yet resolved — must not
    have produced an event yet. Without this, a handler that broadcast before
    awaiting would still pass every failure test above whenever the write happens
    to succeed.
    """

    hass, _repo, store = _make_hass()

    conn = RecordingConn()
    await ws_send(hass, 901, "haventory/subscribe", conn=conn, topic="items")
    conn.messages.clear()

    write_entered = asyncio.Event()
    finish_write = asyncio.Event()
    events_seen_during_write: list[dict[str, Any]] = []

    async def _slow_save(*_args, **_kwargs):
        events_seen_during_write.extend(conn.events())
        write_entered.set()
        await finish_write.wait()

    monkeypatch.setattr(store, "async_save", _slow_save)

    task = asyncio.create_task(ws_send(hass, 1, "haventory/item/create", conn=conn, name="Anvil"))
    await asyncio.wait_for(write_entered.wait(), timeout=5)

    # The write is open. Nothing may have reached the subscriber yet.
    assert events_seen_during_write == []
    assert conn.events() == []

    finish_write.set()
    res = await asyncio.wait_for(task, timeout=5)

    assert res["success"] is True
    actions = [ev.get("action") for ev in conn.events()]
    assert actions == ["created"], "the created event must arrive once, after the write"


# -----------------------------------------------------------------------------
# What a failed persist still leaves behind: in-memory divergence, told to nobody
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_failed_create_stays_in_memory_until_restart(monkeypatch, caplog) -> None:
    """The handlers do not roll back: the item lives in memory but not on disk.

    Nothing on the wire claims otherwise — the caller was told ``storage_error``
    and no subscriber was told anything — so the divergence is invisible to
    clients and ends at the next restart.
    """

    hass, repo, store = _make_hass()
    _fail_next_save(monkeypatch, store)
    caplog.set_level(logging.ERROR)

    res = await ws_send(hass, 1, "haventory/item/create", name="Fragile Item")

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    items = repo.list_items()["items"]
    assert len(items) == 1
    assert items[0].name == "Fragile Item"

    # Restart reads what reached disk, which is nothing.
    fresh_repo = Repository.from_state({"items": {}, "locations": {}})
    assert fresh_repo.list_items()["items"] == []


@pytest.mark.asyncio
async def test_failed_delete_stays_removed_in_memory_until_restart(monkeypatch, caplog) -> None:
    """The inverse divergence: the item is gone from memory and still on disk."""

    hass, repo, store = _make_hass()
    item = repo.create_item({"name": "To Delete"})

    _fail_next_save(monkeypatch, store)
    caplog.set_level(logging.ERROR)

    res = await ws_send(hass, 1, "haventory/item/delete", item_id=str(item.id))

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert repo.list_items()["items"] == []


@pytest.mark.asyncio
async def test_failed_update_keeps_the_new_value_in_memory(monkeypatch, caplog) -> None:
    """A partial update is applied in memory even when the write fails."""

    hass, repo, store = _make_hass()
    INITIAL_QTY = 10
    NEW_QTY = 25
    item = repo.create_item({"name": "Quantity Test", "quantity": INITIAL_QTY})

    _fail_next_save(monkeypatch, store)
    caplog.set_level(logging.ERROR)

    res = await ws_send(
        hass,
        1,
        "haventory/item/update",
        item_id=str(item.id),
        quantity=NEW_QTY,
    )

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert repo.get_item(item.id).quantity == NEW_QTY
