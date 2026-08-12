"""Config flow (and options flow) for HAventory."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import section
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_RATE_LIMIT_COMMANDS_BURST,
    CONF_RATE_LIMIT_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_ENABLED,
    CONF_RATE_LIMIT_EVENTS_BURST,
    CONF_RATE_LIMIT_EVENTS_PER_SECOND,
    CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST,
    CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST,
    CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
    DEFAULT_QUICK_FILTERS,
    DEFAULT_RATE_LIMIT_COMMANDS_BURST,
    DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND,
    DEFAULT_RATE_LIMIT_ENABLED,
    DEFAULT_RATE_LIMIT_EVENTS_BURST,
    DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND,
    DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST,
    DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
    DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST,
    DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DOMAIN,
    QUICK_FILTER_KEYS,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

# Form-only key grouping the rate-limit fields into one collapsible block. It
# is a presentation device: `_flatten_options` folds the block away again, so
# the stored options — and everything reading them — stay flat.
SECTION_RATE_LIMIT = "rate_limit"

# Filled into the rate-limit section's `{docs_url}`. Translation strings may not
# contain URLs (hassfest rejects them), so the link target is supplied as a
# description placeholder instead. A section description renders as plain text —
# unlike a step description, markdown in it is shown verbatim and newlines
# collapse — so it carries the bare URL and stays one paragraph.
RATE_LIMIT_DOCS_URL = "https://github.com/chrreiter/HAventory/blob/main/docs/rate_limiting.md"

# (option key, default) pairs for the numeric rate-limit tunables.
_RATE_LIMIT_NUMBER_OPTIONS: tuple[tuple[str, float], ...] = (
    (CONF_RATE_LIMIT_COMMANDS_PER_SECOND, DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND),
    (CONF_RATE_LIMIT_COMMANDS_BURST, DEFAULT_RATE_LIMIT_COMMANDS_BURST),
    (CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND, DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND),
    (CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST),
    (CONF_RATE_LIMIT_EVENTS_PER_SECOND, DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND),
    (CONF_RATE_LIMIT_EVENTS_BURST, DEFAULT_RATE_LIMIT_EVENTS_BURST),
    (CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND, DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND),
    (CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST),
)


def clean_card_title(value: Any) -> str:
    """Normalize a submitted card title, falling back to the default.

    Whitespace-only input reads as "I want the default back" rather than as an
    empty heading, which the card has no sensible way to render.
    """
    if not isinstance(value, str):
        return DEFAULT_CARD_TITLE
    return value.strip() or DEFAULT_CARD_TITLE


def clean_quick_filters(value: Any) -> list[str]:
    """Normalize a submitted pill list to the names this build knows.

    Canonical order rather than click order, so the stored list reads the same
    however it was assembled. An empty result is kept as it is: a household that
    unticks everything is choosing no pills, which is not the same as never
    having chosen. Anything that is not a list at all — which the selector
    itself already refuses — reads as the form's prefill.
    """
    if not isinstance(value, list):
        return list(DEFAULT_QUICK_FILTERS)
    chosen = {entry for entry in value if isinstance(entry, str)}
    return [key for key in QUICK_FILTER_KEYS if key in chosen]


def _quick_filters_selector() -> SelectSelector:
    """Build the pill picker: the five names, as a checkbox list.

    `LIST` rather than a dropdown because the vocabulary is fixed and short, and
    a household deciding which pills it wants should see all of them at once.
    The labels come from the translation key, so the wire names never surface.
    """
    return SelectSelector(
        SelectSelectorConfig(
            options=list(QUICK_FILTER_KEYS),
            multiple=True,
            mode=SelectSelectorMode.LIST,
            translation_key=CONF_QUICK_FILTERS,
        )
    )


def _user_schema() -> vol.Schema:
    """Build the setup-step schema: what the card is called, and where it lives.

    The same two fields the options flow opens with, so setup decides them once
    rather than leaving the sidebar entry to be discovered under Configure.
    """
    return vol.Schema(
        {
            vol.Required(CONF_CARD_TITLE, default=DEFAULT_CARD_TITLE): str,
            vol.Required(CONF_SIDEBAR_PANEL_ENABLED, default=DEFAULT_SIDEBAR_PANEL_ENABLED): bool,
        }
    )


def _rate_limit_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the rate-limit section's schema, defaulting to the stored options."""
    fields: dict[Any, Any] = {
        vol.Required(
            CONF_RATE_LIMIT_ENABLED,
            default=bool(current.get(CONF_RATE_LIMIT_ENABLED, DEFAULT_RATE_LIMIT_ENABLED)),
        ): bool
    }
    for key, default in _RATE_LIMIT_NUMBER_OPTIONS:
        # Bucket capacities below one token would block ALL traffic (a bucket
        # never holding a whole token can never grant one) — require >= 1.
        minimum = 1.0 if key.endswith("_burst") else 0.1
        fields[vol.Required(key, default=float(current.get(key, default)))] = vol.All(
            vol.Coerce(float), vol.Range(min=minimum)
        )
    return vol.Schema(fields)


def _rate_limit_is_default(current: dict[str, Any]) -> bool:
    """Whether every rate-limit option still sits at its shipped default."""
    if bool(current.get(CONF_RATE_LIMIT_ENABLED, DEFAULT_RATE_LIMIT_ENABLED)):
        return False
    return all(
        float(current.get(key, default)) == default for key, default in _RATE_LIMIT_NUMBER_OPTIONS
    )


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the options-flow schema, defaulting to the stored options."""
    return vol.Schema(
        {
            vol.Required(
                CONF_CARD_TITLE,
                default=clean_card_title(current.get(CONF_CARD_TITLE, DEFAULT_CARD_TITLE)),
            ): str,
            # Top level rather than inside the section below: it decides whether
            # HAventory is visible at all, which is nothing to do with rate
            # limiting. Entries predating the option have no value and read as on.
            vol.Required(
                CONF_SIDEBAR_PANEL_ENABLED,
                default=bool(
                    current.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED)
                ),
            ): bool,
            # Prefilled with every pill when the entry has never chosen, so
            # saving this form for one of the fields above cannot quietly mean
            # "no pills". Once saved, the choice is explicit for good — the
            # unset state is not reachable from the form, only from an entry
            # that predates the option.
            vol.Required(
                CONF_QUICK_FILTERS,
                default=clean_quick_filters(
                    current.get(CONF_QUICK_FILTERS, list(DEFAULT_QUICK_FILTERS))
                ),
            ): _quick_filters_selector(),
            # Collapsed while the whole block is untouched, so the common case
            # is a form with one field; a customized limiter opens expanded
            # rather than hiding the values behind a header. No default on the
            # marker: the frontend would take it as the section's initial data
            # and render every field inside it blank, defaults and all.
            vol.Required(SECTION_RATE_LIMIT): section(
                _rate_limit_schema(current),
                {"collapsed": _rate_limit_is_default(current)},
            ),
        }
    )


def _flatten_options(user_input: dict[str, Any]) -> dict[str, Any]:
    """Fold the rate-limit section back into the flat keys the limiter reads."""
    flat = {key: value for key, value in user_input.items() if key != SECTION_RATE_LIMIT}
    nested = user_input.get(SECTION_RATE_LIMIT)
    if isinstance(nested, dict):
        flat.update(nested)
    return flat


class HAventoryOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle HAventory options (card title, sidebar, pills, WS rate limiting)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            options = _flatten_options(user_input)
            options[CONF_CARD_TITLE] = clean_card_title(options.get(CONF_CARD_TITLE))
            # Only when the form carried the field: writing it unconditionally
            # would turn "never chose" into an explicit list on any submission
            # that skipped it, and the two are different answers downstream.
            if CONF_QUICK_FILTERS in options:
                options[CONF_QUICK_FILTERS] = clean_quick_filters(options[CONF_QUICK_FILTERS])
            return self.async_create_entry(title="", data=options)

        current = dict(getattr(self.config_entry, "options", None) or {})
        return self.async_show_form(
            step_id="init",
            data_schema=_options_schema(current),
            description_placeholders={"docs_url": RATE_LIMIT_DOCS_URL},
        )


class HAventoryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):  # type: ignore[call-arg]  # HA ConfigFlow domain= kwarg; HA is not installed for mypy
    """Handle a config flow for HAventory."""

    VERSION = 1

    @staticmethod
    def async_get_options_flow(config_entry: ConfigEntry) -> HAventoryOptionsFlowHandler:
        """Create the options flow."""
        return HAventoryOptionsFlowHandler()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Handle the initial step.

        Single-instance setup: the name the card carries seeds both the entry
        title and the card-title option, and the sidebar answer is stored as the
        same option the options flow edits later.
        """
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is None:
            return self.async_show_form(step_id="user", data_schema=_user_schema())

        title = clean_card_title(user_input.get(CONF_CARD_TITLE))
        sidebar = bool(user_input.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED))
        return self.async_create_entry(
            title=title,
            data={},
            options={CONF_CARD_TITLE: title, CONF_SIDEBAR_PANEL_ENABLED: sidebar},
        )
