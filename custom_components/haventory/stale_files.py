"""Remove files an earlier release shipped that this one no longer does.

HACS extracts a new release over ``<config>/custom_components/haventory/``
without clearing it, so a module a release deletes stays importable, and a
renamed bundle stays served, for the life of the install. The list is explicit,
never a glob: an operator's own files can sit in the same directory.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .logs import context_logger

LOGGER = context_logger(__name__)

_PACKAGE_DIR = Path(__file__).parent

# Paths relative to the integration directory, POSIX-separated. **A PR that
# deletes or renames a file inside `custom_components/haventory/` appends it here
# in the same PR**, and it stays listed. Directories are not swept.
RETIRED_PATHS: tuple[str, ...] = ("areas.py", "health.py", "rate_limit.py")


def _target_path(relative_path: str) -> Path | None:
    """The file ``relative_path`` names inside the integration directory, or ``None``.

    A typo such as a stray ``../`` would otherwise delete from the config tree.
    """
    package_dir = _PACKAGE_DIR.resolve()
    candidate = (package_dir / relative_path).resolve()
    if package_dir not in candidate.parents:
        return None
    return candidate


def _delete(paths: Sequence[str]) -> list[str]:
    """Delete each listed path that is present. Blocks — run it in the executor."""
    removed: list[str] = []

    for relative_path in paths:
        target = _target_path(relative_path)
        if target is None:
            LOGGER.warning(
                "Refusing to sweep a path outside the integration directory",
                extra={"domain": DOMAIN, "op": "sweep_stale_files", "path": relative_path},
            )
            continue

        try:
            target.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            LOGGER.warning(
                "Could not remove a file left behind by an earlier HAventory version",
                extra={"domain": DOMAIN, "op": "sweep_stale_files", "path": str(target)},
                exc_info=True,
            )
            continue

        removed.append(relative_path)

    return removed


async def async_sweep_retired_files(
    hass: HomeAssistant, paths: Sequence[str] | None = None
) -> tuple[str, ...]:
    """Delete the files earlier releases left behind, returning what was removed."""
    targets = RETIRED_PATHS if paths is None else tuple(paths)
    if not targets:
        return ()

    removed = tuple(await hass.async_add_executor_job(_delete, targets))
    if removed:
        LOGGER.debug(
            "Removed files left behind by an earlier HAventory version",
            extra={"domain": DOMAIN, "op": "sweep_stale_files", "paths": list(removed)},
        )
    return removed
