"""Minimal Home Assistant stubs for offline tests.

Also ensures sockets are enabled when pytest-socket is auto-loaded by IDEs.
This is required on Windows where creating the event loop uses socket.socket.

Additionally, enforce a selector-based event loop policy on Windows to avoid
ProactorEventLoop self-pipe issues when sockets are tampered with by plugins.
"""

import asyncio
import os
import platform
import sys
import types
from pathlib import Path

# Only load pytest-asyncio explicitly when plugin auto-loading is disabled.
# This avoids duplicate plugin registration under VS Code/Cursor test discovery.
if os.environ.get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1":
    pytest_plugins = ("pytest_asyncio.plugin",)

# Re-enable sockets if a plugin disabled them (e.g., pytest-socket via IDE)
try:  # pragma: no cover - safety for IDE-driven runs
    from pytest_socket import enable_socket  # type: ignore

    enable_socket()
except Exception:
    pass

# On Windows force SelectorEventLoopPolicy early (pytest-asyncio will reuse it)
if platform.system() == "Windows":  # pragma: no cover - environment-specific
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

# Ensure project root is on sys.path for module imports
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _ensure_stub(mod_name: str) -> types.ModuleType:
    mod = types.ModuleType(mod_name)
    sys.modules[mod_name] = mod
    return mod


# Root module
homeassistant = _ensure_stub("homeassistant")

# homeassistant.const
ha_const = types.ModuleType("homeassistant.const")
ha_const.Platform = types.SimpleNamespace(SENSOR="sensor", CALENDAR="calendar")
sys.modules["homeassistant.const"] = ha_const

# homeassistant.core
ha_core = types.ModuleType("homeassistant.core")


class HomeAssistant:  # type: ignore[override]
    def __init__(self) -> None:
        self.data = {}


ha_core.HomeAssistant = HomeAssistant
sys.modules["homeassistant.core"] = ha_core

# homeassistant.exceptions
ha_exceptions = types.ModuleType("homeassistant.exceptions")


class HomeAssistantError(Exception):  # type: ignore[override]
    pass


ha_exceptions.HomeAssistantError = HomeAssistantError
sys.modules["homeassistant.exceptions"] = ha_exceptions

# homeassistant.config_entries
ha_config_entries = types.ModuleType("homeassistant.config_entries")


class ConfigEntry:  # type: ignore[override]
    pass


class ConfigFlow:  # type: ignore[override]
    def __init_subclass__(cls, **kwargs):  # accept e.g. domain=...
        return

    # Minimal helpers to satisfy integration code if used in tests later
    def async_abort(self, *, reason: str):
        return {"type": "abort", "reason": reason}

    def async_create_entry(self, *, title: str, data: dict):
        return {"type": "create_entry", "title": title, "data": data}


ha_config_entries.ConfigEntry = ConfigEntry
ha_config_entries.ConfigFlow = ConfigFlow
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
    registry.append(handler)


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
