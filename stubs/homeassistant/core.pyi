"""Minimal Home Assistant stubs for offline type checking.

Only the surface HAventory touches is typed precisely; everything else falls
back to Any via __getattr__. See pyproject [tool.mypy] mypy_path.
"""

from typing import Any

class HomeAssistant:
    data: dict[str, Any]
    def __getattr__(self, name: str) -> Any: ...
