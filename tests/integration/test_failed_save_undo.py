"""A write whose save fails leaves nothing behind, in memory or on disk.

Every save writes the whole repository, so a change left in memory after its save
failed would be written by the next save that succeeds.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import custom_components.haventory as package
import pytest
from custom_components.haventory import media, ops
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.models import AttachmentMeta, new_uuid4
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import STORAGE_KEY
from homeassistant.core import HomeAssistant

from repository_invariants import collect_index_issues, internal_indexes


@dataclass
class Seed:
    """The ids a row can name."""

    item_id: str
    other_item_id: str
    shelf_id: str
    garage_id: str
    attachment_id: str


def _seeded(area_ids: dict[str, str]) -> tuple[Repository, Seed]:
    """Two location trees in two areas, items in both, a custom status, an attachment.

    Enough state that each write family has something to rewrite: a subtree to
    move across areas, a status with items to reassign, tags, a category and a
    checked-out item to keep the index sets non-trivial.
    """

    repo = Repository()
    kitchen = repo.create_location(name="Kitchen", area_id=area_ids["Kitchen"])
    shelf = repo.create_location(name="Shelf", parent_id=str(kitchen.id))
    drawer = repo.create_location(name="Drawer", parent_id=str(shelf.id))
    garage = repo.create_location(name="Garage", area_id=area_ids["Garage"])
    repo.create_status({"slug": "broken", "label": "Broken"})
    item = repo.create_item(
        {
            "name": "Whisk",
            "location_id": str(drawer.id),
            "tags": ["metal"],
            "category": "Utensils",
            "quantity": 1,
            "low_stock_threshold": 2,
            "status": "broken",
        }
    )
    other = repo.create_item({"name": "Ladle", "location_id": str(shelf.id), "tags": ["metal"]})
    repo.check_out(other.id, due_date=None)
    repo.create_item({"name": "Rake", "location_id": str(garage.id), "status": "broken"})
    meta = AttachmentMeta(
        id=new_uuid4(),
        kind="manual",
        filename="manual.pdf",
        mime="application/pdf",
        size=9,
        uploaded_at="2026-01-01T00:00:00Z",
    )
    repo.add_attachment(item.id, meta)
    seed = Seed(
        item_id=str(item.id),
        other_item_id=str(other.id),
        shelf_id=str(shelf.id),
        garage_id=str(garage.id),
        attachment_id=str(meta.id),
    )
    return repo, seed


# (case id, surface, command or service, payload builder over the seeded ids)
WRITES: list[tuple[str, str, str, Callable[[Seed], dict[str, Any]]]] = [
    ("item_create", "ws", "haventory/item/create", lambda _s: {"name": "Fresh"}),
    (
        "item_update",
        "ws",
        "haventory/item/update",
        lambda s: {
            "item_id": s.item_id,
            "name": "Balloon whisk",
            "tags": ["steel"],
            "category": "Baking",
            "quantity": 9,
        },
    ),
    (
        "item_update_service",
        "service",
        "item_update",
        lambda s: {"item_id": s.item_id, "name": "Balloon whisk"},
    ),
    ("item_delete", "ws", "haventory/item/delete", lambda s: {"item_id": s.item_id}),
    ("item_check_in", "ws", "haventory/item/check_in", lambda s: {"item_id": s.other_item_id}),
    (
        "location_move_subtree",
        "ws",
        "haventory/location/move_subtree",
        lambda s: {"location_id": s.shelf_id, "new_parent_id": s.garage_id},
    ),
    (
        "location_rename",
        "ws",
        "haventory/location/update",
        lambda s: {"location_id": s.shelf_id, "name": "Rack"},
    ),
    (
        "status_delete_reassign",
        "ws",
        "haventory/status/delete",
        lambda _s: {"slug": "broken", "reassign_to": "ok"},
    ),
    (
        "attachment_remove",
        "ws",
        "haventory/item/attachment/remove",
        lambda s: {"item_id": s.item_id, "attachment_id": s.attachment_id},
    ),
    (
        "attachment_update",
        "ws",
        "haventory/item/attachment/update",
        lambda s: {"item_id": s.item_id, "attachment_id": s.attachment_id, "title": "Manual"},
    ),
    (
        "items_bulk",
        "ws",
        "haventory/items/bulk",
        lambda s: {
            "operations": [
                {
                    "op_id": "a",
                    "kind": "item_set_quantity",
                    "payload": {"item_id": s.item_id, "quantity": 7},
                },
                {"op_id": "b", "kind": "item_delete", "payload": {"item_id": s.other_item_id}},
                {
                    "op_id": "c",
                    "kind": "item_add_tags",
                    "payload": {"item_id": s.item_id, "tags": ["new"]},
                },
            ]
        },
    ),
    (
        "reminder_set",
        "ws",
        "haventory/reminder/set",
        lambda s: {
            "item_id": s.item_id,
            "reminder_date": "2027-01-15",
            "reminder_interval": {"unit": "months", "count": 1},
        },
    ),
]


@pytest.fixture
async def seeded(hass: HomeAssistant, setup_entry, add_areas):
    """The entry over the seeded store, with the attachment's file on disk."""

    repo, seed = _seeded(add_areas("Kitchen", "Garage"))
    path = media.attachment_path(
        media.media_root(hass), seed.item_id, seed.attachment_id, "application/pdf"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4\n")
    return await setup_entry(stored=repo), seed, path


@pytest.mark.parametrize(
    ("surface", "command", "build"), [w[1:] for w in WRITES], ids=[w[0] for w in WRITES]
)
async def test_failed_save_leaves_memory_and_the_next_save_as_before(  # noqa: PLR0913, PLR0917 - one fixture per surface and check
    seeded,
    hass_storage: dict[str, Any],
    ws_connect,
    call_service,
    fail_next_save,
    surface: str,
    command: str,
    build: Callable[[Seed], dict[str, Any]],
) -> None:
    entry, seed, file = seeded
    repo = entry.runtime_data.repository
    ws = await ws_connect()
    state_before = repo.export_state()
    indexes_before = copy.deepcopy(dict(internal_indexes(repo)))

    fail_next_save()
    if surface == "ws":
        res = await ws.send(command, **build(seed))
        assert res["success"] is False
        assert res["error"]["code"] == "storage_error"
    else:
        with pytest.raises(StorageError):
            await call_service(command, **build(seed))

    assert repo.export_state() == state_before
    assert copy.deepcopy(dict(internal_indexes(repo))) == indexes_before
    assert collect_index_issues(repo) == []
    assert file.exists()

    witness = await ws.send("haventory/item/create", name="Witness")
    assert witness["success"] is True
    saved = dict(hass_storage[STORAGE_KEY]["data"])
    saved.pop("schema_version")
    saved["items"] = {k: v for k, v in saved["items"].items() if k != witness["result"]["id"]}
    assert saved == state_before


async def test_a_write_queued_behind_a_failing_save_survives_it(
    seeded,
    hass_storage: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    ws_connect,
    fail_next_save,
) -> None:
    """The second write waits for the first to settle, and only the first is undone."""

    entry, seed, _ = seeded
    repo = entry.runtime_data.repository
    quantity_before = repo.get_item(seed.item_id).quantity
    ws1, ws2 = await ws_connect(), await ws_connect()

    # `commit` runs up to `async with runtime.write_lock` without yielding, so once
    # this fires the second command is waiting on the lock.
    started, release, queued = asyncio.Event(), asyncio.Event(), asyncio.Event()
    real_commit = ops.commit

    async def _commit(*args: Any, **kwargs: Any) -> Any:
        if started.is_set():
            queued.set()
        return await real_commit(*args, **kwargs)

    monkeypatch.setattr(ops, "commit", _commit)
    fail_next_save(started=started, until=release)

    first = asyncio.create_task(
        ws1.send("haventory/item/set_quantity", item_id=seed.item_id, quantity=40)
    )
    await asyncio.wait_for(started.wait(), 5)
    second = asyncio.create_task(ws2.send("haventory/item/create", name="Queued"))
    await asyncio.wait_for(queued.wait(), 5)
    assert [i.name for i in repo.list_items()["items"] if i.name == "Queued"] == []

    release.set()
    first_res, second_res = await asyncio.wait_for(asyncio.gather(first, second), 5)

    assert first_res["error"]["code"] == "storage_error"
    assert second_res["success"] is True
    queued_id = second_res["result"]["id"]
    assert repo.get_item(seed.item_id).quantity == quantity_before
    assert repo.get_item(queued_id).name == "Queued"
    assert collect_index_issues(repo) == []
    saved = hass_storage[STORAGE_KEY]["data"]["items"]
    assert saved[seed.item_id]["quantity"] == quantity_before
    assert saved[queued_id]["name"] == "Queued"


async def test_a_teardown_flush_waits_for_a_write_in_flight(  # noqa: PLR0913, PLR0917 - one fixture per step
    hass: HomeAssistant,
    seeded,
    hass_storage: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    ws_connect,
    fail_next_save,
) -> None:
    """A flush landing between a write's change and its failed save must not save it."""

    entry, seed, _ = seeded
    quantity_before = entry.runtime_data.repository.get_item(seed.item_id).quantity
    ws = await ws_connect()

    # The flush takes the write lock as its first step, so once this fires it is
    # waiting behind the write.
    flushing = asyncio.Event()
    real_persist: Callable[[HomeAssistant], Awaitable[None]] = package.async_persist_immediate

    async def _persist(hass_: HomeAssistant) -> None:
        flushing.set()
        await real_persist(hass_)

    monkeypatch.setattr(package, "async_persist_immediate", _persist)
    started, release = asyncio.Event(), asyncio.Event()
    fail_next_save(started=started, until=release)

    write = asyncio.create_task(
        ws.send("haventory/item/set_quantity", item_id=seed.item_id, quantity=40)
    )
    await asyncio.wait_for(started.wait(), 5)
    unload = asyncio.create_task(hass.config_entries.async_unload(entry.entry_id))
    await asyncio.wait_for(flushing.wait(), 5)

    release.set()
    res = await asyncio.wait_for(write, 5)
    assert await asyncio.wait_for(unload, 5)

    assert res["error"]["code"] == "storage_error"
    assert hass_storage[STORAGE_KEY]["data"]["items"][seed.item_id]["quantity"] == quantity_before
