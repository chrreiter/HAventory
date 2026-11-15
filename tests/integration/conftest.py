"""pytest configuration for the HAventory integration tests.

These tests drive the integration through a real ``hass``.

The fixtures below are how a test drives the integration the way Home Assistant
and a card do. Each is a factory, so a test arranges storage, patches or bus
listeners first and then asks for the step:

* ``setup_entry`` loads the entry through ``hass.config_entries``, optionally
  over a seeded store.
* ``ws_connect`` opens a WebSocket connection: ``send`` answers with the result
  envelope, and the event frames that arrived on the way are kept on the client.
* ``call_service`` calls a ``haventory.*`` service and returns its response.
* ``fail_next_save`` makes the next save of the integration's store raise, and
  can hold it open while a second write queues behind it.
* ``add_areas`` creates areas in Home Assistant's own registry.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.core import SupportsResponse
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.storage import Store
from pytest_homeassistant_custom_component.common import CLIENT_ID, MockConfigEntry

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant, ServiceResponse

    SetupEntry = Callable[..., Awaitable[MockConfigEntry]]


@pytest.fixture(autouse=True)
def _auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant discover and load ``custom_components/haventory``.

    ``enable_custom_integrations`` is a phacc fixture; wrapping it as autouse
    means every test in this package can set up the integration from a config
    entry without repeating the boilerplate.
    """

    yield


def stored_payload(stored: Repository | Mapping[str, Any]) -> dict[str, Any]:
    """What ``hass_storage`` holds under the integration's key for this dataset.

    A ``Repository`` is written the way the integration's own save writes it. A
    mapping is the store's ``data`` as given, for a payload no save could have
    written: an older schema, a corrupt row, a hand-edited file.
    """

    if isinstance(stored, Repository):
        data: dict[str, Any] = {**stored.export_state(), "schema_version": CURRENT_SCHEMA_VERSION}
    else:
        data = dict(stored)
    return {"version": DomainStore.HA_STORE_VERSION, "key": STORAGE_KEY, "data": data}


@pytest.fixture
def setup_entry(hass: HomeAssistant, hass_storage: dict[str, Any]) -> SetupEntry:
    """Bring the integration up from a config entry, as Home Assistant does.

    ``hass.config_entries.async_setup`` rather than ``async_setup_entry``: only
    the registry path moves the entry through its states, forwards the
    platforms and lets a later reload or unload address it by ``entry_id``.
    The returned entry is what those tests need afterwards.

    ``stored`` seeds the store before setup reads it (see ``stored_payload``).

    Setting up is a step inside a test, not a precondition of one, so this is a
    factory rather than an autouse fixture — several tests fill `hass_storage`,
    monkeypatch a module or listen on the bus before the entry may load.
    """

    async def _setup(
        options: dict | None = None, *, stored: Repository | Mapping[str, Any] | None = None
    ) -> MockConfigEntry:
        if stored is not None:
            hass_storage[STORAGE_KEY] = stored_payload(stored)
        entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory", options=options or {})
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        return entry

    return _setup


class WsClient:
    """One WebSocket connection to the instance, speaking as a card does.

    Home Assistant refuses a message id that is not above the last one on the
    connection, so ids are assigned here. A command's events are written before
    its answer (a surface answers after it announces), so every event a command
    caused is in ``event_frames`` by the time ``send`` returns.
    """

    def __init__(self, socket: Any) -> None:
        self.socket = socket
        self.event_frames: list[dict[str, Any]] = []
        self._last_id = 0

    async def send(self, type_: str, **payload: Any) -> dict[str, Any]:
        """Send one command and return its whole result envelope."""

        self._last_id += 1
        msg_id = self._last_id
        await self.socket.send_json({"id": msg_id, "type": type_, **payload})
        while True:
            frame = await self.socket.receive_json()
            if frame.get("type") == "event":
                self.event_frames.append(frame)
            elif frame.get("id") == msg_id:
                return frame
            else:
                raise AssertionError(f"{type_} (id {msg_id}) was answered by {frame}")

    async def subscribe(self, topic: str, **payload: Any) -> int:
        """Open one subscription, assert it was accepted, and return its id."""

        result = await self.send("haventory/subscribe", topic=topic, **payload)
        assert result["success"] is True, result
        return int(result["id"])

    async def drain(self) -> None:
        """Collect every event already queued, behind a ping's answer.

        For events something other than this connection caused, a service call
        or the clock. Frames arrive in order, so nothing broadcast before the
        ping is still in flight once it answers.
        """

        result = await self.send("haventory/ping")
        assert result["success"] is True, result

    def events(self, topic: str | None = None) -> list[dict[str, Any]]:
        """The ``event`` payloads received so far, oldest first.

        The payload is where ``topic`` and ``action`` live. A test that only
        cares about what follows a step clears ``event_frames`` before it.
        """

        return [
            frame["event"]
            for frame in self.event_frames
            if topic is None or frame["event"].get("topic") == topic
        ]


@pytest.fixture
def ws_connect(
    hass: HomeAssistant, hass_ws_client: Any, hass_admin_user: Any
) -> Callable[[], Awaitable[WsClient]]:
    """Open a WebSocket connection; call it after ``setup_entry``.

    Connecting starts Home Assistant's HTTP app, after which the entry can no
    longer register its views, so the entry loads first. The token is minted
    when the connection opens, so a test that froze the clock first connects
    under it: a token issued after the frozen instant is refused.
    """

    async def _connect() -> WsClient:
        refresh_token = await hass.auth.async_create_refresh_token(hass_admin_user, CLIENT_ID)
        token = hass.auth.async_create_access_token(refresh_token)
        return WsClient(await hass_ws_client(hass, token))

    return _connect


@pytest.fixture
def call_service(hass: HomeAssistant) -> Callable[..., Awaitable[ServiceResponse]]:
    """Call ``haventory.<service>`` and wait for it, returning its response.

    A service that has a response is asked for it; one that has none returns
    ``None``. A refusal raises, as it does for an automation.
    """

    async def _call(service: str, **data: Any) -> ServiceResponse:
        responds = hass.services.supports_response(DOMAIN, service) is not SupportsResponse.NONE
        return await hass.services.async_call(
            DOMAIN, service, data, blocking=True, return_response=responds
        )

    return _call


@pytest.fixture
def fail_next_save(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Make the next save of the integration's store raise; call again to fail more.

    Patched at ``Store.async_save``, the call the integration awaits, and only
    for its own key, so Home Assistant's registries keep saving. ``Store``
    catches the error a full disk raises and only logs it, so the default is a
    bare ``OSError``: what ``Store`` lets through to the integration.

    ``started`` and ``until`` hold that save open, for a test that lines a second
    write up behind it: ``started`` is set as the save begins, and the save waits
    for ``until`` before it raises.
    """

    pending: list[tuple[BaseException, asyncio.Event | None, asyncio.Event | None]] = []
    real_save = Store.async_save

    async def _save(self: Store[Any], data: Any) -> None:
        if self.key == STORAGE_KEY and pending:
            error, started, until = pending.pop(0)
            if started is not None:
                started.set()
            if until is not None:
                await until.wait()
            raise error
        await real_save(self, data)

    monkeypatch.setattr(Store, "async_save", _save)

    def _arm(
        error: BaseException | None = None,
        *,
        started: asyncio.Event | None = None,
        until: asyncio.Event | None = None,
    ) -> None:
        pending.append((error if error is not None else OSError("disk full"), started, until))

    return _arm


@pytest.fixture
def add_areas(hass: HomeAssistant) -> Callable[..., dict[str, str]]:
    """Create areas in Home Assistant's registry; returns each name's area id."""

    def _add(*names: str) -> dict[str, str]:
        registry = ar.async_get(hass)
        return {name: registry.async_create(name).id for name in names}

    return _add
