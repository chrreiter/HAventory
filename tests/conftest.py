"""Minimal Home Assistant stubs for offline tests.

Also ensures sockets are enabled when pytest-socket is auto-loaded by IDEs.
This is required on Windows where creating the event loop uses socket.socket.

Additionally, enforce a selector-based event loop policy on Windows to avoid
ProactorEventLoop self-pipe issues when sockets are tampered with by plugins.
"""

import sys
import types
from pathlib import Path
import asyncio
import platform

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
setattr(
    ha_const, "Platform", types.SimpleNamespace(SENSOR="sensor", CALENDAR="calendar")
)
sys.modules["homeassistant.const"] = ha_const

# homeassistant.core
ha_core = types.ModuleType("homeassistant.core")


class HomeAssistant:  # type: ignore[override]
    def __init__(self) -> None:
        self.data = {}


setattr(ha_core, "HomeAssistant", HomeAssistant)
sys.modules["homeassistant.core"] = ha_core

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


setattr(ha_config_entries, "ConfigEntry", ConfigEntry)
setattr(ha_config_entries, "ConfigFlow", ConfigFlow)
sys.modules["homeassistant.config_entries"] = ha_config_entries

# homeassistant.data_entry_flow
ha_data_entry_flow = types.ModuleType("homeassistant.data_entry_flow")


class FlowResult(dict):  # type: ignore[override]
    pass


sys.modules["homeassistant.data_entry_flow"] = ha_data_entry_flow
setattr(ha_data_entry_flow, "FlowResult", FlowResult)

# homeassistant.helpers and homeassistant.helpers.storage
ha_helpers = types.ModuleType("homeassistant.helpers")
sys.modules["homeassistant.helpers"] = ha_helpers

ha_helpers_storage = types.ModuleType("homeassistant.helpers.storage")


class Store:  # type: ignore[override]
    def __init__(self, _hass: HomeAssistant, _version: int, _key: str) -> None:  # noqa: D401
        self.version = _version
        self.key = _key

    async def async_load(self):  # noqa: D401
        return None

    async def async_save(self, _data):  # noqa: D401
        return None


setattr(ha_helpers_storage, "Store", Store)
sys.modules["homeassistant.helpers.storage"] = ha_helpers_storage
