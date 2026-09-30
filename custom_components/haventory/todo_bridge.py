"""Mirror the low-stock set onto a Home Assistant to-do list.

The bridge converges instead of reacting: every trigger runs one pass that
compares what is low right now against the persisted map of lines this
integration wrote, and issues only the difference.

Identity on the list is the summary the bridge wrote. `todo.add_item` returns no
uid, and `todo.remove_item` and `todo.update_item` match a uid *or* a summary.

Nothing here may fail a mutation: the inventory write has already happened, so
a to-do list that refuses is a warning, never a rollback.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store

from .const import (
    CONF_TODO_ENTITY_ID,
    DEFAULT_TODO_ENTITY_ID,
    DOMAIN,
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    TODO_LINKS_STORAGE_KEY,
    TODO_LINKS_STORAGE_VERSION,
)
from .logs import context_logger
from .runtime import HAventoryRuntime, find_runtime

LOGGER = context_logger(__name__)

TODO_DOMAIN = "todo"
SERVICE_ADD_ITEM = "add_item"
SERVICE_REMOVE_ITEM = "remove_item"
SERVICE_UPDATE_ITEM = "update_item"

# `TodoListEntityFeature.DELETE_TODO_ITEM` as the bit a state carries and as the
# name an entity selector's filter takes. Spelled out because the offline suite
# has no `homeassistant.components.todo`.
TODO_FEATURE_DELETE_ITEM = 2
TODO_FEATURE_DELETE_ITEM_NAME = "todo.TodoListEntityFeature.DELETE_TODO_ITEM"

# U+00D7, what the card prints against a quantity, so the two read the same.
MULTIPLICATION_SIGN = "\u00d7"


def summary_for(name: str, quantity: int, threshold: int) -> str:
    """The line the list carries: the name and the shortfall, floored at 1.

    A threshold of 0 is low at a quantity of 0, which would otherwise ask for none.
    """

    return f"{name} {MULTIPLICATION_SIGN}{max(threshold - quantity, 1)}"


def clean_todo_entity_id(value: Any) -> str:
    """The chosen list as an entity id, or `""` for off (a cleared selector sends none)."""

    return value.strip() if isinstance(value, str) else DEFAULT_TODO_ENTITY_ID


def apply_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Record which list the bridge writes to, from the entry's options."""

    runtime = find_runtime(hass)
    if runtime is None:
        return
    runtime.todo.entity_id = clean_todo_entity_id(entry.options.get(CONF_TODO_ENTITY_ID))


async def async_setup(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Load the link map, subscribe to the mutation events, run a first pass."""

    runtime = find_runtime(hass)
    if runtime is None:
        return
    store: Store[dict[str, Any]] = Store(hass, TODO_LINKS_STORAGE_VERSION, TODO_LINKS_STORAGE_KEY)
    runtime.todo.store = store
    runtime.todo.links = await _async_load_links(store)
    apply_options(hass, entry)

    # Both events, because neither covers the other: an edit that leaves an item
    # low fires only `item_changed`, and the bulk path fires only `low_stock`.
    async def _on_inventory_event(_event: Any) -> None:
        await async_reconcile(hass)

    for event_type in (EVENT_ITEM_CHANGED, EVENT_LOW_STOCK):
        entry.async_on_unload(hass.bus.async_listen(event_type, _on_inventory_event))

    if hass.is_running:
        await async_reconcile(hass)
        return

    # Another integration's list may not be in the state machine until Home
    # Assistant has started. `async_listen`, not `async_listen_once`: unloading
    # after a one-time listener fired logs an ERROR for the stale unsubscribe.
    remove_started: Callable[[], None] | None = None

    def _stop_waiting_for_start() -> None:
        nonlocal remove_started
        if remove_started is not None:
            remove_started()
            remove_started = None

    async def _on_started(_event: Any) -> None:
        _stop_waiting_for_start()
        await async_reconcile(hass)

    remove_started = hass.bus.async_listen(EVENT_HOMEASSISTANT_STARTED, _on_started)
    entry.async_on_unload(_stop_waiting_for_start)


async def async_reconcile(hass: HomeAssistant) -> None:
    """Bring the configured list in line with what is low right now.

    Never raises. The mutation that triggered the pass is already on disk, and a
    to-do list that refuses must not turn a saved change into a failed one.
    """

    runtime = find_runtime(hass)
    if runtime is None or runtime.todo.store is None:
        return

    try:
        async with runtime.todo.lock:
            await _async_reconcile_locked(hass, runtime)
    except Exception:
        LOGGER.exception(
            "Failed to reconcile the to-do list",
            extra={"domain": DOMAIN, "op": "todo_reconcile"},
        )


async def _async_reconcile_locked(hass: HomeAssistant, runtime: HAventoryRuntime) -> None:
    """One pass, with the bridge lock held so two triggers cannot interleave."""

    repo = runtime.repository
    links = runtime.todo.links
    entity_id = runtime.todo.entity_id
    if not entity_id:
        # Off. The map is kept: turning the bridge off does not clear the list.
        return

    if not _list_is_available(hass, entity_id):
        LOGGER.warning(
            "The configured to-do list is unavailable; leaving it untouched",
            extra={"domain": DOMAIN, "op": "todo_reconcile", "entity_id": entity_id},
        )
        return

    desired = _desired_summaries(repo)
    before = {item_id: dict(link) for item_id, link in links.items()}
    try:
        await _async_retract(hass, links, desired, entity_id)
        await _async_restate(hass, links, desired, entity_id)
        await _async_extend(hass, links, desired, entity_id)
    finally:
        # In `finally`, so a pass that dies halfway still records what it wrote.
        if links != before:
            await _async_save_links(runtime)


async def _async_retract(
    hass: HomeAssistant,
    links: dict[str, dict[str, str]],
    desired: dict[str, str],
    entity_id: str,
) -> None:
    """Take back every line whose item is no longer low, or is on another list.

    First, because an item leaving the set and another entering it can produce
    the same line, and removing after adding would take the new one off again.
    """

    for item_id, link in list(links.items()):
        if item_id in desired and link["entity_id"] == entity_id:
            continue
        if await _async_remove_line(hass, link):
            del links[item_id]


async def _async_restate(
    hass: HomeAssistant,
    links: dict[str, dict[str, str]],
    desired: dict[str, str],
    entity_id: str,
) -> None:
    """Rewrite a line whose count or item name has moved on."""

    for item_id, summary in desired.items():
        link = links.get(item_id)
        if link is None or link["summary"] == summary:
            continue
        if await _async_rename_line(hass, entity_id, link["summary"], summary):
            link["summary"] = summary


async def _async_extend(
    hass: HomeAssistant,
    links: dict[str, dict[str, str]],
    desired: dict[str, str],
    entity_id: str,
) -> None:
    """Put a line on the list for every low item that has none."""

    for item_id, summary in desired.items():
        if item_id in links:
            continue
        if await _async_add_line(hass, entity_id, summary):
            links[item_id] = {"entity_id": entity_id, "summary": summary}


def _desired_summaries(repo: Any) -> dict[str, str]:
    """What the list should carry right now, keyed by item id (not paginated)."""

    desired: dict[str, str] = {}
    for item_id in repo.low_stock_item_ids:
        item = repo.get_item(item_id)
        threshold = item.low_stock_threshold
        if threshold is None:
            continue
        desired[item_id] = summary_for(item.name, item.quantity, threshold)
    return desired


def _list_can_delete(hass: HomeAssistant, entity_id: str) -> bool:
    """Whether the list can delete its lines; only one that says it cannot answers no.

    The options picker hides such a list, but an option set through the API can
    still name one.
    """

    state = hass.states.get(entity_id)
    if state is None:
        return True
    features = state.attributes.get("supported_features")
    return features is None or bool(int(features) & TODO_FEATURE_DELETE_ITEM)


def _list_is_available(hass: HomeAssistant, entity_id: str) -> bool:
    """Whether the configured list is in the state machine and answering.

    A service call naming a missing or unavailable entity is dropped, not raised,
    so without this a pass would link a line that was never written.
    """

    state = hass.states.get(entity_id)
    return state is not None and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)


async def _async_add_line(hass: HomeAssistant, entity_id: str, summary: str) -> bool:
    """Put one line on the list. False leaves it unlinked, so the next pass retries."""

    try:
        await hass.services.async_call(
            TODO_DOMAIN,
            SERVICE_ADD_ITEM,
            {"entity_id": entity_id, "item": summary},
            blocking=True,
        )
    except HomeAssistantError:
        LOGGER.warning(
            "Could not add a line to the to-do list; the next change retries it",
            extra={
                "domain": DOMAIN,
                "op": "todo_add",
                "entity_id": entity_id,
                "summary": summary,
            },
            exc_info=True,
        )
        return False
    return True


async def _async_remove_line(hass: HomeAssistant, link: dict[str, str]) -> bool:
    """Take one line back off the list. False keeps the link.

    A refused removal gives the link up (the line was deleted by hand, or the
    list is gone), or the item could never be listed again. A list that cannot
    delete at all keeps it, so the next crossing restates that one line instead
    of adding a duplicate.
    """

    if not _list_can_delete(hass, link["entity_id"]):
        LOGGER.warning(
            "The to-do list cannot delete its own lines, so this one stays on it; "
            "keeping the link so the next crossing restates it rather than repeating it",
            extra={
                "domain": DOMAIN,
                "op": "todo_remove",
                "entity_id": link["entity_id"],
                "summary": link["summary"],
            },
        )
        return False

    try:
        await hass.services.async_call(
            TODO_DOMAIN,
            SERVICE_REMOVE_ITEM,
            {"entity_id": link["entity_id"], "item": link["summary"]},
            blocking=True,
        )
    except HomeAssistantError:
        LOGGER.warning(
            "Could not remove a line from the to-do list; dropping the link and "
            "leaving the line to be cleared by hand",
            extra={
                "domain": DOMAIN,
                "op": "todo_remove",
                "entity_id": link["entity_id"],
                "summary": link["summary"],
            },
            exc_info=True,
        )
    return True


async def _async_rename_line(
    hass: HomeAssistant, entity_id: str, previous: str, summary: str
) -> bool:
    """Restate a line in place. False keeps the link on the text already there."""

    try:
        await hass.services.async_call(
            TODO_DOMAIN,
            SERVICE_UPDATE_ITEM,
            {"entity_id": entity_id, "item": previous, "rename": summary},
            blocking=True,
        )
    except HomeAssistantError:
        LOGGER.warning(
            "Could not restate a line on the to-do list; it keeps the count it was written with",
            extra={
                "domain": DOMAIN,
                "op": "todo_rename",
                "entity_id": entity_id,
                "summary": summary,
            },
            exc_info=True,
        )
        return False
    return True


async def _async_load_links(store: Store[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Read the persisted map, keeping only rows with both an entity id and a summary."""

    try:
        payload = await store.async_load()
    except Exception:
        LOGGER.warning(
            "Could not read the to-do link map; starting from an empty one",
            extra={"domain": DOMAIN, "op": "todo_links_load"},
            exc_info=True,
        )
        return {}

    links: dict[str, dict[str, str]] = {}
    raw = payload.get("links") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        return links
    for item_id, link in raw.items():
        if not isinstance(item_id, str) or not isinstance(link, dict):
            continue
        entity_id = link.get("entity_id")
        summary = link.get("summary")
        if isinstance(entity_id, str) and entity_id and isinstance(summary, str) and summary:
            links[item_id] = {"entity_id": entity_id, "summary": summary}
    return links


async def _async_save_links(runtime: HAventoryRuntime) -> None:
    """Write the map out. A failed write costs duplicates, never the inventory."""

    store = runtime.todo.store
    if store is None:
        return

    try:
        await store.async_save({"links": runtime.todo.links})
    except Exception:
        LOGGER.warning(
            "Could not save the to-do link map; lines already on the list may be written again",
            extra={"domain": DOMAIN, "op": "todo_links_save"},
            exc_info=True,
        )
