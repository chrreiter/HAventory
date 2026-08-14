from collections.abc import Callable, Coroutine, Mapping
from enum import Enum
from typing import Any

from homeassistant.core import HomeAssistant

class ConfigFlowResult(dict[str, Any]): ...

class ConfigEntryState(Enum):
    LOADED = "loaded"
    SETUP_ERROR = "setup_error"
    MIGRATION_ERROR = "migration_error"
    SETUP_RETRY = "setup_retry"
    NOT_LOADED = "not_loaded"
    FAILED_UNLOAD = "failed_unload"
    SETUP_IN_PROGRESS = "setup_in_progress"
    UNLOAD_IN_PROGRESS = "unload_in_progress"

class ConfigEntry:
    entry_id: str
    options: Mapping[str, Any]
    def add_update_listener(
        self,
        listener: Callable[[HomeAssistant, ConfigEntry], Coroutine[Any, Any, None]],
    ) -> Callable[[], None]: ...
    # Real HA 2026.7 returns None (verified against the 2026.7.3 tag).
    def async_on_unload(self, func: Callable[[], None]) -> None: ...
    def __getattr__(self, name: str) -> Any: ...

class ConfigFlow:
    def __init_subclass__(cls, **kwargs: Any) -> None: ...
    def async_abort(self, *, reason: str) -> ConfigFlowResult: ...
    def async_create_entry(
        self,
        *,
        title: str,
        data: Mapping[str, Any],
        options: Mapping[str, Any] | None = ...,
    ) -> ConfigFlowResult: ...
    def async_show_form(
        self,
        *,
        step_id: str,
        data_schema: Any = ...,
        errors: Mapping[str, str] | None = ...,
        description_placeholders: Mapping[str, str] | None = ...,
    ) -> ConfigFlowResult: ...
    def _async_current_entries(self) -> list[ConfigEntry]: ...
    def __getattr__(self, name: str) -> Any: ...

class OptionsFlow:
    config_entry: ConfigEntry
    def async_create_entry(self, *, title: str, data: Mapping[str, Any]) -> ConfigFlowResult: ...
    def async_show_form(
        self,
        *,
        step_id: str,
        data_schema: Any = ...,
        errors: Mapping[str, str] | None = ...,
        description_placeholders: Mapping[str, str] | None = ...,
    ) -> ConfigFlowResult: ...
    def __getattr__(self, name: str) -> Any: ...
