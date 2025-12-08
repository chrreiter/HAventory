"""Schema migrations for HAventory persistent storage.

Forward-only, idempotent migration steps. Each step receives and returns the
entire persisted dict payload. Steps must tolerate being applied more than once
without changing the outcome.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def migrate(payload: dict[str, Any], *, from_version: int, to_version: int) -> dict[str, Any]:
    """Migrate ``payload`` from ``from_version`` to ``to_version``.

    Steps are applied sequentially: vN -> vN+1 -> ... -> vM.
    """

    if from_version > to_version:
        # We do not support downgrades; return the original as-is
        return payload

    data: dict[str, Any] = deepcopy(payload)
    version = int(from_version)
    while version < to_version:
        next_version = version + 1
        step_name = f"migrate_{version}_to_{next_version}"
        step = globals().get(step_name)
        if callable(step):
            data = step(data)  # type: ignore[misc]
        # If no step is defined, assume no-op for this transition
        version = next_version

    data["schema_version"] = to_version
    return data


def migrate_0_to_1(payload: dict[str, Any]) -> dict[str, Any]:
    """Initial migration to v1.

    Ensures required top-level keys exist and drops nothing.
    Idempotent: re-applying yields same result.
    """

    data = deepcopy(payload) if isinstance(payload, dict) else {}
    data.setdefault("items", {})
    data.setdefault("locations", {})
    # schema_version will be set by the driver after the loop
    return data


def migrate_1_to_1(payload: dict[str, Any]) -> dict[str, Any]:
    """No-op placeholder to demonstrate scaffold for equal-version calls."""

    return deepcopy(payload) if isinstance(payload, dict) else {}


def migrate_1_to_2(payload: dict[str, Any]) -> dict[str, Any]:
    """Ensure items/locations keys exist for schema v2."""

    data = deepcopy(payload) if isinstance(payload, dict) else {}
    data.setdefault("items", {})
    data.setdefault("locations", {})
    return data
