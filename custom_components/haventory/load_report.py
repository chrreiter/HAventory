"""What a load could not read, and the per-row reader that collects it.

``Repository.load_state`` reads each stored row through ``load_rows``, which
drops and logs a row that raises, and fills a ``LoadReport``. Setup refuses on a
non-empty report: every write saves the whole store, so the first save after a
partial load would erase the dropped rows. The ids are carried so the Repairs
issue can quote them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .exceptions import ValidationError
from .logs import context_logger

LOGGER = context_logger(__name__)

#: Rows of one kind logged individually before ``load_state`` logs only a total,
#: so a wholesale corruption does not bury the log in one line per row.
LOAD_DROP_LOG_LIMIT = 10


@dataclass(frozen=True)
class LoadReport:
    """What ``load_state`` had to drop or found cyclic.

    ``load_state`` coerces what it can, so an entry here is structurally broken.
    Setup refuses on a non-empty report, because the first save afterwards
    would write the store without the dropped rows. The ids are carried so the
    repair can quote them.
    """

    dropped_item_ids: tuple[str, ...] = ()
    dropped_location_ids: tuple[str, ...] = ()
    #: Locations whose own ``parent_id`` closes a loop — the entries a repair edits.
    cyclic_location_ids: tuple[str, ...] = ()
    #: Locations left unreachable *because* of those, needing no edit of their own.
    unrooted_location_ids: tuple[str, ...] = ()

    @property
    def has_corruption(self) -> bool:
        return bool(
            self.dropped_item_ids
            or self.dropped_location_ids
            or self.cyclic_location_ids
            or self.unrooted_location_ids
        )


def load_rows(
    rows: dict[str, Any],
    load: Callable[[str, Any], None],
    *,
    op: str,
    id_field: str,
    what: str,
) -> list[str]:
    """Load each row, returning the keys of the rows that could not be read.

    Logged at ERROR: a dropped row is gone from memory and the next save
    would write the store without it.
    """

    dropped: list[str] = []
    for key, row in rows.items():
        try:
            load(str(key), row)
        except AttributeError, TypeError, ValueError, ValidationError:
            if len(dropped) < LOAD_DROP_LOG_LIMIT:
                LOGGER.error(
                    "Failed to load %s from persisted state",
                    what,
                    extra={"op": op, id_field: str(key)},
                )
            dropped.append(str(key))
    if len(dropped) > LOAD_DROP_LOG_LIMIT:
        LOGGER.error(
            "Further rows failed to load from persisted state; ids omitted",
            extra={
                "op": op,
                "dropped_total": len(dropped),
                "dropped_logged": LOAD_DROP_LOG_LIMIT,
            },
        )
    return dropped
