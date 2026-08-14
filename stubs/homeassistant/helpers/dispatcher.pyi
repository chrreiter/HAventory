"""Minimal Home Assistant stubs for offline type checking."""

from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant

def async_dispatcher_send(hass: HomeAssistant, signal: str, *args: Any) -> None: ...
def async_dispatcher_connect(
    hass: HomeAssistant, signal: str, target: Callable[..., Any]
) -> Callable[[], None]: ...
