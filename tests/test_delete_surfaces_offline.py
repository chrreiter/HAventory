"""Every surface that deletes an item frees its files through the same call.

Three of them remove an item: `haventory/item/delete`, an `item_delete` row of
`haventory/items/bulk`, and the `haventory.item_delete` service. Each one is
asserted here against `media.async_delete_item_files` rather than against the
files on disk, because what makes a fourth surface safe is going through that
one call — a test per caller is what let the bulk path ship without it.

Ordering, and what a failed write frees, stay with each caller's own tests.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
from custom_components.haventory import media as media_mod
from custom_components.haventory import services as services_mod
from custom_components.haventory.models import AttachmentMeta, iso_utc_now, new_uuid4
from custom_components.haventory.repository import Repository
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime
from ws_helpers import ws_send

Surface = Callable[[HomeAssistant, str], Awaitable[None]]


async def _command(hass: HomeAssistant, item_id: str) -> None:
    res = await ws_send(hass, 1, "haventory/item/delete", item_id=item_id)
    assert res["success"] is True


async def _bulk_row(hass: HomeAssistant, item_id: str) -> None:
    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[{"op_id": "d", "kind": "item_delete", "payload": {"item_id": item_id}}],
    )
    assert res["result"]["results"]["d"]["success"] is True


async def _service(hass: HomeAssistant, item_id: str) -> None:
    await services_mod.service_item_delete(hass, {"item_id": item_id})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "surface",
    [_command, _bulk_row, _service],
    ids=["item/delete", "items/bulk", "service"],
)
async def test_a_delete_frees_the_items_files_through_one_call(
    surface: Surface, monkeypatch
) -> None:
    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    ws_setup(hass)
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(
        item.id,
        AttachmentMeta(
            id=new_uuid4(),
            kind="picture",
            filename="photo.png",
            mime="image/png",
            size=16,
            uploaded_at=iso_utc_now(),
        ),
    )

    freed: list[list[str]] = []

    async def _spy(_hass, bodies):  # type: ignore[no-untyped-def]
        freed.append([str(body.get("id")) for body in bodies])

    monkeypatch.setattr(media_mod, "async_delete_item_files", _spy)

    await surface(hass, str(item.id))

    assert freed == [[str(item.id)]]
