"""Offline tests for HAventory config flow.

Scenarios:
- Single-instance guard aborts with reason
- async_step_user happy path creates entry
- The card title is asked for at setup, normalized, and seeded into the options
- Import path: create entry if no existing (if supported)
- Validation errors surfaced to form (simulated)
"""

from __future__ import annotations

from pathlib import Path

import pytest
from custom_components.haventory.config_flow import (
    RATE_LIMIT_DOCS_URL,
    HAventoryConfigFlow,
    HAventoryOptionsFlowHandler,
)
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
)
from homeassistant.config_entries import ConfigEntry


def _entry(options: dict) -> ConfigEntry:
    return ConfigEntry(options=options)


def _schema_keys(schema) -> set[str]:
    return {str(marker) for marker in schema.schema}


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
    assert result["options"] == {CONF_CARD_TITLE: DEFAULT_CARD_TITLE}


@pytest.mark.asyncio
async def test_user_step_asks_for_the_card_title(monkeypatch) -> None:
    """Setup opens a form rather than creating an unnamed entry outright."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input=None)
    assert result["type"] == "form"
    assert result["step_id"] == "user"
    assert _schema_keys(result["data_schema"]) == {CONF_CARD_TITLE}


@pytest.mark.asyncio
async def test_user_step_uses_the_submitted_title(monkeypatch) -> None:
    """The submitted name becomes both the entry title and the card-title option."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={CONF_CARD_TITLE: "  Pantry  "})
    assert result["title"] == "Pantry"
    assert result["options"] == {CONF_CARD_TITLE: "Pantry"}


@pytest.mark.asyncio
async def test_blank_title_falls_back_to_the_default(monkeypatch) -> None:
    """A cleared field asks for the default back, not for an empty heading."""

    flow = HAventoryConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [], raising=False)

    result = await flow.async_step_user(user_input={CONF_CARD_TITLE: "   "})
    assert result["options"] == {CONF_CARD_TITLE: DEFAULT_CARD_TITLE}


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
async def test_sidebar_toggle_sits_outside_the_rate_limit_section() -> None:
    """Visibility of the integration has nothing to do with rate limiting.

    Nested in the section, the option would also be folded by `_flatten_options`
    only as a side effect of that grouping — and hidden behind a collapsed
    header the moment the limiter is at its defaults.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({})

    form = await flow.async_step_init(user_input=None)
    assert CONF_SIDEBAR_PANEL_ENABLED in _schema_keys(form["data_schema"])


@pytest.mark.asyncio
async def test_options_form_fills_the_docs_link() -> None:
    """The step text links the rate-limit docs through a placeholder.

    Translation strings may not carry URLs — hassfest rejects them — so the
    link target arrives as `description_placeholders`. Without it the form
    renders a literal `{docs_url}`.
    """

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = _entry({})

    form = await flow.async_step_init(user_input=None)
    assert form["description_placeholders"] == {"docs_url": RATE_LIMIT_DOCS_URL}


def test_translation_strings_carry_no_urls() -> None:
    """hassfest fails the build on a URL in a translation string.

    It only runs in CI, so catch the mistake here: a link belongs in a
    `{placeholder}` the flow fills, never inline in the string.
    """

    root = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    for path in (root / "strings.json", root / "translations" / "en.json"):
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, f"{path.name} contains a URL"


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
