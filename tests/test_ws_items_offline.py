"""Offline tests for haventory WebSocket item commands.

Scenarios:
- create/get/update/delete item with envelope success
- adjust/set quantity and check_out/check_in
- list items with pagination cursor passthrough
- error mapping for validation/not_found/conflict with contextual data
- optimistic concurrency: with and without expected_version
- tag normalization on the one command whose schema admits a null tag
- attachment add/remove: version bumps, refusals, and the file-deletion cascade

The attachment tests stand in for core's `file_upload` component, which the
offline harness does not carry. Everything past the upload handle is the real
code path: sniffing, the caps, the move onto disk, and the deletes.
"""

from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

import pytest
from custom_components.haventory import media as media_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


def _repo_of(hass: HomeAssistant) -> Repository:
    return hass.data[DOMAIN]["repository"]


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        if not callable(h) or getattr(h, "_ws_command", None) != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        resp = await h(hass, None, req)
        return resp
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_item_create_get_update_delete_success() -> None:
    """Create, get, update, delete an item via WS and assert envelopes."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Create
    res = await _send(hass, 1, "haventory/item/create", name="Hammer", quantity=2)
    assert res["id"] == 1 and res["type"] == "result" and res["success"] is True
    assert isinstance(res.get("result"), dict) and "id" in res["result"]
    item_id = res["result"]["id"]

    # Get
    res = await _send(hass, 2, "haventory/item/get", item_id=item_id)
    assert res["success"] is True and res["result"]["id"] == item_id

    # Update
    res = await _send(hass, 3, "haventory/item/update", item_id=item_id, name="Hammer Pro")
    assert res["success"] is True and res["result"]["name"] == "Hammer Pro"

    # Delete
    res = await _send(hass, 4, "haventory/item/delete", item_id=item_id)
    assert res["success"] is True and res["result"] is None


@pytest.mark.asyncio
async def test_item_update_normalizes_a_tag_list_carrying_a_null() -> None:
    """`item/update` is the one command that can carry a null tag to the model.

    Every other command taking tags declares `[str]`, which Home Assistant
    refuses a null against before dispatch. `item/update` types each field as
    `object` and leaves the shape to `apply_item_update`, so `normalize_tags`
    has to drop the null rather than store it — a stored `None` would break
    every tag index and filter that assumes strings.
    """

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Battery")
    item_id = created["result"]["id"]

    res = await _send(
        hass, 2, "haventory/item/update", item_id=item_id, tags=["Li-Ion", None, " spare "]
    )

    assert res["success"] is True
    assert res["result"]["tags"] == ["li-ion", "spare"]

    # The narrow schemas hold the line for the commands that declare `[str]`.
    refused = await _send(hass, 3, "haventory/item/add_tags", item_id=item_id, tags=["x", None])
    assert refused["success"] is False
    assert refused["error"]["code"] == "invalid_format"


@pytest.mark.asyncio
async def test_item_quantity_and_checkout_helpers() -> None:
    """Adjust/set quantity and check in/out via WS."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    initial_quantity = 1
    created = await _send(hass, 1, "haventory/item/create", name="Box", quantity=initial_quantity)
    item_id = created["result"]["id"]

    delta_quantity = 2
    expected_after_adjust = initial_quantity + delta_quantity
    res = await _send(
        hass, 2, "haventory/item/adjust_quantity", item_id=item_id, delta=delta_quantity
    )
    assert res["result"]["quantity"] == expected_after_adjust

    target_quantity = 5
    res = await _send(
        hass, 3, "haventory/item/set_quantity", item_id=item_id, quantity=target_quantity
    )
    assert res["result"]["quantity"] == target_quantity

    res = await _send(hass, 4, "haventory/item/check_out", item_id=item_id, due_date="2030-01-01")
    assert res["result"]["checked_out"] is True

    res = await _send(hass, 5, "haventory/item/check_in", item_id=item_id)
    assert res["result"]["checked_out"] is False


@pytest.mark.asyncio
async def test_item_check_out_due_date_is_optional() -> None:
    """Check out without a due date, and with an explicit null one.

    The WS schema declares ``due_date`` optional and nullable (unlike the
    ``haventory.item_check_out`` service, which requires it), so both forms
    check the item out and leave ``due_date`` unset.
    """

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]

    # Omitted entirely
    res = await _send(hass, 2, "haventory/item/check_out", item_id=item_id)
    assert res["success"] is True
    assert res["result"]["checked_out"] is True
    assert res["result"]["due_date"] is None

    await _send(hass, 3, "haventory/item/check_in", item_id=item_id)

    # Explicit null
    res = await _send(hass, 4, "haventory/item/check_out", item_id=item_id, due_date=None)
    assert res["success"] is True
    assert res["result"]["checked_out"] is True
    assert res["result"]["due_date"] is None


@pytest.mark.asyncio
async def test_item_list_pagination_cursor_passthrough() -> None:
    """List items returns items array and next_cursor passthrough shape."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Seed a couple items
    await _send(hass, 1, "haventory/item/create", name="A")
    await _send(hass, 2, "haventory/item/create", name="B")

    res = await _send(hass, 3, "haventory/item/list", limit=1)
    assert res["success"] is True
    assert isinstance(res["result"].get("items"), list)
    cursor = res["result"].get("next_cursor")

    if cursor:
        res2 = await _send(hass, 4, "haventory/item/list", limit=1, cursor=cursor)
        assert res2["success"] is True


@pytest.mark.asyncio
async def test_error_mapping_validation_and_not_found_and_conflict() -> None:
    """Ensure errors map to codes and include context."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # validation_error: negative quantity
    v = await _send(hass, 1, "haventory/item/set_quantity", item_id="x", quantity=-1)
    assert v["success"] is False and v["error"]["code"] == "validation_error"
    # Context includes op and input fields
    assert v["error"].get("context", v["error"].get("data", {})).get("op") == "item_set_quantity"

    # not_found: get by unknown id
    n = await _send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert n["success"] is False and n["error"]["code"] == "not_found"
    assert n["error"].get("context", n["error"].get("data", {})).get("op") == "item_get"

    # conflict: create then update with stale expected_version
    c = await _send(hass, 3, "haventory/item/create", name="Widget")
    iid = c["result"]["id"]
    stale = await _send(
        hass, 4, "haventory/item/update", item_id=iid, expected_version=999, name="X"
    )
    assert stale["success"] is False and stale["error"]["code"] == "conflict"
    assert stale["error"].get("context", stale["error"].get("data", {})).get("op") == "item_update"


@pytest.mark.asyncio
async def test_ws_mutations_persist_to_store(monkeypatch) -> None:
    """After WS mutations, DomainStore.async_save is invoked with export_state."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    # Real store instance so key exists; we'll spy on method
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1
        # Minimal assertions
        assert isinstance(payload, dict)
        assert "items" in payload and "locations" in payload

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Create triggers persist
    created = await _send(hass, 1, "haventory/item/create", name="Hammer")
    assert calls["count"] >= 1
    item_id = created["result"]["id"]
    # Update triggers persist
    await _send(hass, 2, "haventory/item/update", item_id=item_id, name="HammerX")
    # Adjust quantity triggers persist
    await _send(hass, 3, "haventory/item/adjust_quantity", item_id=item_id, delta=1)
    # Delete triggers persist
    await _send(hass, 4, "haventory/item/delete", item_id=item_id)
    MIN_PERSISTS_TOTAL = 4
    assert calls["count"] >= MIN_PERSISTS_TOTAL

    # Validation: set_quantity negative
    res = await _send(hass, 1, "haventory/item/set_quantity", item_id="x", quantity=-1)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Not found
    res = await _send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert res["success"] is False and res["error"]["code"] == "not_found"

    # Conflict: create, then update with stale version
    created = await _send(hass, 3, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]
    stale = await _send(
        hass, 4, "haventory/item/update", item_id=item_id, expected_version=999, name="X"
    )
    assert stale["success"] is False and stale["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_inspection_date_in_create_update_get() -> None:
    """inspection_date field is handled correctly in WS create/update/get operations."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Create item with inspection_date
    res = await _send(
        hass, 1, "haventory/item/create", name="Calibration Tool", inspection_date="2024-03-15"
    )
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-03-15"
    item_id = res["result"]["id"]

    # Get item and verify inspection_date is returned
    res = await _send(hass, 2, "haventory/item/get", item_id=item_id)
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-03-15"

    # Update inspection_date
    res = await _send(
        hass, 3, "haventory/item/update", item_id=item_id, inspection_date="2024-09-30"
    )
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-09-30"

    # Clear inspection_date
    res = await _send(hass, 4, "haventory/item/update", item_id=item_id, inspection_date=None)
    assert res["success"] is True
    assert res["result"]["inspection_date"] is None


@pytest.mark.asyncio
async def test_item_list_reports_filtered_total() -> None:
    """item/list includes `total`: all matches for the filter, on every page."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    await _send(hass, 1, "haventory/item/create", name="Hammer", category="tools")
    await _send(hass, 2, "haventory/item/create", name="Wrench", category="tools")
    await _send(hass, 3, "haventory/item/create", name="Glue", category="misc")

    seeded = 3
    res = await _send(hass, 4, "haventory/item/list", limit=1)
    assert res["success"] is True
    assert res["result"]["total"] == seeded
    assert len(res["result"]["items"]) == 1

    # A later page still reports the full total
    res_page2 = await _send(
        hass, 5, "haventory/item/list", limit=1, cursor=res["result"]["next_cursor"]
    )
    assert res_page2["result"]["total"] == seeded

    tools = 2
    filtered = await _send(hass, 6, "haventory/item/list", filter={"category": "tools"}, limit=1)
    assert filtered["result"]["total"] == tools
    assert len(filtered["result"]["items"]) == 1

    empty = await _send(hass, 7, "haventory/item/list", filter={"q": "zzz-not-there"})
    assert empty["result"]["total"] == 0
    assert empty["result"]["items"] == []


# -----------------------------
# Attachments
# -----------------------------


@contextmanager
def _fake_upload(_hass, file_id: str):
    """Stand in for core's `process_uploaded_file`.

    The real one yields the temp file the browser POSTed to `/api/file_upload`
    and destroys the directory afterwards. `_UPLOADS` is what the tests POST
    into; an id that is not in it raises `ValueError`, which is exactly how the
    real component reports an expired or already-consumed upload.
    """

    if file_id not in _UPLOADS:
        raise ValueError("File does not exist")
    source = _UPLOADS.pop(file_id)
    try:
        yield source
    finally:
        shutil.rmtree(source.parent, ignore_errors=True)


_UPLOADS: dict[str, Path] = {}

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _stage_upload(file_id: str, content: bytes = PNG_BYTES) -> None:
    """Put a file where the fake `process_uploaded_file` will find it."""

    directory = Path(tempfile.mkdtemp(prefix="haventory-upload-"))
    source = directory / "photo.png"
    source.write_bytes(content)
    _UPLOADS[file_id] = source


@pytest.fixture
def upload(monkeypatch):
    """Route the attachment command through the fake upload component."""

    _UPLOADS.clear()
    monkeypatch.setattr(ws_mod, "process_uploaded_file", _fake_upload)
    return _stage_upload


@pytest.mark.asyncio
async def test_attachment_add_and_remove_bump_the_version(upload) -> None:
    """Attaching a file is an item edit, unlike the derived location path."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    assert created["result"]["attachments"] == []

    upload("upload-1")
    added = await _send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=item_id,
        file_id="upload-1",
        filename="drill.png",
    )

    assert added["success"] is True
    attachments = added["result"]["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["kind"] == "picture"
    # The stored type is the sniffed one, never what the client declared.
    assert attachments[0]["mime"] == "image/png"
    assert attachments[0]["filename"] == "drill.png"
    assert added["result"]["version"] == created["result"]["version"] + 1

    removed = await _send(
        hass,
        3,
        "haventory/item/attachment/remove",
        item_id=item_id,
        attachment_id=attachments[0]["id"],
    )

    assert removed["success"] is True
    assert removed["result"]["attachments"] == []
    assert removed["result"]["version"] == added["result"]["version"] + 1


@pytest.mark.asyncio
async def test_attachment_add_announces_the_item_as_updated(upload, monkeypatch) -> None:
    """An open card learns about a new photo the same way it learns about an edit."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    broadcasts: list[tuple[str, str]] = []
    monkeypatch.setattr(
        ws_mod,
        "_broadcast_event",
        lambda _hass, *, topic, action, payload=None: broadcasts.append((topic, action)),
    )

    upload("upload-1")
    await _send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="upload-1",
    )

    assert ("items", "updated") in broadcasts


@pytest.mark.asyncio
async def test_attachment_add_refuses_a_stale_expected_version(upload) -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]

    upload("upload-1")
    res = await _send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=item_id,
        file_id="upload-1",
        expected_version=99,
    )

    assert res["success"] is False
    assert res["error"]["code"] == "conflict"
    # The upload was not consumed: the version is checked before the temp file
    # is touched, so the user does not lose the bytes to a lost race.
    assert "upload-1" in _UPLOADS


@pytest.mark.asyncio
async def test_attachment_add_on_an_unknown_item_is_not_found(upload) -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    upload("upload-1")
    res = await _send(
        hass,
        1,
        "haventory/item/attachment/add",
        item_id="11111111-1111-4111-8111-111111111111",
        file_id="upload-1",
    )

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_attachment_add_reports_an_unknown_file_id_as_not_found(upload) -> None:
    """`file_upload` raises for an expired upload, or one already consumed."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")

    res = await _send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="never-uploaded",
    )

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_attachment_add_refuses_a_file_whose_bytes_are_not_an_image(upload) -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    upload("upload-1", b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')

    res = await _send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="upload-1",
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert _repo_of(hass).get_item(created["result"]["id"]).attachments == []


@pytest.mark.asyncio
async def test_attachment_remove_deletes_the_file_and_the_item_delete_cascades(upload) -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    upload("upload-1")
    added = await _send(
        hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1"
    )
    meta = _repo_of(hass).get_item(item_id).attachments[0]
    path = media_mod.attachment_path(media_mod.media_root(hass), item_id, str(meta.id), meta.mime)
    assert path.is_file()

    await _send(
        hass,
        3,
        "haventory/item/attachment/remove",
        item_id=item_id,
        attachment_id=added["result"]["attachments"][0]["id"],
    )
    assert not path.exists()

    # And deleting the item takes its remaining files with it.
    upload("upload-2")
    await _send(hass, 4, "haventory/item/attachment/add", item_id=item_id, file_id="upload-2")
    second = _repo_of(hass).get_item(item_id).attachments[0]
    second_path = media_mod.attachment_path(
        media_mod.media_root(hass), item_id, str(second.id), second.mime
    )
    assert second_path.is_file()

    await _send(hass, 5, "haventory/item/delete", item_id=item_id)
    assert not second_path.exists()


@pytest.mark.asyncio
async def test_attachment_remove_of_an_unknown_id_is_not_found() -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Drill")

    res = await _send(
        hass,
        2,
        "haventory/item/attachment/remove",
        item_id=created["result"]["id"],
        attachment_id="11111111-1111-4111-8111-111111111111",
    )

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"
