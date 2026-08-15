"""Offline tests for HAventory storage migrations.

Scenarios:
- Older version N → current version: transformed shape and version update
- No-op when already current; idempotency on repeated runs
- Empty file / missing keys → safe defaults
- Backwards migration → refused rather than passed through and relabelled
- Corrupt payload / loader exception → logged with context and safe fallback
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
    migrate,
    migrate_5_to_6,
    migrate_6_to_7,
    migrate_7_to_8,
    migrate_8_to_9,
)
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORE_COLLECTIONS,
    DomainStore,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore


@pytest.mark.asyncio
async def test_older_version_is_migrated_to_current() -> None:
    """Older payload is upgraded to the current schema with required keys."""

    # Arrange: simulate a v0 payload missing required keys
    payload: dict[str, Any] = {"schema_version": 0}

    # Act
    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    # Assert
    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    assert isinstance(migrated.get("items"), dict)
    assert isinstance(migrated.get("locations"), dict)


@pytest.mark.asyncio
async def test_noop_when_already_current_and_idempotent() -> None:
    """Current-version payload is preserved and repeated applications are idempotent."""

    # Arrange
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    # Act
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

    # Assert: equal structure preserved and stable across repeated calls
    assert migrated1 == payload
    assert migrated2 == payload


@pytest.mark.asyncio
async def test_missing_keys_and_empty_payload_safe_defaults() -> None:
    """Migration fills in defaults when keys are missing or input is empty/invalid."""

    # Missing keys but has schema_version 0
    migrated_missing = migrate(
        {"schema_version": 0}, from_version=0, to_version=CURRENT_SCHEMA_VERSION
    )
    assert migrated_missing["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_missing["items"] == {}
    assert migrated_missing["locations"] == {}

    # Empty dict without schema_version (treated as v0 by caller of migrate)
    migrated_empty = migrate({}, from_version=0, to_version=CURRENT_SCHEMA_VERSION)
    assert migrated_empty["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_empty["items"] == {}
    assert migrated_empty["locations"] == {}

    # Non-dict payload input should be tolerated by step functions; driver normalizes
    migrated_non_dict = migrate("oops", from_version=0, to_version=CURRENT_SCHEMA_VERSION)  # type: ignore[arg-type]
    assert migrated_non_dict["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_non_dict["items"] == {}
    assert migrated_non_dict["locations"] == {}


@pytest.mark.asyncio
async def test_downgrade_is_refused_rather_than_relabelled() -> None:
    """A backwards migration raises instead of passing the payload through.

    Passing it through is the dangerous half: the caller stamps ``to_version``
    onto whatever comes back, so data written by a schema this build cannot read
    would be relabelled as one it can.
    """

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}
    before = deepcopy(payload)

    with pytest.raises(SchemaDowngradeError) as excinfo:
        migrate(payload, from_version=CURRENT_SCHEMA_VERSION, to_version=CURRENT_SCHEMA_VERSION - 1)

    # Both versions named, so a caller's log says which direction was asked for.
    message = str(excinfo.value)
    assert str(CURRENT_SCHEMA_VERSION) in message
    assert str(CURRENT_SCHEMA_VERSION - 1) in message

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


def test_the_migration_chain_produces_every_stored_collection() -> None:
    """A store crossing a version boundary arrives holding every collection.

    ``async_load`` backfills ``STORE_COLLECTIONS`` only on the branch where the
    stored version already matches; a payload that goes through ``migrate`` comes
    back as whatever the chain produced. So the chain, not the backfill, is what
    an *upgrading* store depends on — and the backfill deliberately does not cover
    it, because a new collection generally needs deriving rather than defaulting
    to empty, and a silent ``{}`` would hide the missing step exactly the way the
    erased-collection bug it guards against was hidden.

    Adding a name to ``STORE_COLLECTIONS`` without a migration step that produces
    it fails here.
    """

    migrated = migrate({}, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    missing = [name for name in STORE_COLLECTIONS if name not in migrated]
    assert not missing, (
        f"the 0 -> {CURRENT_SCHEMA_VERSION} chain produces no {missing}; an existing "
        f"store would finish migrating without them"
    )


# -----------------------------
# v5 -> v6: statuses + attachments (one step for the whole milestone)
# -----------------------------


def _v5_payload(**items: Any) -> dict[str, Any]:
    return {
        "schema_version": 5,
        "items": dict(items),
        "locations": {},
    }


def _v5_attachment(att_id: str, **overrides: Any) -> dict[str, Any]:
    """An attachment as v5 stored it — before `title` and `order` existed."""

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


def test_v5_to_v6_seeds_exactly_the_three_built_ins() -> None:
    out = migrate(_v5_payload(), from_version=5, to_version=6)

    assert out["statuses"] == {
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


def test_v5_to_v6_backfills_attachments_on_every_item() -> None:
    payload = _v5_payload(
        i1={"id": "i1", "name": "Drill", "status": "ok"},
        i2={"id": "i2", "name": "Saw", "status": "missing"},
    )

    out = migrate(payload, from_version=5, to_version=6)

    assert out["items"]["i1"]["attachments"] == []
    assert out["items"]["i2"]["attachments"] == []


def test_v5_to_v6_does_not_replace_a_list_that_already_has_entries() -> None:
    """The backfill fills in what is absent; it never clears what is there."""

    existing = [_v5_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f")]
    payload = _v5_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    out = migrate(payload, from_version=5, to_version=6)

    assert out["items"]["i1"]["attachments"] == [
        {**existing[0], "title": "", "order": 0},
    ]


def test_v5_to_v6_keeps_a_status_definition_it_did_not_seed() -> None:
    """A hand-added or later-release definition survives the seeding step."""

    payload = _v5_payload()
    payload["statuses"] = {"lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9}}

    out = migrate(payload, from_version=5, to_version=6)

    assert out["statuses"]["lent_out"] == {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": DEFAULT_STATUS_COLOR,
        "icon": DEFAULT_STATUS_ICON,
    }
    assert set(out["statuses"]) == {"lent_out", "ok", "missing", "needs_repair"}


def test_v5_to_v6_gives_an_existing_definition_the_default_appearance() -> None:
    """A store already stamped v6 never re-runs this step, so a definition that
    predates the appearance fields has to read its defaults at load time — but a
    v5 store crossing now gets them written, and a partial one is completed."""

    payload = _v5_payload()
    payload["statuses"] = {
        "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9, "color": "blue"}
    }

    out = migrate(payload, from_version=5, to_version=6)

    assert out["statuses"]["lent_out"]["color"] == "blue"
    assert out["statuses"]["lent_out"]["icon"] == DEFAULT_STATUS_ICON


def test_v5_to_v6_orders_attachments_by_their_stored_position() -> None:
    """`order` is what the cover convention reads, so an existing list has to
    acquire one — position 0 is the item's cover from the moment it exists."""

    existing = [
        _v5_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f"),
        _v5_attachment("4a1d7e3b-2c5f-4b0d-8e4a-3b8c9d2e1f60"),
    ]
    payload = _v5_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    out = migrate(payload, from_version=5, to_version=6)

    assert [a["order"] for a in out["items"]["i1"]["attachments"]] == [0, 1]
    assert [a["title"] for a in out["items"]["i1"]["attachments"]] == ["", ""]


def test_v5_to_v6_numbers_each_kind_from_zero() -> None:
    """Order is per kind, the way `reorder_attachments` writes it.

    Numbering straight down the list would make an item's first manual
    position 1 or 5 depending on how many photos happened to precede it, and
    nothing would ever be the documents list's own first entry.
    """

    existing = [
        _v5_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f"),
        _v5_attachment(
            "4a1d7e3b-2c5f-4b0d-8e4a-3b8c9d2e1f60",
            kind="manual",
            filename="a.pdf",
            mime="application/pdf",
        ),
        _v5_attachment("5b2e8f4c-3d60-4c1e-9f5b-4c9d0e3f2a71"),
        _v5_attachment(
            "6c3f9a5d-4e71-4d2f-a06c-5d0e1f403b82",
            kind="manual",
            filename="b.pdf",
            mime="application/pdf",
        ),
    ]
    payload = _v5_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    out = migrate(payload, from_version=5, to_version=6)

    placed = [(a["kind"], a["order"]) for a in out["items"]["i1"]["attachments"]]
    assert placed == [("picture", 0), ("manual", 0), ("picture", 1), ("manual", 1)]


def test_v5_to_v6_keeps_an_attachment_title_and_order_it_did_not_write() -> None:
    payload = _v5_payload(
        i1={
            "id": "i1",
            "name": "Drill",
            "attachments": [
                _v5_attachment("3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f", title="Cover", order=4)
            ],
        }
    )

    out = migrate(payload, from_version=5, to_version=6)

    assert out["items"]["i1"]["attachments"][0] == _v5_attachment(
        "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f", title="Cover", order=4
    )


def test_v5_to_v6_is_idempotent() -> None:
    """The step itself, re-applied — not the driver, which would skip it."""

    payload = _v5_payload(i1={"id": "i1", "name": "Drill"})

    once = migrate_5_to_6(deepcopy(payload))
    twice = migrate_5_to_6(deepcopy(once))

    assert twice == once


#: The version from which a status ``color`` may be a ``#rrggbb`` literal rather
#: than one of the ten tone tokens, and the one below it.
_HEX_STATUS_COLOUR_VERSION = 7
_TOKEN_ONLY_COLOUR_VERSION = _HEX_STATUS_COLOUR_VERSION - 1


def _v6_payload_with_token_colour() -> dict[str, Any]:
    """A v6 store: every status colour is a tone token, which v6 and v7 both read."""

    return {
        "schema_version": _TOKEN_ONLY_COLOUR_VERSION,
        "items": {"i1": {"id": "i1", "name": "Drill", "status": "loaned", "attachments": []}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
        "statuses": {
            "ok": {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
            "loaned": {
                "slug": "loaned",
                "label": "Loaned out",
                "order": 1,
                "color": "blue",
                "icon": "check",
            },
        },
    }


def test_v6_to_v7_changes_nothing_but_the_stamp() -> None:
    """v7 admits a wider colour; it does not rewrite what v6 already stored."""

    payload = _v6_payload_with_token_colour()
    before = deepcopy(payload)

    out = migrate(
        payload,
        from_version=_TOKEN_ONLY_COLOUR_VERSION,
        to_version=_HEX_STATUS_COLOUR_VERSION,
    )

    assert out["schema_version"] == _HEX_STATUS_COLOUR_VERSION
    for key in ("items", "locations", "statuses"):
        assert out[key] == before[key]


def test_v6_to_v7_is_idempotent() -> None:
    """The step itself, re-applied — not the driver, which would skip it."""

    payload = _v6_payload_with_token_colour()

    once = migrate_6_to_7(deepcopy(payload))
    twice = migrate_6_to_7(deepcopy(once))

    assert twice == once


def test_v6_to_v7_does_not_alias_the_payload_it_was_given() -> None:
    """A no-op step still copies, or a caller's dict is the migrated one."""

    payload = _v6_payload_with_token_colour()

    out = migrate_6_to_7(payload)
    out["statuses"]["loaned"]["color"] = "#3366cc"

    assert payload["statuses"]["loaned"]["color"] == "blue"


_REMINDER_VERSION = 8


def _v7_payload() -> dict[str, Any]:
    return {
        "schema_version": _REMINDER_VERSION - 1,
        "items": {
            "i1": {"id": "i1", "name": "HVAC filter", "quantity": 1},
            "i2": {"id": "i2", "name": "Ladder", "quantity": 1},
        },
        "locations": {},
        "statuses": {},
    }


def test_v7_to_v8_gives_every_item_an_empty_reminder() -> None:
    """An item written before the fields existed had no reminder, and null says so."""

    out = migrate_7_to_8(_v7_payload())

    for item in out["items"].values():
        assert item["reminder_date"] is None
        assert item["reminder_interval"] is None


def test_v7_to_v8_keeps_a_reminder_a_later_release_wrote() -> None:
    """Idempotence has to mean "fills in what is absent", not "resets"."""

    payload = _v7_payload()
    payload["items"]["i1"]["reminder_date"] = "2026-09-01"
    payload["items"]["i1"]["reminder_interval"] = {"unit": "months", "count": 3}

    once = migrate_7_to_8(deepcopy(payload))
    twice = migrate_7_to_8(deepcopy(once))

    assert once["items"]["i1"]["reminder_date"] == "2026-09-01"
    assert once["items"]["i1"]["reminder_interval"] == {"unit": "months", "count": 3}
    assert twice == once


def test_v7_to_v8_does_not_alias_the_payload_it_was_given() -> None:
    payload = _v7_payload()

    out = migrate_7_to_8(payload)
    out["items"]["i1"]["reminder_date"] = "2026-09-01"

    assert payload["items"]["i1"].get("reminder_date") is None


def test_v7_to_v8_tolerates_a_payload_with_no_items() -> None:
    """The same tolerance every other step carries: a shape it cannot walk is left."""

    assert migrate_7_to_8({"schema_version": 7, "items": None}) == {
        "schema_version": 7,
        "items": None,
    }


_REMINDER_ANCHOR_VERSION = 9


def _v8_payload() -> dict[str, Any]:
    return {
        "schema_version": _REMINDER_ANCHOR_VERSION - 1,
        "items": {
            "i1": {
                "id": "i1",
                "name": "HVAC filter",
                "quantity": 1,
                "reminder_date": "2026-09-30",
                "reminder_interval": {"unit": "months", "count": 1},
            },
            "i2": {
                "id": "i2",
                "name": "Ladder",
                "quantity": 1,
                "reminder_date": None,
                "reminder_interval": None,
            },
        },
        "locations": {},
        "statuses": {},
    }


def test_v8_to_v9_anchors_every_reminder_on_its_own_date() -> None:
    """Under the old rule a bump rewrote the date, so the date *is* the anchor.

    Nothing knows how far a v8 series had already drifted, and nothing needs to:
    from here on it is measured from wherever it currently stands.
    """

    out = migrate_8_to_9(_v8_payload())

    assert out["items"]["i1"]["reminder_anchor"] == "2026-09-30"
    assert out["items"]["i2"]["reminder_anchor"] is None


def test_v8_to_v9_keeps_an_anchor_a_bump_has_moved_away_from() -> None:
    """Idempotence means "fills in what is absent", not "resets to the date"."""

    payload = _v8_payload()
    payload["items"]["i1"]["reminder_anchor"] = "2026-08-31"

    out = migrate_8_to_9(payload)

    assert out["items"]["i1"]["reminder_anchor"] == "2026-08-31"
    assert migrate_8_to_9(out) == out


def test_v8_to_v9_leaves_an_item_that_is_not_a_dict_alone() -> None:
    """A corrupt row is the load report's business, not a migration's."""

    payload = _v8_payload()
    payload["items"]["broken"] = "not-an-item"

    out = migrate_8_to_9(payload)

    assert out["items"]["broken"] == "not-an-item"
