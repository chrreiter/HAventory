"""Remove files an earlier release shipped that this one no longer does.

HACS extracts a new release over ``<config>/custom_components/haventory/``
without clearing it, so a module a release deletes stays importable, and a
renamed bundle stays served, for the life of the install. The list is explicit,
never a glob: an operator's own files can sit in the same directory.

The one exception is ``www/chunks/``, which holds nothing but the card build's
chunks. Their names change with their content, so no explicit list could name
them; the build's own manifest names the current ones, and every other ``.js``
file there is a chunk an earlier release shipped.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

from .logs import context_logger

LOGGER = context_logger(__name__)

_PACKAGE_DIR = Path(__file__).parent

# Paths relative to the integration directory, POSIX-separated. **A PR that
# deletes or renames a file inside `custom_components/haventory/` appends it here
# in the same PR**, and it stays listed. Directories are not swept.
RETIRED_PATHS: tuple[str, ...] = ("areas.py", "health.py", "rate_limit.py")

# The card build writes its chunks, and the manifest naming them, to
# `www/chunks/` inside the package.
_CHUNK_MANIFEST = "manifest.json"
_CHUNKS_PREFIX = "chunks/"


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
                extra={"op": "sweep_stale_files", "path": relative_path},
            )
            continue

        try:
            target.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            LOGGER.warning(
                "Could not remove a file left behind by an earlier HAventory version",
                extra={"op": "sweep_stale_files", "path": str(target)},
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
            extra={"op": "sweep_stale_files", "paths": list(removed)},
        )
    return removed


def chunks_named_by(manifest: Any) -> frozenset[str] | None:
    """The chunk file names a Vite build manifest lists, or ``None`` if it is not one.

    Each value's ``file`` is relative to ``www/``; the entry sits outside
    ``chunks/`` and is not a chunk.
    """
    if not isinstance(manifest, dict):
        return None
    names: set[str] = set()
    for record in manifest.values():
        file = record.get("file") if isinstance(record, dict) else None
        if not isinstance(file, str):
            return None
        if file.startswith(_CHUNKS_PREFIX):
            names.add(file.removeprefix(_CHUNKS_PREFIX))
    return frozenset(names)


def _delete_unlisted_chunks(chunks_dir: Path) -> list[str]:
    """Delete each chunk the manifest does not name. Blocks — run it in the executor."""
    try:
        manifest = json.loads((chunks_dir / _CHUNK_MANIFEST).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except OSError, ValueError:
        # Without the list, a current chunk looks like a stale one; deleting
        # on a guess would take the card down.
        LOGGER.warning(
            "Could not read the card's chunk manifest; leaving its chunks in place",
            extra={"op": "sweep_stale_chunks", "path": str(chunks_dir)},
            exc_info=True,
        )
        return []

    current = chunks_named_by(manifest)
    if current is None:
        LOGGER.warning(
            "The card's chunk manifest is not in the expected shape; leaving its chunks in place",
            extra={"op": "sweep_stale_chunks", "path": str(chunks_dir)},
        )
        return []

    removed: list[str] = []
    for path in sorted(chunks_dir.glob("*.js")):
        if path.name in current or not path.is_file():
            continue
        try:
            path.unlink()
        except OSError:
            LOGGER.warning(
                "Could not remove a card chunk left behind by an earlier HAventory version",
                extra={"op": "sweep_stale_chunks", "path": str(path)},
                exc_info=True,
            )
            continue
        removed.append(path.name)
    return removed


async def async_sweep_stale_chunks(
    hass: HomeAssistant, chunks_dir: Path | None = None
) -> tuple[str, ...]:
    """Delete the card chunks earlier releases left behind, returning their names."""
    target = _PACKAGE_DIR / "www" / "chunks" if chunks_dir is None else chunks_dir
    removed = tuple(await hass.async_add_executor_job(_delete_unlisted_chunks, target))
    if removed:
        LOGGER.debug(
            "Removed card chunks left behind by an earlier HAventory version",
            extra={"op": "sweep_stale_chunks", "chunks": list(removed)},
        )
    return removed
