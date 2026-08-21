"""Offline tests for integration setup and storage health."""

from __future__ import annotations

import logging
from copy import deepcopy

import custom_components.haventory as haven_init
import pytest
from custom_components.haventory.const import (
    CONF_ALLOW_LOSSY_LOAD,
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CORRUPT_BACKUP_STORAGE_KEY,
    DEFAULT_CARD_TITLE,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_CORRUPT_STORE,
    ISSUE_SCHEMA_DOWNGRADE,
    REPAIR_ISSUE_IDS,
)
from custom_components.haventory.exceptions import (
    CorruptSchemaVersionError,
    SchemaDowngradeError,
)
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers.storage import Store as HAStore

from runtime_helpers import repo_of, runtime_of, setup_entry


@pytest.mark.asyncio
async def test_setup_entry_logs_warning_for_empty_storage(monkeypatch, caplog) -> None:
    """Empty storage payload logs a warning but completes setup."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return payload

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    caplog.set_level(logging.WARNING)

    await setup_entry(hass, entry)

    assert isinstance(repo_of(hass), Repository)
    assert any("Storage health" in record.message for record in caplog.records)
    assert any(
        record.levelname == "WARNING" and "Storage health" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_setup_entry_invalid_version_raises(monkeypatch) -> None:
    """Schema version mismatch triggers ConfigEntryNotReady."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _bad_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": 0, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _bad_load)

    with pytest.raises(ConfigEntryNotReady):
        await haven_init.async_setup_entry(hass, entry)


@pytest.mark.asyncio
async def test_setup_entry_refuses_newer_schema_and_leaves_store_intact(monkeypatch) -> None:
    """Data written by a newer build aborts setup permanently and is never rewritten."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_newer_schema_refused"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    newer_version = CURRENT_SCHEMA_VERSION + 1
    pre_payload = {
        "schema_version": newer_version,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    # ConfigEntryError, not ConfigEntryNotReady: retrying cannot make this build
    # understand newer data, so HA must stop instead of backing off forever.
    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert str(newer_version) in message
    assert str(CURRENT_SCHEMA_VERSION) in message
    assert "Upgrade HAventory" in message

    assert await raw_store.async_load() == pre_payload
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_validate_storage_payload_reports_newer_version_specifically() -> None:
    """A newer payload reaching validation is refused with the downgrade message."""

    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION + 2,
        "items": {},
        "locations": {},
    }

    with pytest.raises(SchemaDowngradeError) as excinfo:
        haven_init._validate_storage_payload(payload, schema_version=CURRENT_SCHEMA_VERSION)

    assert str(CURRENT_SCHEMA_VERSION + 2) in str(excinfo.value)


@pytest.mark.asyncio
async def test_setup_entry_refuses_corrupt_schema_version_and_leaves_store_intact(
    monkeypatch,
) -> None:
    """A non-integer schema_version stops setup with the corruption message."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_corrupt_schema_version"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    pre_payload = {
        "schema_version": None,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    # ConfigEntryError, not ConfigEntryNotReady: backing off forever cannot repair
    # a corrupt file, and the generic "storage load failed" hid what was wrong.
    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert "schema_version" in message
    assert "None" in message

    assert await raw_store.async_load() == pre_payload
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_validate_storage_payload_rejects_a_numeric_string_version() -> None:
    """``"5"`` is corruption, not the current version — validation must not coerce it."""

    payload = {
        "schema_version": str(CURRENT_SCHEMA_VERSION),
        "items": {},
        "locations": {},
    }

    with pytest.raises(CorruptSchemaVersionError) as excinfo:
        haven_init._validate_storage_payload(payload, schema_version=CURRENT_SCHEMA_VERSION)

    assert repr(str(CURRENT_SCHEMA_VERSION)) in str(excinfo.value)


@pytest.mark.asyncio
async def test_setup_entry_invalid_collections_raise(monkeypatch) -> None:
    """Non-dict collections trigger ConfigEntryNotReady."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _bad_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": [], "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _bad_load)

    with pytest.raises(ConfigEntryNotReady):
        await haven_init.async_setup_entry(hass, entry)


@pytest.mark.asyncio
async def test_setup_entry_publishes_card_title(monkeypatch) -> None:
    """The card title option is resolved into hass.data for haventory/config."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_CARD_TITLE: "Pantry"})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    assert runtime_of(hass).card_title == "Pantry"

    entry.options[CONF_CARD_TITLE] = "Garage"
    await haven_init._async_options_updated(hass, entry)
    assert runtime_of(hass).card_title == "Garage"


@pytest.mark.asyncio
async def test_setup_entry_publishes_the_quick_filter_choice(monkeypatch) -> None:
    """The pill option reaches hass.data, and an edit to it lands there too."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_QUICK_FILTERS: ["low_stock", "total"]})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    # Canonical order, not the order the checkboxes were ticked in.
    assert runtime_of(hass).quick_filters == ["total", "low_stock"]

    entry.options[CONF_QUICK_FILTERS] = []
    await haven_init._async_options_updated(hass, entry)
    assert runtime_of(hass).quick_filters == []


@pytest.mark.asyncio
async def test_setup_entry_leaves_the_quick_filter_choice_unset(monkeypatch) -> None:
    """No stored choice is `None`, which is not the same as an empty list.

    `None` leaves a dashboard's own `quick_filters:` to decide and the card to
    offer every pill; `[]` is a household asking for none.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    assert runtime_of(hass).quick_filters is None


@pytest.mark.asyncio
async def test_setup_entry_defaults_card_title_for_older_entries(monkeypatch) -> None:
    """An entry created before the option existed still gets a usable heading."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    assert runtime_of(hass).card_title == DEFAULT_CARD_TITLE


@pytest.mark.asyncio
async def test_setup_entry_refuses_a_store_it_cannot_fully_read(monkeypatch) -> None:
    """A corrupt row stops setup instead of loading the rest over it.

    Every WS and service handler persists immediately, so a loaded entry rewrites
    the store without the unreadable rows on the first mutation. Refusing is what
    keeps the file repairable; the message has to say which file and how much.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {"not-a-uuid": {"id": "not-a-uuid", "name": "Broken"}},
    }

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert "1 item(s)" in message
    assert "haventory_store" in message
    assert "not-a-uuid" in message
    # The entry never got a repository, so nothing downstream can persist over
    # the file we just refused to read.
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_setup_entry_accepts_a_readable_store(monkeypatch) -> None:
    """The refusal above must not fire for a store this build reads end to end."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    source = Repository()
    where = source.create_location(name="Garage")
    source.create_item(ItemCreate(name="Drill", location_id=str(where.id)))
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, **source.export_state()}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    assert isinstance(repo_of(hass), Repository)


def _issues(hass: HomeAssistant) -> dict:
    """What the offline issue-registry stub recorded, keyed as HA keys it."""

    return hass.data.get("__issue_registry__") or {}


def _corrupt_payload() -> dict:
    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {
            "not-a-uuid": {"id": "not-a-uuid", "name": "Broken"},
            "also-not-a-uuid": {"id": "also-not-a-uuid", "name": "Also broken"},
        },
    }


@pytest.mark.asyncio
async def test_a_newer_store_also_reaches_settings_repairs(monkeypatch) -> None:
    """The entry's error state is one screen; Repairs is the one users are sent to."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _newer(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION + 1, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _newer)

    with pytest.raises(ConfigEntryError):
        await haven_init.async_setup_entry(hass, entry)

    issue = _issues(hass)[(haven_init.DOMAIN, ISSUE_SCHEMA_DOWNGRADE)]
    assert issue["is_fixable"] is False
    assert issue["severity"] == "error"
    assert str(CURRENT_SCHEMA_VERSION + 1) in issue["translation_placeholders"]["error"]
    assert issue["translation_placeholders"]["storage_key"] == STORAGE_KEY


@pytest.mark.asyncio
async def test_an_unreadable_schema_version_reaches_settings_repairs(monkeypatch) -> None:
    """Its own id, so restoring a store fixes one card rather than leaving the wrong one."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _corrupt_version(self):  # type: ignore[no-untyped-def]
        raise CorruptSchemaVersionError("stored data has a corrupt schema_version (None)")

    monkeypatch.setattr(DomainStore, "async_load", _corrupt_version)

    with pytest.raises(ConfigEntryError):
        await haven_init.async_setup_entry(hass, entry)

    assert (haven_init.DOMAIN, ISSUE_CORRUPT_SCHEMA_VERSION) in _issues(hass)
    assert (haven_init.DOMAIN, ISSUE_SCHEMA_DOWNGRADE) not in _issues(hass)


@pytest.mark.asyncio
async def test_a_corrupt_store_offers_the_fixable_issue(monkeypatch) -> None:
    """The only fixable one: the readable remainder is intact, so going on is a choice."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(_corrupt_payload())

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    with pytest.raises(ConfigEntryError):
        await haven_init.async_setup_entry(hass, entry)

    issue = _issues(hass)[(haven_init.DOMAIN, ISSUE_CORRUPT_STORE)]
    assert issue["is_fixable"] is True
    assert issue["severity"] == "warning"
    assert issue["translation_placeholders"]["items"] == "2"
    assert issue["translation_placeholders"]["backup_key"] == CORRUPT_BACKUP_STORAGE_KEY


@pytest.mark.asyncio
async def test_a_store_that_loads_clears_every_issue(monkeypatch) -> None:
    """A card describing a store the integration just read is a card that lies."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    hass.data["__issue_registry__"] = {
        (haven_init.DOMAIN, issue_id): {} for issue_id in REPAIR_ISSUE_IDS
    }

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    assert _issues(hass) == {}


@pytest.mark.asyncio
async def test_the_repair_option_loads_the_readable_remainder(monkeypatch, caplog) -> None:
    """What the fix flow buys: the same store, loaded, minus what could not be read."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_ALLOW_LOSSY_LOAD: True})
    payload = _corrupt_payload()
    payload["items"]["11111111-1111-4111-8111-111111111111"] = {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Readable",
        "quantity": 1,
    }

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)
    caplog.set_level(logging.WARNING)

    await setup_entry(hass, entry)

    repository = repo_of(hass)
    assert repository.get_counts()["items_total"] == 1
    assert any("as the repair asked" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_the_repair_option_is_spent_on_the_boot_it_buys(monkeypatch) -> None:
    """Left set, it would silently accept the next corruption too — a standing waiver."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_ALLOW_LOSSY_LOAD: True, CONF_CARD_TITLE: "Pantry"})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(_corrupt_payload())

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)

    assert CONF_ALLOW_LOSSY_LOAD not in entry.options
    # The rest of the options survive the edit; only the opt-in is taken back.
    assert entry.options[CONF_CARD_TITLE] == "Pantry"
    assert (haven_init.DOMAIN, ISSUE_CORRUPT_STORE) not in _issues(hass)


@pytest.mark.asyncio
async def test_a_clean_load_spends_a_leftover_repair_option(monkeypatch) -> None:
    """The option only lingers where it is most dangerous: on a store that reads fine.

    That is where a restored backup and a failed reload both land, and a waiver
    left armed there is spent by the *next* corruption — which arrives with no
    copy of the store taken and no card raised.
    """

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_ALLOW_LOSSY_LOAD: True, CONF_CARD_TITLE: "Pantry"})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)

    assert CONF_ALLOW_LOSSY_LOAD not in entry.options
    assert entry.options[CONF_CARD_TITLE] == "Pantry"


@pytest.mark.asyncio
async def test_an_ordinary_boot_does_not_write_the_entry_back(monkeypatch) -> None:
    """Nothing to spend means nothing to write: every boot would otherwise touch the entry."""

    hass = HomeAssistant()
    registry = hass.config_entries
    hass.config_entries = registry
    entry = ConfigEntry(options={CONF_CARD_TITLE: "Pantry"})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)

    assert registry.updates == []


@pytest.mark.asyncio
async def test_a_lossy_load_rewrites_the_store_it_could_not_fully_read(monkeypatch) -> None:
    """Otherwise the repair holds until the next restart and no further.

    The lossy load leaves the unreadable rows on disk, so a household that
    repairs, sees it work and restarts that evening meets the same refusal —
    with a backup file that looks like the only thing the repair did.
    """

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_ALLOW_LOSSY_LOAD: True})
    key = "test_init_lossy_load_rewrites"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    payload = _corrupt_payload()
    payload["items"]["11111111-1111-4111-8111-111111111111"] = {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Readable",
        "quantity": 1,
    }
    raw_store = HAStore(hass, DomainStore.HA_STORE_VERSION, key)
    await raw_store.async_save(deepcopy(payload))
    backup = HAStore(hass, DomainStore.HA_STORE_VERSION, CORRUPT_BACKUP_STORAGE_KEY)
    await backup.async_remove()

    try:
        await setup_entry(hass, entry)

        written = await raw_store.async_load()
        assert set(written["items"]) == {"11111111-1111-4111-8111-111111111111"}
        # The rows that just left the store are in the copy, which is what makes
        # rewriting it something other than deleting them.
        assert set((await backup.async_load())["items"]) == set(payload["items"])
    finally:
        # The stub's backing dict is module-global, so a copy left under the real
        # key would outlive this test.
        await backup.async_remove()


@pytest.mark.asyncio
async def test_a_lossy_load_that_cannot_be_copied_leaves_the_store_alone(
    monkeypatch, caplog
) -> None:
    """No copy, no rewrite: the rows stay recoverable at the price of one more refusal."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_ALLOW_LOSSY_LOAD: True})
    key = "test_init_lossy_load_no_copy"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    payload = _corrupt_payload()
    raw_store = HAStore(hass, DomainStore.HA_STORE_VERSION, key)
    await raw_store.async_save(deepcopy(payload))

    async def _no_copy(_hass, **_kwargs):  # type: ignore[no-untyped-def]
        return False

    monkeypatch.setattr(haven_init, "async_backup_store", _no_copy)
    caplog.set_level(logging.ERROR)

    await setup_entry(hass, entry)

    assert await raw_store.async_load() == payload
    assert any("could not copy it aside" in record.message for record in caplog.records)
