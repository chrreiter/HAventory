"""Offline tests: a write whose save fails leaves nothing behind, in memory or on disk.

Every save writes the whole repository, so a change left in memory after its
save failed would be written by the next save that succeeds. Each test here
therefore asserts on two things: the repository after the failure, and the
payload the store received from the next, unrelated write.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.models import AttachmentMeta, new_uuid4
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import async_persist_immediate
from homeassistant.core import HomeAssistant

from repository_invariants import collect_index_issues, internal_indexes
from runtime_helpers import runtime_of, ws_hass
from ws_helpers import ws_send


@dataclass
class RecordingStore:
    """Stands in for `DomainStore.async_save`: keeps each payload, fails on request."""

    payloads: list[dict[str, Any]] = field(default_factory=list)
    failures: int = 0
    # Set while a save is in flight; the save waits for `release` before settling.
    entered: asyncio.Event | None = None
    release: asyncio.Event | None = None

    async def async_save(self, data: dict[str, Any]) -> None:
        if self.entered is not None and self.release is not None:
            self.entered.set()
            await self.release.wait()
        if self.failures:
            self.failures -= 1
            raise StorageError("disk full")
        self.payloads.append(copy.deepcopy(data))


@dataclass
class Seed:
    """The ids a payload builder can name; see `_seeded` for what each one is."""

    item_id: str
    other_item_id: str
    shelf_id: str
    garage_id: str
    attachment_id: str


def _seeded(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[HomeAssistant, Repository, RecordingStore, Seed]:
    """Two location trees in two areas, items in both, a custom status, an attachment.

    Enough state that each write family has something to rewrite: a subtree to
    move across areas, a status with items to reassign, tags, a category and a
    checked-out item to keep the index sets non-trivial.
    """

    repo = Repository()
    hass = ws_hass(repository=repo)
    recorder = RecordingStore()
    monkeypatch.setattr(runtime_of(hass).store, "async_save", recorder.async_save)

    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    shelf = repo.create_location(name="Shelf", parent_id=str(kitchen.id))
    drawer = repo.create_location(name="Drawer", parent_id=str(shelf.id))
    garage = repo.create_location(name="Garage", area_id="garage")
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
        kind="document",
        filename="manual.pdf",
        mime="application/pdf",
        size=10,
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
    return hass, repo, recorder, seed


def _indexes(repo: Repository) -> dict[str, Any]:
    return copy.deepcopy(dict(internal_indexes(repo)))


def _without(payload: dict[str, Any], item_id: str) -> dict[str, Any]:
    return {**payload, "items": {k: v for k, v in payload["items"].items() if k != item_id}}


# (case id, command, payload builder over the seeded ids)
WRITES: list[tuple[str, str, Callable[[Seed], dict[str, Any]]]] = [
    ("item_create", "haventory/item/create", lambda _s: {"name": "Fresh"}),
    (
        "item_update",
        "haventory/item/update",
        lambda s: {
            "item_id": s.item_id,
            "name": "Balloon whisk",
            "tags": ["steel"],
            "category": "Baking",
            "quantity": 9,
        },
    ),
    ("item_delete", "haventory/item/delete", lambda s: {"item_id": s.item_id}),
    ("item_check_in", "haventory/item/check_in", lambda s: {"item_id": s.other_item_id}),
    (
        "location_move_subtree",
        "haventory/location/move_subtree",
        lambda s: {"location_id": s.shelf_id, "new_parent_id": s.garage_id},
    ),
    (
        "location_rename",
        "haventory/location/update",
        lambda s: {"location_id": s.shelf_id, "name": "Rack"},
    ),
    (
        "status_delete_reassign",
        "haventory/status/delete",
        lambda _s: {"slug": "broken", "reassign_to": "ok"},
    ),
    (
        "attachment_remove",
        "haventory/item/attachment/remove",
        lambda s: {"item_id": s.item_id, "attachment_id": s.attachment_id},
    ),
    (
        "attachment_update",
        "haventory/item/attachment/update",
        lambda s: {"item_id": s.item_id, "attachment_id": s.attachment_id, "title": "Manual"},
    ),
    (
        "items_bulk",
        "haventory/items/bulk",
        lambda s: {
            "operations": [
                {
                    "op_id": "a",
                    "kind": "item_set_quantity",
                    "payload": {"item_id": s.item_id, "quantity": 7},
                },
                {
                    "op_id": "b",
                    "kind": "item_delete",
                    "payload": {"item_id": s.other_item_id},
                },
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
        "haventory/reminder/set",
        lambda s: {
            "item_id": s.item_id,
            "reminder_date": "2027-01-15",
            "reminder_interval": {"unit": "months", "count": 1},
        },
    ),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("command", "build"), [(c, b) for _, c, b in WRITES], ids=[i for i, _, _ in WRITES]
)
async def test_failed_save_leaves_memory_and_the_next_save_as_before(
    monkeypatch: pytest.MonkeyPatch,
    command: str,
    build: Callable[[Seed], dict[str, Any]],
) -> None:
    hass, repo, recorder, seed = _seeded(monkeypatch)
    state_before = repo.export_state()
    indexes_before = _indexes(repo)

    recorder.failures = 1
    res = await ws_send(hass, 1, command, **build(seed))

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert repo.export_state() == state_before
    assert _indexes(repo) == indexes_before
    assert collect_index_issues(repo) == []

    witness = await ws_send(hass, 2, "haventory/item/create", name="Witness")

    assert witness["success"] is True
    assert len(recorder.payloads) == 1
    assert _without(recorder.payloads[0], witness["result"]["id"]) == state_before


@pytest.mark.asyncio
async def test_a_write_queued_behind_a_failing_save_survives_it(monkeypatch) -> None:
    """The second write waits for the first to settle, and only the first is undone."""

    hass, repo, recorder, seed = _seeded(monkeypatch)
    quantity_before = repo.get_item(seed.item_id).quantity
    recorder.failures = 1
    recorder.entered = asyncio.Event()
    recorder.release = asyncio.Event()

    first = asyncio.create_task(
        ws_send(hass, 1, "haventory/item/set_quantity", item_id=seed.item_id, quantity=40)
    )
    await asyncio.wait_for(recorder.entered.wait(), timeout=5)
    second = asyncio.create_task(ws_send(hass, 2, "haventory/item/create", name="Queued"))
    # Let the second command run as far as it can while the first save is open.
    for _ in range(5):
        await asyncio.sleep(0)
    assert [i.name for i in repo.list_items()["items"] if i.name == "Queued"] == []

    recorder.release.set()
    first_res, second_res = await asyncio.wait_for(asyncio.gather(first, second), timeout=5)

    assert first_res["error"]["code"] == "storage_error"
    assert second_res["success"] is True
    queued_id = second_res["result"]["id"]
    assert repo.get_item(seed.item_id).quantity == quantity_before
    assert repo.get_item(queued_id).name == "Queued"
    assert collect_index_issues(repo) == []
    saved = recorder.payloads[-1]["items"]
    assert saved[seed.item_id]["quantity"] == quantity_before
    assert saved[queued_id]["name"] == "Queued"


@pytest.mark.asyncio
async def test_a_teardown_flush_waits_for_a_write_in_flight(monkeypatch) -> None:
    """A flush landing between a write's change and its failed save must not save it."""

    hass, repo, recorder, seed = _seeded(monkeypatch)
    quantity_before = repo.get_item(seed.item_id).quantity
    recorder.failures = 1
    recorder.entered = asyncio.Event()
    recorder.release = asyncio.Event()

    write = asyncio.create_task(
        ws_send(hass, 1, "haventory/item/set_quantity", item_id=seed.item_id, quantity=40)
    )
    await asyncio.wait_for(recorder.entered.wait(), timeout=5)
    flush = asyncio.create_task(async_persist_immediate(hass))
    for _ in range(5):
        await asyncio.sleep(0)
    recorder.release.set()
    res = await asyncio.wait_for(write, timeout=5)
    await asyncio.wait_for(flush, timeout=5)

    assert res["error"]["code"] == "storage_error"
    assert len(recorder.payloads) == 1
    assert recorder.payloads[0]["items"][seed.item_id]["quantity"] == quantity_before


def test_restore_puts_back_a_location_move_across_areas() -> None:
    """The deepest undo: paths, area buckets and the subtree index of a moved tree."""

    repo = Repository()
    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    shelf = repo.create_location(name="Shelf", parent_id=str(kitchen.id))
    drawer = repo.create_location(name="Drawer", parent_id=str(shelf.id))
    garage = repo.create_location(name="Garage", area_id="garage")
    repo.create_item({"name": "Whisk", "location_id": str(drawer.id)})
    state_before = repo.export_state()
    indexes_before = _indexes(repo)

    snapshot = repo.snapshot()
    repo.update_location(shelf.id, new_parent_id=str(garage.id), name="Rack")
    assert repo.export_state() != state_before
    repo.restore(snapshot)

    assert repo.export_state() == state_before
    assert _indexes(repo) == indexes_before
    assert collect_index_issues(repo) == []
    assert repo.effective_area_id(str(drawer.id)) == "kitchen"


def test_a_snapshot_is_not_reached_by_later_writes() -> None:
    """Index sets are edited in place, so the snapshot must hold copies of them."""

    repo = Repository()
    item = repo.create_item({"name": "Whisk", "tags": ["metal"]})
    snapshot = repo.snapshot()
    repo.update_item(item.id, {"tags": ["wood"], "category": "Utensils"})
    repo.create_item({"name": "Ladle", "tags": ["metal"]})
    repo.restore(snapshot)

    assert [i.name for i in repo.list_items()["items"]] == ["Whisk"]
    assert repo.get_item(item.id).tags == ("metal",)
    assert collect_index_issues(repo) == []
