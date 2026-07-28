"""Test configuration shared by both HAventory test modes.

HAventory has two, deliberately separate, backend test modes:

* **Offline (fast, default).** Home Assistant is *stubbed* — the fake modules
  installed below stand in for the real ``homeassistant`` package so the suite
  runs in milliseconds with no HA install. Invoke with plugin autoload disabled::

      PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest -q

* **Integration (opt-in).** The integration runs inside a *real* in-process
  Home Assistant core provided by ``pytest-homeassistant-custom-component``
  (phacc), with plugin autoload ENABLED. Lives under ``tests/integration/`` and
  is invoked explicitly (see ``tests/integration/conftest.py``)::

      pytest -o asyncio_mode=auto tests/integration

This module must serve the offline suite without ever leaking its HA stubs into
the integration suite. It picks the mode from two signals: whether a real
``homeassistant`` package is importable, and whether plugin autoload is disabled.
Integration mode = real HA present *and* autoload enabled; every other case is
the offline suite and gets the stubs. As a result:

* the offline suite is byte-for-byte unchanged (stubs install exactly as before
  whenever the real package is absent, which is always true in the HA-free
  offline environment); and
* the phacc suite never sees the stubs (real HA is present and autoload is on),
  and is never collected by the offline run (``collect_ignore`` below).

It also ensures sockets are enabled when pytest-socket is auto-loaded by IDEs
(required on Windows where creating the event loop uses ``socket.socket``) and,
on Windows, makes pytest-asyncio hand out a selector-based event loop to avoid
ProactorEventLoop self-pipe issues when sockets are tampered with by plugins.
That's done via the ``pytest_asyncio_loop_factories`` hook rather than
``asyncio.set_event_loop_policy``/``WindowsSelectorEventLoopPolicy`` — both are
deprecated since Python 3.14 and slated for removal in 3.16.
"""

import asyncio
import os
import platform
import sys
import types
from pathlib import Path

# Ensure project root is on sys.path for module imports (both modes).
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_AUTOLOAD_DISABLED = os.environ.get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1"

# The offline environment never installs Home Assistant (it is stubbed); the
# integration environment (phacc) does. Use that as the primary discriminator.
try:
    import homeassistant as _real_homeassistant  # noqa: F401

    _REAL_HA_PRESENT = True
except ModuleNotFoundError:
    _REAL_HA_PRESENT = False

# Only skip the stubs when we are unambiguously in the phacc integration mode:
# a real HA core is importable AND plugin autoload is enabled. Anything else is
# the offline suite (including offline runs that happen inside an HA-equipped
# venv, which still expect the stubs).
_INTEGRATION_MODE = _REAL_HA_PRESENT and not _AUTOLOAD_DISABLED


def _install_offline_ha_stubs() -> None:  # noqa: PLR0915 - flat, intentional stub registrations
    """Install the minimal Home Assistant stub modules used by the offline suite."""

    def _ensure_stub(mod_name: str) -> types.ModuleType:
        mod = types.ModuleType(mod_name)
        sys.modules[mod_name] = mod
        return mod

    # Root module
    _ensure_stub("homeassistant")

    # homeassistant.const
    ha_const = types.ModuleType("homeassistant.const")
    ha_const.Platform = types.SimpleNamespace(SENSOR="sensor", CALENDAR="calendar")
    sys.modules["homeassistant.const"] = ha_const

    # homeassistant.core
    ha_core = types.ModuleType("homeassistant.core")

    class HomeAssistant:  # type: ignore[override]
        def __init__(self) -> None:
            self.data = {}

        def async_create_background_task(self, target, name, eager_start=True):
            """Stand in for HA's tracked-task helper; the real one also cancels on shutdown."""
            return asyncio.create_task(target, name=name)

    ha_core.HomeAssistant = HomeAssistant
    sys.modules["homeassistant.core"] = ha_core

    # homeassistant.exceptions
    ha_exceptions = types.ModuleType("homeassistant.exceptions")

    class HomeAssistantError(Exception):  # type: ignore[override]
        pass

    class ConfigEntryNotReady(HomeAssistantError):  # type: ignore[override]
        pass

    class ConfigEntryError(HomeAssistantError):  # type: ignore[override]
        pass

    ha_exceptions.HomeAssistantError = HomeAssistantError
    ha_exceptions.ConfigEntryNotReady = ConfigEntryNotReady
    ha_exceptions.ConfigEntryError = ConfigEntryError
    sys.modules["homeassistant.exceptions"] = ha_exceptions

    # homeassistant.config_entries
    ha_config_entries = types.ModuleType("homeassistant.config_entries")

    class ConfigEntry:  # type: ignore[override]
        def __init__(self, *, options: dict | None = None) -> None:
            self.options: dict = dict(options or {})
            self._update_listeners: list = []
            self._on_unload: list = []

        def add_update_listener(self, listener):
            self._update_listeners.append(listener)

            def _remove() -> None:
                if listener in self._update_listeners:
                    self._update_listeners.remove(listener)

            return _remove

        def async_on_unload(self, func):
            self._on_unload.append(func)
            return func

    class ConfigFlow:  # type: ignore[override]
        def __init_subclass__(cls, **kwargs):  # accept e.g. domain=...
            return

        # Minimal helpers to satisfy integration code if used in tests later
        def async_abort(self, *, reason: str):
            return {"type": "abort", "reason": reason}

        def async_create_entry(self, *, title: str, data: dict):
            return {"type": "create_entry", "title": title, "data": data}

    class OptionsFlow:  # type: ignore[override]
        # The real OptionsFlow resolves config_entry via hass; tests assign it.
        config_entry: ConfigEntry | None = None

        def async_create_entry(self, *, title: str, data: dict):
            return {"type": "create_entry", "title": title, "data": data}

        def async_show_form(self, *, step_id: str, data_schema=None):
            return {"type": "form", "step_id": step_id, "data_schema": data_schema}

    ha_config_entries.ConfigEntry = ConfigEntry
    ha_config_entries.ConfigFlow = ConfigFlow
    ha_config_entries.OptionsFlow = OptionsFlow
    sys.modules["homeassistant.config_entries"] = ha_config_entries

    # homeassistant.data_entry_flow
    ha_data_entry_flow = types.ModuleType("homeassistant.data_entry_flow")

    class FlowResult(dict):  # type: ignore[override]
        pass

    sys.modules["homeassistant.data_entry_flow"] = ha_data_entry_flow
    ha_data_entry_flow.FlowResult = FlowResult

    # homeassistant.helpers and homeassistant.helpers.storage
    ha_helpers = types.ModuleType("homeassistant.helpers")
    sys.modules["homeassistant.helpers"] = ha_helpers

    ha_helpers_cv = types.ModuleType("homeassistant.helpers.config_validation")

    def empty_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    def platform_only_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    def config_entry_only_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    ha_helpers_cv.empty_config_schema = empty_config_schema
    ha_helpers_cv.platform_only_config_schema = platform_only_config_schema
    ha_helpers_cv.config_entry_only_config_schema = config_entry_only_config_schema
    sys.modules["homeassistant.helpers.config_validation"] = ha_helpers_cv

    ha_helpers_storage = types.ModuleType("homeassistant.helpers.storage")

    # Simple in-memory store keyed by storage key
    _IN_MEMORY_STORE: dict[str, object] = {}

    class Store:  # type: ignore[override]
        def __init__(self, _hass: HomeAssistant, _version: int, _key: str) -> None:
            self.version = _version
            self.key = _key

        async def async_load(self):
            return _IN_MEMORY_STORE.get(self.key)

        async def async_save(self, data):
            _IN_MEMORY_STORE[self.key] = data

    ha_helpers_storage.Store = Store
    sys.modules["homeassistant.helpers.storage"] = ha_helpers_storage

    # homeassistant.components.websocket_api
    ha_components = types.ModuleType("homeassistant.components")
    sys.modules.setdefault("homeassistant.components", ha_components)

    ha_ws = types.ModuleType("homeassistant.components.websocket_api")

    def websocket_command(schema=None):  # type: ignore[override]
        def decorator(func):
            func._ws_command = True
            func._ws_schema = schema
            return func

        return decorator

    def async_response(func):  # type: ignore[override]
        func._ws_async_response = True
        return func

    def result_message(_id: int, result=None):  # type: ignore[override]
        return {"id": _id, "type": "result", "success": True, "result": result}

    def error_message(_id: int, code: str, message: str, data: dict | None = None):  # type: ignore[override]
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {"id": _id, "type": "result", "success": False, "error": error}

    def async_register_command(hass: HomeAssistant, handler):  # type: ignore[override]
        registry = hass.data.setdefault("__ws_commands__", [])

        async def _wrapped(hass: HomeAssistant, conn, msg):  # type: ignore[override]
            local_conn = conn
            stub = None
            if local_conn is None:

                class _StubConn:  # simple capture stub used in offline tests
                    def __init__(self) -> None:
                        self.last = None

                    def send_message(self, m):
                        self.last = m

                stub = _StubConn()
                local_conn = stub
            res = await handler(hass, local_conn, msg)
            if res is not None:
                return res
            # Prefer captured message from our stub, then from provided conn if it collects messages
            if stub is not None and getattr(stub, "last", None) is not None:
                return stub.last
            try:
                msgs = getattr(local_conn, "messages", None)
                if isinstance(msgs, list) and msgs:
                    return msgs[-1]
            except Exception:
                pass
            return None

        # Preserve HA websocket metadata so tests can discover handlers by schema
        for attr in ("_ws_schema", "_ws_command", "_ws_async_response"):
            try:
                setattr(_wrapped, attr, getattr(handler, attr, None))
            except Exception:
                pass

        registry.append(_wrapped)

    ha_ws.websocket_command = websocket_command
    ha_ws.async_response = async_response
    ha_ws.result_message = result_message
    ha_ws.error_message = error_message
    ha_ws.async_register_command = async_register_command
    sys.modules["homeassistant.components.websocket_api"] = ha_ws

    # homeassistant.helpers.area_registry
    ha_helpers_area_registry = types.ModuleType("homeassistant.helpers.area_registry")

    class _AreaRegistry:  # type: ignore[override]
        def __init__(self) -> None:
            self._areas: dict[str, object] = {}

        def _add(self, area_id: str, name: str):
            entry = types.SimpleNamespace(id=area_id, name=name)
            self._areas[area_id] = entry
            return entry

        def async_get_area(self, area_id: str):
            return self._areas.get(area_id)

        def async_get_area_by_name(self, name: str):
            for area in self._areas.values():
                if getattr(area, "name", None) == name:
                    return area
            return None

        def async_list_areas(self):
            return list(self._areas.values())

    async def async_get(hass: HomeAssistant):  # type: ignore[override]
        registry = hass.data.get("__area_registry__")
        if registry is None:
            registry = _AreaRegistry()
            hass.data["__area_registry__"] = registry
        return registry

    ha_helpers_area_registry.async_get = async_get
    sys.modules["homeassistant.helpers.area_registry"] = ha_helpers_area_registry


if _INTEGRATION_MODE:
    # Integration mode: a real Home Assistant core (via phacc) drives the tests
    # and plugin autoload is enabled. Install no stubs and let
    # tests/integration/conftest.py handle the fixtures.
    pass
else:
    # Offline mode: stub Home Assistant.

    # Only load pytest-asyncio explicitly when plugin auto-loading is disabled.
    # This avoids duplicate plugin registration under VS Code/Cursor test discovery.
    if _AUTOLOAD_DISABLED:
        pytest_plugins = ("pytest_asyncio.plugin",)

    # Never collect the phacc-based integration suite in the offline run: it needs
    # the real Home Assistant core that the stubs below deliberately replace.
    collect_ignore = ["integration"]

    # Re-enable sockets if a plugin disabled them (e.g., pytest-socket via IDE)
    try:  # pragma: no cover - safety for IDE-driven runs
        from pytest_socket import enable_socket  # type: ignore

        enable_socket()
    except Exception:
        pass

    # On Windows, hand pytest-asyncio a selector-based loop factory instead of
    # forcing a process-wide event loop policy: asyncio.set_event_loop_policy()
    # and WindowsSelectorEventLoopPolicy are both deprecated since Python 3.14
    # (removal slated for 3.16). A single-entry mapping keeps every async test
    # parametrized exactly as before (one run, id hidden) while going through
    # pytest-asyncio's supported extension point.
    if platform.system() == "Windows":  # pragma: no cover - environment-specific

        def pytest_asyncio_loop_factories():
            return {"selector": asyncio.SelectorEventLoop}

    _install_offline_ha_stubs()

    # Pytest fixtures for testing

    # Import project storage module after HA stubs are installed
    import pytest
    from custom_components.haventory import storage as storage_mod

    @pytest.fixture
    def immediate_persist(monkeypatch):
        """Fixture that makes persistence immediate instead of debounced for faster tests."""
        # Replace async_request_persist with async_persist_repo to make it immediate
        monkeypatch.setattr(storage_mod, "async_request_persist", storage_mod.async_persist_repo)
