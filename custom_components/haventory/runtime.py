"""What one loaded config entry owns, and how any module reaches it.

Home Assistant hands every config entry a `runtime_data` slot: setup fills it,
Home Assistant clears it on unload, and a typed alias makes every read a checked
one. HAventory keeps its repository, its store, its rate limiter and the rest of
its per-entry state there rather than in the shared `hass.data[DOMAIN]` dict.

**Two lookups, and the difference matters.** `loaded_runtime` refuses unless the
entry is `LOADED` — it is the client-facing boundary, the thing that makes a
WebSocket command a dashboard left open still holds refuse once the entry is
gone. `find_runtime` asks only whether a runtime exists. Teardown runs while the
entry is *not* loaded (Home Assistant sets `UNLOAD_IN_PROGRESS` before calling
`async_unload_entry`, and clears `runtime_data` only after it returns), so the
final flush, the teardown broadcast and the subscription close callbacks all go
through `find_runtime`. Routing any of them through the loaded check would drop
the last write, or leave a subscriber never told its topics had stopped.

Single-instance (`single_config_entry` in the manifest, enforced again in the
config flow), so "the entry" is `async_entries(DOMAIN)[0]` or nothing at all.

What stays in `hass.data[DOMAIN]` is what outlives an entry: the flags recording
an aiohttp route, a frontend module URL or a sidebar panel, none of which Home
Assistant can hand back on unload.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypedDict

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .exceptions import NotLoadedError
from .rate_limit import RateLimiter
from .repository import Repository

if TYPE_CHECKING:
    from homeassistant.helpers.storage import Store

    # Imported for typing only: `storage.py` reads the runtime, so a module-scope
    # import here would be a cycle.
    from .storage import DomainStore


class Subscription(TypedDict, total=False):
    """One open `haventory/subscribe`, as the broadcaster matches it.

    Lives here rather than in `subscriptions.py` because the registry holding
    these is a field of the runtime, and typing that field from the module that
    reads the registry would be a cycle.
    """

    topic: str
    location_id: str | None
    location_ids: list[str]
    area_id: str | None
    include_subtree: bool
    inspection_overdue_only: bool


@dataclass(slots=True)
class TodoBridgeState:
    """The shopping-list bridge's own state, scoped to the entry like the rest.

    Its `Store` is a second file beside the inventory's — the link map survives a
    restart, so a line the household already ticked off is not written back.
    """

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
    rate_limiter: RateLimiter
    # Serializes every write to the one store file. Per entry, because it guards
    # that entry's store and nothing else.
    persist_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    subscriptions: dict[Any, dict[int, Subscription]] = field(default_factory=dict)
    # Which items were low when the last mutation was announced. Seeded at setup
    # so a restart re-announces nothing, and diffed after every mutation.
    low_stock_ids: frozenset[str] = frozenset()
    todo: TodoBridgeState = field(default_factory=TodoBridgeState)


# A `type` statement rather than an assignment: its value is evaluated lazily, so
# `ConfigEntry[HAventoryRuntime]` is never subscripted at import time. That keeps
# it working against a stub `ConfigEntry` as well as the real generic one.
type HAventoryConfigEntry = ConfigEntry[HAventoryRuntime]


def find_entry(hass: HomeAssistant) -> HAventoryConfigEntry | None:
    """The one config entry, in whatever state it is in."""

    config_entries = getattr(hass, "config_entries", None)
    if config_entries is None:
        return None
    entries = config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def find_runtime(hass: HomeAssistant) -> HAventoryRuntime | None:
    """The runtime if one exists, whatever state its entry is in.

    For the paths that run outside a loaded entry: the teardown flush, the
    teardown broadcast, and the subscription callbacks a closing connection fires
    long after the entry went. See the module docstring for why they must not go
    through `loaded_runtime`.
    """

    entry = find_entry(hass)
    if entry is None:
        return None
    runtime = getattr(entry, "runtime_data", None)
    return runtime if isinstance(runtime, HAventoryRuntime) else None


def loaded_runtime(hass: HomeAssistant) -> HAventoryRuntime:
    """The runtime of a `LOADED` entry, or `NotLoadedError`.

    The client-facing boundary. Home Assistant cannot unregister a WebSocket
    command or a service, so both go on listening after the entry is unloaded,
    disabled or removed; this refusal is what makes them answer the contract's
    `storage_error` instead of serving state nothing owns.
    """

    entry = find_entry(hass)
    if entry is None:
        raise NotLoadedError("no HAventory config entry; add the integration")
    if getattr(entry, "state", None) is not ConfigEntryState.LOADED:
        raise NotLoadedError("HAventory config entry is not loaded; run integration setup")
    runtime = getattr(entry, "runtime_data", None)
    if not isinstance(runtime, HAventoryRuntime):
        raise NotLoadedError("HAventory runtime not initialized; run integration setup")
    return runtime
