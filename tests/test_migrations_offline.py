"""Offline tests for HAventory schema handling.

Scenarios:
- The driver stamps a payload below the current version and refuses a downgrade
- The adoptable set is closed: the versions the project shipped to itself, no more
- The adopter fills in every field a store may predate, and only those
- Double application is equal, so a store crossing twice is a store crossing once
- Corrupt payload reaches the storage layer's log with its context attached
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

import pytest
from custom_components.haventory.const import (
    DEFAULT_STATUS_COLOR,
    DEFAULT_STATUS_ICON,
    DOMAIN,
)
from custom_components.haventory.exceptions import SchemaDowngradeError, StorageError
from custom_components.haventory.migrations import (
    ADOPTABLE_SCHEMA_VERSIONS,
    adopt_dev_schema,
    migrate,
)
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORE_COLLECTIONS,
    DomainStore,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore

#: One above everything the amnesty covers: a store no build of this project wrote.
BEYOND_THE_ADOPTABLE_RANGE = max(ADOPTABLE_SCHEMA_VERSIONS) + 1


@pytest.mark.asyncio
async def test_older_version_is_stamped_with_the_current_one() -> None:
    """A payload below the current version comes back carrying it."""

    payload: dict[str, Any] = {"schema_version": 0, "items": {}, "locations": {}}

    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated["items"] == {}
    assert migrated["locations"] == {}


@pytest.mark.asyncio
async def test_noop_when_already_current_and_idempotent() -> None:
    """Current-version payload is preserved and repeated applications are idempotent."""

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    migrated1 = migrate(
        payload,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )
    migrated2 = migrate(
        migrated1,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )

    assert migrated1 == payload
    assert migrated2 == payload


@pytest.mark.asyncio
async def test_the_driver_does_not_alias_or_crash_on_what_it_is_given() -> None:
    """A caller's dict is never the stamped one, and a non-dict is tolerated."""

    payload: dict[str, Any] = {"schema_version": 0, "items": {"i1": {"id": "i1"}}}

    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)
    migrated["items"]["i1"]["name"] = "Screws"

    assert "name" not in payload["items"]["i1"]
    assert payload["schema_version"] == 0

    migrated_non_dict = migrate("oops", from_version=0, to_version=CURRENT_SCHEMA_VERSION)  # type: ignore[arg-type]
    assert migrated_non_dict == {"schema_version": CURRENT_SCHEMA_VERSION}


@pytest.mark.asyncio
async def test_downgrade_is_refused_rather_than_relabelled() -> None:
    """A backwards migration raises instead of passing the payload through.

    Passing it through is the dangerous half: the caller stamps ``to_version``
    onto whatever comes back, so data written by a schema this build cannot read
    would be relabelled as one it can.
    """

    payload = {"schema_version": CURRENT_SCHEMA_VERSION + 1, "items": {}, "locations": {}}
    before = deepcopy(payload)

    with pytest.raises(SchemaDowngradeError) as excinfo:
        migrate(payload, from_version=CURRENT_SCHEMA_VERSION + 1, to_version=CURRENT_SCHEMA_VERSION)

    # Both versions named, so a caller's log says which direction was asked for.
    message = str(excinfo.value)
    assert str(CURRENT_SCHEMA_VERSION + 1) in message
    assert str(CURRENT_SCHEMA_VERSION) in message

    # A refusal touches nothing.
    assert payload == before
    assert isinstance(excinfo.value, StorageError)


@pytest.mark.asyncio
async def test_log_context_on_corrupted_payload_via_storage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Storage logs contextual fields when encountering corrupted payload (non-dict)."""

    # We exercise this via the DomainStore API because logging is implemented there.
    caplog.set_level(logging.ERROR)

    hass = HomeAssistant()
    key = "test_migrate_log_context_corrupt"
    store = DomainStore(hass, key=key)
    raw_store = HAStore(hass, 1, key)

    # Save a corrupted payload (string)
    await raw_store.async_save("oops")

    with pytest.raises(StorageError):
        await store.async_load()

    # Assert log record includes structured context
    found = False
    for rec in caplog.records:
        if (
            rec.levelno >= logging.ERROR
            and getattr(rec, "op", None) == "migrate"
            and getattr(rec, "domain", None) == DOMAIN
        ):
            found = True
            assert getattr(rec, "storage_key", None) == key
            assert getattr(rec, "to_version", None) == store.schema_version
            break
    assert found, "expected migration error log with context"


# -----------------------------
# The closed set
# -----------------------------


def test_the_adoptable_set_is_closed_above() -> None:
    """One past the range is not adoptable: the amnesty is membership, not `>=`.

    A store stamped there was written by a build that knows something this one
    does not, and taking it in would relabel data nothing here can read.
    """

    assert BEYOND_THE_ADOPTABLE_RANGE not in ADOPTABLE_SCHEMA_VERSIONS


def test_the_adoptable_set_leaves_the_forward_path_alone() -> None:
    """0 and 1 are below the current version, so they migrate rather than being adopted."""

    assert 0 not in ADOPTABLE_SCHEMA_VERSIONS
    assert CURRENT_SCHEMA_VERSION not in ADOPTABLE_SCHEMA_VERSIONS
    assert min(ADOPTABLE_SCHEMA_VERSIONS) == CURRENT_SCHEMA_VERSION + 1


def test_the_adopter_produces_every_stored_collection() -> None:
    """A store crossing into this build arrives holding every collection.

    ``STORE_COLLECTIONS`` is what the save path writes and the load path expects.
    A name added there without the adopter producing it would reach the
    repository absent on every store that predates it — which is every store the
    amnesty exists for.
    """

    adopted = adopt_dev_schema({})

    missing = [name for name in STORE_COLLECTIONS if name not in adopted]
    assert not missing, (
        f"the adopter produces no {missing}; a store crossing into this build "
        f"would arrive without them"
    )


# -----------------------------
# The adopter: statuses
# -----------------------------


def _dev_payload(**items: Any) -> dict[str, Any]:
    """A store as a build before the collapse wrote it, at its earliest shape."""

    return {"schema_version": 4, "items": dict(items), "locations": {}}


def _stored_attachment(att_id: str, **overrides: Any) -> dict[str, Any]:
    """An attachment as it was stored before `title` and `order` existed."""

    doc = {
        "id": att_id,
        "kind": "picture",
        "filename": "photo.png",
        "mime": "image/png",
        "size": 12,
        "uploaded_at": "2026-08-05T10:00:00Z",
    }
    doc.update(overrides)
    return doc


def test_the_adopter_seeds_exactly_the_three_built_ins() -> None:
    adopted = adopt_dev_schema(_dev_payload())

    assert adopted["statuses"] == {
        "ok": {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
        "missing": {
            "slug": "missing",
            "label": "Missing",
            "order": 1,
            "color": "amber",
            "icon": "alert",
        },
        "needs_repair": {
            "slug": "needs_repair",
            "label": "Needs repair",
            "order": 2,
            "color": "amber",
            "icon": "wrench",
        },
    }


def test_the_adopter_keeps_the_collection_a_store_already_carries() -> None:
    """A household's own vocabulary crosses as it stands, nothing added to it.

    Every built-in but the default can be deleted, so seeding into a collection
    that is already there would put `missing` and `needs_repair` back on the
    first boot after the upgrade — and again after every later one.
    """

    payload = _dev_payload()
    payload["statuses"] = {
        "ok": {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
        "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9},
    }

    adopted = adopt_dev_schema(payload)

    assert set(adopted["statuses"]) == {"ok", "lent_out"}
    # What it does fill in is an appearance a definition carries neither half of.
    assert adopted["statuses"]["lent_out"] == {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": DEFAULT_STATUS_COLOR,
        "icon": DEFAULT_STATUS_ICON,
    }


def test_the_adopter_completes_a_definition_that_predates_the_appearance() -> None:
    payload = _dev_payload()
    payload["statuses"] = {
        "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9, "color": "blue"}
    }

    adopted = adopt_dev_schema(payload)

    assert adopted["statuses"]["lent_out"]["color"] == "blue"
    assert adopted["statuses"]["lent_out"]["icon"] == DEFAULT_STATUS_ICON


def test_the_adopter_leaves_a_collection_in_the_list_form_alone() -> None:
    """A store restored by hand from an export holds the list an export carries.

    The load path reads that shape, so the fills have to leave it as it is — and
    still read the slugs out of it, or every item on a status only the list names
    would be rewritten to the default.
    """

    payload = _dev_payload(a={"id": "a", "name": "Skis", "status": "lent_out"})
    payload["statuses"] = [
        {"slug": "ok", "label": "OK", "order": 0},
        {"slug": "lent_out", "label": "Lent out", "order": 1},
    ]

    adopted = adopt_dev_schema(payload)

    assert adopted["statuses"] == payload["statuses"]
    assert adopted["items"]["a"]["status"] == "lent_out"


def test_the_adopter_gives_an_item_without_a_status_the_default() -> None:
    """From the version that introduced the field, every item carries exactly one."""

    adopted = adopt_dev_schema(
        _dev_payload(
            a={"id": "a", "name": "Hammer"},
            b={"id": "b", "name": "Drill", "status": "needs_repair"},
        )
    )

    assert adopted["items"]["a"]["status"] == "ok"
    assert adopted["items"]["b"]["status"] == "needs_repair"


def test_the_adopter_keeps_an_item_on_a_status_the_household_defined() -> None:
    """The rewrite is for slugs the store cannot name, and a custom one it can.

    The adopter runs on every store it accepts, not only on those written before
    the status vocabulary was editable, so a rule of "anything but the built-in
    three becomes ok" would silently flatten a household's own statuses on the
    upgrade that adopts the store.
    """

    payload = _dev_payload(
        a={"id": "a", "name": "Skis", "status": "lent_out"},
        b={"id": "b", "name": "Drill", "status": "shattered"},
    )
    payload["statuses"] = {
        "ok": {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
        "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9, "color": "blue"},
    }

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["a"]["status"] == "lent_out"
    # Nothing in the store names this one, so it reads as the default.
    assert adopted["items"]["b"]["status"] == "ok"


# -----------------------------
# The adopter: attachments
# -----------------------------


def test_the_adopter_gives_every_item_an_attachment_list() -> None:
    adopted = adopt_dev_schema(
        _dev_payload(
            i1={"id": "i1", "name": "Drill", "status": "ok"},
            i2={"id": "i2", "name": "Saw", "status": "missing"},
        )
    )

    assert adopted["items"]["i1"]["attachments"] == []
    assert adopted["items"]["i2"]["attachments"] == []


def test_the_adopter_does_not_replace_a_list_that_already_has_entries() -> None:
    """The fill fills in what is absent; it never clears what is there."""

    existing = [_stored_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f")]
    payload = _dev_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["i1"]["attachments"] == [{**existing[0], "title": "", "order": 0}]


def test_the_adopter_numbers_each_attachment_kind_from_zero() -> None:
    """Order is per kind, the way `reorder_attachments` writes it.

    Numbering straight down the list would make an item's first manual
    position 1 or 5 depending on how many photos happened to precede it, and
    nothing would ever be the documents list's own first entry.
    """

    existing = [
        _stored_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f"),
        _stored_attachment(
            "4a1d7e3b-2c5f-4b0d-8e4a-3b8c9d2e1f60",
            kind="manual",
            filename="a.pdf",
            mime="application/pdf",
        ),
        _stored_attachment("5b2e8f4c-3d60-4c1e-9f5b-4c9d0e3f2a71"),
        _stored_attachment(
            "6c3f9a5d-4e71-4d2f-a06c-5d0e1f403b82",
            kind="manual",
            filename="b.pdf",
            mime="application/pdf",
        ),
    ]
    payload = _dev_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    adopted = adopt_dev_schema(payload)

    placed = [(a["kind"], a["order"]) for a in adopted["items"]["i1"]["attachments"]]
    assert placed == [("picture", 0), ("manual", 0), ("picture", 1), ("manual", 1)]


def test_the_adopter_keeps_an_attachment_title_and_order_it_did_not_write() -> None:
    payload = _dev_payload(
        i1={
            "id": "i1",
            "name": "Drill",
            "attachments": [
                _stored_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f", title="Cover", order=4)
            ],
        }
    )

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["i1"]["attachments"][0] == _stored_attachment(
        "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f", title="Cover", order=4
    )


# -----------------------------
# The adopter: reminders
# -----------------------------


def test_the_adopter_gives_every_item_an_empty_reminder() -> None:
    """An item written before the fields existed had no reminder, and null says so."""

    adopted = adopt_dev_schema(
        _dev_payload(
            i1={"id": "i1", "name": "HVAC filter", "quantity": 1},
            i2={"id": "i2", "name": "Ladder", "quantity": 1},
        )
    )

    for item in adopted["items"].values():
        assert item["reminder_date"] is None
        assert item["reminder_interval"] is None
        assert item["reminder_anchor"] is None


def test_the_adopter_anchors_a_reminder_on_its_own_date() -> None:
    """Before the anchor existed a bump rewrote the date, so the date *is* the anchor.

    Nothing knows how far such a series had already drifted, and nothing needs
    to: from here on it is measured from wherever it currently stands.
    """

    payload = _dev_payload(
        i1={
            "id": "i1",
            "name": "HVAC filter",
            "reminder_date": "2026-09-30",
            "reminder_interval": {"unit": "months", "count": 1},
        },
        i2={"id": "i2", "name": "Ladder", "reminder_date": None, "reminder_interval": None},
    )

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["i1"]["reminder_anchor"] == "2026-09-30"
    assert adopted["items"]["i2"]["reminder_anchor"] is None


def test_the_adopter_keeps_a_reminder_and_an_anchor_it_did_not_write() -> None:
    """Filling in what is absent, never resetting what a bump has moved."""

    payload = _dev_payload(
        i1={
            "id": "i1",
            "name": "HVAC filter",
            "reminder_date": "2026-09-30",
            "reminder_interval": {"unit": "months", "count": 3},
            "reminder_anchor": "2026-08-31",
        }
    )

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["i1"]["reminder_date"] == "2026-09-30"
    assert adopted["items"]["i1"]["reminder_interval"] == {"unit": "months", "count": 3}
    assert adopted["items"]["i1"]["reminder_anchor"] == "2026-08-31"


# -----------------------------
# The adopter: shape and idempotence
# -----------------------------


def test_the_adopter_is_idempotent() -> None:
    """A store crossing twice is a store crossing once.

    The load path runs this on every payload it accepts, so a second boot — and
    a second install of the same build — has to produce what the first did.
    """

    payload = _dev_payload(
        i1={"id": "i1", "name": "Drill"},
        i2={
            "id": "i2",
            "name": "HVAC filter",
            "reminder_date": "2026-09-30",
            "reminder_interval": {"unit": "months", "count": 1},
            "attachments": [_stored_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f")],
        },
    )

    once = adopt_dev_schema(payload)
    twice = adopt_dev_schema(deepcopy(once))

    assert twice == once


def test_the_adopter_does_not_alias_the_payload_it_was_given() -> None:
    """The fills land on the adopter's copy, or a caller's dict is the adopted one."""

    payload = _dev_payload(i1={"id": "i1", "name": "Drill"})

    adopted = adopt_dev_schema(payload)
    adopted["items"]["i1"]["reminder_date"] = "2026-09-01"

    assert "reminder_date" not in payload["items"]["i1"]
    assert "statuses" not in payload


def test_the_adopter_leaves_a_row_that_is_not_a_dict_alone() -> None:
    """A corrupt row is the load report's business, not the adopter's."""

    payload = _dev_payload(broken="not-an-item")
    payload["items"]["i1"] = {"id": "i1", "name": "Drill"}

    adopted = adopt_dev_schema(payload)

    assert adopted["items"]["broken"] == "not-an-item"
    assert adopted["items"]["i1"]["status"] == "ok"


def test_the_adopter_tolerates_collections_it_cannot_walk() -> None:
    """A shape it cannot read is left for the load path to name."""

    assert adopt_dev_schema({"schema_version": 7, "items": None})["items"] is None


def test_the_adopter_fills_in_an_empty_payload() -> None:
    """A store holding nothing but a stamp still arrives with the collections."""

    adopted = adopt_dev_schema({})

    assert adopted["items"] == {}
    assert adopted["locations"] == {}
    assert sorted(adopted["statuses"]) == ["missing", "needs_repair", "ok"]
