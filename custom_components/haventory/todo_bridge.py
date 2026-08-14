"""Mirror the low-stock set onto a Home Assistant to-do list.

The bridge converges instead of reacting. Every trigger runs one pass that
compares what is low *right now* against the map of lines this integration put
on the list, and issues only the difference. That is what makes a restart, a
re-fired event, a dropped event and a wholesale import all land on the same
list: nothing remembers "did I already add this" except the map, and the map is
persisted beside the inventory rather than inside it.

Identity on the list is the summary the bridge wrote. `todo.add_item` answers
nothing — Home Assistant registers it with the default `SupportsResponse.NONE`
— so there is no uid to record, and none is needed: `todo.remove_item` and
`todo.update_item` both match their `item` field against a uid *or* a summary.

Nothing here may fail a mutation. By the time a pass runs the inventory write
has already happened, so a to-do list that refuses is a warning, never a
rollback.
"""

from __future__ import annotations

import asyncio
import logging
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

LOGGER = logging.getLogger(__name__)

TODO_DOMAIN = "todo"
SERVICE_ADD_ITEM = "add_item"
SERVICE_REMOVE_ITEM = "remove_item"
SERVICE_UPDATE_ITEM = "update_item"

# The multiplication sign, U+00D7 — not the letter x a line like "Peanut butter
# x2" would carry. It is what the card prints against a quantity, so the list
# and the card read the same way.
MULTIPLICATION_SIGN = "\u00d7"

# `hass.data[DOMAIN]` keys, all entry-scoped — unload empties the bucket and the
# next setup rebuilds them.
_LINKS_KEY = "todo_links"
_STORE_KEY = "todo_link_store"
_LOCK_KEY = "todo_lock"
_ENTITY_KEY = "todo_entity_id"


def summary_for(name: str, quantity: int, threshold: int) -> str:
    """The line the list carries: what to buy, and how many of it.

    The count is the shortfall — how many it takes to reach the threshold —
    floored at 1, because an item with a threshold of 0 is low at a quantity of
    0, and a line asking the household to buy none of something is not one.
    """

    return f"{name} {MULTIPLICATION_SIGN}{max(threshold - quantity, 1)}"


def configured_entity_id(entry: ConfigEntry) -> str:
    """The list this entry mirrors onto, or `""` when the bridge is off."""

    options = getattr(entry, "options", None) or {}
    value = options.get(CONF_TODO_ENTITY_ID, DEFAULT_TODO_ENTITY_ID)
    return value.strip() if isinstance(value, str) else DEFAULT_TODO_ENTITY_ID


def apply_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Record which list the bridge writes to, from the entry's options."""

    hass.data.setdefault(DOMAIN, {})[_ENTITY_KEY] = configured_entity_id(entry)


async def async_setup(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Load the link map, subscribe to the mutation events, run a first pass."""

    bucket = hass.data.setdefault(DOMAIN, {})
    store: Store[dict[str, Any]] = Store(hass, TODO_LINKS_STORAGE_VERSION, TODO_LINKS_STORAGE_KEY)
    bucket[_STORE_KEY] = store
    bucket[_LOCK_KEY] = asyncio.Lock()
    bucket[_LINKS_KEY] = await _async_load_links(store)
    apply_options(hass, entry)

    on_unload = getattr(entry, "async_on_unload", None)
    bus = getattr(hass, "bus", None)
    listen = getattr(bus, "async_listen", None)
    if callable(listen) and callable(on_unload):
        # The public automation surface rather than a hook in every mutation
        # handler. Both events, because neither covers the other: a rename or a
        # quantity edit that leaves an item low fires only `item_changed`, and
        # the bulk path — which passes no item — fires only `low_stock`. A
        # mutation firing both runs the pass twice, and the second finds the
        # list already converged and calls nothing.
        async def _on_inventory_event(_event: Any) -> None:
            await async_reconcile(hass)

        for event_type in (EVENT_ITEM_CHANGED, EVENT_LOW_STOCK):
            on_unload(listen(event_type, _on_inventory_event))

    listen_once = getattr(bus, "async_listen_once", None)
    if getattr(hass, "is_running", True) or not (callable(listen_once) and callable(on_unload)):
        await async_reconcile(hass)
        return

    # A list owned by another integration may not be in the state machine yet
    # while Home Assistant is still starting, and the pass refuses to write to a
    # list it cannot see. Waiting for the start event is what lets a restart
    # converge on its own, without anything in the inventory having to change.
    async def _on_started(_event: Any) -> None:
        await async_reconcile(hass)

    on_unload(listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started))


async def async_reconcile(hass: HomeAssistant) -> None:
    """Bring the configured list in line with what is low right now.

    Never raises. The mutation that triggered the pass is already on disk, and a
    to-do list that refuses must not turn a saved change into a failed one.
    """

    bucket = hass.data.get(DOMAIN)
    if not isinstance(bucket, dict):
        return
    lock = bucket.get(_LOCK_KEY)
    if lock is None:
        # No bridge in this bucket: the entry was torn down between the write
        # and this call, or never set one up.
        return

    try:
        async with lock:
            await _async_reconcile_locked(hass, bucket)
    except Exception:
        LOGGER.exception(
            "Failed to reconcile the to-do list",
            extra={"domain": DOMAIN, "op": "todo_reconcile"},
        )


async def _async_reconcile_locked(hass: HomeAssistant, bucket: dict[str, Any]) -> None:
    """One pass, with the bridge lock held so two triggers cannot interleave."""

    repo = bucket.get("repository")
    links: dict[str, dict[str, str]] | None = bucket.get(_LINKS_KEY)
    if repo is None or links is None:
        return

    entity_id: str = bucket.get(_ENTITY_KEY) or ""
    if not entity_id:
        # Off. The map is kept rather than retracted: clearing the option means
        # "stop managing the list", not "delete what is on it", and keeping it
        # is what lets a household that switches the bridge back on carry on
        # instead of listing everything a second time.
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
        # Compared against the snapshot rather than flagged along the way, in
        # `finally`, so a pass that dies halfway still records the lines it did
        # write — losing them would mean writing them all a second time.
        if links != before:
            await _async_save_links(bucket)


async def _async_retract(
    hass: HomeAssistant,
    links: dict[str, dict[str, str]],
    desired: dict[str, str],
    entity_id: str,
) -> None:
    """Take back every line whose item is no longer low, or is on another list.

    First of the three phases: one item leaving the low-stock set while another
    enters it can produce the same line, and removing after adding would take
    the new one straight back off. A link naming a different list belongs to a
    household that changed the option, and comes off the list it was written to
    before `_async_extend` writes it to the new one.
    """

    for item_id, link in list(links.items()):
        if item_id in desired and link["entity_id"] == entity_id:
            continue
        await _async_remove_line(hass, link)
        del links[item_id]


async def _async_restate(
    hass: HomeAssistant,
    links: dict[str, dict[str, str]],
    desired: dict[str, str],
    entity_id: str,
) -> None:
    """Rewrite a line whose count or item name has moved on.

    The shortfall is what the line is for, so a stale one is wrong rather than
    merely old.
    """

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
    """What the list should carry right now, keyed by item id.

    Read off the low-stock index rather than through `list_items`, which
    paginates — a page limit would silently cap the shopping list.
    """

    desired: dict[str, str] = {}
    for item_id in repo.low_stock_item_ids:
        item = repo.get_item(item_id)
        threshold = item.low_stock_threshold
        if threshold is None:
            continue
        desired[item_id] = summary_for(item.name, item.quantity, threshold)
    return desired


def _list_is_available(hass: HomeAssistant, entity_id: str) -> bool:
    """Whether the configured list is in the state machine and answering.

    Home Assistant does not raise when an entity service names an entity that is
    missing or unavailable — it logs and drops the call — so a pass without this
    check would record a link for a line that was never written.
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


async def _async_remove_line(hass: HomeAssistant, link: dict[str, str]) -> None:
    """Take one line back off the list, and give up the link either way.

    Everything Home Assistant refuses here is permanent — the line was deleted
    by hand, the list cannot delete, the list is gone — and a link held for a
    line that cannot be retracted would stop that item from ever being listed
    again.
    """

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
    """Read the persisted map, keeping only the rows a pass can act on.

    A row missing either half cannot be retracted, and holding it would keep its
    item off the list for good; dropping it costs at most one duplicate line.
    """

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


async def _async_save_links(bucket: dict[str, Any]) -> None:
    """Write the map out. A failed write costs duplicates, never the inventory."""

    store = bucket.get(_STORE_KEY)
    links = bucket.get(_LINKS_KEY)
    if store is None or links is None:
        return

    try:
        await store.async_save({"links": links})
    except Exception:
        LOGGER.warning(
            "Could not save the to-do link map; lines already on the list may be written again",
            extra={"domain": DOMAIN, "op": "todo_links_save"},
            exc_info=True,
        )
