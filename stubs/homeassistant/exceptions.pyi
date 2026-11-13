from collections.abc import Mapping

class HomeAssistantError(Exception):
    translation_domain: str | None
    translation_key: str | None
    translation_placeholders: dict[str, str] | None
    def __init__(
        self,
        *args: object,
        translation_domain: str | None = None,
        translation_key: str | None = None,
        translation_placeholders: Mapping[str, str] | None = None,
    ) -> None: ...

class ServiceValidationError(HomeAssistantError): ...
class ConfigEntryNotReady(HomeAssistantError): ...
class ConfigEntryError(HomeAssistantError): ...
