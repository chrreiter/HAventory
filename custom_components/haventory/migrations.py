"""Schema handling for HAventory persistent storage.

Two things live here. ``migrate`` is the forward-only driver the storage layer
calls for a payload stamped below the current version. ``adopt_dev_schema`` is
the one-release amnesty: it fills in everything a store written before the
schema was collapsed to 1 may not carry, so such a store can be read and
restamped instead of refused.

Both are idempotent — they receive and return the entire persisted dict payload,
and applying either twice leaves what the first pass produced.

The module deliberately imports no model or constant: what it fills in has to
keep meaning what it meant for the stores it is fed, and the live vocabulary is
free to grow past it.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Final

from .exceptions import SchemaDowngradeError

# The stamps `adopt_dev_schema` is allowed to take in. Each of them names a
# schema this project shipped to itself before the collapse, so a store carrying
# one reads as *newer* than this build and would otherwise hit the downgrade
# refusal. The set is closed — exactly those numbers, never `> CURRENT` — so a
# store from a genuinely newer build is still refused, and it exists for one
# release: it is deleted once the store it was written for has crossed.
ADOPTABLE_SCHEMA_VERSIONS: Final[frozenset[int]] = frozenset(range(2, 10))

# What an item with no readable status becomes. It is the one slug that cannot
# be deleted, so it names something in every store. Frozen here rather than read
# from models, for the reason the module docstring gives.
_DEFAULT_ITEM_STATUS: Final[str] = "ok"

# The status definitions a store that predates the collection is given, and the
# appearance a definition carrying none reads as.
_SEED_STATUS_DEFINITIONS: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("ok", "OK", "green", "check"),
    ("missing", "Missing", "amber", "alert"),
    ("needs_repair", "Needs repair", "amber", "wrench"),
)
_DEFAULT_STATUS_COLOR: Final[str] = "neutral"
_DEFAULT_STATUS_ICON: Final[str] = "check"


def migrate(payload: dict[str, Any], *, from_version: int, to_version: int) -> dict[str, Any]:
    """Migrate ``payload`` from ``from_version`` to ``to_version``.

    With the schema collapsed to a single version there is no step to run
    between the two: a store below the current version is one written before any
    of the fields existed, and ``adopt_dev_schema`` is what gives it them. What
    is left here is the stamp and the guard.

    Raises ``SchemaDowngradeError`` when asked to go backwards.
    """

    if from_version > to_version:
        # A downgrade would leave the payload untouched and still stamp
        # ``to_version`` on data written by a schema this build cannot read —
        # relabelling it for whoever saves the result. The storage layer refuses
        # newer payloads before it ever calls this, and the refusal it raises is
        # the one users see; this guard is what stops a second caller from
        # reintroducing the silent relabel.
        raise SchemaDowngradeError(
            f"refusing to migrate schema version {from_version} down to {to_version}: "
            "migrations are forward-only"
        )

    data: dict[str, Any] = deepcopy(payload) if isinstance(payload, dict) else {}
    data["schema_version"] = to_version
    return data


def adopt_dev_schema(payload: dict[str, Any]) -> dict[str, Any]:
    """Fill in every field a store may predate, leaving what it holds alone.

    One function stands in for what was a chain of steps because each of them
    only ever filled in an absent field: the per-item status, the seeded status
    definitions and the per-item attachment list, the two reminder fields, and
    the reminder's series anchor. Nothing here rewrites a value that is there,
    so it is safe to run on a store that already has all of it — which is what
    lets it run on every payload this build reads rather than only on the stamps
    ``ADOPTABLE_SCHEMA_VERSIONS`` names. A store stamped 1 before the collapse
    gave 1 its meaning predates all of these fills and reads as current, so it
    needs them as much as an adopted one does.
    """

    data: dict[str, Any] = deepcopy(payload) if isinstance(payload, dict) else {}
    data.setdefault("items", {})
    data.setdefault("locations", {})

    if "statuses" not in data:
        # Seeded only for a store that carries no collection at all — one
        # written before the vocabulary became the household's. A store that has
        # one keeps exactly it: every built-in but the default can be deleted,
        # and seeding into an existing collection would put back what someone
        # removed, on every boot.
        data["statuses"] = {
            slug: {"slug": slug, "label": label, "order": order, "color": color, "icon": icon}
            for order, (slug, label, color, icon) in enumerate(_SEED_STATUS_DEFINITIONS)
        }

    statuses = data["statuses"]
    if isinstance(statuses, dict):
        for definition in statuses.values():
            if isinstance(definition, dict):
                definition.setdefault("color", _DEFAULT_STATUS_COLOR)
                definition.setdefault("icon", _DEFAULT_STATUS_ICON)

    # An item's status is rewritten only when nothing in the store names it. The
    # collection above is what names them, so a household's own status survives
    # — the same rule the repository applies as it reads each row.
    nameable = {_DEFAULT_ITEM_STATUS} | _defined_slugs(statuses)

    items = data.get("items")
    if isinstance(items, dict):
        for item in items.values():
            if not isinstance(item, dict):
                continue
            if item.get("status") not in nameable:
                item["status"] = _DEFAULT_ITEM_STATUS
            item.setdefault("attachments", [])
            _backfill_attachment_fields(item.get("attachments"))
            item.setdefault("reminder_date", None)
            item.setdefault("reminder_interval", None)
            # The anchor of a series nobody has bumped is its own date, and a
            # store written before the anchor existed holds only such series.
            item.setdefault("reminder_anchor", item.get("reminder_date"))
    return data


def _defined_slugs(statuses: object) -> set[str]:
    """Every status slug a stored collection names, in either shape it can hold.

    The store writes a slug-keyed map; the load path also accepts the list an
    export document carries, so a file restored by hand can hold either. A shape
    it is neither names nothing.
    """

    entries: list[object]
    if isinstance(statuses, dict):
        entries = list(statuses.values())
    elif isinstance(statuses, list):
        entries = list(statuses)
    else:
        return set()
    return {
        entry["slug"]
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("slug"), str)
    }


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
