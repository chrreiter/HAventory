"""Config flow (and options flow) for HAventory."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import section
from homeassistant.helpers.selector import (
    EntityFilterSelectorConfig,
    EntitySelector,
    EntitySelectorConfig,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    CONF_TODO_ENTITY_ID,
    DEFAULT_CARD_TITLE,
    DEFAULT_QUICK_FILTERS,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DEFAULT_TODO_ENTITY_ID,
    DOMAIN,
    QUICK_FILTER_KEYS,
)

# The domain the shopping-list picker offers, taken from the module that calls
# its services: a picker offering entities those calls cannot target would let a
# household choose a list the bridge then refuses to write to.
from .todo_bridge import TODO_DOMAIN, TODO_FEATURE_DELETE_ITEM_NAME

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

# Form-only key grouping fields into a collapsible block. A presentation device:
# `_flatten_options` folds the block away again, so the stored options — and
# everything reading them — stay flat.
SECTION_TODO = "todo"

# Ordered as the form shows them, and the one list `_flatten_options` folds. A
# section added to the schema and not to this tuple would be stored nested,
# where nothing looks for it.
OPTION_SECTIONS: tuple[str, ...] = (SECTION_TODO,)


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


def clean_todo_entity_id(value: Any) -> str:
    """Normalize the chosen shopping list to an entity id, or `""` for off.

    A cleared entity selector submits no value at all rather than an empty one,
    so "absent" and "off" have to arrive at the same answer here. The option is
    stored as a string either way, and the bridge reads `""` as "not
    configured" — there is no third state for it to distinguish.
    """
    if not isinstance(value, str):
        return DEFAULT_TODO_ENTITY_ID
    return value.strip()


def _todo_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the shopping-list section's schema: one to-do entity, or nothing.

    `suggested_value` rather than `default`: voluptuous re-inserts a default
    when the key is absent, which is exactly what a cleared field submits, so a
    default would make the list impossible to unpick once chosen.
    """
    chosen = clean_todo_entity_id(current.get(CONF_TODO_ENTITY_ID))
    return vol.Schema(
        {
            vol.Optional(
                CONF_TODO_ENTITY_ID,
                description={"suggested_value": chosen or None},
            ): EntitySelector(
                EntitySelectorConfig(
                    filter=EntityFilterSelectorConfig(
                        domain=TODO_DOMAIN,
                        # A list that can be written to but not deleted from
                        # collects one line per low-stock crossing and nothing
                        # HAventory can do ever clears them. Not offering it is
                        # the only way a household cannot choose wrongly here.
                        supported_features=[TODO_FEATURE_DELETE_ITEM_NAME],
                    )
                )
            ),
        }
    )


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


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the options-flow schema, defaulting to the stored options."""
    return vol.Schema(
        {
            vol.Required(
                CONF_CARD_TITLE,
                default=clean_card_title(current.get(CONF_CARD_TITLE, DEFAULT_CARD_TITLE)),
            ): str,
            # Entries predating the option have no value and read as on.
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
            # Collapsed until a list is chosen: the bridge is off by default,
            # and a household that has not asked for a shopping list should not
            # meet an entity picker on the way to renaming its card.
            vol.Required(SECTION_TODO): section(
                _todo_schema(current),
                {"collapsed": not clean_todo_entity_id(current.get(CONF_TODO_ENTITY_ID))},
            ),
        }
    )


def _flatten_options(user_input: dict[str, Any]) -> dict[str, Any]:
    """Fold the form's sections back into the flat keys the runtime reads."""
    flat = {key: value for key, value in user_input.items() if key not in OPTION_SECTIONS}
    for name in OPTION_SECTIONS:
        nested = user_input.get(name)
        if isinstance(nested, dict):
            flat.update(nested)
    return flat


class HAventoryOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle HAventory options (card title, sidebar, pills, shopping list).

    The form is the whole of what an entry's options may hold: `async_create_entry`
    replaces them wholesale, so a key an older release wrote and this one no longer
    offers is read by nothing and is gone the next time this form is saved.
    """

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            options = _flatten_options(user_input)
            options[CONF_CARD_TITLE] = clean_card_title(options.get(CONF_CARD_TITLE))
            # Unconditionally, unlike the pills below: a cleared selector sends
            # nothing, and "nothing" is the answer that turns the bridge off.
            options[CONF_TODO_ENTITY_ID] = clean_todo_entity_id(options.get(CONF_TODO_ENTITY_ID))
            # Only when the form carried the field: writing it unconditionally
            # would turn "never chose" into an explicit list on any submission
            # that skipped it, and the two are different answers downstream.
            if CONF_QUICK_FILTERS in options:
                options[CONF_QUICK_FILTERS] = clean_quick_filters(options[CONF_QUICK_FILTERS])
            return self.async_create_entry(title="", data=options)

        current = dict(self.config_entry.options)
        return self.async_show_form(step_id="init", data_schema=_options_schema(current))


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
