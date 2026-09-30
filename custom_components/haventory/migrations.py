"""Schema handling for HAventory persistent storage.

``migrate`` is the forward-only driver the storage layer calls for a payload
stamped below the current version; applying it twice leaves what the first pass
produced. It imports no model or constant, so the numbers here can describe
stores this build no longer reads.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Final

from .exceptions import SchemaDowngradeError

# The stamps used before the schema was collapsed to 1. Only a 0.8.x build reads
# such a store, so the refusal names that way across. The next schema takes 2,
# which is why the set stops at 9 and is consulted only while the current is 1.
PRE_COLLAPSE_SCHEMA_VERSIONS: Final[frozenset[int]] = frozenset(range(2, 10))


def migrate(payload: dict[str, Any], *, from_version: int, to_version: int) -> dict[str, Any]:
    """Return a copy of ``payload`` migrated from ``from_version`` to ``to_version``.

    No step runs between versions today: ``Item.from_dict`` reads an absent
    field as its default. Going backwards raises ``SchemaDowngradeError``, since
    stamping ``to_version`` on a newer payload would relabel data this build
    cannot read.
    """

    if from_version > to_version:
        raise SchemaDowngradeError(
            f"refusing to migrate schema version {from_version} down to {to_version}: "
            "migrations are forward-only"
        )

    data = deepcopy(payload)
    data["schema_version"] = to_version
    return data
