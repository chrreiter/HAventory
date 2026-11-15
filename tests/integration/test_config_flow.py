"""Integration: the setup flow and the options flow, driven through Home Assistant.

Every flow here is started and answered through ``hass.config_entries``, so the
schema a submission is validated against, the defaults it is filled with and the
entry that comes out are the ones a household's browser gets.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import voluptuous as vol
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    CONF_TODO_ENTITY_ID,
    DEFAULT_CARD_TITLE,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DEFAULT_TODO_ENTITY_ID,
    DOMAIN,
    QUICK_FILTER_KEYS,
)
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType, InvalidData

MANIFEST = Path(__file__).resolve().parents[2] / "custom_components" / "haventory" / "manifest.json"

# Written as literals: what an upgraded entry carries is decided by the release
# that wrote it, and no module defines these names any more.
RETIRED_RATE_LIMIT_OPTIONS: dict[str, Any] = {
    "rate_limit_enabled": True,
    "rate_limit_commands_per_second": 0.1,
    "rate_limit_commands_burst": 1.0,
    "rate_limit_global_commands_per_second": 0.1,
    "rate_limit_global_commands_burst": 1.0,
    "rate_limit_events_per_second": 0.1,
    "rate_limit_events_burst": 1.0,
    "rate_limit_global_events_per_second": 0.1,
    "rate_limit_global_events_burst": 1.0,
}

TODO_SECTION = "todo"
PILLS = list(QUICK_FILTER_KEYS)


def _keys(schema: vol.Schema) -> set[str]:
    return {str(marker) for marker in schema.schema}


def _marker(schema: vol.Schema, key: str) -> vol.Marker:
    """The schema's marker for one field: its prefill is `.default()` and `.description`."""

    for marker in schema.schema:
        if str(marker) == key:
            return marker
    raise AssertionError(f"no field {key} in schema")


def _todo_marker(schema: vol.Schema) -> vol.Marker:
    """The list field inside the form's collapsible shopping-list section."""

    return _marker(schema.schema[_marker(schema, TODO_SECTION)].schema, CONF_TODO_ENTITY_ID)


async def _options_form(hass: HomeAssistant, entry: Any) -> dict[str, Any]:
    form = await hass.config_entries.options.async_init(entry.entry_id)
    assert form["type"] is FlowResultType.FORM
    return form


async def _save_options(hass: HomeAssistant, entry: Any, user_input: dict[str, Any]) -> None:
    form = await _options_form(hass, entry)
    result = await hass.config_entries.options.async_configure(form["flow_id"], user_input)
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()


async def test_a_second_entry_is_refused(hass: HomeAssistant, setup_entry) -> None:
    """A second setup aborts, and the manifest keeps the integration off the picker.

    `single_config_entry` is what removes HAventory from "Add integration" once
    an entry exists; the in-flow abort covers the paths that bypass the picker.
    """

    await setup_entry()

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"
    assert json.loads(MANIFEST.read_text(encoding="utf-8")).get("single_config_entry") is True


async def test_setup_asks_for_the_title_and_the_sidebar_only(hass: HomeAssistant) -> None:
    """Setup is two questions; the pills have a default worth keeping until there is stock."""

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert _keys(result["data_schema"]) == {CONF_CARD_TITLE, CONF_SIDEBAR_PANEL_ENABLED}
    sidebar = _marker(result["data_schema"], CONF_SIDEBAR_PANEL_ENABLED)
    assert sidebar.default() is DEFAULT_SIDEBAR_PANEL_ENABLED


@pytest.mark.parametrize(
    ("submitted", "title", "options"),
    [
        pytest.param(
            {},
            DEFAULT_CARD_TITLE,
            {CONF_CARD_TITLE: DEFAULT_CARD_TITLE, CONF_SIDEBAR_PANEL_ENABLED: True},
            id="defaults",
        ),
        pytest.param(
            {CONF_CARD_TITLE: "  Pantry  "},
            "Pantry",
            {CONF_CARD_TITLE: "Pantry", CONF_SIDEBAR_PANEL_ENABLED: True},
            id="trimmed_title",
        ),
        # Absence reads as on everywhere the panel is applied, so an opt-out only
        # holds if setup writes it down.
        pytest.param(
            {CONF_CARD_TITLE: "Pantry", CONF_SIDEBAR_PANEL_ENABLED: False},
            "Pantry",
            {CONF_CARD_TITLE: "Pantry", CONF_SIDEBAR_PANEL_ENABLED: False},
            id="declined_sidebar",
        ),
        pytest.param(
            {CONF_CARD_TITLE: "   "},
            DEFAULT_CARD_TITLE,
            {CONF_CARD_TITLE: DEFAULT_CARD_TITLE, CONF_SIDEBAR_PANEL_ENABLED: True},
            id="blank_title",
        ),
    ],
)
async def test_setup_creates_the_entry_from_the_submitted_form(
    hass: HomeAssistant, submitted, title, options
) -> None:
    """The entry's title and stored options; no pill choice is stored at setup."""

    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(flow["flow_id"], submitted)

    assert result["type"] is FlowResultType.CREATE_ENTRY
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    assert entry.title == title
    assert entry.data == {}
    assert dict(entry.options) == options


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        # Absent means "no opinion": the prefill matches what the card does without
        # one, so saving the form for the title alone takes no pill away.
        pytest.param(
            {CONF_CARD_TITLE: "Pantry"},
            {
                CONF_CARD_TITLE: "Pantry",
                CONF_SIDEBAR_PANEL_ENABLED: True,
                CONF_QUICK_FILTERS: PILLS,
                CONF_TODO_ENTITY_ID: None,
            },
            id="predates_everything",
        ),
        pytest.param(
            {CONF_SIDEBAR_PANEL_ENABLED: False},
            {CONF_SIDEBAR_PANEL_ENABLED: False},
            id="sidebar_off",
        ),
        pytest.param(
            {CONF_QUICK_FILTERS: ["low_stock", "total"]},
            {CONF_QUICK_FILTERS: ["total", "low_stock"]},
            id="narrowed_pills",
        ),
        # No pills is a choice, distinct from never having chosen.
        pytest.param({CONF_QUICK_FILTERS: []}, {CONF_QUICK_FILTERS: []}, id="no_pills"),
        # The selector refuses names it does not list, so an unknown one in the
        # prefill would make the form unsubmittable.
        pytest.param(
            {CONF_QUICK_FILTERS: ["low_stock", "sideways"]},
            {CONF_QUICK_FILTERS: ["low_stock"]},
            id="unknown_pill",
        ),
        pytest.param(
            {CONF_TODO_ENTITY_ID: "todo.shopping_list"},
            {CONF_TODO_ENTITY_ID: "todo.shopping_list"},
            id="chosen_list",
        ),
    ],
)
async def test_the_options_form_prefills_from_the_stored_options(
    hass: HomeAssistant, setup_entry, stored, expected
) -> None:
    """Opening the form reads the stored options without reading them as other answers."""

    schema = (await _options_form(hass, await setup_entry(stored)))["data_schema"]

    for key, want in expected.items():
        if key == CONF_TODO_ENTITY_ID:
            assert _todo_marker(schema).description == {"suggested_value": want}
        else:
            assert _marker(schema, key).default() == want


async def test_the_options_form_opens_over_retired_keys(hass: HomeAssistant, setup_entry) -> None:
    """Keys no field offers any more are read by nothing and do not break the form."""

    entry = await setup_entry({CONF_CARD_TITLE: "Pantry", **RETIRED_RATE_LIMIT_OPTIONS})

    schema = (await _options_form(hass, entry))["data_schema"]

    assert not [key for key in _keys(schema) if key.startswith("rate_limit")]


@pytest.mark.parametrize(
    ("stored", "submitted", "expected"),
    [
        pytest.param(
            {CONF_CARD_TITLE: "Pantry"},
            {CONF_CARD_TITLE: " Garage  "},
            {CONF_CARD_TITLE: "Garage"},
            id="title_trimmed",
        ),
        pytest.param(
            {CONF_SIDEBAR_PANEL_ENABLED: False},
            {CONF_SIDEBAR_PANEL_ENABLED: False},
            {CONF_SIDEBAR_PANEL_ENABLED: False},
            id="sidebar_opt_out_stays",
        ),
        # The bridge reads one flat key; the section is form dressing, and stored
        # nested the option would be invisible to everything that looks for it.
        pytest.param(
            {},
            {TODO_SECTION: {CONF_TODO_ENTITY_ID: "todo.shopping_list"}},
            {CONF_TODO_ENTITY_ID: "todo.shopping_list"},
            id="list_stored_flat",
        ),
        # A cleared selector submits nothing, and nothing has to mean off.
        pytest.param(
            {CONF_TODO_ENTITY_ID: "todo.shopping_list"},
            {TODO_SECTION: {}},
            {CONF_TODO_ENTITY_ID: DEFAULT_TODO_ENTITY_ID},
            id="cleared_list",
        ),
        pytest.param(
            {}, {CONF_QUICK_FILTERS: []}, {CONF_QUICK_FILTERS: []}, id="no_pills_stay_empty"
        ),
    ],
)
async def test_the_options_flow_stores_the_submitted_options(
    hass: HomeAssistant, setup_entry, stored, submitted, expected
) -> None:
    """A save stores the cleaned submission; omitted required fields take their prefill."""

    entry = await setup_entry(stored)

    await _save_options(hass, entry, {TODO_SECTION: {}, **submitted})

    assert {key: entry.options[key] for key in expected} == expected
    assert TODO_SECTION not in entry.options


async def test_saving_the_options_drops_retired_keys(hass: HomeAssistant, setup_entry) -> None:
    """The stored options are replaced by the submission, so a retired key cannot survive."""

    entry = await setup_entry({CONF_CARD_TITLE: "Pantry", **RETIRED_RATE_LIMIT_OPTIONS})

    await _save_options(hass, entry, {TODO_SECTION: {}})

    assert not [key for key in entry.options if key.startswith("rate_limit")]


async def test_the_options_flow_stores_a_pill_choice_the_card_then_reads(
    setup_entry, ws_connect, hass: HomeAssistant
) -> None:
    """The pill picker is a real selector, and only real HA applies it.

    This walks the whole path: the form Home Assistant builds, a submission
    through it, and what `haventory/config` then reports to the card, a renamed
    title included, with no reload in between.
    """

    entry = await setup_entry()
    ws = await ws_connect()

    before = (await ws.send("haventory/config"))["result"]
    # Nothing chosen yet: null, not an empty list; the card keeps every pill.
    assert before["quick_filters"] is None

    await _save_options(
        hass,
        entry,
        {
            CONF_CARD_TITLE: "Pantry",
            CONF_SIDEBAR_PANEL_ENABLED: True,
            CONF_QUICK_FILTERS: ["overdue", "low_stock"],
            TODO_SECTION: {},
        },
    )

    assert entry.options[CONF_QUICK_FILTERS] == ["low_stock", "overdue"]
    after = (await ws.send("haventory/config"))["result"]
    assert after["quick_filters"] == ["low_stock", "overdue"]
    assert after["card_title"] == "Pantry"


async def test_the_options_flow_refuses_a_pill_it_does_not_offer(
    hass: HomeAssistant, setup_entry
) -> None:
    """A name outside the five is rejected by the form, not stored and dropped later."""

    entry = await setup_entry()
    submitted = {
        CONF_CARD_TITLE: "HAventory",
        CONF_SIDEBAR_PANEL_ENABLED: True,
        CONF_QUICK_FILTERS: ["sideways"],
        TODO_SECTION: {},
    }

    form = await _options_form(hass, entry)
    with pytest.raises(InvalidData):
        await hass.config_entries.options.async_configure(form["flow_id"], submitted)

    assert CONF_QUICK_FILTERS not in entry.options
