"""Remove files an earlier release shipped that this one no longer does.

HACS extracts a new release over ``<config>/custom_components/haventory/``
without clearing it, so a module a release deletes stays importable, and a
renamed bundle stays served, for the life of the install. The list is explicit,
never a glob: an operator's own files can sit in the same directory.

The one exception is ``www/chunks/``, which holds nothing but the card build's
chunks. Their names change with their content, so no explicit list could name
them; the build's own manifest names the current ones, and every other ``.js``
file there is a chunk an earlier release shipped.

Beside each ``.js`` in ``www/`` the build writes a ``.br`` and a ``.gz`` copy,
and aiohttp serves whichever the browser accepts without checking that it still
matches the ``.js``. A copy left from another build therefore serves that
build's code, and the entry's name never changes, so a copy-over install keeps
serving the old card. Each copy is kept only if it decompresses to the bytes of
the ``.js`` beside it.
"""

from __future__ import annotations

import gzip
import importlib
import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, cast

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

# The suffixes aiohttp's `FileResponse` serves in place of the file they extend.
_COMPRESSED_SUFFIXES = (".br", ".gz")


def _find_brotli_decompress() -> Callable[[bytes], bytes] | None:
    """The Brotli decoder aiohttp itself would use, or ``None`` without one.

    Home Assistant constrains Brotli but does not require it, so a Core install
    can lack both modules.
    """
    for name in ("brotlicffi", "brotli"):
        try:
            module = importlib.import_module(name)
        except ImportError:
            continue
        return cast("Callable[[bytes], bytes]", module.decompress)
    return None


_brotli_decompress = _find_brotli_decompress()


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


def _copy_matches(copy: Path, original: bytes) -> bool:
    """Whether ``copy`` decompresses to ``original``. A copy it cannot read does not.

    A ``.br`` without a Brotli decoder cannot be checked, so it counts as stale:
    the ``.gz`` beside it is served instead.
    """
    try:
        data = copy.read_bytes()
        if copy.suffix == ".gz":
            return gzip.decompress(data) == original
        if _brotli_decompress is None:
            return False
        return _brotli_decompress(data) == original
    # A corrupt copy raises whatever its decoder raises: `zlib.error`,
    # `EOFError`, or the Brotli binding's own error type.
    except Exception as err:
        LOGGER.debug(
            "Could not read a compressed copy of the card",
            extra={"op": "sweep_compressed_copies", "path": str(copy), "error": repr(err)},
        )
        return False


def _delete_stale_compressed_copies(www_dir: Path) -> list[str]:
    """Delete each ``.js.br`` / ``.js.gz`` that is not its ``.js``. Blocks — run in the executor."""
    removed: list[str] = []
    for directory in (www_dir, www_dir / "chunks"):
        copies = [
            path
            for suffix in _COMPRESSED_SUFFIXES
            for path in sorted(directory.glob(f"*.js{suffix}"))
        ]
        originals: dict[Path, bytes | None] = {}
        for copy in copies:
            original_path = copy.with_suffix("")
            if original_path not in originals:
                # Gone, or not a file: either way nothing this copy may stand in for.
                try:
                    originals[original_path] = original_path.read_bytes()
                except OSError:
                    originals[original_path] = None
            original = originals[original_path]
            if original is not None and _copy_matches(copy, original):
                continue
            try:
                copy.unlink()
            except FileNotFoundError:
                continue
            except OSError:
                LOGGER.warning(
                    "Could not remove a compressed copy of the card that no longer matches it",
                    extra={"op": "sweep_compressed_copies", "path": str(copy)},
                    exc_info=True,
                )
                continue
            removed.append(copy.relative_to(www_dir).as_posix())
    return removed


async def async_sweep_compressed_copies(
    hass: HomeAssistant, www_dir: Path | None = None
) -> tuple[str, ...]:
    """Delete the compressed copies that would serve other bytes than their ``.js``.

    Runs after the chunk sweep, so a chunk it deleted takes its copies with it.
    """
    target = _PACKAGE_DIR / "www" if www_dir is None else www_dir
    removed = tuple(await hass.async_add_executor_job(_delete_stale_compressed_copies, target))
    if removed:
        LOGGER.debug(
            "Removed compressed copies of the card that did not match it",
            extra={"op": "sweep_compressed_copies", "paths": list(removed)},
        )
    return removed
