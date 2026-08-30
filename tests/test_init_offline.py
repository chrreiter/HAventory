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
from custom_components.haventory.migrations import ADOPTABLE_SCHEMA_VERSIONS
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers.storage import Store as HAStore

from runtime_helpers import RETIRED_RATE_LIMIT_OPTIONS, repo_of, runtime_of, setup_entry
from ws_helpers import RecordingConn, ws_send

#: One above everything the amnesty covers: a store no build of this project
#: wrote, and the only kind setup refuses on its schema version.
BEYOND_THE_ADOPTABLE_RANGE = max(ADOPTABLE_SCHEMA_VERSIONS) + 1


def _health_records(caplog) -> list[logging.LogRecord]:
    """The storage-health lines one setup wrote."""

    return [record for record in caplog.records if "Storage health" in record.getMessage()]


@pytest.mark.asyncio
async def test_setup_entry_logs_empty_storage_at_debug(monkeypatch, caplog) -> None:
    """A store that loaded empty is a first run, not a fault: DEBUG, never WARNING.

    Every fresh install starts at 0/0, and HA shows WARNING with no logger
    configuration, so warning here made a new user's first line about HAventory
    a warning about nothing. A store that is unreadable has its own refusals and
    its own Repairs card.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return payload

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    caplog.set_level(logging.DEBUG)

    await setup_entry(hass, entry)

    assert isinstance(repo_of(hass), Repository)
    health = _health_records(caplog)
    assert health, [record.getMessage() for record in caplog.records]
    assert [record.levelno for record in health] == [logging.DEBUG]
    assert "items_count=0" in health[-1].getMessage()
    assert "locations_count=0" in health[-1].getMessage()
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]


@pytest.mark.asyncio
async def test_setup_entry_logs_populated_storage_at_debug(monkeypatch, caplog) -> None:
    """A store with data logs the same line, at the same level, with its counts."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    source = Repository()
    where = source.create_location(name="Garage")
    source.create_item(ItemCreate(name="Drill", location_id=str(where.id)))
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, **source.export_state()}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    caplog.set_level(logging.DEBUG)

    await setup_entry(hass, entry)

    health = _health_records(caplog)
    assert health, [record.getMessage() for record in caplog.records]
    assert [record.levelno for record in health] == [logging.DEBUG]
    assert "items_count=1" in health[-1].getMessage()
    assert "locations_count=1" in health[-1].getMessage()


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_version", sorted(ADOPTABLE_SCHEMA_VERSIONS))
async def test_setup_entry_adopts_a_store_from_before_the_collapse(
    monkeypatch, stored_version: int
) -> None:
    """A store stamped inside the amnesty sets up, rather than stopping the entry.

    Its number is above this build's, which is the shape of the refusal below —
    so the two paths have to be told apart here or an upgrade lands the owner on
    the Repairs card instead of their inventory.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = f"test_init_adopted_v{stored_version}"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    item_id = "11111111-1111-4111-8111-111111111111"
    pre_payload = {
        "schema_version": stored_version,
        "items": {item_id: {"id": item_id, "name": "Screws", "quantity": 5}},
        "locations": {},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    await setup_entry(hass, entry)

    assert repo_of(hass).get_item(item_id).name == "Screws"
    assert (await raw_store.async_load())["schema_version"] == CURRENT_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_setup_entry_refuses_newer_schema_and_leaves_store_intact(monkeypatch) -> None:
    """Data written by a newer build aborts setup permanently and is never rewritten."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_newer_schema_refused"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    newer_version = BEYOND_THE_ADOPTABLE_RANGE
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
async def test_setup_entry_retries_on_a_collection_of_the_wrong_type(monkeypatch) -> None:
    """A stored ``items`` that is not a mapping stops setup rather than half-loading.

    ConfigEntryNotReady, not ConfigEntryError: a file in that state was written
    by something other than this integration, and a restore in the background is
    a fix a retry would pick up.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_collection_wrong_type"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    raw_store = HAStore(hass, DomainStore.HA_STORE_VERSION, key)
    await raw_store.async_save(
        {"schema_version": CURRENT_SCHEMA_VERSION, "items": [], "locations": {}}
    )

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
async def test_setup_entry_ignores_options_no_release_reads_any_more(monkeypatch) -> None:
    """An entry carrying retired option keys loads, and nothing acts on them.

    Home Assistant keeps whatever the last save wrote, so a household that once
    turned the WebSocket rate limiter on still has its nine keys in the entry
    after upgrading. Setup reads the keys it knows by name, so the rest are
    inert rather than a reason to refuse the entry — and the values, which used
    to cap one connection at a single command, cap nothing.
    """

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_CARD_TITLE: "Pantry", **RETIRED_RATE_LIMIT_OPTIONS})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    ws_setup(hass)

    assert runtime_of(hass).card_title == "Pantry"

    conn = RecordingConn()
    for iden in range(1, 5):
        assert (await ws_send(hass, iden, "haventory/ping", conn=conn))["success"] is True

    await haven_init._async_options_updated(hass, entry)
    assert (await ws_send(hass, 5, "haventory/ping", conn=conn))["success"] is True


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
        raise SchemaDowngradeError(
            f"stored data uses schema version {BEYOND_THE_ADOPTABLE_RANGE}, which is newer "
            f"than this build supports ({CURRENT_SCHEMA_VERSION})"
        )

    monkeypatch.setattr(DomainStore, "async_load", _newer)

    with pytest.raises(ConfigEntryError):
        await haven_init.async_setup_entry(hass, entry)

    issue = _issues(hass)[(haven_init.DOMAIN, ISSUE_SCHEMA_DOWNGRADE)]
    assert issue["is_fixable"] is False
    assert issue["severity"] == "error"
    assert str(BEYOND_THE_ADOPTABLE_RANGE) in issue["translation_placeholders"]["error"]
    # The build's own number reaches the card too, and it is the collapsed one.
    assert f"({CURRENT_SCHEMA_VERSION})" in issue["translation_placeholders"]["error"]
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

    await setup_entry(hass, entry)

    # What the copy the repair flow took holds is asserted where that flow can
    # actually run: `tests/integration/test_repairs.py`.
    written = await raw_store.async_load()
    assert set(written["items"]) == {"11111111-1111-4111-8111-111111111111"}
