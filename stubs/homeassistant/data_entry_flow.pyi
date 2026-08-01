from typing import Any, TypedDict

class FlowResult(dict[str, Any]): ...

class SectionConfig(TypedDict, total=False):
    collapsed: bool

# A voluptuous validator wrapping a nested schema; `options` reaches the
# frontend only, so validation is the inner schema's.
class section:
    schema: Any
    options: SectionConfig
    def __init__(self, schema: Any, options: SectionConfig | None = ...) -> None: ...
    def __call__(self, value: Any) -> Any: ...
