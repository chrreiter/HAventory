"""The per-item status field (ok / missing / needs_repair): defaults, validation, filtering.

Covers the model's creation and update rules, the strict and tolerant reads of a
status, the filter, the repository round trip and the live status set a household
can extend. The WebSocket side is in `tests/integration/test_ws_statuses.py`.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.item_writes import (
    ItemCreate,
    ItemUpdate,
    apply_item_update,
    create_item_from_create,
)
from custom_components.haventory.models import (
    DEFAULT_ITEM_STATUS,
    ITEM_STATUSES,
    validate_item_status,
)
from custom_components.haventory.query import filter_items
from custom_components.haventory.repository import Repository
from custom_components.haventory.timestamps import today_local_date

LIVE = {"ok", "lent_out"}


def test_create_defaults_to_ok() -> None:
    item = create_item_from_create({"name": "Hammer"})
    assert item.status == DEFAULT_ITEM_STATUS == "ok"


@pytest.mark.parametrize("status", ITEM_STATUSES)
def test_create_accepts_each_known_status(status: str) -> None:
    payload: ItemCreate = {"name": "Hammer", "status": status}
    assert create_item_from_create(payload).status == status


@pytest.mark.parametrize("bad", ["broken", "OK", "", None, 1, True])
def test_create_rejects_unknown_status(bad: object) -> None:
    with pytest.raises(ValidationError, match="status must be one of"):
        create_item_from_create({"name": "Hammer", "status": bad})  # type: ignore[typeddict-item]


def test_update_sets_status_and_bumps_version() -> None:
    item = create_item_from_create({"name": "Hammer"})
    updated = apply_item_update(item, ItemUpdate(status="missing"))
    assert updated.status == "missing"
    assert updated.version == item.version + 1
    # Back to ok is how a flagged state clears.
    assert apply_item_update(updated, ItemUpdate(status="ok")).status == "ok"


@pytest.mark.parametrize("bad", ["lost", None])
def test_update_rejects_unknown_and_null_status(bad: object) -> None:
    item = create_item_from_create({"name": "Hammer"})
    with pytest.raises(ValidationError, match="status must be one of"):
        apply_item_update(item, {"status": bad})  # type: ignore[typeddict-item]


def test_update_without_status_keeps_it() -> None:
    item = create_item_from_create({"name": "Hammer", "status": "needs_repair"})
    assert apply_item_update(item, ItemUpdate(name="Hammer Pro")).status == "needs_repair"


@pytest.mark.parametrize(
    ("value", "kwargs", "expected"),
    [
        pytest.param("missing", {}, "missing", id="strict_known"),
        pytest.param("bogus", {}, None, id="strict_unknown"),
        pytest.param("needs_repair", {}, "needs_repair", id="default_set_is_the_built_ins"),
        pytest.param("lent_out", {"known_statuses": LIVE}, "lent_out", id="live_slug"),
        pytest.param("missing", {"known_statuses": LIVE}, None, id="outside_live_set"),
        pytest.param("needs_repair", {"default": "ok"}, "needs_repair", id="tolerant_known"),
        pytest.param(None, {"default": "ok"}, "ok", id="tolerant_none"),
        pytest.param("bogus", {"default": "ok"}, "ok", id="tolerant_unknown"),
        pytest.param(7, {"default": "ok"}, "ok", id="tolerant_int"),
        pytest.param("lent_out", {"known_statuses": LIVE, "default": "ok"}, "lent_out", id="kept"),
        pytest.param("who_knows", {"known_statuses": LIVE, "default": "ok"}, "ok", id="garbage"),
    ],
)
def test_validate_item_status(value: object, kwargs: dict[str, Any], expected: str | None) -> None:
    if expected is None:
        with pytest.raises(ValidationError, match="status must be one of"):
            validate_item_status(value, **kwargs)
    else:
        assert validate_item_status(value, **kwargs) == expected


def test_filter_items_by_status() -> None:
    ok = create_item_from_create({"name": "Wrench"})
    missing = create_item_from_create({"name": "Hammer", "status": "missing"})
    repair = create_item_from_create({"name": "Drill", "status": "needs_repair"})
    items = [ok, missing, repair]
    today = today_local_date()

    assert filter_items(items, {"status": "missing"}, today=today) == [missing]
    assert filter_items(items, {"status": "needs_repair"}, today=today) == [repair]
    assert filter_items(items, {"status": "ok"}, today=today) == [ok]
    # Combined with q: both predicates must hold.
    assert filter_items(items, {"status": "missing", "q": "drill"}, today=today) == []
    assert filter_items(items, {"status": "needs_repair", "q": "drill"}, today=today) == [repair]
    with pytest.raises(ValidationError, match="status must be one of"):
        filter_items(items, {"status": "bogus"}, today=today)


def test_repository_roundtrip_preserves_status() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Wrench"})

    restored = Repository.from_state(repo.export_state())
    by_name = {i.name: i for i in restored.list_items()["items"]}
    assert by_name["Hammer"].status == "missing"
    assert by_name["Wrench"].status == "ok"
    assert restored.get_counts()["missing_count"] == 1


def test_load_state_tolerates_missing_and_unknown_status() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})
    repo.create_item({"name": "Drill"})
    state = repo.export_state()
    items = list(state["items"].values())
    # A payload written before the field existed, and a hand-edited value.
    del items[0]["status"]
    items[1]["status"] = "shattered"

    restored = Repository.from_state(state)
    assert all(i.status == "ok" for i in restored.list_items()["items"])
    counts = restored.get_counts()
    assert counts["missing_count"] == 0
    assert counts["needs_repair_count"] == 0


def test_a_household_defined_status_filters_the_list() -> None:
    repo = Repository.from_state(
        {
            "items": {},
            "locations": {},
            "statuses": {
                "ok": {"slug": "ok", "label": "OK", "order": 0},
                "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 1},
            },
        }
    )
    repo.create_item({"name": "Ladder", "status": "lent_out"})
    repo.create_item({"name": "Hammer"})

    page = repo.list_items(flt={"status": "lent_out"})

    assert [i.name for i in page["items"]] == ["Ladder"]
