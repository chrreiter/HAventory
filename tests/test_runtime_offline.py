"""Offline tests for the two runtime lookups, and the paths that need each one.

`loaded_runtime` is the client-facing boundary and refuses unless the entry is
`LOADED`; `find_runtime` asks only whether a runtime exists. Everything that runs
*outside* a loaded entry — the teardown flush, the teardown broadcast, a
subscription callback fired by a connection closing long afterwards — has to go
through the second, and this file is what pins that apart.

`tests/integration/test_config_entry.py` covers the half only a real core can
show: that Home Assistant deletes `runtime_data` on unload, and when.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import storage as storage_mod
from custom_components.haventory import subscriptions as subs_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.exceptions import NotLoadedError
from custom_components.haventory.runtime import find_runtime, loaded_runtime
from custom_components.haventory.storage import DomainStore
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, installed_entry, repo_of, unload_runtime
from ws_helpers import RecordingConn, ws_send


def test_loaded_runtime_answers_for_a_loaded_entry() -> None:
    hass = HomeAssistant()
    runtime = install_runtime(hass)

    assert loaded_runtime(hass) is runtime
    assert find_runtime(hass) is runtime


def test_loaded_runtime_refuses_with_no_entry_at_all() -> None:
    """The removed-integration case: nothing to resolve a runtime through."""

    hass = HomeAssistant()

    assert find_runtime(hass) is None
    with pytest.raises(NotLoadedError):
        loaded_runtime(hass)


@pytest.mark.parametrize(
    "state",
    [
        ConfigEntryState.NOT_LOADED,
        ConfigEntryState.SETUP_ERROR,
        ConfigEntryState.SETUP_RETRY,
        ConfigEntryState.UNLOAD_IN_PROGRESS,
    ],
)
def test_only_loaded_counts_for_a_client(state) -> None:
    """Every other state refuses, runtime attached or not.

    A disabled entry keeps its object graph reachable, so "is there a runtime"
    is not the question a command can ask — "is this entry serving" is.
    """

    hass = HomeAssistant()
    runtime = install_runtime(hass, state=state)

    with pytest.raises(NotLoadedError):
        loaded_runtime(hass)
    # ...and the internal lookup still finds it, which is what teardown needs.
    assert find_runtime(hass) is runtime


@pytest.mark.asyncio
async def test_the_final_flush_writes_while_the_entry_is_not_loaded() -> None:
    """The flush at teardown goes through the lookup that ignores entry state.

    Home Assistant marks an entry `UNLOAD_IN_PROGRESS` *before* calling
    `async_unload_entry`, so the teardown flush runs against an entry that is no
    longer loaded. Routed through the client-facing lookup it would refuse, and
    whatever was still unsaved would be gone with no error anybody sees.
    """

    hass = HomeAssistant()
    saved: list[dict] = []

    class _RecordingStore(DomainStore):
        async def async_save(self, payload: dict) -> None:  # type: ignore[override]
            saved.append(payload)

    install_runtime(hass, store=_RecordingStore(hass))
    repo_of(hass).create_item({"name": "Unsaved"})  # type: ignore[arg-type]

    installed_entry(hass).state = ConfigEntryState.UNLOAD_IN_PROGRESS
    await storage_mod.async_persist_repo(hass)

    assert [item["name"] for item in saved[-1]["items"].values()] == ["Unsaved"]


@pytest.mark.asyncio
async def test_a_persist_after_the_runtime_is_gone_refuses_rather_than_writing() -> None:
    """No runtime is a refusal, not a silent write of nothing."""

    hass = HomeAssistant()
    install_runtime(hass)
    unload_runtime(hass)

    with pytest.raises(NotLoadedError):
        await storage_mod.async_persist_repo(hass)


@pytest.mark.asyncio
async def test_a_close_callback_after_teardown_is_a_no_op() -> None:
    """A connection outlives the entry, and its teardown must not raise.

    The callbacks are bound to the connection, so they fire whenever it closes —
    which can be long after the entry that served the subscription went away.
    """

    hass = HomeAssistant()
    install_runtime(hass)
    ws_mod.setup(hass)
    conn = RecordingConn()

    assert (await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="items"))["success"]
    assert subs_mod.open_subscriptions(hass)

    unload_runtime(hass)

    # Both callbacks, on a hass with no runtime left to look one up in.
    subs_mod._drop_subscription(hass, conn, 1)
    subs_mod._cleanup_subscriptions_for_conn(hass, conn)

    assert subs_mod.open_subscriptions(hass) == {}


@pytest.mark.asyncio
async def test_a_broadcast_after_teardown_reaches_nobody_and_raises_nothing() -> None:
    """The other teardown-adjacent path through the subscription registry."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_mod.setup(hass)
    conn = RecordingConn()
    assert (await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="items"))["success"]
    conn.messages.clear()

    unload_runtime(hass)
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)

    assert conn.events() == []
