"""Integration: the low-stock bridge against a real to-do list.

The offline suite records the `todo.*` calls a pass decides to make; it cannot
show that Home Assistant dispatches them. Everything between the decision and
the line appearing lives here: entity-service targeting by `entity_id`, the
feature gate on `add_item` / `remove_item`, the summary matching that lets a
line be found without a uid, and the bus listener that turns a `haventory.*`
service call into a pass.

The list is a to-do entity of this suite's own rather than `local_todo`, whose
`ical` requirement a phacc run does not install. What it models is the contract
`TodoListEntity` states: create, update and delete of items with uids the
entity itself assigns.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import todo_bridge
from custom_components.haventory.const import CONF_TODO_ENTITY_ID, DOMAIN
from custom_components.haventory.runtime import find_runtime
from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry, ConfigFlow
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
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
THRESHOLD = 3
LOW_QUANTITY = 1

TIMES = todo_bridge.MULTIPLICATION_SIGN


class _TestTodoList(TodoListEntity):
    """A to-do list that keeps its items in memory and assigns its own uids."""

    _attr_name = "Shopping"
    _attr_has_entity_name = False
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )

    def __init__(self) -> None:
        self._attr_todo_items: list[TodoItem] = []
        self._issued = 0

    @property
    def summaries(self) -> list[str]:
        return [item.summary for item in self._attr_todo_items or ()]

    async def async_create_todo_item(self, item: TodoItem) -> None:
        self._issued += 1
        item.uid = str(self._issued)
        self._attr_todo_items = [*(self._attr_todo_items or []), item]
        self.async_write_ha_state()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        self._attr_todo_items = [
            item if existing.uid == item.uid else existing
            for existing in self._attr_todo_items or ()
        ]
        self.async_write_ha_state()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        self._attr_todo_items = [
            existing for existing in self._attr_todo_items or () if existing.uid not in uids
        ]
        self.async_write_ha_state()


class _ListFlow(ConfigFlow):
    """The list integration's config flow, so its entry can be set up and unloaded."""


@pytest.fixture
async def todo_list(hass: HomeAssistant) -> _TestTodoList:
    """A real `todo.*` entity on the state machine, backed by the class above."""

    entity = _TestTodoList()

    async def _setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
        await hass.config_entries.async_forward_entry_setups(entry, [Platform.TODO])
        return True

    async def _setup_platform(
        hass: HomeAssistant,
        entry: ConfigEntry,
        async_add_entities: AddConfigEntryEntitiesCallback,
    ) -> None:
        async_add_entities([entity])

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
    return entity


async def _setup_haventory(hass: HomeAssistant, *, entity_id: str) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={},
        options={CONF_TODO_ENTITY_ID: entity_id},
        title="HAventory",
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _create_low_item(hass: HomeAssistant, *, name: str = "Peanut butter") -> str:
    """Create an item already below its threshold, through the real service."""

    await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": name, "quantity": LOW_QUANTITY, "low_stock_threshold": THRESHOLD},
        blocking=True,
    )
    await hass.async_block_till_done()
    items = find_runtime(hass).repository._debug_get_internal_indexes()["items_by_id"]
    return next(item_id for item_id, item in items.items() if item.name == name)


async def test_a_service_mutation_puts_a_line_on_the_list(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """The whole chain: a service call, the bus event, the pass, `todo.add_item`.

    Nothing offline can assert this — the stub has no service registry, so it
    never sees Home Assistant classify and dispatch either handler.
    """

    await _setup_haventory(hass, entity_id=LIST_ENTITY_ID)
    assert todo_list.summaries == []

    item_id = await _create_low_item(hass)

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    assert todo_list._attr_todo_items[0].status == TodoItemStatus.NEEDS_ACTION

    # And restocking takes the line off again, matched by its summary alone —
    # the bridge records no uid, because `todo.add_item` returns none.
    await hass.services.async_call(
        DOMAIN,
        "item_set_quantity",
        {"item_id": item_id, "quantity": THRESHOLD + 1},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert todo_list.summaries == []


async def test_a_second_mutation_does_not_duplicate_the_line(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """Convergence over a real list: the pass runs again and writes nothing new."""

    await _setup_haventory(hass, entity_id=LIST_ENTITY_ID)
    await _create_low_item(hass)
    await _create_low_item(hass, name="Rope")

    assert sorted(todo_list.summaries) == [f"Peanut butter {TIMES}2", f"Rope {TIMES}2"]


async def test_a_deeper_shortfall_restates_the_existing_line(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """`todo.update_item` finds the line by its old summary and renames it."""

    await _setup_haventory(hass, entity_id=LIST_ENTITY_ID)
    item_id = await _create_low_item(hass)
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
    uid = todo_list._attr_todo_items[0].uid

    await hass.services.async_call(
        DOMAIN, "item_set_quantity", {"item_id": item_id, "quantity": 0}, blocking=True
    )
    await hass.async_block_till_done()

    assert todo_list.summaries == [f"Peanut butter {TIMES}3"]
    # Restated in place rather than replaced, so anything the household added to
    # the line — a note, a position in the list — survives.
    assert todo_list._attr_todo_items[0].uid == uid


async def test_an_unconfigured_list_leaves_every_list_alone(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """Off is the default, and off has to mean no `todo.*` call is dispatched."""

    await _setup_haventory(hass, entity_id="")
    await _create_low_item(hass)

    assert todo_list.summaries == []


async def test_a_list_that_is_not_there_does_not_fail_the_mutation(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """An inventory write must never fail because a to-do list did.

    Home Assistant answers a service call naming a missing entity with a log
    line rather than an error, so the bridge checks the state machine itself —
    and either way the item is created and stays created.
    """

    await _setup_haventory(hass, entity_id="todo.does_not_exist")
    item_id = await _create_low_item(hass)

    assert find_runtime(hass).repository.get_item(item_id).quantity == LOW_QUANTITY
    assert todo_list.summaries == []
    assert find_runtime(hass).todo.links == {}


async def test_unloading_the_entry_stops_the_bridge_listening(
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """The listeners are released with the entry, not left on the bus.

    Left behind, they would run a pass against an emptied bucket on every
    mutation for the rest of the Home Assistant run.
    """

    entry = await _setup_haventory(hass, entity_id=LIST_ENTITY_ID)
    await _create_low_item(hass)
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    # The link map went with the runtime Home Assistant took back.
    assert find_runtime(hass) is None
    # The list keeps what it had: an unloaded entry gives up its own runtime,
    # not the household's shopping list.
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]


async def test_the_options_flow_offers_the_shopping_list_field(hass: HomeAssistant) -> None:
    """The entity selector has to build under the real `selector` helper.

    Offline it is a stub, so a config that Home Assistant's own selector refuses
    would only surface here — or on the user's screen.
    """

    entry = await _setup_haventory(hass, entity_id="")
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
    hass: HomeAssistant, todo_list: _TestTodoList
) -> None:
    """An option set before the picker was filtered still names such a list.

    Home Assistant refuses `todo.remove_item` on an entity without
    `DELETE_TODO_ITEM`, and the bridge used to read that refusal as permanent and
    give up the link — so the next crossing wrote a second line, and the one
    after that a third, with nothing HAventory offers able to clear them.
    """

    todo_list._attr_supported_features = TodoListEntityFeature.CREATE_TODO_ITEM
    todo_list.async_write_ha_state()
    await _setup_haventory(hass, entity_id=LIST_ENTITY_ID)
    item_id = await _create_low_item(hass)
    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]

    for _cycle in range(3):
        await hass.services.async_call(
            DOMAIN,
            "item_set_quantity",
            {"item_id": item_id, "quantity": THRESHOLD + 1},
            blocking=True,
        )
        await hass.async_block_till_done()
        await hass.services.async_call(
            DOMAIN,
            "item_set_quantity",
            {"item_id": item_id, "quantity": LOW_QUANTITY},
            blocking=True,
        )
        await hass.async_block_till_done()

    assert todo_list.summaries == [f"Peanut butter {TIMES}2"]
