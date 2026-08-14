"""The dev-setup script answers the config flow with the form's own defaults.

``scripts/ws_init_haventory.py`` exists to stand up a working instance with no
questions asked. The user step's fields are required, so an empty submission is
refused with HTTP 400; the script instead builds its payload from the defaults
in the serialized schema the flow returns. These tests pin that extraction, and
pin the flow-side property it depends on: every field the user step requires
offers a default the script can read.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import voluptuous as vol
from custom_components.haventory.config_flow import _user_schema
from custom_components.haventory.const import (
    DEFAULT_CARD_TITLE,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from ws_init_haventory import build_user_input  # noqa: E402


def test_answers_the_user_step_with_its_defaults() -> None:
    """The two required fields are answered with the values the form prefills.

    The descriptor list mirrors what the REST flow API returns for the user
    step: ``voluptuous_serialize`` output, one dict per field, defaults inline.
    """
    data_schema = [
        {"name": "card_title", "type": "string", "required": True, "default": DEFAULT_CARD_TITLE},
        {
            "name": "sidebar_panel_enabled",
            "type": "boolean",
            "required": True,
            "default": DEFAULT_SIDEBAR_PANEL_ENABLED,
        },
    ]
    assert build_user_input(data_schema) == {
        "card_title": DEFAULT_CARD_TITLE,
        "sidebar_panel_enabled": DEFAULT_SIDEBAR_PANEL_ENABLED,
    }


def test_a_required_field_without_a_default_is_refused_by_name() -> None:
    """A value the form does not offer cannot be invented — the script must say which field."""
    data_schema = [
        {"name": "card_title", "type": "string", "required": True, "default": "HAventory"},
        {"name": "api_key", "type": "string", "required": True},
    ]
    with pytest.raises(RuntimeError, match="api_key"):
        build_user_input(data_schema)


def test_an_optional_field_without_a_default_is_omitted() -> None:
    """Optional and unanswered means left out, not sent as None."""
    data_schema = [
        {"name": "card_title", "type": "string", "required": True, "default": "HAventory"},
        {"name": "nickname", "type": "string", "optional": True},
    ]
    assert build_user_input(data_schema) == {"card_title": "HAventory"}


def test_a_suggested_value_answers_a_field_with_no_default() -> None:
    """Suggested values ride under ``description`` in the serialized schema."""
    data_schema = [
        {
            "name": "card_title",
            "type": "string",
            "required": True,
            "description": {"suggested_value": "Pantry"},
        }
    ]
    assert build_user_input(data_schema) == {"card_title": "Pantry"}


def test_a_section_is_answered_as_a_nested_object() -> None:
    """A section serializes as an expandable wrapper and submits as a nested dict."""
    data_schema = [
        {"name": "card_title", "type": "string", "required": True, "default": "HAventory"},
        {
            "name": "rate_limit",
            "type": "expandable",
            "schema": [
                {"name": "enabled", "type": "boolean", "required": True, "default": False},
                {"name": "burst", "required": True, "default": 10.0},
            ],
        },
    ]
    assert build_user_input(data_schema) == {
        "card_title": "HAventory",
        "rate_limit": {"enabled": False, "burst": 10.0},
    }


def test_a_missing_or_malformed_schema_yields_an_empty_payload() -> None:
    """A flow result with no ``data_schema`` still submits — as the old empty payload."""
    assert build_user_input(None) == {}
    assert build_user_input([]) == {}
    assert build_user_input(["not-a-dict", {"no-name": True}]) == {}


def test_every_required_user_step_field_offers_a_default() -> None:
    """The flow-side half of the contract the script leans on.

    The script answers required fields from their defaults, so a field added to
    the user step must ship one: without it, headless setup is back to the 400
    this arrangement exists to prevent. This fails on the flow change itself,
    not on the next fresh-instance provisioning.
    """
    for marker in _user_schema().schema:
        assert isinstance(marker, vol.Optional | vol.Required)
        assert marker.default is not vol.UNDEFINED, (
            f"user-step field {marker!s} offers no default; "
            "scripts/ws_init_haventory.py cannot answer it headlessly"
        )
