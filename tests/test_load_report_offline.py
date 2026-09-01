"""What ``load_state`` refuses to make sense of, and how it says so.

A corrupt or hand-edited ``haventory_store`` is the only way these paths are
reached: the import route rebuilds paths through ``build_location_path_from_map``,
whose own guard rejects a cyclic document before any state swap, and
``update_location`` refuses a move under a descendant. So everything here is about
the setup path reading a file somebody else wrote.

Two properties have to hold:

- the walk **terminates** — a cyclic parent chain used to be followed forever,
  once per item, during Home Assistant startup;
- the damage is **reported** — entries that cannot be loaded are dropped from
  memory, and the next save would write the store without them.
"""

from __future__ import annotations

import logging
import uuid

import pytest
from custom_components.haventory.models import NAME_MAX_LENGTH, ItemCreate
from custom_components.haventory.repository import LOAD_DROP_LOG_LIMIT, LoadReport, Repository
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


def test_only_the_cycle_members_are_named_as_cyclic() -> None:
    """A branch hanging off a cycle is reported apart from the cycle itself.

    Only a member's own ``parent_id`` closes the loop, so it is the only row an
    edit can fix; the descendants are unreachable purely as a consequence. Naming
    them together sends the user to rows where there is nothing to change — and
    because ids sort arbitrarily, the members can fall outside a truncated sample
    entirely, which is what a real two-location cycle with three descendants did.
    """

    payload = _cyclic_payload()
    a, b = sorted(payload["locations"])  # type: ignore[arg-type]
    below = [str(uuid.uuid4()) for _ in range(3)]
    parent = a
    for index, child in enumerate(below):
        payload["locations"][child] = _loc(child, f"Below {index}", parent)  # type: ignore[index]
        parent = child

    report = Repository.from_state(payload).last_load_report

    assert set(report.cyclic_location_ids) == {a, b}
    assert set(report.unrooted_location_ids) == set(below)
    assert not set(report.cyclic_location_ids) & set(report.unrooted_location_ids)


def test_a_wholesale_item_corruption_does_not_flood_the_log(caplog) -> None:
    """Every broken row is counted; only the first few are named.

    The log is where the refusal message sends the user, so a store with a
    thousand unreadable rows must not bury every other line under a thousand
    ERROR records.
    """

    broken = {f"not-a-uuid-{n}": {"id": f"not-a-uuid-{n}", "name": "Broken"} for n in range(200)}
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": broken,
    }

    with caplog.at_level(logging.DEBUG):
        repo = Repository.from_state(payload)

    assert len(repo.last_load_report.dropped_item_ids) == len(broken)
    named = [r for r in caplog.records if "Failed to load item" in r.getMessage()]
    assert len(named) == LOAD_DROP_LOG_LIMIT
    # The count still reaches the log — it is the part that says how bad it is.
    overflow = [r for r in caplog.records if "Further rows failed to load" in r.getMessage()]
    assert [getattr(r, "dropped_total", None) for r in overflow] == [len(broken)]


def test_a_bounded_corruption_logs_every_row_and_no_summary(caplog) -> None:
    """Under the cap nothing is withheld, and no summary claims otherwise."""

    broken = {f"not-a-uuid-{n}": {"id": f"not-a-uuid-{n}", "name": "Broken"} for n in range(3)}
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "locations": {}, "items": broken}

    with caplog.at_level(logging.DEBUG):
        Repository.from_state(payload)

    named = [r for r in caplog.records if "Failed to load item" in r.getMessage()]
    assert len(named) == len(broken)
    assert not [r for r in caplog.records if "Further rows failed to load" in r.getMessage()]


@pytest.mark.parametrize(
    ("report", "expected"),
    [
        (LoadReport(), False),
        (LoadReport(dropped_item_ids=("i",)), True),
        (LoadReport(dropped_location_ids=("l",)), True),
        (LoadReport(cyclic_location_ids=("c",)), True),
        (LoadReport(unrooted_location_ids=("u",)), True),
    ],
)
def test_has_corruption_covers_every_kind(report: LoadReport, expected: bool) -> None:
    """Setup keys off this one property, so each tuple has to feed it."""

    assert report.has_corruption is expected


def test_a_reload_leaves_exactly_what_a_fresh_repository_holds() -> None:
    """One list of fields, so neither construction path can outgrow the other.

    A field only ``__init__`` sets survives a reload carrying the previous
    load's content; a field only the reset sets is missing until the first
    load. Both show up here as a difference between the two repositories.
    """

    used = Repository()
    where = used.create_location(name="Garage")
    used.create_item(ItemCreate(name="Drill", location_id=str(where.id)))

    used.load_state({"schema_version": CURRENT_SCHEMA_VERSION, "locations": {}, "items": {}})

    assert vars(used) == vars(Repository())


def test_a_payload_that_is_not_a_dict_reports_an_empty_load() -> None:
    """The content is gone by the time the payload is refused, so the report is too.

    ``load_state`` resets before it reads, and a caller that hands it something
    other than a mapping is left with an empty repository — a report still
    naming the previous load's damage would describe rows this repository no
    longer holds.
    """

    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {"not-a-uuid": {"id": "not-a-uuid", "name": "Broken"}},
    }
    repo = Repository.from_state(payload)
    assert repo.last_load_report.has_corruption is True

    repo.load_state("not a payload")  # type: ignore[arg-type]

    assert repo.last_load_report == LoadReport()
    assert repo.export_state()["items"] == {}


#: Marks a key a case wants *absent* rather than set to something unreadable.
#: The two are different bugs — a missing key read as ``""``, a stored ``null``
#: as the literal ``"None"`` — so both have to be reachable from one table.
ABSENT = object()


def _without_absent(row: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in row.items() if value is not ABSENT}


def _item(item_id: str, **overrides: object) -> dict[str, object]:
    """An item row as the store holds it, with one field bent out of shape."""

    row: dict[str, object] = {
        "id": item_id,
        "name": "Drill",
        "location_id": None,
        "quantity": 1,
        "status": "ok",
        "checked_out": False,
        "tags": [],
        "custom_fields": {},
        "version": 1,
    }
    row.update(overrides)
    return _without_absent(row)


#: Every spelling of "this row has no name". ``.get("name", "")`` answered the
#: first with ``""`` and the second with the literal string ``"None"``; the rest
#: are what a third-party writer or a hand-edit produces.
UNREADABLE_NAMES: list[tuple[str, dict[str, object]]] = [
    ("missing", {"name": ABSENT}),
    ("null", {"name": None}),
    ("blank", {"name": ""}),
    ("whitespace", {"name": "   "}),
    ("number", {"name": 42}),
    ("list", {"name": ["Drill"]}),
]
UNREADABLE_IDS = [label for label, _ in UNREADABLE_NAMES]


@pytest.mark.parametrize(("label", "overrides"), UNREADABLE_NAMES, ids=UNREADABLE_IDS)
def test_an_item_with_no_readable_name_is_dropped(label: str, overrides: dict[str, object]) -> None:
    """A row no write path could have produced is corrupt, not an item named "".

    The write paths all refuse a name that is empty after a trim. The load path
    used to coerce instead, which put a row in memory the model rejects and made
    it permanent on the next save — and an empty name indexes no search tokens,
    so the row is unfindable as well as unnameable.
    """

    item_id = str(uuid.uuid4())
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {item_id: _item(item_id, **overrides)},
    }

    repo = Repository.from_state(payload)

    assert repo.last_load_report.dropped_item_ids == (item_id,)
    assert repo.last_load_report.has_corruption is True
    assert repo.export_state()["items"] == {}


@pytest.mark.parametrize(("label", "overrides"), UNREADABLE_NAMES, ids=UNREADABLE_IDS)
def test_a_location_with_no_readable_name_is_dropped(
    label: str, overrides: dict[str, object]
) -> None:
    """The location twin behaves the same — it had the identical coercion."""

    loc_id = str(uuid.uuid4())
    row = _loc(loc_id, "Garage", None)
    row.update(overrides)
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {loc_id: _without_absent(row)},
        "items": {},
    }

    repo = Repository.from_state(payload)

    assert repo.last_load_report.dropped_location_ids == (loc_id,)
    assert repo.export_state()["locations"] == {}


def test_an_unreadable_name_is_logged_at_error_like_any_other_corrupt_row(caplog) -> None:
    """It reaches the same report and the same log line the Repairs card reads.

    No new wiring was needed: ``ValidationError`` is already what both ``except``
    blocks in ``load_state`` catch, so the row lands in ``dropped_item_ids`` and
    feeds the corrupt-store repair that shipped with the load report.
    """

    item_id = str(uuid.uuid4())
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {item_id: _item(item_id, name=None)},
    }

    with caplog.at_level(logging.DEBUG):
        Repository.from_state(payload)

    failures = [r for r in caplog.records if "Failed to load item" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.ERROR]
    assert [getattr(r, "item_id", None) for r in failures] == [item_id]


def test_a_name_that_only_needs_trimming_still_loads() -> None:
    """Padding is not corruption, and the row keeps the name a write would give it.

    Every write path trims, so a padded stored name is a hand-edit rather than
    something this codebase wrote — and the honest reading of it is the trimmed
    name, not a refusal.
    """

    item_id, loc_id = str(uuid.uuid4()), str(uuid.uuid4())
    location = _loc(loc_id, "Garage", None)
    location["name"] = "  Garage  "
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {loc_id: location},
        "items": {item_id: _item(item_id, name="  Drill  ")},
    }

    repo = Repository.from_state(payload)

    assert repo.last_load_report == LoadReport()
    assert repo.get_item(item_id).name == "Drill"
    assert repo.get_location(loc_id).name == "Garage"


def test_a_stored_name_over_the_cap_still_loads() -> None:
    """The cap binds what an edit may add, not what a store may already hold.

    Deliberate, and the reason the load path checks non-emptiness only: an
    over-cap name predates the cap, so refusing it here would drop rows this
    integration itself wrote — and a corrupt-store refusal blocks setup.
    """

    item_id = str(uuid.uuid4())
    long_name = "L" * (NAME_MAX_LENGTH + 50)
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {item_id: _item(item_id, name=long_name)},
    }

    repo = Repository.from_state(payload)

    assert repo.last_load_report == LoadReport()
    assert repo.get_item(item_id).name == long_name
