"""Integration: the low-stock bridge against a real to-do list.

A pass is judged by the lines that end up on a real `todo` entity, so Home
Assistant's own dispatch is in the loop: entity targeting, the feature gate on
`add_item` / `remove_item`, summary matching, and the bus listeners.

The list is a to-do entity of this suite's own rather than `local_todo`, whose
`ical` requirement the test environment does not install. It models the contract
`TodoListEntity` states: items with uids the entity itself assigns.
"""

from __future__ import annotations

import logging
import uuid

import pytest
from custom_components.haventory import todo_bridge
from custom_components.haventory.const import (
    CONF_TODO_ENTITY_ID,
    TODO_LINKS_STORAGE_KEY,
    TODO_LINKS_STORAGE_VERSION,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import find_runtime
from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry, ConfigFlow
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, STATE_UNAVAILABLE, Platform
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    MockModule,
    MockPlatform,
    mock_config_flow,
    mock_integration,
    mock_platform,
)

LIST_DOMAIN = "haventory_test_list"
LIST_ENTITY_ID = "todo.shopping"
OTHER_ENTITY_ID = "todo.household"
THRESHOLD = 3
LOW_QUANTITY = 1

TIMES = todo_bridge.MULTIPLICATION_SIGN


class _TestTodoList(TodoListEntity):
    """A to-do list that keeps its items in memory and assigns its own uids."""

    _attr_has_entity_name = False
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )

    def __init__(self, name: str = "Shopping") -> None:
        self._attr_name = name
        self._attr_todo_items: list[TodoItem] = []
        self._issued = 0
        self.creates = 0
        # Methods ("create", "update", "delete") that raise until a test lifts
        # them, as a list that is busy or has lost the line does. One mutation
        # can run two passes, so a refusal that lapsed after one call would be
        # retried inside the same step.
        self.refuse: set[str] = set()

    def _maybe_refuse(self, method: str) -> None:
        if method in self.refuse:
            raise HomeAssistantError(f"{method} refused")

    @property
    def summaries(self) -> list[str]:
        return [item.summary for item in self._attr_todo_items or ()]

    def delete_by_hand(self) -> None:
        """What the household does in the to-do UI: the lines go, HAventory is not told."""

        self._attr_todo_items = []
        self.async_write_ha_state()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        self.creates += 1
        self._maybe_refuse("create")
        self._issued += 1
        item.uid = str(self._issued)
        self._attr_todo_items = [*(self._attr_todo_items or []), item]
        self.async_write_ha_state()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        self._maybe_refuse("update")
        self._attr_todo_items = [
            item if existing.uid == item.uid else existing
            for existing in self._attr_todo_items or ()
        ]
        self.async_write_ha_state()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        self._maybe_refuse("delete")
        self._attr_todo_items = [
            existing for existing in self._attr_todo_items or () if existing.uid not in uids
        ]
        self.async_write_ha_state()


class _ListFlow(ConfigFlow):
    """The list integration's config flow, so its entry can be set up and unloaded."""


@pytest.fixture
async def todo_lists(hass: HomeAssistant) -> tuple[_TestTodoList, _TestTodoList]:
    """Two real `todo.*` entities on the state machine, backed by the class above."""

    entities = (_TestTodoList("Shopping"), _TestTodoList("Household"))

    async def _setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
        await hass.config_entries.async_forward_entry_setups(entry, [Platform.TODO])
        return True

    async def _setup_platform(
        hass: HomeAssistant,
        entry: ConfigEntry,
        async_add_entities: AddConfigEntryEntitiesCallback,
    ) -> None:
        async_add_entities(entities)

    mock_integration(hass, MockModule(LIST_DOMAIN, async_setup_entry=_setup_entry))
    mock_platform(
        hass,
        f"{LIST_DOMAIN}.{Platform.TODO}",
        MockPlatform(async_setup_entry=_setup_platform),
    )
    # Home Assistant imports an entry's `config_flow` platform before setting it
    # up, and refuses the entry when there is none to import — registering an
    # empty one is what lets `mock_config_flow` below supply the handler.
    mock_platform(hass, f"{LIST_DOMAIN}.config_flow", None)

    with mock_config_flow(LIST_DOMAIN, _ListFlow):
        entry = MockConfigEntry(domain=LIST_DOMAIN)
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    assert hass.states.get(LIST_ENTITY_ID) is not None
    assert hass.states.get(OTHER_ENTITY_ID) is not None
    return entities


@pytest.fixture
def todo_list(todo_lists: tuple[_TestTodoList, _TestTodoList]) -> _TestTodoList:
    return todo_lists[0]


@pytest.fixture
def household_list(todo_lists: tuple[_TestTodoList, _TestTodoList]) -> _TestTodoList:
    return todo_lists[1]


@pytest.fixture
def create_low_item(hass: HomeAssistant, call_service):
    """Create an item already below its threshold, through the real service."""

    async def _create(name: str = "Peanut butter") -> str:
        result = await call_service(
            "item_create", name=name, quantity=LOW_QUANTITY, low_stock_threshold=THRESHOLD
        )
        await hass.async_block_till_done()
        return str(result["item"]["id"])

    return _create


async def set_quantity(hass: HomeAssistant, call_service, item_id: str, quantity: int) -> None:
    await call_service("item_set_quantity", item_id=item_id, quantity=quantity)
    await hass.async_block_till_done()


async def test_a_service_mutation_puts_a_line_on_the_list(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item, call_service
) -> None:
    """The whole chain: a service call, the bus event, the pass, `todo.add_item`."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    assert todo_list.summaries == []

    item_id = await create_low_item()

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    assert todo_list._attr_todo_items[0].status == TodoItemStatus.NEEDS_ACTION

    # Restocking takes the line off again, matched by its summary alone: the
    # bridge records no uid, because `todo.add_item` returns none.
    await set_quantity(hass, call_service, item_id, THRESHOLD + 1)

    assert todo_list.summaries == []


async def test_a_second_mutation_does_not_duplicate_the_line(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """Convergence over a real list: the pass runs again and writes nothing new."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await create_low_item()
    await create_low_item("Rope")

    assert sorted(todo_list.summaries) == [f"Peanut butter {TIMES}2", f"Rope {TIMES}2"]


async def test_a_deeper_shortfall_restates_the_existing_line(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item, call_service
) -> None:
    """`todo.update_item` finds the line by its old summary and renames it."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    item_id = await create_low_item()
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    uid = todo_list._attr_todo_items[0].uid

    await set_quantity(hass, call_service, item_id, 0)

    assert todo_list.summaries == [f"Peanut butter {TIMES}3"]
    # Restated in place rather than replaced, so anything the household added to
    # the line, a note or a position in the list, survives.
    assert todo_list._attr_todo_items[0].uid == uid


async def test_the_shortfall_never_reads_zero(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, call_service
) -> None:
    """An item low at a threshold of 0 still asks for one to be bought."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await call_service("item_create", name="Salt", quantity=0, low_stock_threshold=0)
    await hass.async_block_till_done()

    assert todo_list.summaries == [f"Salt {TIMES}1"]
    # The sign itself, pinned once: every expectation here builds on the same
    # constant, so only this line can catch a swapped glyph.
    assert todo_bridge.MULTIPLICATION_SIGN == "\u00d7"


async def test_an_unconfigured_list_leaves_every_list_alone(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """Off is the default, and off has to mean no `todo.*` call is dispatched."""

    await setup_entry({CONF_TODO_ENTITY_ID: ""})
    await create_low_item()

    assert todo_list.summaries == []
    assert todo_list.creates == 0


async def test_a_list_that_is_not_there_does_not_fail_the_mutation(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """An inventory write must never fail because a to-do list did.

    Home Assistant answers a service call naming a missing entity with a log
    line rather than an error, so the bridge checks the state machine itself,
    and either way the item is created and stays created.
    """

    await setup_entry({CONF_TODO_ENTITY_ID: "todo.does_not_exist"})
    item_id = await create_low_item()

    assert find_runtime(hass).repository.get_item(item_id).quantity == LOW_QUANTITY
    assert todo_list.summaries == []
    assert find_runtime(hass).todo.links == {}


async def test_an_unavailable_list_gets_no_line_until_it_answers(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """A line written to a list that is not answering would be linked and never there."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    hass.states.async_set(LIST_ENTITY_ID, STATE_UNAVAILABLE)
    await create_low_item()
    assert todo_list.creates == 0

    todo_list.async_write_ha_state()
    await create_low_item("Rope")
    assert sorted(todo_list.summaries) == [f"Peanut butter {TIMES}2", f"Rope {TIMES}2"]


async def test_the_first_pass_after_a_restart_is_silent(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """A reloaded link map means a restart re-lists nothing it had already listed."""

    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await create_low_item()
    assert todo_list.creates == 1

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    assert todo_list.creates == 1


async def test_a_refused_add_leaves_the_item_unlinked_so_the_next_pass_retries(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    create_low_item,
    call_service,
) -> None:
    """A list that was busy must not cost the item its line for good."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    todo_list.refuse.add("create")
    item_id = await create_low_item()
    assert todo_list.summaries == []

    todo_list.refuse.clear()
    await set_quantity(hass, call_service, item_id, LOW_QUANTITY + 1)

    assert todo_list.summaries == [f"Peanut butter {TIMES}1"]


async def test_a_refused_removal_gives_up_the_link(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    create_low_item,
    call_service,
) -> None:
    """A line deleted by hand is gone for good.

    Holding the link would keep the item off the list for good; giving it up
    costs at most one line the user clears themselves.
    """

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    item_id = await create_low_item()
    todo_list.delete_by_hand()

    # Home Assistant refuses the removal of a summary it cannot find, and the
    # restock still succeeds.
    await set_quantity(hass, call_service, item_id, THRESHOLD + 1)
    assert find_runtime(hass).repository.get_item(item_id).quantity == THRESHOLD + 1

    await set_quantity(hass, call_service, item_id, LOW_QUANTITY)
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]


async def test_a_refused_restatement_keeps_the_link_on_the_text_already_there(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    create_low_item,
    call_service,
) -> None:
    """The line stays readable and the pass keeps matching it; the count lags."""

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    item_id = await create_low_item()

    todo_list.refuse.add("update")
    await set_quantity(hass, call_service, item_id, 0)
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    todo_list.refuse.clear()

    # The link still names the old text, so the restock finds the line.
    await set_quantity(hass, call_service, item_id, THRESHOLD + 1)
    assert todo_list.summaries == []


async def test_clearing_the_option_stops_writing_without_retracting(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """Switching the bridge off means stop managing, not delete what is there."""

    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await create_low_item()

    hass.config_entries.async_update_entry(entry, options={CONF_TODO_ENTITY_ID: ""})
    await hass.async_block_till_done()
    await create_low_item("Rope")

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]


async def test_changing_the_list_moves_the_lines_across(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    household_list: _TestTodoList,
    setup_entry,
    create_low_item,
) -> None:
    """Off the list they were written to, onto the one now configured."""

    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await create_low_item()

    hass.config_entries.async_update_entry(entry, options={CONF_TODO_ENTITY_ID: OTHER_ENTITY_ID})
    await hass.async_block_till_done()

    assert todo_list.summaries == []
    assert household_list.summaries == [f"Peanut butter {TIMES}2"]


async def test_a_stored_row_missing_half_of_itself_is_dropped_on_load(
    hass: HomeAssistant,
    hass_storage: dict,
    todo_list: _TestTodoList,
    setup_entry,
) -> None:
    """A row that cannot be retracted would hold its item off the list for good.

    The three malformed rows leave their items without a line, so each gets one;
    the well-formed row's line is already on the list and is not written again.
    """

    repo = Repository()
    ids = {
        name: str(
            repo.create_item(  # type: ignore[arg-type]
                {"name": name, "quantity": LOW_QUANTITY, "low_stock_threshold": THRESHOLD}
            ).id
        )
        for name in ("Kept", "No summary", "No entity", "Not a row")
    }
    kept_line = f"Kept {TIMES}2"
    hass_storage[TODO_LINKS_STORAGE_KEY] = {
        "version": TODO_LINKS_STORAGE_VERSION,
        "key": TODO_LINKS_STORAGE_KEY,
        "data": {
            "links": {
                ids["Kept"]: {"entity_id": LIST_ENTITY_ID, "summary": kept_line},
                ids["No summary"]: {"entity_id": LIST_ENTITY_ID},
                ids["No entity"]: {"summary": f"No entity {TIMES}2"},
                ids["Not a row"]: f"Not a row {TIMES}2",
            }
        },
    }
    todo_list._attr_todo_items = [TodoItem(summary=kept_line, uid=str(uuid.uuid4()))]
    todo_list.async_write_ha_state()

    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID}, stored=repo)

    assert sorted(todo_list.summaries) == sorted(
        [kept_line, f"No summary {TIMES}2", f"No entity {TIMES}2", f"Not a row {TIMES}2"]
    )


async def test_unloading_the_entry_stops_the_bridge_listening(
    hass: HomeAssistant, todo_list: _TestTodoList, setup_entry, create_low_item
) -> None:
    """The listeners are released with the entry, not left on the bus.

    Left behind, they would run a pass against an emptied bucket on every
    mutation for the rest of the Home Assistant run.
    """

    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    await create_low_item()
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    # The link map went with the runtime Home Assistant took back.
    assert find_runtime(hass) is None
    # The list keeps what it had: an unloaded entry gives up its own runtime,
    # not the household's shopping list.
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]


def _started_listeners(hass: HomeAssistant) -> int:
    return hass.bus.async_listeners().get(EVENT_HOMEASSISTANT_STARTED, 0)


async def test_the_boot_time_start_listener_is_gone_once_it_has_fired(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A restart and then a reload must leave nothing at ERROR carrying our name.

    Set up while Home Assistant is still starting, the bridge defers its first
    pass to the start event: a low item already in the store has no line before
    it and one after. Home Assistant's own bookkeeping is what makes a stale
    second removal visible: the bus refuses a listener it cannot match with
    `Unable to remove unknown job listener`, at ERROR, quoting the frame that
    asked.
    """

    repo = Repository()
    repo.create_item(  # type: ignore[arg-type]
        {"name": "Peanut butter", "quantity": LOW_QUANTITY, "low_stock_threshold": THRESHOLD}
    )
    hass.set_state(CoreState.not_running)
    before = _started_listeners(hass)

    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID}, stored=repo)
    assert _started_listeners(hass) == before + 1
    assert todo_list.summaries == []

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
    await hass.async_block_till_done()
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    # Fewer, not `before`: Home Assistant's own one-time listeners for this event
    # go with the same firing, so the count after it is not the count before it.
    assert _started_listeners(hass) < before + 1

    caplog.clear()
    with caplog.at_level(logging.ERROR):
        assert await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()

    errors = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors == []


async def test_an_unload_before_the_start_event_releases_the_listener(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The other order, stopped or reloaded mid-boot, and the bus is left clean.

    Left on it, the listener would run a pass against a runtime Home Assistant
    has already taken back, the moment startup finished.
    """

    hass.set_state(CoreState.not_running)
    before = _started_listeners(hass)
    entry = await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    assert _started_listeners(hass) == before + 1

    caplog.clear()
    with caplog.at_level(logging.ERROR):
        assert await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()

    assert _started_listeners(hass) == before
    assert [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR] == []


async def test_the_options_flow_offers_the_shopping_list_field(
    hass: HomeAssistant, setup_entry
) -> None:
    """The entity selector has to build under the real `selector` helper."""

    entry = await setup_entry({CONF_TODO_ENTITY_ID: ""})
    result = await hass.config_entries.options.async_init(entry.entry_id)

    assert result["type"] == "form"
    assert result["step_id"] == "init"
    assert "todo" in result["data_schema"].schema

    # And the picker only offers lists this bridge can take a line back off.
    # Home Assistant resolves the feature name by importing the module, so a
    # wrong string is refused when the selector is built, not when it is drawn.
    section = result["data_schema"].schema["todo"]
    selector = next(iter(section.schema.schema.values()))
    assert selector.config["filter"] == [
        {
            "domain": ["todo"],
            "supported_features": [int(TodoListEntityFeature.DELETE_TODO_ITEM)],
        }
    ]


async def test_a_list_that_cannot_delete_keeps_one_line_rather_than_stacking_them(
    hass: HomeAssistant,
    todo_list: _TestTodoList,
    setup_entry,
    create_low_item,
    call_service,
) -> None:
    """An option set before the picker was filtered still names such a list.

    Home Assistant refuses `todo.remove_item` on an entity without
    `DELETE_TODO_ITEM`, and a bridge reading that refusal as permanent would
    give up the link, so the next crossing wrote a second line, and the one
    after that a third, with nothing HAventory offers able to clear them.
    """

    todo_list._attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM
    todo_list.async_write_ha_state()
    await setup_entry({CONF_TODO_ENTITY_ID: LIST_ENTITY_ID})
    item_id = await create_low_item()
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]

    for _cycle in range(3):
        await set_quantity(hass, call_service, item_id, THRESHOLD + 1)
        await set_quantity(hass, call_service, item_id, LOW_QUANTITY)

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
