"""One way for an offline test to say "an HAventory entry is loaded".

Home Assistant holds an integration's runtime on the config entry, and every
module in `custom_components/haventory` resolves it through
`hass.config_entries` (see `haventory/runtime.py`). So a test that wants a
working HAventory registers an entry with a runtime attached, rather than
writing keys into `hass.data[DOMAIN]` — which is neither where the code looks
nor a shape real Home Assistant has.

* :func:`install_runtime` builds the runtime, attaches it to a stub entry and
  registers that entry. Defaults are an empty repository and a real
  `DomainStore`, which is what almost every test wants.
* ``ws=True`` also registers the WebSocket commands, which setup does in the
  same breath; :func:`ws_hass` is the whole opening move — a stub Home
  Assistant with an entry loaded and the commands registered — for the many
  files whose every test starts there.
* ``state=`` is what makes the refusals testable: an entry that is not `LOADED`
  is exactly what a WebSocket command or a `haventory.*` service meets after an
  unload, a disable or a removal, and `loaded_runtime` refuses on it.
* :func:`unload_runtime` takes the runtime back the way Home Assistant does —
  by **deleting** the attribute, not setting it to None, which is what every
  ``getattr(entry, "runtime_data", None)`` in the integration is written
  against.
* :func:`runtime_of` and :func:`repo_of` are the read side, for a test that
  asserts on what setup built.
* :data:`RETIRED_RATE_LIMIT_OPTIONS` is the options an entry that once enabled
  the WebSocket rate limiter still carries, for the tests that hold setup and
  the options flow to ignoring them.

The stubs these lean on are installed by ``tests/conftest.py`` at import time,
so importing Home Assistant here is safe.
"""

from __future__ import annotations

from typing import Any

from custom_components.haventory import (
    async_remove_entry,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import HAventoryRuntime, find_runtime
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant

# Written as literals rather than imported: no module defines these names any
# more, and what an upgraded entry carries is decided by the release that wrote
# it. The values are the tightest a household could have chosen — one command
# per connection — so a test using them fails loudly if anything reads them.
RETIRED_RATE_LIMIT_OPTIONS: dict[str, Any] = {
    "rate_limit_enabled": True,
    "rate_limit_commands_per_second": 0.1,
    "rate_limit_commands_burst": 1.0,
    "rate_limit_global_commands_per_second": 0.1,
    "rate_limit_global_commands_burst": 1.0,
    "rate_limit_events_per_second": 0.1,
    "rate_limit_events_burst": 1.0,
    "rate_limit_global_events_per_second": 0.1,
    "rate_limit_global_events_burst": 1.0,
}


def install_runtime(  # noqa: PLR0913 - one keyword per runtime field, all optional
    hass: HomeAssistant,
    *,
    repository: Repository | None = None,
    store: DomainStore | None = None,
    card_title: str = "HAventory",
    quick_filters: list[str] | None = None,
    options: dict[str, Any] | None = None,
    state: Any = None,
    entry: Any = None,
    ws: bool = False,
) -> HAventoryRuntime:
    """Register one HAventory entry carrying a runtime, and return the runtime."""

    runtime = HAventoryRuntime(
        store=store if store is not None else DomainStore(hass),
        repository=repository if repository is not None else Repository(),
        card_title=card_title,
        quick_filters=quick_filters,
    )
    if entry is None:
        entry = ConfigEntry(options=dict(options or {}))
    entry.state = state if state is not None else ConfigEntryState.LOADED
    entry.runtime_data = runtime
    hass.data.setdefault(DOMAIN, {})
    hass.config_entries.add(entry)
    if ws:
        ws_setup(hass)
    return runtime


def ws_hass(**runtime_fields: Any) -> HomeAssistant:
    """A Home Assistant with an entry loaded and the WebSocket commands registered.

    Where every `ws_send` test starts. The keywords are `install_runtime`'s, so
    a test that needs its own repository or store names it here.
    """

    hass = HomeAssistant()
    install_runtime(hass, ws=True, **runtime_fields)
    return hass


def installed_entry(hass: HomeAssistant) -> Any:
    """The registered entry, for a test that needs to move its state."""

    entries = hass.config_entries.async_entries(DOMAIN)
    assert entries, "no HAventory config entry registered; call install_runtime first"
    return entries[0]


def unload_runtime(hass: HomeAssistant) -> None:
    """Take the runtime back the way Home Assistant does on unload."""

    for entry in hass.config_entries.async_entries(DOMAIN):
        entry.state = ConfigEntryState.NOT_LOADED
        if hasattr(entry, "runtime_data"):
            del entry.runtime_data


def runtime_of(hass: HomeAssistant) -> HAventoryRuntime:
    """The installed runtime, asserted present."""

    runtime = find_runtime(hass)
    assert runtime is not None, "no HAventory runtime installed"
    return runtime


def repo_of(hass: HomeAssistant) -> Repository:
    """The installed repository, for a test that asserts on what setup built."""

    return runtime_of(hass).repository


async def setup_entry(hass: HomeAssistant, entry: Any = None, **kwargs: Any) -> Any:
    """Run the integration's real setup the way Home Assistant runs it.

    Home Assistant registers the entry, moves it through `SETUP_IN_PROGRESS` and
    marks it `LOADED` only once `async_setup_entry` returns True. The runtime
    lookup reads both the registry and the state, so a test that calls
    `async_setup_entry` directly on a loose entry gets an integration that set
    itself up and cannot find its own runtime.
    """

    if entry is None:
        entry = ConfigEntry(**kwargs)
    entry.state = ConfigEntryState.SETUP_IN_PROGRESS
    hass.config_entries.add(entry)
    ok = await async_setup_entry(hass, entry)
    entry.state = ConfigEntryState.LOADED if ok else ConfigEntryState.SETUP_ERROR
    assert ok is True, "async_setup_entry did not report success"
    return entry


async def unload_entry(hass: HomeAssistant, entry: Any) -> bool:
    """Unload it the way Home Assistant does, state transitions included.

    `UNLOAD_IN_PROGRESS` **before** the call and `runtime_data` deleted only
    **after** it — which is what lets teardown flush and lets the loaded check
    refuse, at the same moment.
    """

    entry.state = ConfigEntryState.UNLOAD_IN_PROGRESS
    unloaded = await async_unload_entry(hass, entry)
    if unloaded:
        # What `entry.async_on_unload` collected during setup — the options
        # listener, the bridge's bus subscriptions, the midnight tick. Home
        # Assistant runs them itself at exactly this point, and a test that
        # skipped them would show every one of them still live after an unload.
        run_on_unload = getattr(entry, "run_on_unload", None)
        if callable(run_on_unload):
            run_on_unload()
    if unloaded and hasattr(entry, "runtime_data"):
        del entry.runtime_data
    entry.state = ConfigEntryState.NOT_LOADED if unloaded else ConfigEntryState.FAILED_UNLOAD
    return unloaded


async def remove_entry(hass: HomeAssistant, entry: Any) -> None:
    """Remove it the way Home Assistant does: unload first, then remove."""

    if getattr(entry, "state", None) is ConfigEntryState.LOADED:
        await unload_entry(hass, entry)
    await async_remove_entry(hass, entry)
    hass.config_entries.remove(entry)
