"""Schema migrations for HAventory persistent storage.

Forward-only, idempotent migration steps. Each step receives and returns the
entire persisted dict payload. Steps must tolerate being applied more than once
without changing the outcome.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Final

from .exceptions import SchemaDowngradeError


def migrate(payload: dict[str, Any], *, from_version: int, to_version: int) -> dict[str, Any]:
    """Migrate ``payload`` from ``from_version`` to ``to_version``.

    Steps are applied sequentially: vN -> vN+1 -> ... -> vM.

    Raises ``SchemaDowngradeError`` when asked to go backwards.
    """

    if from_version > to_version:
        # Steps are forward-only, so a downgrade would run none of them and still
        # leave the loop stamping ``to_version`` on data written by a schema this
        # build cannot read — relabelling it for whoever saves the result. The
        # storage layer refuses newer payloads before it ever calls this, and the
        # refusal it raises is the one users see; this guard is what stops a
        # second caller from reintroducing the silent relabel.
        raise SchemaDowngradeError(
            f"refusing to migrate schema version {from_version} down to {to_version}: "
            "migrations are forward-only"
        )

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


def migrate_1_to_2(payload: dict[str, Any]) -> dict[str, Any]:
    """Ensure items/locations keys exist for schema v2."""

    data = deepcopy(payload) if isinstance(payload, dict) else {}
    data.setdefault("items", {})
    data.setdefault("locations", {})
    return data


def migrate_2_to_3(payload: dict[str, Any]) -> dict[str, Any]:
    """No-op migration to v3 (inspection_date is optional)."""
    return deepcopy(payload) if isinstance(payload, dict) else {}


# The item statuses as schema v5 defines them. Frozen here rather than read
# from models so this step keeps its meaning if the live set grows later.
_V5_ITEM_STATUSES: Final[tuple[str, ...]] = ("ok", "missing", "needs_repair")


def migrate_4_to_5(payload: dict[str, Any]) -> dict[str, Any]:
    """Backfill the per-item ``status`` field for schema v5.

    From v5 every item carries exactly one status; an item written before the
    field existed — or holding a value v5 does not know — becomes ``"ok"``.
    Idempotent: an item already carrying a known status is left untouched.
    """

    data = deepcopy(payload) if isinstance(payload, dict) else {}
    items = data.get("items")
    if isinstance(items, dict):
        for item in items.values():
            if isinstance(item, dict) and item.get("status") not in _V5_ITEM_STATUSES:
                item["status"] = "ok"
    return data
