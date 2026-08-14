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


# The status definitions v6 seeds. Frozen literals rather than a read from
# models, for the same reason as ``_V5_ITEM_STATUSES``: this step must keep
# seeding exactly these three once the live set can grow.
_V6_SEED_STATUSES: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("ok", "OK", "green", "check"),
    ("missing", "Missing", "amber", "alert"),
    ("needs_repair", "Needs repair", "amber", "wrench"),
)

# Frozen here rather than imported from `const`: a migration step has to keep
# meaning what it meant when it was written, and the live vocabulary is free to
# grow past it.
_V6_DEFAULT_STATUS_COLOR: Final[str] = "neutral"
_V6_DEFAULT_STATUS_ICON: Final[str] = "check"


def migrate_5_to_6(payload: dict[str, Any]) -> dict[str, Any]:
    """Seed the ``statuses`` collection and backfill per-item ``attachments``.

    One step for both, so a v0.4.0 install crosses exactly one version.

    * ``statuses`` becomes a slug-keyed map of definitions, seeded with the
      three built-ins and their appearance. A definition already present —
      including one a later release or a hand edit added — keeps every field it
      carries and is only completed where one is absent.
    * every item gains ``attachments: []`` unless it already carries the field,
      and every entry in an existing list gains ``title`` and ``order``.
      ``order`` follows stored position, because position 0 is the cover.

    Idempotent throughout: re-applying only ever fills in what is absent.
    """

    data = deepcopy(payload) if isinstance(payload, dict) else {}

    statuses = data.get("statuses")
    if not isinstance(statuses, dict):
        statuses = {}
    for order, (slug, label, color, icon) in enumerate(_V6_SEED_STATUSES):
        statuses.setdefault(
            slug, {"slug": slug, "label": label, "order": order, "color": color, "icon": icon}
        )
    for definition in statuses.values():
        if isinstance(definition, dict):
            definition.setdefault("color", _V6_DEFAULT_STATUS_COLOR)
            definition.setdefault("icon", _V6_DEFAULT_STATUS_ICON)
    data["statuses"] = statuses

    items = data.get("items")
    if isinstance(items, dict):
        for item in items.values():
            if isinstance(item, dict):
                item.setdefault("attachments", [])
                _backfill_attachment_fields(item.get("attachments"))
    return data


def _backfill_attachment_fields(attachments: object) -> None:
    """Give every stored attachment entry a ``title`` and an ``order``.

    Order is per kind and counts from zero within it — the same convention
    ``reorder_attachments`` writes — so an item's first manual is position 0
    however many pictures are stored ahead of it.
    """

    if not isinstance(attachments, list):
        return
    placed: dict[object, int] = {}
    for entry in attachments:
        if not isinstance(entry, dict):
            continue
        kind = entry.get("kind")
        position = placed.get(kind, 0)
        placed[kind] = position + 1
        entry.setdefault("title", "")
        entry.setdefault("order", position)


def migrate_6_to_7(payload: dict[str, Any]) -> dict[str, Any]:
    """Mark the store as one whose status colours a v6 build cannot read.

    Nothing in the payload changes, and nothing needs to: every v6 document is
    already a valid v7 one. The version exists for the shape v7 *admits* — a
    status definition's ``color`` may be a ``#rrggbb`` literal, where v6 accepts
    only the ten tone tokens.

    The bump is what stops the two shapes sharing a stamp. Under one stamp a v6
    build reads a store holding a literal, cannot validate the definition, and —
    because an unreadable status definition is skipped rather than fatal — drops
    it and rewrites every item carrying that slug to the default status,
    persisting the loss on the next save. Stamped 7, the same build refuses the
    store outright and the data waits for one that understands it.
    """

    return deepcopy(payload) if isinstance(payload, dict) else {}
