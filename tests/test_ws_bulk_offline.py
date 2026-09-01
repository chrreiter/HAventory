"""Offline tests for the `haventory/items/bulk` command.

A batch is one write, whatever it holds: the rows are applied in memory, the
store is saved once, and a row that fails takes only itself down.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import media as media_mod
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.models import AttachmentMeta, iso_utc_now, new_uuid4
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant

from runtime_helpers import runtime_of, ws_hass
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_bulk_mixed_results_and_single_persist(monkeypatch) -> None:
    """Bulk should return per-op results and persist once if any success."""

    hass = ws_hass()
    store = runtime_of(hass).store

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    created = await ws_send(hass, 1, "haventory/item/create", name="Hammer", quantity=1)
    item_id = created["result"]["id"]

    ops = [
        {
            "op_id": "ok1",
            "kind": "item_adjust_quantity",
            "payload": {"item_id": item_id, "delta": 2},
        },
        {
            "op_id": "bad1",
            "kind": "item_set_quantity",
            "payload": {"item_id": item_id, "quantity": -1},
        },
        {
            "op_id": "ok2",
            "kind": "item_update_custom_fields",
            "payload": {"item_id": item_id, "set": {"color": "red"}},
        },
        {"op_id": "bad2", "kind": "unknown", "payload": {}},
    ]

    res = await ws_send(hass, 2, "haventory/items/bulk", operations=ops)
    assert res["success"] is True
    results = res["result"]["results"]
    assert results["ok1"]["success"] is True and results["ok2"]["success"] is True
    assert results["bad1"]["success"] is False and results["bad2"]["success"] is False

    assert calls["count"] >= 1


@pytest.mark.asyncio
async def test_bulk_empty_and_invalid_operations_and_duplicate_ids(monkeypatch) -> None:
    """Bulk: empty returns empty results; invalid type rejected; dup op_id rejects."""

    hass = ws_hass()
    store = runtime_of(hass).store

    calls = {"count": 0}

    async def _spy_save(_payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    res = await ws_send(hass, 1, "haventory/items/bulk", operations=[])
    assert res["success"] is True and res["result"]["results"] == {}
    assert calls["count"] == 0  # nothing to persist

    # Invalid operations type: the command declares `operations` as `object`, so
    # the frame reaches the handler and is answered through the guard.
    res = await ws_send(hass, 2, "haventory/items/bulk", operations="oops")
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # The shape of each entry is the handler's to check too.
    res = await ws_send(hass, 3, "haventory/items/bulk", operations=["oops"])
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Duplicate op_id: the batch is refused whole, because results are keyed by
    # op_id and a repeat would leave the caller one verdict for two operations.
    created = await ws_send(hass, 4, "haventory/item/create", name="X", quantity=1)
    iid = created["result"]["id"]
    START_QTY = 1
    ops = [
        {
            "op_id": "dup",
            "kind": "item_set_quantity",
            "payload": {"item_id": iid, "quantity": 2},
        },
        {
            "op_id": "dup",
            "kind": "item_set_quantity",
            "payload": {"item_id": iid, "quantity": 3},
        },
    ]
    res = await ws_send(hass, 5, "haventory/items/bulk", operations=ops)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "dup" in res["error"]["message"]
    # Nothing ran: the quantity is still what item/create left it at.
    got = await ws_send(hass, 6, "haventory/item/get", item_id=iid)
    assert got["result"]["quantity"] == START_QTY

    # `1` and `"1"` are one id, not two — the result map normalizes with str().
    ops_mixed = [
        {"op_id": 1, "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 2}},
        {"op_id": "1", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 3}},
    ]
    res = await ws_send(hass, 7, "haventory/items/bulk", operations=ops_mixed)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Distinct ids still return one result each.
    ops_ok = [
        {"op_id": "a", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 2}},
        {"op_id": "b", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 3}},
    ]
    res = await ws_send(hass, 8, "haventory/items/bulk", operations=ops_ok)
    assert res["success"] is True
    assert set(res["result"]["results"]) == {"a", "b"}


# -----------------------------
# The files of the rows that were deleted
#
# One rule for every surface that deletes an item: once the write has landed,
# the files of each removed item are unlinked. The ordering is the point — a
# file deleted ahead of a save that then fails leaves stored metadata naming
# nothing, while a file left behind by a failed unlink is swept at setup.
# -----------------------------


def _meta() -> AttachmentMeta:
    return AttachmentMeta(
        id=new_uuid4(),
        kind="picture",
        filename="photo.png",
        mime="image/png",
        size=16,
        uploaded_at=iso_utc_now(),
    )


def _hass_with_store() -> tuple[HomeAssistant, Repository, DomainStore]:
    repo = Repository()
    hass = ws_hass(repository=repo)
    store = runtime_of(hass).store
    return hass, repo, store


def _record_save_and_unlink(
    monkeypatch, store: DomainStore
) -> tuple[list[str], list[tuple[str, str]]]:
    """Spy the write and the unlink into one ordered list, plus the pairs."""

    order: list[str] = []
    unlinked: list[tuple[str, str]] = []

    async def _spy_save(_payload):  # type: ignore[no-untyped-def]
        order.append("save")

    async def _spy_delete(_hass, pairs):  # type: ignore[no-untyped-def]
        order.append("unlink")
        unlinked.extend((item_id, str(meta.id)) for item_id, meta in pairs)

    monkeypatch.setattr(store, "async_save", _spy_save)
    monkeypatch.setattr(media_mod, "async_delete_attachments", _spy_delete)
    return order, unlinked


@pytest.mark.asyncio
async def test_bulk_delete_frees_the_files_after_the_batch_write(monkeypatch) -> None:
    """A bulk delete unlinks the item's files, and not before the save."""

    hass, repo, store = _hass_with_store()
    item = repo.create_item({"name": "Drill"})
    meta = _meta()
    repo.add_attachment(item.id, meta)
    order, unlinked = _record_save_and_unlink(monkeypatch, store)

    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[{"op_id": "d", "kind": "item_delete", "payload": {"item_id": str(item.id)}}],
    )

    assert res["success"] is True
    assert res["result"]["results"]["d"]["success"] is True
    assert order == ["save", "unlink"]
    assert unlinked == [(str(item.id), str(meta.id))]


@pytest.mark.asyncio
async def test_bulk_delete_frees_nothing_when_the_write_fails(monkeypatch) -> None:
    """A batch answered `storage_error` still has its files on disk."""

    hass, repo, store = _hass_with_store()
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(item.id, _meta())
    _order, unlinked = _record_save_and_unlink(monkeypatch, store)

    async def _raise(_payload):  # type: ignore[no-untyped-def]
        raise StorageError("disk full")

    monkeypatch.setattr(store, "async_save", _raise)

    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[{"op_id": "d", "kind": "item_delete", "payload": {"item_id": str(item.id)}}],
    )

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert unlinked == []


@pytest.mark.asyncio
async def test_bulk_frees_the_files_of_the_deleted_row_only(monkeypatch) -> None:
    """A row refused on a stale version keeps every file it had."""

    hass, repo, store = _hass_with_store()
    gone = repo.create_item({"name": "Drill"})
    gone_meta = _meta()
    repo.add_attachment(gone.id, gone_meta)
    kept = repo.create_item({"name": "Saw"})
    kept_meta = _meta()
    repo.add_attachment(kept.id, kept_meta)
    order, unlinked = _record_save_and_unlink(monkeypatch, store)

    STALE_VERSION = 99
    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[
            {"op_id": "gone", "kind": "item_delete", "payload": {"item_id": str(gone.id)}},
            {
                "op_id": "stale",
                "kind": "item_delete",
                "payload": {"item_id": str(kept.id), "expected_version": STALE_VERSION},
            },
        ],
    )

    results = res["result"]["results"]
    assert results["gone"]["success"] is True
    assert results["stale"]["success"] is False
    assert results["stale"]["error"]["code"] == "conflict"
    assert order == ["save", "unlink"]
    assert unlinked == [(str(gone.id), str(gone_meta.id))]
    assert [str(a.id) for a in repo.get_item(kept.id).attachments] == [str(kept_meta.id)]


@pytest.mark.asyncio
async def test_a_row_whose_tags_are_a_string_fails_only_itself() -> None:
    """Bulk payloads carry no schema, so the model's tag rule is the only guard.

    `tags: "kitchen"` iterates as its characters on both the whole-list write
    and the two tag ops, so each row is refused and the item keeps the tags it
    had while the rest of the batch runs.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Chisel", tags=["tools"])
    item_id = created["result"]["id"]

    NEW_QTY = 4
    ops = [
        {
            "op_id": "update",
            "kind": "item_update",
            "payload": {"item_id": item_id, "tags": "kitchen"},
        },
        {
            "op_id": "add",
            "kind": "item_add_tags",
            "payload": {"item_id": item_id, "tags": "kitchen"},
        },
        {
            "op_id": "remove",
            "kind": "item_remove_tags",
            "payload": {"item_id": item_id, "tags": "tools"},
        },
        {
            "op_id": "ok",
            "kind": "item_set_quantity",
            "payload": {"item_id": item_id, "quantity": NEW_QTY},
        },
    ]

    res = await ws_send(hass, 2, "haventory/items/bulk", operations=ops)

    assert res["success"] is True
    results = res["result"]["results"]
    for op_id in ("update", "add", "remove"):
        assert results[op_id]["success"] is False
        assert results[op_id]["error"]["code"] == "validation_error"
        assert results[op_id]["error"]["message"] == "tags must be a list of strings"
    assert results["ok"]["success"] is True

    got = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert got["result"]["tags"] == ["tools"]
    assert got["result"]["quantity"] == NEW_QTY
