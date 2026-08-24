"""Remove files an earlier release shipped that this one no longer does.

An upgrade never clears the integration directory. With ``zip_release``, HACS
copies the previous install aside and then extracts the new asset straight over
``<config>/custom_components/haventory/``, keeping whatever the archive does not
overwrite; ``docker cp`` into a dev container merges the same way. So a module a
release deletes, or a bundle it renames, stays on disk — importable, and served
under ``/haventory_static/`` — for the whole life of that install.

Nothing about the release asset is wrong when that happens, which is why
``scripts/check_release_zip.py`` cannot see it: the archive is correct and it is
the install directory that carries history. What can see it is an explicit list
of the paths earlier releases shipped and this one does not, deleted at setup.
Explicit and never a glob: the same directory holds whatever an operator put
there, and a wildcard would take those too.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .logs import context_logger

LOGGER = context_logger(__name__)

_PACKAGE_DIR = Path(__file__).parent

# Files this release no longer ships: paths relative to the integration
# directory, POSIX-separated. **A PR that deletes or renames a file shipped
# inside `custom_components/haventory/` appends it here in the same PR** — this
# entry is the only thing that ever reaches an install already holding the old
# copy, and it has to stay listed for as long as anyone might upgrade across
# that release. Directories are not swept: an operator's own files can sit
# inside one, and a directory left empty is inert.
RETIRED_PATHS: tuple[str, ...] = ("areas.py", "health.py", "rate_limit.py")


def _target_path(relative_path: str) -> Path | None:
    """The file ``relative_path`` names inside the integration directory.

    ``None`` for anything landing outside it. The list above is a literal in
    this module, so only a typo gets here — but it points into the operator's
    config tree, where a stray ``../`` deletes a file nobody asked us to touch.
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
            # The ordinary outcome: this install never had the file, or an
            # earlier setup already swept it.
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
    """Delete the files earlier releases left behind, returning what was removed.

    Absence is the normal case — a fresh install carries none of them, and an
    upgraded one carries each only until the first setup — so an empty result is
    not an error.
    """
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
