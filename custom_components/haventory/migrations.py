"""Schema handling for HAventory persistent storage.

``migrate`` is the forward-only driver the storage layer calls for a payload
stamped below the current version. It receives and returns the entire persisted
dict payload, and applying it twice leaves what the first pass produced.

The module deliberately imports no model or constant: the numbers here describe
stores this build no longer reads, and the live vocabulary is free to move past
them.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Final

from .exceptions import SchemaDowngradeError

# The stamps this project used before the schema was collapsed to 1. Nothing
# reads such a store; the numbers are here so the refusal can name the one way
# across — a 0.8.x build, which takes it in and restamps it — rather than
# telling the user to upgrade to a HAventory that understands it. None does, and
# none will: the schema after the collapse takes 2, which is why the set is
# closed at 9 and why the storage layer checks it only while the current schema
# is 1.
PRE_COLLAPSE_SCHEMA_VERSIONS: Final[frozenset[int]] = frozenset(range(2, 10))


def migrate(payload: dict[str, Any], *, from_version: int, to_version: int) -> dict[str, Any]:
    """Migrate ``payload`` from ``from_version`` to ``to_version``.

    With the schema collapsed to a single version there is no step to run
    between the two: a store below the current version is one written before the
    fields existed, and ``Item.from_dict`` reads an absent field as the value the
    build that introduced it writes. What is left here is the stamp and the guard.

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
