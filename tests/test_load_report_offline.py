"""What ``load_state`` refuses to make sense of, and how it says so.

A corrupt or hand-edited ``haventory_store`` is the only way these paths are
reached: the import route rebuilds paths through ``build_location_path_from_map``,
whose own guard rejects a cyclic document before any state swap, and
``update_location`` refuses a move under a descendant. So everything here is about
the setup path reading a file somebody else wrote.

Two properties are load-bearing:

- the walk **terminates** — a cyclic parent chain used to be followed forever,
  once per item, during Home Assistant startup;
- the damage is **reported** — entries that cannot be loaded are dropped from
  memory, and the next save would write the store without them.
"""

from __future__ import annotations

import logging
import uuid

import pytest
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import LoadReport, Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION


def _loc(loc_id: str, name: str, parent_id: str | None) -> dict[str, object]:
    """A location row as the store holds it, parent link included."""

    return {
        "id": loc_id,
        "name": name,
        "parent_id": parent_id,
        "area_id": None,
        "path": {
            "id_path": [loc_id],
            "name_path": [name],
            "display_path": name,
            "sort_key": name.casefold(),
        },
    }


def _cyclic_payload() -> dict[str, object]:
    """Two locations that are each other's parent, with an item in one."""

    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    item_id = str(uuid.uuid4())
    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {a: _loc(a, "A", b), b: _loc(b, "B", a)},
        "items": {
            item_id: {
                "id": item_id,
                "name": "Drill",
                "location_id": a,
                "quantity": 1,
                "status": "ok",
                "checked_out": False,
                "tags": [],
                "custom_fields": {},
                "version": 1,
            }
        },
    }


def test_a_cyclic_parent_chain_terminates() -> None:
    """The load completes at all — it used to spin forever, during startup.

    Asserted by the call returning rather than by a wall-clock bound, which is
    what makes it meaningful in CI.
    """

    payload = _cyclic_payload()

    repo = Repository.from_state(payload)

    assert isinstance(repo, Repository)
    assert set(repo.export_state()["locations"]) == set(payload["locations"])


def test_a_self_parenting_location_terminates() -> None:
    """The one-node cycle: a location whose parent is itself."""

    loc_id = str(uuid.uuid4())
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {loc_id: _loc(loc_id, "Loop", loc_id)},
        "items": {},
    }

    repo = Repository.from_state(payload)

    assert repo.last_load_report.cyclic_location_ids == (loc_id,)


def test_an_acyclic_tree_keeps_its_full_ancestry() -> None:
    """The guard must not truncate a legitimate chain — three levels stay three."""

    repo = Repository()
    top = repo.create_location(name="House")
    mid = repo.create_location(name="Garage", parent_id=str(top.id))
    leaf = repo.create_location(name="Shelf", parent_id=str(mid.id))

    ancestors = repo._get_ancestors(str(leaf.id))

    assert ancestors == [str(mid.id), str(top.id)]
    assert repo.last_load_report.cyclic_location_ids == ()


def test_a_clean_payload_reports_nothing() -> None:
    """The report is empty for a store this build can read end to end."""

    source = Repository()
    where = source.create_location(name="Garage")
    source.create_item(ItemCreate(name="Drill", location_id=str(where.id)))

    restored = Repository.from_state(source.export_state())

    assert restored.last_load_report == LoadReport()
    assert restored.last_load_report.has_corruption is False


def test_a_broken_item_is_reported_and_logged_at_error(caplog) -> None:
    """A row that cannot be loaded is named, not passed over in silence."""

    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {"not-a-uuid": {"id": "not-a-uuid", "name": "Broken"}},
    }

    with caplog.at_level(logging.DEBUG):
        repo = Repository.from_state(payload)

    assert repo.last_load_report.dropped_item_ids == ("not-a-uuid",)
    assert repo.last_load_report.has_corruption is True
    failures = [r for r in caplog.records if "Failed to load item" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.ERROR]


def test_a_broken_location_is_reported_and_logged_at_error(caplog) -> None:
    """Same for the location half of the load."""

    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {"nope": {"id": "nope", "name": ""}},
        "items": {},
    }

    with caplog.at_level(logging.DEBUG):
        repo = Repository.from_state(payload)

    assert repo.last_load_report.dropped_location_ids == ("nope",)
    failures = [r for r in caplog.records if "Failed to load location" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.ERROR]


def test_a_cycle_is_reported_without_dropping_anything() -> None:
    """Cyclic locations are reported, not removed.

    Dropping one cascades into its children and their items, and setup refuses on
    the report anyway — so nothing is rewritten and the file stays repairable.
    """

    payload = _cyclic_payload()

    repo = Repository.from_state(payload)
    report = repo.last_load_report

    assert set(report.cyclic_location_ids) == set(payload["locations"])
    assert report.dropped_location_ids == ()
    assert report.dropped_item_ids == ()
    assert report.has_corruption is True


@pytest.mark.parametrize(
    ("report", "expected"),
    [
        (LoadReport(), False),
        (LoadReport(dropped_item_ids=("i",)), True),
        (LoadReport(dropped_location_ids=("l",)), True),
        (LoadReport(cyclic_location_ids=("c",)), True),
    ],
)
def test_has_corruption_covers_every_kind(report: LoadReport, expected: bool) -> None:
    """Setup keys off this one property, so each tuple has to feed it."""

    assert report.has_corruption is expected
