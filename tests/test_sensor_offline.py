"""Offline tests for the sensor catalog.

`sensor.py` itself is not imported here: nothing offline stubs
`homeassistant.components.sensor`, so the entity class belongs to the phacc
suite (`tests/integration/test_sensor.py`). What is checkable offline is the
catalog it is built from — that every descriptor names a real count, that the
`unique_id` suffixes cannot collide, and that the names the frontend shows exist
in both translation files.
"""

from __future__ import annotations

import json
from pathlib import Path

from custom_components.haventory.const import PLATFORMS, SENSOR_DESCRIPTIONS
from custom_components.haventory.repository import Repository

PACKAGE = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
EXPECTED_SENSOR_COUNT = 8


def test_every_descriptor_names_a_count_the_repository_computes() -> None:
    """A key `get_counts()` does not return would be a sensor stuck at unknown."""

    counts = Repository().get_counts()
    missing = [d.key for d in SENSOR_DESCRIPTIONS if d.key not in counts]
    assert missing == []


def test_the_promoted_counts_are_the_documented_ones() -> None:
    """The other counts stay card- and WebSocket-only; promoting one is additive."""

    assert [d.key for d in SENSOR_DESCRIPTIONS] == [
        "items_total",
        "low_stock_count",
        "checked_out_count",
        "overdue_count",
        "checked_out_due_count",
        "inspection_overdue_count",
        "inspection_due_count",
        "locations_total",
    ]
    assert len(SENSOR_DESCRIPTIONS) == EXPECTED_SENSOR_COUNT


def test_unique_id_suffixes_and_translation_keys_are_distinct() -> None:
    """Two entities sharing a suffix would collide on one `unique_id`."""

    assert len({d.key for d in SENSOR_DESCRIPTIONS}) == len(SENSOR_DESCRIPTIONS)
    assert len({d.translation_key for d in SENSOR_DESCRIPTIONS}) == len(SENSOR_DESCRIPTIONS)


def test_only_the_calendar_derived_counts_track_midnight() -> None:
    """The rest move on a mutation, and a midnight rewrite would be noise."""

    assert {d.key for d in SENSOR_DESCRIPTIONS if d.date_derived} == {
        "overdue_count",
        "checked_out_due_count",
        "inspection_overdue_count",
        "inspection_due_count",
    }


def test_the_rollover_is_the_instances_midnight_and_not_utcs() -> None:
    """The counts read the instance's local day, so the rewrite has to follow it.

    Read off the source because nothing offline stubs
    `homeassistant.components.sensor`, so the module cannot be imported here.
    That the subscription actually fires at local midnight is asserted in
    `tests/integration/test_sensor.py`; what this catches is the one-word slip
    back to the UTC helper, which no offline test could otherwise see.
    """

    source = (PACKAGE / "sensor.py").read_text(encoding="utf-8")

    assert "async_track_utc_time_change" not in source
    assert "async_track_time_change" in source


def test_the_forwarded_platforms_are_the_two_this_integration_owns() -> None:
    """A platform in the tuple with no module beside it fails setup outright."""

    assert [str(p) for p in PLATFORMS] == ["sensor", "calendar"]
    for platform in PLATFORMS:
        assert (PACKAGE / f"{platform}.py").is_file(), platform


def test_every_translation_key_is_named_in_both_translation_files() -> None:
    """A missing entry shows the entity_id in the UI instead of a name.

    `test_translation_flow_sections_match_strings` holds the two files equal;
    this holds them to the catalog, which that equality cannot see.
    """

    for name in ("strings.json", "translations/en.json"):
        catalog = json.loads((PACKAGE / name).read_text(encoding="utf-8"))
        sensors = catalog["entity"]["sensor"]
        assert set(sensors) == {d.translation_key for d in SENSOR_DESCRIPTIONS}, name
        assert all(entry.keys() == {"name"} for entry in sensors.values()), name
        assert all(entry["name"].strip() for entry in sensors.values()), name
