"""Offline tests for the Home Assistant bus events."""

from __future__ import annotations

from pathlib import Path

import pytest
from custom_components.haventory import events as events_mod
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import (
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    SIGNAL_INVENTORY_CHANGED,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.serialization import serialize_item
from homeassistant.core import HomeAssistant

from runtime_helpers import (
    install_runtime,
    installed_entry,
    repo_of,
    setup_entry,
    unload_entry,
    unload_runtime,
    ws_hass,
)
from ws_helpers import ITEM_ACTIONS, RecordingConn, ws_send

LOW_THRESHOLD = 3
# One create, then the reassignment's edit.
_AFTER_A_REASSIGNMENT = 2
EVENTS_LOGGER = "custom_components.haventory.events"


def _hass() -> tuple[HomeAssistant, Repository]:
    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    events_mod.seed_low_stock_snapshot(hass)
    return hass, repo


def _signals(hass: HomeAssistant) -> list[str]:
    """The dispatcher signals sent, without the counts each one carries."""

    return [signal for signal, _args in hass.dispatcher_sends]


def _count_passes(monkeypatch: pytest.MonkeyPatch) -> list[None]:
    """Record every `Repository.get_counts` call; each walks the whole inventory."""

    calls: list[None] = []
    original = Repository.get_counts

    def _counted(self: Repository):  # type: ignore[no-untyped-def]
        calls.append(None)
        return original(self)

    monkeypatch.setattr(Repository, "get_counts", _counted)
    return calls


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

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)

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
    assert {e["action"] for e in fired} <= ITEM_ACTIONS
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
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]


def test_a_bulk_style_notification_carries_no_item_event() -> None:
    """An import rewrites the dataset; one signal, not one event per row."""

    hass, repo = _hass()
    _create(repo, hass, name="Widget")

    events_mod.notify_mutation(hass, action="reloaded")

    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]


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
    runtime = install_runtime(hass, repository=repo)
    events_mod.seed_low_stock_snapshot(hass)
    assert runtime.low_stock_ids == frozenset({str(item.id)})

    unrelated = repo.create_item({"name": "Rope", "quantity": 5})  # type: ignore[arg-type]
    events_mod.notify_mutation(hass, action="created", item=serialize_item(hass, unrelated))

    assert hass.bus.events_of(EVENT_LOW_STOCK) == []


def test_an_emptied_bucket_is_a_no_op() -> None:
    """A mutation racing the entry's teardown must not raise out of the helper."""

    hass, repo = _hass()
    _item, serialized = _create(repo, hass, name="Widget")

    unload_runtime(hass)
    events_mod.notify_mutation(hass, action="created", item=serialized)
    assert hass.bus.fired == []

    # An entry that survived the unload but has no runtime is the same story.
    hass.config_entries.remove(installed_entry(hass))
    events_mod.notify_mutation(hass, action="created", item=serialized)
    assert hass.bus.events_of(EVENT_LOW_STOCK) == []


@pytest.mark.parametrize("action", sorted(ITEM_ACTIONS))
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


@pytest.mark.asyncio
async def test_deleting_a_status_with_reassign_to_announces_every_item_it_rewrote() -> None:
    """The one mutation path that moved items and told nobody.

    `_reassign_status` performs ordinary item edits — a new version and a new
    `updated_at` each — so an automation watching `haventory_item_changed` was
    blind while a whole set moved underneath it, against a contract that says the
    event fires on every path.
    """

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)
    repo = repo_of(hass)
    moved = [repo.create_item({"name": f"Item {n}", "status": "missing"}) for n in range(3)]
    repo.create_item({"name": "Untouched"})
    hass.bus.fired.clear()

    res = await ws_send(hass, 1, "haventory/status/delete", slug="missing", reassign_to="ok")

    assert res["success"] is True, res
    assert res["result"]["reassigned"] == len(moved)
    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    assert {e["item_id"] for e in fired} == {str(i.id) for i in moved}
    assert {e["action"] for e in fired} == {"updated"}
    # Each event carries the version the reassignment wrote, not the one before.
    assert all(e["version"] == _AFTER_A_REASSIGNMENT for e in fired)


def test_a_bulk_notification_repaints_once_however_many_items_it_names() -> None:
    """Forty rewritten rows are one inventory change, not forty."""

    hass, repo = _hass()
    serialized = [_create(repo, hass, name=f"Widget {n}")[1] for n in range(4)]

    events_mod.notify_bulk_mutation(hass, action="updated", items=serialized)

    assert len(hass.bus.events_of(EVENT_ITEM_CHANGED)) == len(serialized)
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]


@pytest.mark.asyncio
async def test_renaming_a_location_repaints_without_announcing_an_item_change() -> None:
    """The calendar renders each event's description from the stored path.

    Nothing invalidated that until local midnight or the next item edit, so a
    renamed location kept being announced under its old name. The dispatcher
    signal is what fires: no item's `version` or `updated_at` moved, and the bus
    vocabulary has no location word.
    """

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)
    repo = repo_of(hass)
    garage = repo.create_location(name="Garage")
    repo.create_item({"name": "Ladder", "location_id": str(garage.id)})
    hass.bus.fired.clear()
    hass.dispatcher_sends.clear()

    res = await ws_send(
        hass, 1, "haventory/location/update", location_id=str(garage.id), name="Workshop"
    )

    assert res["success"] is True, res
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


@pytest.mark.asyncio
async def test_a_location_save_that_changes_no_path_repaints_nothing() -> None:
    """The control: a re-save with the same name is not a reason to recount."""

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)
    repo = repo_of(hass)
    garage = repo.create_location(name="Garage")
    hass.dispatcher_sends.clear()

    res = await ws_send(
        hass, 1, "haventory/location/update", location_id=str(garage.id), name="Garage"
    )

    assert res["success"] is True, res
    assert _signals(hass) == []


@pytest.mark.asyncio
async def test_moving_a_subtree_repaints_the_paths_it_rewrote() -> None:
    """`move_subtree` rewrites every path below the moved node."""

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)
    repo = repo_of(hass)
    garage = repo.create_location(name="Garage")
    cellar = repo.create_location(name="Cellar")
    shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))
    hass.dispatcher_sends.clear()

    res = await ws_send(
        hass,
        1,
        "haventory/location/move_subtree",
        location_id=str(shelf.id),
        new_parent_id=str(cellar.id),
    )

    assert res["success"] is True, res
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


@pytest.mark.asyncio
async def test_the_location_service_repaints_the_same_way_the_command_does() -> None:
    """An automation renaming a location must not leave the calendar behind."""

    hass = HomeAssistant()
    install_runtime(hass)
    events_mod.seed_low_stock_snapshot(hass)
    repo = repo_of(hass)
    garage = repo.create_location(name="Garage")
    hass.dispatcher_sends.clear()

    await services_mod.service_location_update(
        hass, {"location_id": str(garage.id), "name": "Workshop"}
    )

    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


@pytest.mark.asyncio
async def test_creating_and_deleting_a_location_repaints_the_count() -> None:
    """`locations_total` is a sensor, and only this signal moves it.

    Neither create nor delete touches an item, so nothing else on either path
    invalidates the state — it would sit at the old figure until the next item
    edit.
    """

    hass = ws_hass()
    events_mod.seed_low_stock_snapshot(hass)
    hass.dispatcher_sends.clear()

    created = await ws_send(hass, 1, "haventory/location/create", name="Garage")
    assert created["success"] is True, created
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]

    hass.dispatcher_sends.clear()
    deleted = await ws_send(
        hass, 2, "haventory/location/delete", location_id=created["result"]["id"]
    )
    assert deleted["success"] is True, deleted
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


@pytest.mark.asyncio
async def test_the_location_services_repaint_the_count_too() -> None:
    """The same two mutations through `haventory.location_*`."""

    hass = HomeAssistant()
    install_runtime(hass)
    events_mod.seed_low_stock_snapshot(hass)
    hass.dispatcher_sends.clear()

    created = await services_mod.service_location_create(hass, {"name": "Garage"})
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]

    hass.dispatcher_sends.clear()
    await services_mod.service_location_delete(hass, {"location_id": created["location"]["id"]})
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


def _rollover_action(hass: HomeAssistant):
    """The one thing setup asked to be called at the instance's midnight."""

    assert len(hass.time_change_trackers) == 1, hass.time_change_trackers
    action, hour, minute, second = hass.time_change_trackers[0]
    assert (hour, minute, second) == (0, 0, 0)
    return action


@pytest.mark.asyncio
async def test_setup_tracks_the_instances_local_midnight_once() -> None:
    """One tracker, on the day boundary, running on the event loop.

    Home Assistant hands a plain function to an executor thread and a
    `@callback` to the loop, so the marker is what keeps this broadcast off a
    worker thread.
    """

    hass = HomeAssistant()
    await setup_entry(hass)

    action = _rollover_action(hass)
    assert getattr(action, "_hass_callback", False) is True


@pytest.mark.asyncio
async def test_the_midnight_tick_sends_one_counts_event_to_a_subscriber() -> None:
    """The rollover the issue asks for: fresh counts with nothing mutated.

    An item dated tomorrow is not due today, and nobody edits it overnight — so
    without this tick a card left open keeps yesterday's figure while the
    date-derived sensors beside it have already moved.
    """

    hass = HomeAssistant()
    await setup_entry(hass)
    conn = RecordingConn()
    assert (await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="stats"))["success"]
    created = await ws_send(hass, 2, "haventory/item/create", conn=conn, name="Harness")
    assert created["success"] is True, created
    conn.messages.clear()

    _rollover_action(hass)(None)

    events = conn.events(topic="stats")
    assert [e["action"] for e in events] == ["counts"]
    assert events[0]["counts"]["items_total"] == 1


@pytest.mark.asyncio
async def test_unload_cancels_the_midnight_tick() -> None:
    """An unloaded entry owns no counts, so nothing may go on broadcasting them."""

    hass = HomeAssistant()
    entry = await setup_entry(hass)
    assert len(hass.time_change_trackers) == 1

    await unload_entry(hass, entry)

    assert hass.time_change_trackers == []


def test_nothing_but_events_py_reaches_the_broadcaster() -> None:
    """One door: a write path announces through here, or subscribers hear nothing.

    A module calling `subscriptions.broadcast_event` itself would reach a card
    without firing the bus event, diffing the low-stock set or repainting the
    entities beside it, so the same edit would look different depending on which
    surface was watching. Read from the source rather than by importing: several
    modules pull in Home Assistant packages the offline stubs do not provide.
    """

    package = Path(events_mod.__file__).parent
    offenders = []
    for path in sorted(package.glob("*.py")):
        if path.name in {"events.py", "subscriptions.py"}:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "broadcast_event(" in line or "broadcast_counts(" in line:
                offenders.append(f"{path.name}:{number}: {line.strip()}")

    assert offenders == [], "announce through events.py: it covers the bus and the entities too"


@pytest.mark.asyncio
async def test_one_write_walks_the_inventory_for_its_counts_once(monkeypatch) -> None:
    """The repaint carries the set the `stats` topic gets, so neither recomputes it.

    The sensors read their value off the signal's argument; a sensor computing
    its own would cost one pass per entity per write.
    """

    hass = ws_hass()
    conn = RecordingConn()
    await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="stats")
    calls = _count_passes(monkeypatch)

    await ws_send(hass, 2, "haventory/item/create", conn=conn, name="Hammer", quantity=1)

    assert len(calls) == 1
    counts = repo_of(hass).get_counts()
    assert hass.dispatcher_sends == [(SIGNAL_INVENTORY_CHANGED, (counts,))]
    assert [e["counts"] for e in conn.events(topic="stats")] == [counts]


@pytest.mark.asyncio
async def test_a_bulk_batch_repaints_once_and_counts_once(monkeypatch) -> None:
    """Each row keeps its `items` event and its low-stock crossing; the batch repaints once."""

    hass = ws_hass()
    conn = RecordingConn()
    await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="items")
    await ws_send(hass, 2, "haventory/subscribe", conn=conn, topic="stats")
    rows = 25
    ids = []
    for n in range(rows):
        created = await ws_send(
            hass,
            10 + n,
            "haventory/item/create",
            name=f"Battery {n}",
            quantity=10,
            low_stock_threshold=LOW_THRESHOLD,
        )
        ids.append(created["result"]["id"])
    hass.dispatcher_sends.clear()
    conn.messages.clear()
    calls = _count_passes(monkeypatch)

    operations = [
        {
            "op_id": str(n),
            "kind": "item_set_quantity",
            "payload": {"item_id": item_id, "quantity": 1 if n < 2 else 5},  # noqa: PLR2004
        }
        for n, item_id in enumerate(ids)
    ]
    res = await ws_send(hass, 99, "haventory/items/bulk", conn=conn, operations=operations)

    assert res["success"] is True
    assert _signals(hass) == [SIGNAL_INVENTORY_CHANGED]
    assert len(calls) == 1
    item_events = conn.events(topic="items")
    assert [e["item"]["id"] for e in item_events] == ids
    assert len(conn.events(topic="stats")) == 1
    entered = [e for e in hass.bus.events_of(EVENT_LOW_STOCK) if e["action"] == "entered"]
    # One diff for the whole batch, after every row's own events; each crossing
    # is announced once, with its own name.
    assert sorted((e["item_id"], e["name"]) for e in entered) == sorted(
        [(ids[0], "Battery 0"), (ids[1], "Battery 1")]
    )


@pytest.mark.asyncio
async def test_a_bulk_delete_names_the_low_item_it_removed_from_any_row() -> None:
    """A deleted item is gone from the store, so its name has to come from its row."""

    hass = ws_hass()
    plain = await ws_send(hass, 1, "haventory/item/create", name="Tape", quantity=10)
    low = await ws_send(
        hass,
        2,
        "haventory/item/create",
        name="Batteries",
        quantity=1,
        low_stock_threshold=LOW_THRESHOLD,
    )
    low_id = low["result"]["id"]
    hass.bus.fired.clear()

    operations = [
        {"op_id": str(n), "kind": "item_delete", "payload": {"item_id": item["result"]["id"]}}
        for n, item in enumerate([plain, low])
    ]
    res = await ws_send(hass, 3, "haventory/items/bulk", operations=operations)

    assert res["success"] is True
    cleared = [e for e in hass.bus.events_of(EVENT_LOW_STOCK) if e["action"] == "cleared"]
    assert [
        (e["item_id"], e["name"], e["quantity"], e["low_stock_threshold"]) for e in cleared
    ] == [(low_id, "Batteries", 1, LOW_THRESHOLD)]


@pytest.mark.asyncio
async def test_a_bulk_batch_with_no_successful_row_announces_nothing() -> None:
    hass = ws_hass()
    hass.dispatcher_sends.clear()

    operations = [{"op_id": "a", "kind": "item_set_quantity", "payload": {"item_id": "nope"}}]
    res = await ws_send(hass, 1, "haventory/items/bulk", operations=operations)

    assert res["result"]["results"]["a"]["success"] is False
    assert _signals(hass) == []
