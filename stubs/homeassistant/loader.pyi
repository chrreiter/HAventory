from typing import Any

from homeassistant.core import HomeAssistant

class IntegrationNotFound(Exception):
    domain: str

class Integration:
    domain: str
    manifest: dict[str, Any]
    def __getattr__(self, name: str) -> Any: ...

async def async_get_integration(hass: HomeAssistant, domain: str) -> Integration: ...
def __getattr__(name: str) -> Any: ...
