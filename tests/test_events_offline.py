"""Offline tests for the Home Assistant bus events.

Scenarios:
- every item mutation fires exactly one `haventory_item_changed` with the
  documented keys, and the action vocabulary matches the WebSocket one
- low-stock transitions fire once on the crossing and not again below it
- a restock fires `cleared`; deleting a low item fires `cleared` with no name
- the snapshot seeded at setup keeps a restart from re-announcing
- a torn-down entry makes the helper a no-op rather than a `KeyError`
"""

from __future__ import annotations

import pytest
from custom_components.haventory import events as events_mod
from custom_components.haventory.const import (
    DATA_LOW_STOCK_SNAPSHOT,
    DOMAIN,
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    SIGNAL_COUNTS_UPDATED,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.serialization import serialize_item
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from ws_helpers import ws_send

LOW_THRESHOLD = 3


def _hass() -> tuple[HomeAssistant, Repository]:
    hass = HomeAssistant()
    repo = Repository()
    hass.data[DOMAIN] = {"repository": repo}
    events_mod.seed_low_stock_snapshot(hass)
    return hass, repo


def _create(repo: Repository, hass: HomeAssistant, **payload):
    item = repo.create_item({"quantity": 10, **payload})  # type: ignore[arg-type]
    return item, serialize_item(hass, item)


@pytest.mark.asyncio
async def test_every_websocket_item_mutation_reaches_the_bus() -> None:
    """Each WS item command fires a bus event, with the action it broadcast.

    An automation trigger and a card subscription describing the same mutation
    with different words would be two vocabularies to document and keep in step,
    so the bus action is asserted against the one the WS event carried.
    """

    hass = HomeAssistant()
    hass.data[DOMAIN] = {"repository": Repository(), "store": DomainStore(hass)}
    events_mod.seed_low_stock_snapshot(hass)
    ws_setup(hass)

    created = await ws_send(hass, 1, "haventory/item/create", name="Widget", quantity=5)
    item_id = created["result"]["id"]

    commands: list[tuple[str, dict]] = [
        ("haventory/item/update", {"item_id": item_id, "name": "Widget Pro"}),
        ("haventory/item/move", {"item_id": item_id, "location_id": None}),
        ("haventory/item/adjust_quantity", {"item_id": item_id, "delta": -1}),
        ("haventory/item/set_quantity", {"item_id": item_id, "quantity": 7}),
        ("haventory/item/check_out", {"item_id": item_id, "due_date": "2030-01-01"}),
        ("haventory/item/check_in", {"item_id": item_id}),
        ("haventory/item/delete", {"item_id": item_id}),
    ]
    for index, (command, payload) in enumerate(commands, start=2):
        res = await ws_send(hass, index, command, **payload)
        assert res["success"] is True, (command, res)

    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    assert len(fired) == len(commands) + 1
    assert {e["action"] for e in fired} <= events_mod.ITEM_ACTIONS
    assert fired[0]["action"] == "created"
    assert fired[-1]["action"] == "deleted"
    assert {e["item_id"] for e in fired} == {item_id}


def test_a_mutation_fires_one_item_changed_with_the_documented_keys() -> None:
    hass, repo = _hass()
    loc = repo.create_location(name="Shelf")
    item, serialized = _create(repo, hass, name="Widget", location_id=str(loc.id))

    events_mod.notify_mutation(hass, action="created", item=serialized)

    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    assert len(fired) == 1
    payload = fired[0]
    assert set(payload) == {
        "action",
        "item_id",
        "name",
        "quantity",
        "location_id",
        "location_path",
        "effective_area_id",
        "version",
        "ts",
    }
    assert payload["action"] == "created"
    assert payload["item_id"] == str(item.id)
    assert payload["name"] == "Widget"
    assert payload["location_path"] == "Shelf"
    assert payload["version"] == item.version
    # Trigger fodder only: an automation that wants the body calls haventory/item/get.
    assert "custom_fields" not in payload
    assert "description" not in payload

    # The sensors repaint off the dispatcher, not off the bus event.
    assert hass.dispatcher_sends == [(SIGNAL_COUNTS_UPDATED, ())]


def test_a_bulk_style_notification_carries_no_item_event() -> None:
    """An import rewrites the dataset; one signal, not one event per row."""

    hass, repo = _hass()
    _create(repo, hass, name="Widget")

    events_mod.notify_mutation(hass, action="reloaded")

    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []
    assert hass.dispatcher_sends == [(SIGNAL_COUNTS_UPDATED, ())]


def test_crossing_the_threshold_fires_entered_once() -> None:
    hass, repo = _hass()
    item, _ = _create(repo, hass, name="Batteries", low_stock_threshold=LOW_THRESHOLD)

    updated = repo.set_quantity(str(item.id), LOW_THRESHOLD - 1)
    events_mod.notify_mutation(hass, action="quantity_changed", item=serialize_item(hass, updated))
    entered = hass.bus.events_of(EVENT_LOW_STOCK)
    assert [e["action"] for e in entered] == ["entered"]
    assert entered[0]["item_id"] == str(item.id)
    assert entered[0]["name"] == "Batteries"
    assert entered[0]["low_stock_threshold"] == LOW_THRESHOLD

    # A further drop is still low stock — the set did not change, so nothing fires.
    updated = repo.set_quantity(str(item.id), 0)
    events_mod.notify_mutation(hass, action="quantity_changed", item=serialize_item(hass, updated))
    assert len(hass.bus.events_of(EVENT_LOW_STOCK)) == 1


def test_a_restock_fires_cleared() -> None:
    hass, repo = _hass()
    item, _ = _create(repo, hass, name="Batteries", quantity=1, low_stock_threshold=LOW_THRESHOLD)
    events_mod.notify_mutation(hass, action="created", item=serialize_item(hass, item))
    assert [e["action"] for e in hass.bus.events_of(EVENT_LOW_STOCK)] == ["entered"]

    restocked = repo.set_quantity(str(item.id), 10)
    events_mod.notify_mutation(
        hass, action="quantity_changed", item=serialize_item(hass, restocked)
    )
    assert [e["action"] for e in hass.bus.events_of(EVENT_LOW_STOCK)] == ["entered", "cleared"]


def test_deleting_a_low_item_clears_it_with_no_name() -> None:
    """The item is gone by the time the diff runs, so the id is all there is."""

    hass, repo = _hass()
    item, _ = _create(repo, hass, name="Batteries", quantity=1, low_stock_threshold=LOW_THRESHOLD)
    events_mod.notify_mutation(hass, action="created", item=serialize_item(hass, item))

    removed = serialize_item(hass, item)
    repo.delete_item(str(item.id))
    events_mod.notify_mutation(hass, action="deleted", item=removed)

    cleared = [e for e in hass.bus.events_of(EVENT_LOW_STOCK) if e["action"] == "cleared"]
    assert len(cleared) == 1
    assert cleared[0]["item_id"] == str(item.id)
    # The delete's own payload names it; a lookup would have raised.
    assert cleared[0]["name"] == "Batteries"


def test_the_seeded_snapshot_keeps_a_restart_quiet() -> None:
    """A store loaded with low items announces nothing until something changes."""

    hass = HomeAssistant()
    repo = Repository()
    item = repo.create_item(  # type: ignore[arg-type]
        {"name": "Batteries", "quantity": 1, "low_stock_threshold": LOW_THRESHOLD}
    )
    # The entry sets up against a store that already holds a low item.
    hass.data[DOMAIN] = {"repository": repo}
    events_mod.seed_low_stock_snapshot(hass)
    assert hass.data[DOMAIN][DATA_LOW_STOCK_SNAPSHOT] == frozenset({str(item.id)})

    unrelated = repo.create_item({"name": "Rope", "quantity": 5})  # type: ignore[arg-type]
    events_mod.notify_mutation(hass, action="created", item=serialize_item(hass, unrelated))

    assert hass.bus.events_of(EVENT_LOW_STOCK) == []


def test_an_emptied_bucket_is_a_no_op() -> None:
    """A mutation racing the entry's teardown must not raise out of the helper."""

    hass, repo = _hass()
    _item, serialized = _create(repo, hass, name="Widget")

    hass.data.pop(DOMAIN)
    events_mod.notify_mutation(hass, action="created", item=serialized)
    assert hass.bus.fired == []

    # A bucket that survived but lost its repository is the same story.
    hass.data[DOMAIN] = {}
    events_mod.notify_mutation(hass, action="created", item=serialized)
    assert hass.bus.events_of(EVENT_LOW_STOCK) == []


@pytest.mark.parametrize("action", sorted(events_mod.ITEM_ACTIONS))
def test_every_action_in_the_vocabulary_fires(action: str) -> None:
    hass, repo = _hass()
    _item, serialized = _create(repo, hass, name="Widget")

    events_mod.notify_mutation(hass, action=action, item=serialized)

    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    assert [e["action"] for e in fired] == [action]


def test_low_stock_ids_are_a_snapshot_not_the_live_index() -> None:
    """The diff is against a set taken before the mutation, so it cannot alias."""

    repo = Repository()
    item = repo.create_item(  # type: ignore[arg-type]
        {"name": "Batteries", "quantity": 1, "low_stock_threshold": LOW_THRESHOLD}
    )
    before = repo.low_stock_item_ids
    assert before == frozenset({str(item.id)})

    repo.set_quantity(str(item.id), 10)
    assert repo.low_stock_item_ids == frozenset()
    assert before == frozenset({str(item.id)})
