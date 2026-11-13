"""The setup refusals as Settings → Repairs issues, and the corrupt-store opt-in.

A schema refusal is reported but cannot be fixed from Repairs. A store with
unreadable rows gets the fixable issue, whose flow in ``repairs.py`` copies the
store aside and sets ``CONF_ALLOW_LOSSY_LOAD``. That option is good for one boot:
setup spends it on any load that gets through. No issue is persistent, because
each describes only the last setup attempt.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import (
    CONF_ALLOW_LOSSY_LOAD,
    CORRUPT_BACKUP_STORAGE_KEY,
    DOMAIN,
    ISSUE_CORRUPT_STORE,
    REPAIR_ISSUE_IDS,
)
from .load_report import LoadReport

# How many ids of each kind the corrupt-store refusal quotes. Enough to grep the
# file with, few enough that a wholesale corruption does not paste thousands of
# uuids into the config entry's error state.
_CORRUPT_SAMPLE_IDS = 3


def create_refusal_issue(
    hass: HomeAssistant, issue_id: str, exc: Exception, *, store_key: str
) -> None:
    """Put a schema refusal in Settings → Repairs as well as the entry's error state.

    Not persistent: the issue describes the last setup attempt, and a stored copy
    would outlive a store the user has since restored.
    """

    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key=issue_id,
        translation_placeholders={"error": str(exc), "storage_key": store_key},
    )


def create_corrupt_store_issue(hass: HomeAssistant, report: LoadReport, *, store_key: str) -> None:
    """Offer the guarded "load anyway" for a store with unreadable rows; `repairs.py` runs it."""

    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_CORRUPT_STORE,
        is_fixable=True,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_CORRUPT_STORE,
        translation_placeholders={
            "items": str(len(report.dropped_item_ids)),
            "locations": str(len(report.dropped_location_ids)),
            "cyclic_locations": str(len(report.cyclic_location_ids)),
            "storage_key": store_key,
            "backup_key": CORRUPT_BACKUP_STORAGE_KEY,
        },
    )


def delete_refusal_issues(hass: HomeAssistant) -> None:
    """Clear every repairs issue setup can raise. Deleting an absent one is not an error."""

    for issue_id in REPAIR_ISSUE_IDS:
        ir.async_delete_issue(hass, DOMAIN, issue_id)


def lossy_load_allowed(entry: ConfigEntry) -> bool:
    """Whether the corrupt-store repair has been run and its reload is now arriving."""

    return bool(entry.options.get(CONF_ALLOW_LOSSY_LOAD))


def clear_lossy_load_option(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Take the one-boot opt-in back off the entry, without rewriting an unchanged one."""

    if not lossy_load_allowed(entry):
        return

    options = {key: value for key, value in entry.options.items() if key != CONF_ALLOW_LOSSY_LOAD}
    hass.config_entries.async_update_entry(entry, options=options)


def corrupt_store_message(report: LoadReport, *, store_key: str) -> str:
    """Explain a refused load: counts, a few ids labelled by kind, and the file."""

    parts: list[str] = []
    if report.dropped_item_ids:
        parts.append(f"{len(report.dropped_item_ids)} item(s)")
    if report.dropped_location_ids:
        parts.append(f"{len(report.dropped_location_ids)} location(s)")
    if report.cyclic_location_ids:
        cycle = f"{len(report.cyclic_location_ids)} location(s) in a parent cycle"
        if report.unrooted_location_ids:
            cycle += f" (blocking {len(report.unrooted_location_ids)} below them)"
        parts.append(cycle)

    # Cycle members only. A location merely sitting below a cycle needs no edit,
    # so naming it sends the user to a row where there is nothing to change.
    sample = [
        *(f"item {i}" for i in report.dropped_item_ids[:_CORRUPT_SAMPLE_IDS]),
        *(f"location {i}" for i in report.dropped_location_ids[:_CORRUPT_SAMPLE_IDS]),
        *(f"location {i} (parent_id)" for i in report.cyclic_location_ids[:_CORRUPT_SAMPLE_IDS]),
    ]
    detail = f" First affected ids: {'; '.join(sample)}." if sample else ""
    return (
        f"HAventory could not read {' and '.join(parts)} from .storage/{store_key}, "
        f"so setup stopped instead of loading a partial inventory and overwriting the "
        f"file on the next change.{detail} The store has been left untouched — restore "
        f"it from a backup, or repair those entries, then reload the integration. "
        f"Removing and re-adding the integration will not help: it leaves the file "
        f"exactly as it is, so setup stops here again."
    )
