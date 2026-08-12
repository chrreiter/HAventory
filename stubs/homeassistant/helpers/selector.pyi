from enum import StrEnum
from typing import Any, Required, TypedDict

class SelectSelectorMode(StrEnum):
    LIST = "list"
    DROPDOWN = "dropdown"

class SelectOptionDict(TypedDict):
    value: str
    label: str

class SelectSelectorConfig(TypedDict, total=False):
    options: Required[list[str] | list[SelectOptionDict]]
    multiple: bool
    custom_value: bool
    mode: SelectSelectorMode
    translation_key: str
    sort: bool

# A voluptuous validator: it rejects anything outside `options`, and with
# `multiple` set it takes and returns a list.
class SelectSelector:
    config: SelectSelectorConfig
    def __init__(self, config: SelectSelectorConfig) -> None: ...
    def __call__(self, data: Any) -> Any: ...

def __getattr__(name: str) -> Any: ...
