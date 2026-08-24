"""Offline tests for HAventory config flow.

Scenarios:
- Single-instance guard aborts with reason, and the manifest declares the same rule
- async_step_user happy path creates entry
- The card title is asked for at setup, normalized, and seeded into the options
- Import path: create entry if no existing (if supported)
- Validation errors surfaced to form (simulated)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import voluptuous as vol
from custom_components.haventory.config_flow import (
    SECTION_TODO,
    HAventoryConfigFlow,
    HAventoryOptionsFlowHandler,
)
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    CONF_TODO_ENTITY_ID,
    DEFAULT_CARD_TITLE,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DEFAULT_TODO_ENTITY_ID,
    QUICK_FILTER_KEYS,
)
from homeassistant.config_entries import ConfigEntry


def _entry(options: dict) -> ConfigEntry:
    return ConfigEntry(options=options)


def _schema_keys(schema) -> set[str]:
    return {str(marker) for marker in schema.schema}


def _section_schema(schema, name: str):
    """The inner schema of one form section, by the form-only key holding it."""
    for marker, value in schema.schema.items():
        if str(marker) == name:
            return value.schema
    raise AssertionError(f"no section {name} in schema")


def _schema_default(schema, key: str):
    """Read a field's prefilled value without validating a whole payload."""
    for marker in schema.schema:
        if str(marker) == key:
            return marker.default()
    raise AssertionError(f"no field {key} in schema")


@pytest.mark.asyncio
async def test_single_instance_guard_aborts(monkeypatch) -> None:
    """If an entry already exists, flow aborts with reason."""

    flow = HAventoryConfigFlow()

    # Simulate existing entries
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [object()], raising=False)

    result = await flow.async_step_user(user_input=None)
    assert result["type"] == "abort"
    assert result["reason"] == "single_instance_allowed"


def test_manifest_declares_single_config_entry() -> None:
    """The manifest must declare the same single-instance rule the flow enforces.

    `single_config_entry` is what removes HAventory from the "Add integration"
    picker once an entry exists, so the second attempt never starts. The in-flow
    guard above still covers the paths that bypass the picker, and the two must
    agree: dropping the manifest key would silently put the entry back in the
    picker only to abort on its first step.
    """

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest.get("single_config_entry") is True


@pytest.mark.asyncio
async def test_user_step_creates_entry(monkeypatch) -> None:
    """Happy path: no existing entries -> create entry immediately."""

    flow = HAventoryConfigFlow()

    # No current entries
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={})
    assert result["type"] == "create_entry"
    assert result["title"] == DEFAULT_CARD_TITLE
    assert result["data"] == {}
    assert result["options"] == {
        CONF_CARD_TITLE: DEFAULT_CARD_TITLE,
        CONF_SIDEBAR_PANEL_ENABLED: DEFAULT_SIDEBAR_PANEL_ENABLED,
    }


@pytest.mark.asyncio
async def test_user_step_asks_for_the_title_and_the_sidebar(monkeypatch) -> None:
    """Setup opens a form rather than creating an unnamed entry outright.

    Both fields the options flow opens with are asked here, so the sidebar entry
    is a decision at setup rather than a discovery under Configure.
    """

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input=None)
    assert result["type"] == "form"
    assert result["step_id"] == "user"
    assert _schema_keys(result["data_schema"]) == {CONF_CARD_TITLE, CONF_SIDEBAR_PANEL_ENABLED}
    assert (
        _schema_default(result["data_schema"], CONF_SIDEBAR_PANEL_ENABLED)
        is DEFAULT_SIDEBAR_PANEL_ENABLED
    )


@pytest.mark.asyncio
async def test_user_step_uses_the_submitted_title(monkeypatch) -> None:
    """The submitted name becomes both the entry title and the card-title option."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={CONF_CARD_TITLE: "  Pantry  "})
    assert result["title"] == "Pantry"
    assert result["options"][CONF_CARD_TITLE] == "Pantry"


@pytest.mark.asyncio
async def test_user_step_stores_a_declined_sidebar(monkeypatch) -> None:
    """Answering "no" at setup has to survive as the stored option.

    Absence reads as on everywhere the panel is applied, so an opt-out only
    holds if the setup step writes it down.
    """

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(
        user_input={CONF_CARD_TITLE: "Pantry", CONF_SIDEBAR_PANEL_ENABLED: False}
    )
    assert result["options"][CONF_SIDEBAR_PANEL_ENABLED] is False


@pytest.mark.asyncio
async def test_blank_title_falls_back_to_the_default(monkeypatch) -> None:
    """A cleared field asks for the default back, not for an empty heading."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={CONF_CARD_TITLE: "   "})
    assert result["options"][CONF_CARD_TITLE] == DEFAULT_CARD_TITLE


@pytest.mark.asyncio
async def test_options_flow_edits_the_card_title() -> None:
    """The options flow offers the stored title and stores the edited one."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_CARD_TITLE: "Pantry"})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_CARD_TITLE) == "Pantry"

    result = await flow.async_step_init(user_input={CONF_CARD_TITLE: " Garage  "})
    assert result["type"] == "create_entry"
    assert result["data"][CONF_CARD_TITLE] == "Garage"


@pytest.mark.asyncio
async def test_sidebar_toggle_defaults_on_for_an_entry_that_predates_it() -> None:
    """No stored value reads as on: the sidebar entry is what makes HAventory findable."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_CARD_TITLE: "Pantry"})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_SIDEBAR_PANEL_ENABLED) is True


@pytest.mark.asyncio
async def test_sidebar_toggle_offers_and_stores_an_opt_out() -> None:
    """An explicit off survives a trip through the form rather than reverting to the default."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_SIDEBAR_PANEL_ENABLED: False})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_SIDEBAR_PANEL_ENABLED) is False

    result = await flow.async_step_init(
        user_input={CONF_CARD_TITLE: "Pantry", CONF_SIDEBAR_PANEL_ENABLED: False}
    )
    assert result["data"][CONF_SIDEBAR_PANEL_ENABLED] is False


@pytest.mark.asyncio
async def test_the_shopping_list_section_folds_flat_and_defaults_to_off() -> None:
    """The bridge reads one flat `todo_entity_id`; the section is form dressing.

    Stored nested, the option would be invisible to everything that looks for
    it — the bridge, and the runtime that hands it the list to write to.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({})

    form = await flow.async_step_init(user_input=None)
    assert SECTION_TODO in _schema_keys(form["data_schema"])

    result = await flow.async_step_init(
        user_input={
            CONF_CARD_TITLE: "Pantry",
            SECTION_TODO: {CONF_TODO_ENTITY_ID: "todo.shopping_list"},
        }
    )
    assert result["data"][CONF_TODO_ENTITY_ID] == "todo.shopping_list"
    assert SECTION_TODO not in result["data"]


@pytest.mark.asyncio
async def test_a_cleared_shopping_list_stores_the_empty_string() -> None:
    """A cleared entity selector submits nothing, and nothing has to mean off.

    Left absent, the stored options would keep the previous list and the bridge
    would go on writing to it — the field could never be unpicked.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_TODO_ENTITY_ID: "todo.shopping_list"})

    result = await flow.async_step_init(user_input={CONF_CARD_TITLE: "Pantry", SECTION_TODO: {}})
    assert result["data"][CONF_TODO_ENTITY_ID] == DEFAULT_TODO_ENTITY_ID


@pytest.mark.asyncio
async def test_the_shopping_list_field_is_prefilled_with_the_stored_list() -> None:
    """Opening the form must not read as "no list chosen" to a household that has."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_TODO_ENTITY_ID: "todo.shopping_list"})

    form = await flow.async_step_init(user_input=None)
    section_schema = _section_schema(form["data_schema"], SECTION_TODO)
    for marker in section_schema.schema:
        if str(marker) == CONF_TODO_ENTITY_ID:
            assert marker.description == {"suggested_value": "todo.shopping_list"}
            break
    else:  # pragma: no cover - the field is asserted to exist above
        raise AssertionError(f"no field {CONF_TODO_ENTITY_ID} in the {SECTION_TODO} section")


@pytest.mark.asyncio
async def test_the_options_form_refuses_a_list_outside_the_todo_domain() -> None:
    """The bridge calls `todo.*` services; anything else it cannot write to."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({})

    form = await flow.async_step_init(user_input=None)
    with pytest.raises(vol.Invalid):
        form["data_schema"](
            {
                CONF_CARD_TITLE: "Pantry",
                CONF_SIDEBAR_PANEL_ENABLED: True,
                CONF_QUICK_FILTERS: list(QUICK_FILTER_KEYS),
                SECTION_TODO: {CONF_TODO_ENTITY_ID: "sensor.not_a_list"},
            }
        )


@pytest.mark.asyncio
async def test_quick_filters_prefill_every_pill_for_an_entry_that_predates_them() -> None:
    """An untouched entry opens the form with all five ticked.

    The stored value is still absent at that point, and absent means "no
    opinion" — so the prefill has to match what the card does without one, or
    saving the form for the title alone would quietly take pills away.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_CARD_TITLE: "Pantry"})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_QUICK_FILTERS) == list(QUICK_FILTER_KEYS)


@pytest.mark.asyncio
async def test_quick_filters_offer_and_store_a_narrowed_set() -> None:
    """A chosen subset survives the round trip, in the card's own order."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_QUICK_FILTERS: ["low_stock", "total"]})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_QUICK_FILTERS) == ["total", "low_stock"]

    result = await flow.async_step_init(
        user_input={CONF_CARD_TITLE: "Pantry", CONF_QUICK_FILTERS: ["checked_out", "overdue"]}
    )
    assert result["data"][CONF_QUICK_FILTERS] == ["overdue", "checked_out"]


@pytest.mark.asyncio
async def test_quick_filters_keep_an_empty_choice_empty() -> None:
    """Unticking everything means no pills, not "back to the default".

    `[]` and an absent value are different answers all the way to the card, and
    the form is the only place the empty one can be made.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_QUICK_FILTERS: []})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_QUICK_FILTERS) == []

    result = await flow.async_step_init(
        user_input={CONF_CARD_TITLE: "Pantry", CONF_QUICK_FILTERS: []}
    )
    assert result["data"][CONF_QUICK_FILTERS] == []


@pytest.mark.asyncio
async def test_quick_filters_drop_a_name_this_build_does_not_know() -> None:
    """A stored pill from another version is dropped rather than offered back.

    The selector refuses anything outside the options it lists, so a prefill
    carrying an unknown name would make the form unsubmittable until the user
    noticed which invisible value was at fault.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({CONF_QUICK_FILTERS: ["low_stock", "sideways"]})

    form = await flow.async_step_init(user_input=None)
    assert _schema_default(form["data_schema"], CONF_QUICK_FILTERS) == ["low_stock"]


@pytest.mark.asyncio
async def test_the_options_form_refuses_a_pill_that_is_not_offered() -> None:
    """The selector is the guard: only the five names it lists validate."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({})

    form = await flow.async_step_init(user_input=None)
    with pytest.raises(vol.Invalid):
        form["data_schema"](
            {
                CONF_CARD_TITLE: "Pantry",
                CONF_SIDEBAR_PANEL_ENABLED: True,
                CONF_QUICK_FILTERS: ["sideways"],
                SECTION_TODO: {},
            }
        )


@pytest.mark.asyncio
async def test_setup_does_not_ask_which_pills(monkeypatch) -> None:
    """Setup stays two questions; the pills have a default worth keeping.

    Every pill is the right answer until a household says otherwise, and the
    field means nothing before there is an inventory to filter.
    """

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    form = await flow.async_step_user(user_input=None)
    assert CONF_QUICK_FILTERS not in _schema_keys(form["data_schema"])

    result = await flow.async_step_user(user_input={CONF_CARD_TITLE: "Pantry"})
    assert CONF_QUICK_FILTERS not in result["options"]


def _translation_files() -> list[Path]:
    """Every file Home Assistant reads a translated string out of."""

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    return [root / "strings.json", *sorted((root / "translations").glob("*.json"))]


def _flatten(node: object, prefix: str = "") -> dict[str, str]:
    """A nested translation document as `a.b.c` -> value."""

    if not isinstance(node, dict):
        return {prefix: str(node)}
    out: dict[str, str] = {}
    for key, value in node.items():
        out.update(_flatten(value, f"{prefix}.{key}" if prefix else key))
    return out


def test_translation_strings_carry_no_urls() -> None:
    """hassfest fails the build on a URL in a translation string.

    It only runs in CI, so catch the mistake here: a link belongs in a
    `{placeholder}` the flow fills, never inline in the string.
    """

    for path in _translation_files():
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, f"{path.name} contains a URL"


def test_translations_mirror_the_strings_key_tree() -> None:
    """Every shipped language answers to exactly the keys `strings.json` declares.

    A key only one language carries is a screen that renders in English for
    everyone else with nothing to say so, and a key a language carries that
    `strings.json` has dropped is dead weight nothing reads.
    """

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    expected = set(_flatten(json.loads((root / "strings.json").read_text(encoding="utf-8"))))
    for path in sorted((root / "translations").glob("*.json")):
        keys = set(_flatten(json.loads(path.read_text(encoding="utf-8"))))
        assert keys == expected, f"{path.name} does not mirror strings.json"


def test_translations_repeat_their_placeholders() -> None:
    """A `{placeholder}` renames or vanishes silently, and renders literally.

    Home Assistant fills these by name — `{docs_url}` on the options screen,
    `{error}` and `{storage_key}` on a repairs issue — so a German value that
    spells one differently prints the braces on the screen, and one that drops
    it loses the only concrete detail the sentence carried. Nothing else
    catches it: hassfest validates the shape of the file, not the insides of
    its strings.
    """

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    english = _flatten(json.loads((root / "strings.json").read_text(encoding="utf-8")))
    placeholder = re.compile(r"\{(\w+)\}")
    for path in sorted((root / "translations").glob("*.json")):
        for key, value in _flatten(json.loads(path.read_text(encoding="utf-8"))).items():
            assert set(placeholder.findall(value)) == set(placeholder.findall(english[key])), (
                f"{path.name}: {key} does not carry the same placeholders as strings.json"
            )


def test_translation_flow_sections_match_strings() -> None:
    """`translations/en.json` must repeat every section `strings.json` declares.

    Home Assistant renders the config flow, the options flow and the service
    catalog from the translation file; `strings.json` is only the source
    hassfest validates. An edit that lands in one file but not the other ships a
    screen with the stale text and nothing fails.
    """

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    strings = json.loads((root / "strings.json").read_text(encoding="utf-8"))
    en = json.loads((root / "translations" / "en.json").read_text(encoding="utf-8"))
    assert en == strings


@pytest.mark.asyncio
async def test_import_step_behaves_like_user_when_supported(monkeypatch) -> None:
    """Import path (if implemented) should create an entry when none exists."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    # Some integrations alias import to user; try calling if present
    step = getattr(flow, "async_step_import", None)
    if callable(step):
        result = await step(user_input={})
        assert result["type"] == "create_entry"
    else:
        # If not supported, fall back to user step for coverage
        result = await flow.async_step_user(user_input={})
        assert result["type"] == "create_entry"


@pytest.mark.asyncio
async def test_validation_error_form(monkeypatch) -> None:
    """Simulate a validation error surfaced to the form with errors mapping."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    # Monkeypatch create_entry to simulate a validation branch that returns a form
    def _form(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {"type": "form", "step_id": "user", "errors": {"base": "invalid"}}

    monkeypatch.setattr(flow, "async_create_entry", _form, raising=False)

    result = await flow.async_step_user(user_input={})
    assert result["type"] == "form"
    assert result["step_id"] == "user"
    assert result["errors"]["base"] == "invalid"
