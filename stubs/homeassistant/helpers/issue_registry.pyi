from enum import StrEnum
from typing import Any

from homeassistant.core import HomeAssistant

class IssueSeverity(StrEnum):
    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"

class IssueEntry:
    domain: str
    issue_id: str
    is_fixable: bool | None
    severity: IssueSeverity | None
    translation_key: str | None
    translation_placeholders: dict[str, str] | None
    def __getattr__(self, name: str) -> Any: ...

class IssueRegistry:
    def async_get_issue(self, domain: str, issue_id: str) -> IssueEntry | None: ...
    def __getattr__(self, name: str) -> Any: ...

def async_get(hass: HomeAssistant) -> IssueRegistry: ...
def async_create_issue(
    hass: HomeAssistant,
    domain: str,
    issue_id: str,
    *,
    breaks_in_ha_version: str | None = ...,
    data: dict[str, str | int | float | None] | None = ...,
    is_fixable: bool,
    is_persistent: bool = ...,
    issue_domain: str | None = ...,
    learn_more_url: str | None = ...,
    severity: IssueSeverity,
    translation_key: str,
    translation_placeholders: dict[str, str] | None = ...,
) -> None: ...
def async_delete_issue(hass: HomeAssistant, domain: str, issue_id: str) -> None: ...
