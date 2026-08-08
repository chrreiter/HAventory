from typing import Any

from homeassistant.core import HomeAssistant

async def async_register_panel(
    hass: HomeAssistant,
    frontend_url_path: str,
    webcomponent_name: str,
    sidebar_title: str | None = ...,
    sidebar_icon: str | None = ...,
    js_url: str | None = ...,
    module_url: str | None = ...,
    embed_iframe: bool = ...,
    trust_external: bool = ...,
    config: dict[str, Any] | None = ...,
    require_admin: bool = ...,
    config_panel_domain: str | None = ...,
) -> None: ...
def __getattr__(name: str) -> Any: ...
