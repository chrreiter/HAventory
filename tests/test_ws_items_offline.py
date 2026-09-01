"""Offline tests for haventory WebSocket item commands.

Scenarios:
- create/get/update/delete item with envelope success
- adjust/set quantity and check_out/check_in
- list items with pagination cursor passthrough
- error mapping for validation/not_found/conflict with contextual data
- optimistic concurrency: with and without expected_version
- tag normalization, and the null tag every command taking tags refuses
- a wrong-typed field answers validation_error and writes nothing
- attachment add/remove: version bumps, refusals, and the file-deletion cascade

The attachment tests stand in for core's `file_upload` component, which the
offline harness does not carry. Everything past the upload handle is the real
code path: sniffing, the caps, the move onto disk, and the deletes.
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

import pytest
from custom_components.haventory import events as events_mod
from custom_components.haventory import media as media_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.repository import Repository
from homeassistant.core import HomeAssistant

from runtime_helpers import repo_of, runtime_of, ws_hass
from ws_helpers import ws_send


def _repo_of(hass: HomeAssistant) -> Repository:
    return repo_of(hass)


@pytest.mark.asyncio
async def test_item_create_get_update_delete_success() -> None:
    """Create, get, update, delete an item via WS and assert envelopes."""

    hass = ws_hass()

    # Create
    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer", quantity=2)
    assert res["id"] == 1 and res["type"] == "result" and res["success"] is True
    assert isinstance(res.get("result"), dict) and "id" in res["result"]
    item_id = res["result"]["id"]

    # Get
    res = await ws_send(hass, 2, "haventory/item/get", item_id=item_id)
    assert res["success"] is True and res["result"]["id"] == item_id

    # Update
    res = await ws_send(hass, 3, "haventory/item/update", item_id=item_id, name="Hammer Pro")
    assert res["success"] is True and res["result"]["name"] == "Hammer Pro"

    # Delete
    res = await ws_send(hass, 4, "haventory/item/delete", item_id=item_id)
    assert res["success"] is True and res["result"] is None


@pytest.mark.asyncio
async def test_item_update_refuses_a_tag_list_carrying_a_null() -> None:
    """A null tag is refused by the model, on every command that takes tags.

    Each of them types `tags` as `object` and leaves the shape to the model — a
    stored `None` would break every tag index and filter that assumes strings,
    and dropping it silently would store a list the caller did not send.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Battery", tags=["li-ion"])
    item_id = created["result"]["id"]

    res = await ws_send(
        hass, 2, "haventory/item/update", item_id=item_id, tags=["Li-Ion", None, " spare "]
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == "tags must be a list of strings"

    unchanged = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert unchanged["result"]["tags"] == ["li-ion"]

    # The two tag operations answer the same code with the same message.
    for op_id, command in ((4, "add_tags"), (5, "remove_tags")):
        refused = await ws_send(
            hass, op_id, f"haventory/item/{command}", item_id=item_id, tags=["x", None]
        )
        assert refused["success"] is False, command
        assert refused["error"]["code"] == "validation_error", command
        assert refused["error"]["message"] == "tags must be a list of strings", command

    still_unchanged = await ws_send(hass, 6, "haventory/item/get", item_id=item_id)
    assert still_unchanged["result"]["tags"] == ["li-ion"]


@pytest.mark.asyncio
async def test_item_update_refuses_a_bad_inspection_date_by_its_own_name() -> None:
    """A client sending a malformed date is told which of its fields is wrong."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Boiler")
    item_id = created["result"]["id"]
    version = created["result"]["version"]

    res = await ws_send(
        hass, 2, "haventory/item/update", item_id=item_id, inspection_date="2026-13-01"
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == "inspection_date must be a valid calendar date (YYYY-MM-DD)"

    stored = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert stored["result"]["version"] == version
    assert stored["result"]["inspection_date"] is None


@pytest.mark.asyncio
async def test_item_update_refuses_a_string_tags_and_keeps_the_item() -> None:
    """A string `tags` writes nothing, and a null still clears the list.

    `tags: "kitchen"` iterates as seven characters, so the item would come back
    carrying seven one-letter tags a caller never wrote. The refusal leaves the
    item's tags and its version alone, which is what tells a client its edit
    did not land.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Chisel", tags=["tools"])
    item_id = created["result"]["id"]
    version_before = created["result"]["version"]

    res = await ws_send(hass, 2, "haventory/item/update", item_id=item_id, tags="kitchen")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == "tags must be a list of strings"

    unchanged = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert unchanged["result"]["tags"] == ["tools"]
    assert unchanged["result"]["version"] == version_before

    cleared = await ws_send(hass, 4, "haventory/item/update", item_id=item_id, tags=None)
    assert cleared["success"] is True
    assert cleared["result"]["tags"] == []


@pytest.mark.asyncio
async def test_item_quantity_and_checkout_helpers() -> None:
    """Adjust/set quantity and check in/out via WS."""

    hass = ws_hass()

    initial_quantity = 1
    created = await ws_send(hass, 1, "haventory/item/create", name="Box", quantity=initial_quantity)
    item_id = created["result"]["id"]

    delta_quantity = 2
    expected_after_adjust = initial_quantity + delta_quantity
    res = await ws_send(
        hass, 2, "haventory/item/adjust_quantity", item_id=item_id, delta=delta_quantity
    )
    assert res["result"]["quantity"] == expected_after_adjust

    target_quantity = 5
    res = await ws_send(
        hass, 3, "haventory/item/set_quantity", item_id=item_id, quantity=target_quantity
    )
    assert res["result"]["quantity"] == target_quantity

    res = await ws_send(hass, 4, "haventory/item/check_out", item_id=item_id, due_date="2030-01-01")
    assert res["result"]["checked_out"] is True

    res = await ws_send(hass, 5, "haventory/item/check_in", item_id=item_id)
    assert res["result"]["checked_out"] is False


@pytest.mark.asyncio
async def test_item_check_out_due_date_is_optional() -> None:
    """Check out without a due date, and with an explicit null one.

    The WS schema declares ``due_date`` optional and nullable (unlike the
    ``haventory.item_check_out`` service, which requires it), so both forms
    check the item out and leave ``due_date`` unset.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]

    # Omitted entirely
    res = await ws_send(hass, 2, "haventory/item/check_out", item_id=item_id)
    assert res["success"] is True
    assert res["result"]["checked_out"] is True
    assert res["result"]["due_date"] is None

    await ws_send(hass, 3, "haventory/item/check_in", item_id=item_id)

    # Explicit null
    res = await ws_send(hass, 4, "haventory/item/check_out", item_id=item_id, due_date=None)
    assert res["success"] is True
    assert res["result"]["checked_out"] is True
    assert res["result"]["due_date"] is None


@pytest.mark.asyncio
async def test_error_mapping_validation_and_not_found_and_conflict() -> None:
    """Ensure errors map to codes and include context."""

    hass = ws_hass()

    # validation_error: negative quantity
    v = await ws_send(hass, 1, "haventory/item/set_quantity", item_id="x", quantity=-1)
    assert v["success"] is False and v["error"]["code"] == "validation_error"
    # Context includes op and input fields
    assert v["error"]["data"]["op"] == "item_set_quantity"

    # not_found: get by unknown id
    n = await ws_send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert n["success"] is False and n["error"]["code"] == "not_found"
    assert n["error"]["data"]["op"] == "item_get"

    # conflict: create then update with stale expected_version
    c = await ws_send(hass, 3, "haventory/item/create", name="Widget")
    iid = c["result"]["id"]
    stale = await ws_send(
        hass, 4, "haventory/item/update", item_id=iid, expected_version=999, name="X"
    )
    assert stale["success"] is False and stale["error"]["code"] == "conflict"
    assert stale["error"]["data"]["op"] == "item_update"


@pytest.mark.asyncio
async def test_ws_mutations_persist_to_store(monkeypatch) -> None:
    """After WS mutations, DomainStore.async_save is invoked with export_state."""

    hass = ws_hass()
    store = runtime_of(hass).store

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1
        # Minimal assertions
        assert isinstance(payload, dict)
        assert "items" in payload and "locations" in payload

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Create triggers persist
    created = await ws_send(hass, 1, "haventory/item/create", name="Hammer")
    assert calls["count"] >= 1
    item_id = created["result"]["id"]
    # Update triggers persist
    await ws_send(hass, 2, "haventory/item/update", item_id=item_id, name="HammerX")
    # Adjust quantity triggers persist
    await ws_send(hass, 3, "haventory/item/adjust_quantity", item_id=item_id, delta=1)
    # Delete triggers persist
    await ws_send(hass, 4, "haventory/item/delete", item_id=item_id)
    MIN_PERSISTS_TOTAL = 4
    assert calls["count"] >= MIN_PERSISTS_TOTAL


@pytest.mark.asyncio
async def test_inspection_date_in_create_update_get() -> None:
    """inspection_date field is handled correctly in WS create/update/get operations."""

    hass = ws_hass()

    # Create item with inspection_date
    res = await ws_send(
        hass, 1, "haventory/item/create", name="Calibration Tool", inspection_date="2024-03-15"
    )
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-03-15"
    item_id = res["result"]["id"]

    # Get item and verify inspection_date is returned
    res = await ws_send(hass, 2, "haventory/item/get", item_id=item_id)
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-03-15"

    # Update inspection_date
    res = await ws_send(
        hass, 3, "haventory/item/update", item_id=item_id, inspection_date="2024-09-30"
    )
    assert res["success"] is True
    assert res["result"]["inspection_date"] == "2024-09-30"

    # Clear inspection_date
    res = await ws_send(hass, 4, "haventory/item/update", item_id=item_id, inspection_date=None)
    assert res["success"] is True
    assert res["result"]["inspection_date"] is None


@pytest.mark.asyncio
async def test_item_list_reports_filtered_total() -> None:
    """item/list includes `total`: all matches for the filter, on every page."""

    hass = ws_hass()

    await ws_send(hass, 1, "haventory/item/create", name="Hammer", category="tools")
    await ws_send(hass, 2, "haventory/item/create", name="Wrench", category="tools")
    await ws_send(hass, 3, "haventory/item/create", name="Glue", category="misc")

    seeded = 3
    res = await ws_send(hass, 4, "haventory/item/list", limit=1)
    assert res["success"] is True
    assert res["result"]["total"] == seeded
    assert len(res["result"]["items"]) == 1

    # A later page still reports the full total
    res_page2 = await ws_send(
        hass, 5, "haventory/item/list", limit=1, cursor=res["result"]["next_cursor"]
    )
    assert res_page2["result"]["total"] == seeded

    tools = 2
    filtered = await ws_send(hass, 6, "haventory/item/list", filter={"category": "tools"}, limit=1)
    assert filtered["result"]["total"] == tools
    assert len(filtered["result"]["items"]) == 1

    empty = await ws_send(hass, 7, "haventory/item/list", filter={"q": "zzz-not-there"})
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

    Both halves record the thread they ran on. The real teardown is a
    synchronous `shutil.rmtree`, so neither may run on the event loop thread —
    and the stub `HomeAssistant` dispatches `async_add_executor_job` to a
    genuine worker, which is what makes the difference observable.
    """

    if file_id not in _UPLOADS:
        raise ValueError("File does not exist")
    source = _UPLOADS.pop(file_id)
    _UPLOAD_THREADS["enter"] = threading.get_ident()
    try:
        yield source
    finally:
        _UPLOAD_THREADS["exit"] = threading.get_ident()
        shutil.rmtree(source.parent, ignore_errors=True)


_UPLOADS: dict[str, Path] = {}
_UPLOAD_THREADS: dict[str, int] = {}

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _stage_upload(file_id: str, content: bytes = PNG_BYTES) -> Path:
    """Put a file where the fake `process_uploaded_file` will find it.

    Returns the temp directory holding it, which the teardown must delete.
    """

    directory = Path(tempfile.mkdtemp(prefix="haventory-upload-"))
    source = directory / "photo.png"
    source.write_bytes(content)
    _UPLOADS[file_id] = source
    return directory


@pytest.fixture
def upload(monkeypatch):
    """Route the attachment command through the fake upload component."""

    _UPLOADS.clear()
    _UPLOAD_THREADS.clear()
    monkeypatch.setattr(ws_mod, "process_uploaded_file", _fake_upload)
    return _stage_upload


@pytest.mark.asyncio
async def test_attachment_add_and_remove_bump_the_version(upload) -> None:
    """Attaching a file is an item edit, unlike the derived location path."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    assert created["result"]["attachments"] == []

    upload("upload-1")
    added = await ws_send(
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

    removed = await ws_send(
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

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    broadcasts: list[tuple[str, str]] = []
    monkeypatch.setattr(
        events_mod,
        "broadcast_event",
        lambda _hass, *, topic, action, payload=None: broadcasts.append((topic, action)),
    )

    upload("upload-1")
    await ws_send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="upload-1",
    )

    assert ("items", "updated") in broadcasts


@pytest.mark.asyncio
async def test_attachment_add_refuses_a_stale_expected_version(upload) -> None:
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]

    upload("upload-1")
    res = await ws_send(
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
    hass = ws_hass()

    upload("upload-1")
    res = await ws_send(
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

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")

    res = await ws_send(
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
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    upload("upload-1", b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')

    res = await ws_send(
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
async def test_attachment_add_consumes_the_upload_handle_off_the_event_loop(upload) -> None:
    """Core's handle enters and leaves on a worker, never on the loop thread.

    Its teardown deletes the upload's temp directory with a synchronous
    `shutil.rmtree`; on the loop that stalls every other connection for as long
    as the walk takes, and Home Assistant's blocking-call detector reports it
    against this integration.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    directory = upload("upload-1")
    loop_thread = threading.get_ident()

    added = await ws_send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="upload-1",
    )

    assert added["success"] is True
    assert _UPLOAD_THREADS["enter"] != loop_thread
    assert _UPLOAD_THREADS["exit"] != loop_thread
    assert not directory.exists()


@pytest.mark.asyncio
async def test_attachment_add_tears_the_upload_down_off_the_loop_when_it_is_refused(
    upload,
) -> None:
    """The failure path pays the same teardown, so it offloads it the same way."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    directory = upload("upload-1", b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
    loop_thread = threading.get_ident()

    refused = await ws_send(
        hass,
        2,
        "haventory/item/attachment/add",
        item_id=created["result"]["id"],
        file_id="upload-1",
    )

    assert refused["success"] is False
    assert refused["error"]["code"] == "validation_error"
    assert _UPLOAD_THREADS["exit"] != loop_thread
    assert not directory.exists()


@pytest.mark.asyncio
async def test_attachment_add_tears_the_upload_down_when_the_command_is_cancelled(
    upload, monkeypatch
) -> None:
    """A dropped connection mid-upload must not leave the bytes behind.

    Nothing else collects an abandoned `file_upload` directory: the media sweep
    only knows the integration's own media root.
    """

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    directory = upload("upload-1")

    consuming = asyncio.Event()

    async def _hang(*_args, **_kwargs):
        consuming.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(media_mod, "async_consume_upload", _hang)

    task = asyncio.create_task(
        ws_send(
            hass,
            2,
            "haventory/item/attachment/add",
            item_id=created["result"]["id"],
            file_id="upload-1",
        )
    )
    await consuming.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert not directory.exists()


@pytest.mark.asyncio
async def test_attachment_remove_deletes_the_file_and_the_item_delete_cascades(upload) -> None:
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    upload("upload-1")
    added = await ws_send(
        hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1"
    )
    meta = _repo_of(hass).get_item(item_id).attachments[0]
    path = media_mod.attachment_path(media_mod.media_root(hass), item_id, str(meta.id), meta.mime)
    assert path.is_file()

    await ws_send(
        hass,
        3,
        "haventory/item/attachment/remove",
        item_id=item_id,
        attachment_id=added["result"]["attachments"][0]["id"],
    )
    assert not path.exists()

    # And deleting the item takes its remaining files with it.
    upload("upload-2")
    await ws_send(hass, 4, "haventory/item/attachment/add", item_id=item_id, file_id="upload-2")
    second = _repo_of(hass).get_item(item_id).attachments[0]
    second_path = media_mod.attachment_path(
        media_mod.media_root(hass), item_id, str(second.id), second.mime
    )
    assert second_path.is_file()

    await ws_send(hass, 5, "haventory/item/delete", item_id=item_id)
    assert not second_path.exists()


@pytest.mark.asyncio
async def test_attachment_remove_of_an_unknown_id_is_not_found() -> None:
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")

    res = await ws_send(
        hass,
        2,
        "haventory/item/attachment/remove",
        item_id=created["result"]["id"],
        attachment_id="11111111-1111-4111-8111-111111111111",
    )

    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_attachment_update_retitles_and_bumps_the_version(upload) -> None:
    """A title is what a manuals list reads, so it is a real item edit."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Dishwasher")
    item_id = created["result"]["id"]
    upload("upload-1")
    added = await ws_send(
        hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1"
    )
    attachment_id = added["result"]["attachments"][0]["id"]

    res = await ws_send(
        hass,
        3,
        "haventory/item/attachment/update",
        item_id=item_id,
        attachment_id=attachment_id,
        title="Warranty",
    )

    assert res["success"] is True
    assert res["result"]["attachments"][0]["title"] == "Warranty"
    assert res["result"]["version"] == added["result"]["version"] + 1


@pytest.mark.asyncio
async def test_attachment_update_reports_a_stale_version_as_conflict(upload) -> None:
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Dishwasher")
    item_id = created["result"]["id"]
    upload("upload-1")
    added = await ws_send(
        hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1"
    )

    res = await ws_send(
        hass,
        3,
        "haventory/item/attachment/update",
        item_id=item_id,
        attachment_id=added["result"]["attachments"][0]["id"],
        title="Warranty",
        expected_version=1,
    )

    assert res["success"] is False
    assert res["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_attachment_reorder_makes_the_named_first_one_the_cover(upload) -> None:
    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    upload("upload-1")
    await ws_send(hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1")
    _stage_upload("upload-2")
    two = await ws_send(
        hass, 3, "haventory/item/attachment/add", item_id=item_id, file_id="upload-2"
    )
    first, second = (a["id"] for a in two["result"]["attachments"])

    res = await ws_send(
        hass,
        4,
        "haventory/item/attachment/reorder",
        item_id=item_id,
        kind="picture",
        attachment_ids=[second, first],
    )

    assert res["success"] is True
    ordered = sorted(res["result"]["attachments"], key=lambda a: a["order"])
    assert [a["id"] for a in ordered] == [second, first]


@pytest.mark.asyncio
async def test_attachment_reorder_refuses_a_partial_list(upload) -> None:
    """A partial list would leave two attachments claiming the same position."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item_id = created["result"]["id"]
    upload("upload-1")
    await ws_send(hass, 2, "haventory/item/attachment/add", item_id=item_id, file_id="upload-1")
    _stage_upload("upload-2")
    two = await ws_send(
        hass, 3, "haventory/item/attachment/add", item_id=item_id, file_id="upload-2"
    )

    res = await ws_send(
        hass,
        4,
        "haventory/item/attachment/reorder",
        item_id=item_id,
        kind="picture",
        attachment_ids=[two["result"]["attachments"][0]["id"]],
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


# -----------------------------
# item/list input hardening
# -----------------------------


def _hass_with_items(count: int = 3) -> HomeAssistant:
    hass = ws_hass()
    repo = _repo_of(hass)
    for i in range(count):
        repo.create_item({"name": f"Item {i}"})
    return hass


@pytest.mark.asyncio
async def test_item_list_refuses_an_unknown_filter_key_by_name() -> None:
    """A typo'd key used to be dropped, and the reply was the whole inventory."""

    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", filter={"query": "Item 0"})

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "query" in res["error"]["message"]


@pytest.mark.asyncio
async def test_item_list_refuses_an_unknown_sort_field() -> None:
    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", sort={"field": "colour", "order": "asc"})

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_item_list_refuses_an_empty_cursor() -> None:
    """Omitting the key is how a caller asks for page one; "" is a client bug."""

    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", limit=2, cursor="")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_item_list_refuses_an_undecodable_cursor() -> None:
    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", limit=2, cursor="garbage")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_item_list_refuses_a_non_integer_limit() -> None:
    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", limit="two")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["tags_any", "tags_all"])
async def test_item_list_refuses_a_tag_selection_that_is_a_bare_string(key: str) -> None:
    """A bare string is refused rather than queried as its letters.

    The index pre-filter reads the same key before the scan does, so answering
    it there is what keeps this from coming back as an empty page — which reads
    to a client as "no item carries that tag".
    """

    hass = _hass_with_items()

    res = await ws_send(hass, 1, "haventory/item/list", filter={key: "kitchen"})

    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == f"{key} must be a list of strings"


@pytest.mark.asyncio
async def test_item_list_still_serves_a_full_known_filter_and_pages() -> None:
    """The regression that matters: nothing legitimate got refused."""

    hass = _hass_with_items()

    listed = await ws_send(
        hass,
        1,
        "haventory/item/list",
        filter={"q": "Item", "include_subtree": True, "low_stock_first": False},
        sort={"field": "name", "order": "asc"},
        limit=2,
    )
    assert listed["success"] is True, listed
    assert [i["name"] for i in listed["result"]["items"]] == ["Item 0", "Item 1"]

    page2 = await ws_send(
        hass,
        2,
        "haventory/item/list",
        filter={"q": "Item", "include_subtree": True, "low_stock_first": False},
        sort={"field": "name", "order": "asc"},
        limit=2,
        cursor=listed["result"]["next_cursor"],
    )
    assert page2["success"] is True, page2
    assert [i["name"] for i in page2["result"]["items"]] == ["Item 2"]


@pytest.mark.asyncio
async def test_item_create_answers_a_wrong_typed_field_with_validation_error() -> None:
    """A wrong type is refused by the handler, through the guard.

    Home Assistant refuses a schema mismatch before ``ws_guard`` runs and logs
    the client's payload at ERROR while doing it. Every field carrying a value
    is typed ``object`` so the answer comes from the model layer instead,
    naming the field at WARNING — the scalars and the collections alike.
    """

    hass = ws_hass()
    repo = repo_of(hass)

    for payload in (
        {"name": "Hammer", "quantity": "many"},
        {"name": 42},
        {"name": "Hammer", "quantity": 1.5},
        {"name": "Hammer", "tags": "chisel"},
        {"name": "Hammer", "tags": [7]},
        {"name": "Hammer", "custom_fields": ["length"]},
    ):
        res = await ws_send(hass, 1, "haventory/item/create", **payload)
        assert res["success"] is False, payload
        assert res["error"]["code"] == "validation_error", payload

    assert repo.get_counts()["items_total"] == 0
