"""What one loaded config entry owns, and how any module reaches it.

Per-entry state lives on the entry's `runtime_data`, which Home Assistant clears
on unload. `hass.data[DOMAIN]` keeps only the registrations that outlive an entry.

**Two lookups, and the difference matters.** `loaded_runtime` refuses unless the
entry is `LOADED`: it is the client-facing boundary. `find_runtime` asks only
whether a runtime exists. Teardown runs while the entry is *not* loaded (Home
Assistant sets `UNLOAD_IN_PROGRESS` before `async_unload_entry` and clears
`runtime_data` after it), so the final flush, the teardown broadcast and the
subscription close callbacks go through `find_runtime`; the loaded check would
drop the last write.

Single-instance, so "the entry" is `async_entries(DOMAIN)[0]` or nothing.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypedDict

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .exceptions import NotLoadedError
from .repository import Repository

if TYPE_CHECKING:
    from homeassistant.helpers.storage import Store

    # Imported for typing only: `storage.py` reads the runtime, so a module-scope
    # import here would be a cycle.
    from .storage import DomainStore


class Subscription(TypedDict, total=False):
    """One open `haventory/subscribe`; here because typing it in `subscriptions.py` is a cycle."""

    topic: str
    location_id: str | None
    location_ids: list[str]
    area_id: str | None
    include_subtree: bool
    inspection_overdue_only: bool


@dataclass(slots=True)
class TodoBridgeState:
    """The shopping-list bridge's state; its `Store` is a second file beside the inventory's."""

    entity_id: str = ""
    links: dict[str, dict[str, str]] = field(default_factory=dict)
    store: Store[dict[str, Any]] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(slots=True)
class HAventoryRuntime:
    """Everything setup builds and unload gives up, in one typed place."""

    store: DomainStore
    repository: Repository
    card_title: str
    quick_filters: list[str] | None
    # Serializes every write to the one store file. Per entry, because it guards
    # that entry's store and nothing else.
    persist_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscriptions: dict[Any, dict[int, Subscription]] = field(default_factory=dict)
    # Which items were low when the last mutation was announced. Seeded at setup
    # so a restart re-announces nothing, and diffed after every mutation.
    low_stock_ids: frozenset[str] = frozenset()
    todo: TodoBridgeState = field(default_factory=TodoBridgeState)


# A `type` statement is evaluated lazily, so a non-generic stub `ConfigEntry` works too.
type HAventoryConfigEntry = ConfigEntry[HAventoryRuntime]


def find_entry(hass: HomeAssistant) -> HAventoryConfigEntry | None:
    """The one config entry, in whatever state it is in."""

    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def find_runtime(hass: HomeAssistant) -> HAventoryRuntime | None:
    """The runtime if one exists, whatever state its entry is in (see the module docstring)."""

    entry = find_entry(hass)
    if entry is None:
        return None
    runtime = getattr(entry, "runtime_data", None)
    return runtime if isinstance(runtime, HAventoryRuntime) else None


def loaded_runtime(hass: HomeAssistant) -> HAventoryRuntime:
    """The runtime of a `LOADED` entry, or `NotLoadedError`.

    Home Assistant cannot unregister a WebSocket command or a service, so this
    refusal is what makes them answer `storage_error` once the entry is gone.
    """

    entry = find_entry(hass)
    if entry is None:
        raise NotLoadedError("no HAventory config entry; add the integration")
    if entry.state is not ConfigEntryState.LOADED:
        raise NotLoadedError("HAventory config entry is not loaded; run integration setup")
    runtime = getattr(entry, "runtime_data", None)
    if not isinstance(runtime, HAventoryRuntime):
        raise NotLoadedError("HAventory runtime not initialized; run integration setup")
    return runtime
