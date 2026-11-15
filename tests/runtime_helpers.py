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
* :func:`runtime_of` and :func:`repo_of` are the read side, for a test that
  asserts on what setup built.

The stubs these lean on are installed by ``tests/conftest.py`` at import time,
so importing Home Assistant here is safe.
"""

from __future__ import annotations

from typing import Any

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import HAventoryRuntime, find_runtime
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant


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


def runtime_of(hass: HomeAssistant) -> HAventoryRuntime:
    """The installed runtime, asserted present."""

    runtime = find_runtime(hass)
    assert runtime is not None, "no HAventory runtime installed"
    return runtime


def repo_of(hass: HomeAssistant) -> Repository:
    """The installed repository, for a test that asserts on what setup built."""

    return runtime_of(hass).repository
