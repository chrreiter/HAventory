"""Config-entry diagnostics for HAventory.

**Aggregates only — no item or location bodies at any depth, and none of the
household's own words.** The card title and the shopping list are redacted, and
household status slugs are replaced with indices.

Home Assistant can call this on an entry whose setup failed, so no block assumes
a loaded runtime.
"""

from __future__ import annotations

from dataclasses import fields
from pathlib import Path
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import _CARD_BUNDLE_PATH
from .const import CONF_CARD_TITLE, CONF_TODO_ENTITY_ID, DOMAIN, INTEGRATION_VERSION
from .models import ITEM_STATUSES
from .repository import Repository
from .runtime import find_runtime
from .storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY

# Options the household chose the words for; a list's object id is its name.
_REDACT_OPTIONS = {CONF_CARD_TITLE, CONF_TODO_ENTITY_ID}


def _bundle_state(path: Path) -> dict[str, Any]:
    """Whether the built card bundle is on disk, and how big it is."""

    try:
        stat = path.stat()
    except OSError:
        return {"filename": path.name, "exists": False, "size_bytes": None}
    return {"filename": path.name, "exists": True, "size_bytes": stat.st_size}


def _repository_block(repo: Repository | None) -> dict[str, Any]:
    if repo is None:
        return {"loaded": False, "counts": None, "health_issues": None}
    return {
        "loaded": True,
        "counts": _without_household_status_names(repo.get_counts()),
        # Constant, for the reason `ws.ws_health` gives; the key stays so a
        # report from this build has the shape a reader expects.
        "health_issues": [],
    }


def _without_household_status_names(counts: dict[str, Any]) -> dict[str, Any]:
    """Report the spread across statuses; only the shipped slugs keep their names."""

    status_counts = counts["status_counts"]
    anonymized: dict[str, Any] = {}
    household = 0
    for slug, count in status_counts.items():
        if slug in ITEM_STATUSES:
            anonymized[slug] = count
            continue
        household += 1
        anonymized[f"custom_{household}"] = count
    return {**counts, "status_counts": anonymized}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Build the diagnostics payload for the HAventory config entry."""

    runtime = find_runtime(hass)
    store = runtime.store if runtime is not None else None
    repo = runtime.repository if runtime is not None else None

    bundle = await hass.async_add_executor_job(_bundle_state, _CARD_BUNDLE_PATH)

    return {
        "integration": {"version": INTEGRATION_VERSION},
        "storage": {
            # What the running store was built for; `null` when setup refused.
            "key": store.key if store is not None else STORAGE_KEY,
            "supported_schema_version": CURRENT_SCHEMA_VERSION,
            "store_schema_version": store.schema_version if store is not None else None,
        },
        "repository": _repository_block(repo),
        "runtime": {
            # Field names, never values: the runtime holds the whole inventory.
            "data_keys": sorted(f.name for f in fields(runtime)) if runtime is not None else [],
            "shared_keys": sorted(str(key) for key in (hass.data.get(DOMAIN) or {})),
        },
        "options": async_redact_data(dict(entry.options), _REDACT_OPTIONS),
        "frontend_bundle": bundle,
    }
