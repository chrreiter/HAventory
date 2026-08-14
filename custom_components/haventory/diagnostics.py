"""Config-entry diagnostics for HAventory.

Home Assistant discovers this module by name and puts "Download diagnostics" on
the entry's ⋮ menu; the JSON it writes is what a bug report carries.

**Aggregates only — no item or location bodies at any depth.** A diagnostics
dump answers questions about the *shape* of an install: how much is stored, what
schema it is on, whether the indexes agree with themselves, whether the card
bundle is even deployed. Redacting free text well enough to paste into a public
issue is not something a name, a note or a custom field can be trusted to
survive, and a user who wants their content already has `haventory/export`. The
one user-authored string that does appear — the card title, out of the entry's
options — goes through Home Assistant's redaction helper.

Home Assistant can call this on an entry whose setup failed, which is exactly
when it is worth having, so every block reports what it found rather than
assuming a loaded runtime.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import _CARD_BUNDLE_PATH
from .const import CONF_CARD_TITLE, DOMAIN, INTEGRATION_VERSION
from .health import collect_health_issues
from .rate_limit import RateLimiter
from .repository import Repository
from .storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore

# The card title is the one free-text string a household writes into the entry's
# options; everything else there is a number, a flag or an entity id.
_REDACT_OPTIONS = {CONF_CARD_TITLE}


def _bundle_state(path: Path) -> dict[str, Any]:
    """Whether the built card bundle is on disk, and how big it is.

    "The card will not render" is answered here more often than anywhere else:
    the bundle is git-ignored and produced by a build, so an install that was
    copied rather than released can be missing it entirely.
    """

    try:
        stat = path.stat()
    except OSError:
        return {"filename": path.name, "exists": False, "size_bytes": None}
    return {"filename": path.name, "exists": True, "size_bytes": stat.st_size}


def _repository_block(repo: Repository | None) -> dict[str, Any]:
    if repo is None:
        return {"loaded": False, "counts": None, "generation": None, "health_issues": None}
    issues, counts = collect_health_issues(repo)
    return {
        "loaded": True,
        "counts": counts,
        "generation": repo.generation,
        "health_issues": issues,
    }


def _rate_limit_block(limiter: RateLimiter | None) -> dict[str, Any] | None:
    if limiter is None:
        return None
    return {
        "enabled": bool(limiter.enabled),
        "dropped_commands": limiter.dropped_commands,
        "dropped_events": limiter.dropped_events,
    }


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Build the diagnostics payload for the HAventory config entry."""

    bucket = hass.data.get(DOMAIN) or {}
    store = bucket.get("store")
    repo = bucket.get("repository")

    # Off the event loop, the way `stale_files` does its own filesystem work.
    bundle = await hass.async_add_executor_job(_bundle_state, _CARD_BUNDLE_PATH)

    return {
        "integration": {"version": INTEGRATION_VERSION},
        "storage": {
            # `store_schema_version` is what the running store was constructed
            # for, not what the file says: a payload on an older version is
            # migrated during setup, and one on a newer version stops setup
            # before a store is ever put in the bucket — which is what the
            # `null` here means.
            "key": store.key if isinstance(store, DomainStore) else STORAGE_KEY,
            "supported_schema_version": CURRENT_SCHEMA_VERSION,
            "store_schema_version": (
                store.schema_version if isinstance(store, DomainStore) else None
            ),
        },
        "repository": _repository_block(repo if isinstance(repo, Repository) else None),
        "runtime": {
            # Key names, never values: the bucket holds the repository itself,
            # and a dump of it would be the whole inventory.
            "data_keys": sorted(str(key) for key in bucket),
            "rate_limit": _rate_limit_block(
                bucket.get("rate_limiter")
                if isinstance(bucket.get("rate_limiter"), RateLimiter)
                else None
            ),
        },
        "options": async_redact_data(dict(getattr(entry, "options", None) or {}), _REDACT_OPTIONS),
        "frontend_bundle": bundle,
    }
