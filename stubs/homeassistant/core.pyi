"""Minimal Home Assistant stubs for offline type checking.

Only the surface HAventory touches is typed precisely; everything else falls
back to Any via __getattr__. See pyproject [tool.mypy] mypy_path.
"""

import asyncio
from collections.abc import Coroutine, Mapping
from typing import Any

class HomeAssistant:
    data: dict[str, Any]
    def async_create_background_task[R](
        self,
        target: Coroutine[Any, Any, R],
        name: str,
        eager_start: bool = True,
    ) -> asyncio.Task[R]: ...
    def __getattr__(self, name: str) -> Any: ...

class ServiceCall:
    # Read-only in real HA; copy it before mutating.
    data: Mapping[str, Any]
    def __getattr__(self, name: str) -> Any: ...
