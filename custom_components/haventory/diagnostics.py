"""Config-entry diagnostics for HAventory.

Home Assistant discovers this module by name and puts "Download diagnostics" on
the entry's ⋮ menu; the JSON it writes is what a bug report carries.

**Aggregates only — no item or location bodies at any depth, and none of the
household's own words.** A diagnostics dump answers questions about the *shape*
of an install: how much is stored, what schema it is on, which runtime pieces
are loaded, whether the card bundle is even deployed. Redacting free
text well enough to paste into a public issue is not something a name, a note or
a custom field can be trusted to survive, and a user who wants their content
already has `haventory/export`.

Three strings a household authors could otherwise reach the file, and none does:
the card title and the chosen shopping list go through Home Assistant's
redaction helper, and the status slugs — `status_counts` is keyed by *every*
defined status, and a household writes its own — are replaced with indices
unless they are the three this integration ships. A user who is told a file is
safe to attach and finds their own words in it has no way to know what else is
in there.

Home Assistant can call this on an entry whose setup failed, which is exactly
when it is worth having, so every block reports what it found rather than
assuming a loaded runtime.
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
from .storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore

# What the entry's options can carry that the household chose the words for. The
# card title is free text. `todo_entity_id` is an entity id rather than prose,
# but its object id is whatever the list was named — `todo.alices_shopping` — and
# the diagnostic question it answers, whether the bridge is configured at all,
# survives redaction because the key stays in the dump either way. Everything
# else there is a number or a flag.
_REDACT_OPTIONS = {CONF_CARD_TITLE, CONF_TODO_ENTITY_ID}


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
        return {"loaded": False, "counts": None, "health_issues": None}
    return {
        "loaded": True,
        "counts": _without_household_status_names(repo.get_counts()),
        # The index checks this used to carry moved into the test suite, where
        # they are worth something; see `ws.ws_health`. The key stays so a
        # report from this build has the shape a reader expects.
        "health_issues": [],
    }


def _without_household_status_names(counts: dict[str, Any]) -> dict[str, Any]:
    """Report the spread across statuses without the household's words for them.

    `status_counts` is keyed by every defined slug, and the slug constraint —
    lowercase, digits and underscores, up to 64 of them — does nothing to stop
    one being a name. The diagnostic value is whether items are spread across
    statuses or piled on one, and that survives the anonymisation; the three this
    integration ships stay readable, because a report saying `needs_repair` is
    easier to act on than one saying `custom_2`.
    """

    status_counts = counts.get("status_counts")
    if not isinstance(status_counts, dict):  # pragma: no cover - defensive
        return counts

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
            # Field names, never values: the runtime holds the repository
            # itself, and a dump of it would be the whole inventory. Empty when
            # no entry is loaded, which is the first thing to read here.
            "data_keys": sorted(f.name for f in fields(runtime)) if runtime is not None else [],
            # What is left in the shared domain bucket: the flags recording
            # registrations Home Assistant cannot hand back, which say whether a
            # route or a panel is already in place.
            "shared_keys": sorted(str(key) for key in (hass.data.get(DOMAIN) or {})),
        },
        "options": async_redact_data(dict(entry.options), _REDACT_OPTIONS),
        "frontend_bundle": bundle,
    }
