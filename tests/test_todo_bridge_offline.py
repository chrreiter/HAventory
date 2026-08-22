"""Offline tests for the low-stock → to-do list bridge.

Scenarios:
- an item dropping to its threshold puts one line on the list; restocking takes
  it off, and neither issues a call the other's pass already made
- a second pass over unchanged data, and the first pass after a restart, are
  both silent — the convergence property the whole design rests on
- a refused add leaves the item unlinked so the next pass retries it; a refused
  removal gives up the link instead, because nothing about it will improve
- an unconfigured list issues no call at all, and changing the list moves the
  lines across
- a list that is missing or unavailable is left alone until it answers again
- the shortfall floors at one, so a threshold of zero never asks for none

The bridge's service calls are recorded rather than dispatched: the offline
`HomeAssistant` stub has no service registry, and what these tests assert is
which `todo.*` calls a pass decides to make.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import todo_bridge
from custom_components.haventory.const import (
    CONF_TODO_ENTITY_ID,
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    TODO_LINKS_STORAGE_KEY,
    TODO_LINKS_STORAGE_VERSION,
)
from custom_components.haventory.repository import Repository
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store

from runtime_helpers import install_runtime, runtime_of

TODO_ENTITY = "todo.shopping_list"
OTHER_ENTITY = "todo.household"
THRESHOLD = 3

TIMES = todo_bridge.MULTIPLICATION_SIGN

ADD = f"{todo_bridge.TODO_DOMAIN}.{todo_bridge.SERVICE_ADD_ITEM}"
REMOVE = f"{todo_bridge.TODO_DOMAIN}.{todo_bridge.SERVICE_REMOVE_ITEM}"
UPDATE = f"{todo_bridge.TODO_DOMAIN}.{todo_bridge.SERVICE_UPDATE_ITEM}"

# `TodoListEntityFeature` bits, as a state's `supported_features` reports them.
CREATE_ONLY = 1
CREATE_AND_DELETE = 1 | todo_bridge.TODO_FEATURE_DELETE_ITEM


class _Services:
    """Record the `todo.*` calls a pass makes, and refuse the named ones."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.refuse: set[str] = set()

    async def async_call(self, domain, service, data=None, blocking=False, **_kwargs):
        self.calls.append((f"{domain}.{service}", dict(data or {})))
        if service in self.refuse:
            raise HomeAssistantError(f"{service} refused")

    @property
    def names(self) -> list[str]:
        return [name for name, _data in self.calls]

    @property
    def summaries(self) -> list[str]:
        return [data.get("item") for _name, data in self.calls]

    def clear(self) -> None:
        self.calls.clear()


async def _forget_links(hass: HomeAssistant) -> None:
    """Empty the bridge's own store, which outlives a test in the offline stub."""

    await Store(hass, TODO_LINKS_STORAGE_VERSION, TODO_LINKS_STORAGE_KEY).async_remove()


async def _bridge(
    *,
    entity_id: str = TODO_ENTITY,
    available: bool = True,
    is_running: bool = True,
    keep_links: bool = False,
    repo: Repository | None = None,
) -> tuple[HomeAssistant, Repository, _Services, ConfigEntry]:
    """A hass with a loaded repository and the bridge set up against it.

    The runtime goes onto the entry before setup, as `async_setup_entry` puts it
    there — the bridge's first pass reads the repository off it, so a test that
    seeds it afterwards is not testing the same sequence Home Assistant runs.
    """

    hass = HomeAssistant()
    hass.is_running = is_running
    services = _Services()
    hass.services = services  # type: ignore[attr-defined]
    repository = repo if repo is not None else Repository()
    entry = ConfigEntry(options={CONF_TODO_ENTITY_ID: entity_id})
    install_runtime(
        hass, repository=repository, entry=entry, options={CONF_TODO_ENTITY_ID: entity_id}
    )
    if available:
        hass.states.async_set(entity_id, "0")
    if not keep_links:
        await _forget_links(hass)

    await todo_bridge.async_setup(hass, entry)
    return hass, repository, services, entry


def _low_item(repo: Repository, name: str = "Peanut butter", quantity: int = 1):
    return repo.create_item(  # type: ignore[arg-type]
        {"name": name, "quantity": quantity, "low_stock_threshold": THRESHOLD}
    )


@pytest.mark.asyncio
async def test_a_low_item_gets_one_line_and_a_restock_takes_it_off() -> None:
    """The pair of calls the whole feature exists for, and nothing besides."""

    hass, repo, services, _entry = await _bridge()
    item = _low_item(repo, quantity=1)

    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]
    assert services.summaries == [f"Peanut butter {TIMES}2"]
    assert services.calls[0][1]["entity_id"] == TODO_ENTITY

    services.clear()
    repo.set_quantity(str(item.id), THRESHOLD + 1)
    await todo_bridge.async_reconcile(hass)
    assert services.names == [REMOVE]
    assert services.summaries == [f"Peanut butter {TIMES}2"]


@pytest.mark.asyncio
async def test_a_second_pass_over_unchanged_data_calls_nothing() -> None:
    """Convergence, not edge detection: a re-fired event must cost no writes."""

    hass, repo, services, _entry = await _bridge()
    _low_item(repo)
    await todo_bridge.async_reconcile(hass)
    services.clear()

    await todo_bridge.async_reconcile(hass)
    await todo_bridge.async_reconcile(hass)
    assert services.calls == []


@pytest.mark.asyncio
async def test_the_first_pass_after_a_restart_is_silent() -> None:
    """A reloaded map means a restart re-lists nothing it had already listed."""

    hass, repo, services, _entry = await _bridge()
    _low_item(repo)
    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]

    # The same inventory and the same link store, both loaded from scratch:
    # that is a Home Assistant restart from the bridge's side. Setup runs a pass
    # of its own, and it is that pass which has to stay silent.
    reloaded = Repository()
    reloaded.load_state(repo.export_state())
    _restarted, _repo, services_after, _entry_after = await _bridge(keep_links=True, repo=reloaded)
    assert services_after.calls == []


@pytest.mark.asyncio
async def test_a_refused_add_leaves_the_item_unlinked_so_the_next_pass_retries() -> None:
    """A list that was busy must not cost the item its line for good."""

    hass, repo, services, _entry = await _bridge()
    services.refuse = {todo_bridge.SERVICE_ADD_ITEM}
    _low_item(repo)

    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]
    assert runtime_of(hass).todo.links == {}

    services.refuse = set()
    services.clear()
    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]
    assert list(runtime_of(hass).todo.links.values()) == [
        {"entity_id": TODO_ENTITY, "summary": f"Peanut butter {TIMES}2"}
    ]


@pytest.mark.asyncio
async def test_a_refused_removal_gives_up_the_link() -> None:
    """A line deleted by hand, or a list that is gone, is permanent.

    Holding the link would keep the item off the list for good; giving it up
    costs at most one line the user clears themselves. A list that cannot delete
    at all is the exception, tested below.
    """

    hass, repo, services, _entry = await _bridge()
    item = _low_item(repo)
    await todo_bridge.async_reconcile(hass)

    services.refuse = {todo_bridge.SERVICE_REMOVE_ITEM}
    services.clear()
    repo.set_quantity(str(item.id), THRESHOLD + 1)
    await todo_bridge.async_reconcile(hass)
    assert services.names == [REMOVE]
    assert runtime_of(hass).todo.links == {}

    # And the retraction is not attempted a second time on the next pass.
    services.clear()
    await todo_bridge.async_reconcile(hass)
    assert services.calls == []


@pytest.mark.asyncio
async def test_an_unconfigured_list_issues_no_call_at_all() -> None:
    """Off is the default, and off means the to-do domain is never touched."""

    hass, repo, services, _entry = await _bridge(entity_id="")
    _low_item(repo)

    await todo_bridge.async_reconcile(hass)
    assert services.calls == []


@pytest.mark.asyncio
async def test_clearing_the_option_stops_writing_without_retracting() -> None:
    """Switching the bridge off means stop managing, not delete what is there."""

    hass, repo, services, entry = await _bridge()
    _low_item(repo)
    await todo_bridge.async_reconcile(hass)
    services.clear()

    entry.options = {CONF_TODO_ENTITY_ID: ""}
    todo_bridge.apply_options(hass, entry)
    await todo_bridge.async_reconcile(hass)
    assert services.calls == []
    assert len(runtime_of(hass).todo.links) == 1


@pytest.mark.asyncio
async def test_changing_the_list_moves_the_lines_across() -> None:
    """Off the list they were written to, onto the one now configured."""

    hass, repo, services, entry = await _bridge()
    _low_item(repo)
    await todo_bridge.async_reconcile(hass)
    services.clear()

    hass.states.async_set(OTHER_ENTITY, "0")
    entry.options = {CONF_TODO_ENTITY_ID: OTHER_ENTITY}
    todo_bridge.apply_options(hass, entry)
    await todo_bridge.async_reconcile(hass)

    assert services.names == [REMOVE, ADD]
    assert services.calls[0][1]["entity_id"] == TODO_ENTITY
    assert services.calls[1][1]["entity_id"] == OTHER_ENTITY
    assert list(runtime_of(hass).todo.links.values()) == [
        {"entity_id": OTHER_ENTITY, "summary": f"Peanut butter {TIMES}2"}
    ]


@pytest.mark.asyncio
async def test_a_missing_or_unavailable_list_is_left_alone_until_it_answers() -> None:
    """Home Assistant drops an entity service call for a missing target silently.

    A pass that wrote anyway would record a link for a line nobody has.
    """

    hass, repo, services, _entry = await _bridge(available=False)
    _low_item(repo)

    await todo_bridge.async_reconcile(hass)
    assert services.calls == []
    assert runtime_of(hass).todo.links == {}

    hass.states.async_set(TODO_ENTITY, STATE_UNAVAILABLE)
    await todo_bridge.async_reconcile(hass)
    assert services.calls == []

    hass.states.async_set(TODO_ENTITY, "0")
    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]


@pytest.mark.asyncio
async def test_a_line_is_restated_when_the_shortfall_moves() -> None:
    """The count is what the line is for, so a stale one is wrong, not just old."""

    hass, repo, services, _entry = await _bridge()
    item = _low_item(repo, quantity=2)
    await todo_bridge.async_reconcile(hass)
    assert services.summaries == [f"Peanut butter {TIMES}1"]

    services.clear()
    repo.set_quantity(str(item.id), 0)
    await todo_bridge.async_reconcile(hass)
    assert services.names == [UPDATE]
    assert services.calls[0][1] == {
        "entity_id": TODO_ENTITY,
        "item": f"Peanut butter {TIMES}1",
        "rename": f"Peanut butter {TIMES}3",
    }
    assert list(runtime_of(hass).todo.links.values()) == [
        {"entity_id": TODO_ENTITY, "summary": f"Peanut butter {TIMES}3"}
    ]


@pytest.mark.asyncio
async def test_a_refused_restatement_keeps_the_link_on_the_text_already_there() -> None:
    """The line stays readable and the pass keeps matching it; the count lags."""

    hass, repo, services, _entry = await _bridge()
    item = _low_item(repo, quantity=2)
    await todo_bridge.async_reconcile(hass)

    services.refuse = {todo_bridge.SERVICE_UPDATE_ITEM}
    services.clear()
    repo.set_quantity(str(item.id), 0)
    await todo_bridge.async_reconcile(hass)
    assert list(runtime_of(hass).todo.links.values()) == [
        {"entity_id": TODO_ENTITY, "summary": f"Peanut butter {TIMES}1"}
    ]


def test_the_shortfall_never_reads_zero() -> None:
    """An item low at a threshold of 0 still asks for one to be bought."""

    assert todo_bridge.summary_for("Salt", 0, 0) == f"Salt {TIMES}1"
    assert todo_bridge.summary_for("Batteries", 3, 3) == f"Batteries {TIMES}1"
    assert todo_bridge.summary_for("Peanut butter", 1, 4) == f"Peanut butter {TIMES}3"
    # The sign itself, pinned once: everything above builds its expectation out
    # of the same constant, so only this line can catch a swapped glyph.
    assert todo_bridge.MULTIPLICATION_SIGN == "\u00d7"


@pytest.mark.asyncio
async def test_setup_listens_on_both_mutation_events_and_releases_them_on_unload() -> None:
    """Neither event covers the other, and a reload must not double-subscribe."""

    hass, repo, services, entry = await _bridge()
    assert len(hass.bus.listeners_for(EVENT_ITEM_CHANGED)) == 1
    assert len(hass.bus.listeners_for(EVENT_LOW_STOCK)) == 1

    # The listener runs the same pass a direct call does.
    _low_item(repo)
    for listener in hass.bus.listeners_for(EVENT_LOW_STOCK):
        await listener(None)
    assert services.names == [ADD]

    for release in entry._on_unload:
        release()
    assert hass.bus.listeners == []


@pytest.mark.asyncio
async def test_the_first_pass_waits_for_startup_when_home_assistant_is_still_booting() -> None:
    """A list owned by another integration may not be in the state machine yet."""

    hass, repo, services, _entry = await _bridge(is_running=False)
    _low_item(repo)
    assert services.calls == []

    started = hass.bus.listeners_for(EVENT_HOMEASSISTANT_STARTED)
    assert len(started) == 1
    await started[0](None)
    assert services.names == [ADD]


@pytest.mark.asyncio
async def test_the_start_listener_is_taken_off_the_bus_once_it_has_fired() -> None:
    """The unload must not ask again for a listener that is already gone.

    Real Home Assistant answers a removal it cannot match with
    `Unable to remove unknown job listener` at ERROR, naming the frame that
    asked — an HAventory line describing something that worked.
    """

    hass, _repo, _services, entry = await _bridge(is_running=False)
    started = hass.bus.listeners_for(EVENT_HOMEASSISTANT_STARTED)
    await started[0](None)
    assert hass.bus.listeners_for(EVENT_HOMEASSISTANT_STARTED) == []

    for release in entry._on_unload:
        release()

    assert hass.bus.unknown_removals == []


@pytest.mark.asyncio
async def test_an_unload_before_the_start_event_still_takes_it_off() -> None:
    """The other order: Home Assistant stopped, or the entry reloaded, mid-boot.

    Left on the bus, the listener would run a pass against a torn-down runtime
    the moment startup finished.
    """

    hass, _repo, _services, entry = await _bridge(is_running=False)
    assert len(hass.bus.listeners_for(EVENT_HOMEASSISTANT_STARTED)) == 1

    for release in entry._on_unload:
        release()

    assert hass.bus.listeners == []
    assert hass.bus.unknown_removals == []


@pytest.mark.asyncio
async def test_a_stored_row_missing_half_of_itself_is_dropped_on_load() -> None:
    """A row that cannot be retracted would hold its item off the list for good."""

    store: Store = Store(HomeAssistant(), TODO_LINKS_STORAGE_VERSION, TODO_LINKS_STORAGE_KEY)
    await store.async_save(
        {
            "links": {
                "kept": {"entity_id": TODO_ENTITY, "summary": f"Peanut butter {TIMES}2"},
                "no-summary": {"entity_id": TODO_ENTITY},
                "no-entity": {"summary": f"Rope {TIMES}1"},
                "not-a-row": f"Rope {TIMES}1",
            }
        }
    )

    # Set up with the bridge switched off, so the pass leaves the loaded map
    # exactly as it read it and the assertion is about the read alone.
    hass, _repo, _services, _entry = await _bridge(entity_id="", keep_links=True)

    assert runtime_of(hass).todo.links == {
        "kept": {"entity_id": TODO_ENTITY, "summary": f"Peanut butter {TIMES}2"}
    }


# -----------------------------
# A list that cannot delete its own lines
# -----------------------------


@pytest.mark.asyncio
async def test_a_list_that_cannot_delete_collects_one_line_per_item_and_no_more() -> None:
    """The one accumulation the bridge could not recover from.

    Every other refusal is about one line and will not repeat. "This list cannot
    delete" repeats on every crossing, and giving up the link each time meant the
    next crossing wrote a fresh duplicate of a line the bridge had forgotten —
    unbounded, and clearable by nothing HAventory offers.
    """

    hass, repo, services, _entry = await _bridge()
    hass.states.async_set(TODO_ENTITY, "0", {"supported_features": CREATE_ONLY})
    item = _low_item(repo)
    await todo_bridge.async_reconcile(hass)
    assert services.names == [ADD]

    for cycle in range(3):
        services.clear()
        repo.set_quantity(str(item.id), THRESHOLD + 1)
        await todo_bridge.async_reconcile(hass)
        # Nothing is even attempted: Home Assistant would refuse it, and the
        # link is what stops the next crossing writing a second line.
        assert services.calls == [], cycle
        assert list(runtime_of(hass).todo.links) == [str(item.id)], cycle

        services.clear()
        repo.set_quantity(str(item.id), THRESHOLD - 1)
        await todo_bridge.async_reconcile(hass)
        # The line already on the list is restated in place where the shortfall
        # moved, and never added a second time.
        assert ADD not in services.names, cycle


@pytest.mark.asyncio
async def test_a_list_that_can_delete_still_has_its_lines_retracted() -> None:
    """The control: the new check must not stop an ordinary list working."""

    hass, repo, services, _entry = await _bridge()
    hass.states.async_set(TODO_ENTITY, "0", {"supported_features": CREATE_AND_DELETE})
    item = _low_item(repo)
    await todo_bridge.async_reconcile(hass)

    services.clear()
    repo.set_quantity(str(item.id), THRESHOLD + 1)
    await todo_bridge.async_reconcile(hass)

    assert services.names == [REMOVE]
    assert runtime_of(hass).todo.links == {}


@pytest.mark.asyncio
async def test_a_list_publishing_no_features_is_treated_as_it_always_was() -> None:
    """Only a list that positively says it cannot delete gets the new treatment."""

    hass, repo, services, _entry = await _bridge()
    item = _low_item(repo)
    await todo_bridge.async_reconcile(hass)

    services.clear()
    repo.set_quantity(str(item.id), THRESHOLD + 1)
    await todo_bridge.async_reconcile(hass)

    assert services.names == [REMOVE]
    assert runtime_of(hass).todo.links == {}
