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
from .todo_bridge import TODO_DOMAIN, TODO_FEATURE_DELETE_ITEM_NAME

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

# Form-only collapsible blocks. `_flatten_options` folds every section listed
# here, so the stored options stay flat; one missing here would be stored nested.
SECTION_TODO = "todo"
OPTION_SECTIONS: tuple[str, ...] = (SECTION_TODO,)


def clean_card_title(value: Any) -> str:
    """Normalize a submitted card title; blank reads as the default."""
    if not isinstance(value, str):
        return DEFAULT_CARD_TITLE
    return value.strip() or DEFAULT_CARD_TITLE


def clean_quick_filters(value: Any) -> list[str]:
    """Normalize a submitted pill list to the known names, in canonical order.

    An empty list is kept: unticking everything means no pills, which differs
    from never having chosen.
    """
    if not isinstance(value, list):
        return list(DEFAULT_QUICK_FILTERS)
    chosen = {entry for entry in value if isinstance(entry, str)}
    return [key for key in QUICK_FILTER_KEYS if key in chosen]


def clean_todo_entity_id(value: Any) -> str:
    """Normalize the chosen shopping list to an entity id, or `""` for off.

    A cleared entity selector submits no value at all, which also means off.
    """
    if not isinstance(value, str):
        return DEFAULT_TODO_ENTITY_ID
    return value.strip()


def _todo_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the shopping-list section's schema: one to-do entity, or nothing.

    `suggested_value`, not `default`: voluptuous re-inserts a default for the
    absent key a cleared field submits, so the list could never be unpicked.
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
                        # A list HAventory cannot delete from would only fill up.
                        supported_features=[TODO_FEATURE_DELETE_ITEM_NAME],
                    )
                )
            ),
        }
    )


def _quick_filters_selector() -> SelectSelector:
    """Build the pill picker as a checkbox list, labelled through the translation key."""
    return SelectSelector(
        SelectSelectorConfig(
            options=list(QUICK_FILTER_KEYS),
            multiple=True,
            mode=SelectSelectorMode.LIST,
            translation_key=CONF_QUICK_FILTERS,
        )
    )


def _user_schema() -> vol.Schema:
    """Build the setup-step schema: the card title and the sidebar toggle."""
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
            vol.Required(
                CONF_SIDEBAR_PANEL_ENABLED,
                default=bool(
                    current.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED)
                ),
            ): bool,
            # Prefilled with every pill when the entry has never chosen, so
            # saving the form for another field cannot quietly mean "no pills".
            vol.Required(
                CONF_QUICK_FILTERS,
                default=clean_quick_filters(
                    current.get(CONF_QUICK_FILTERS, list(DEFAULT_QUICK_FILTERS))
                ),
            ): _quick_filters_selector(),
            # Collapsed until a list is chosen: the bridge is off by default.
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
    """Handle HAventory options; `async_create_entry` replaces them wholesale."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            options = _flatten_options(user_input)
            options[CONF_CARD_TITLE] = clean_card_title(options.get(CONF_CARD_TITLE))
            # Unconditionally: a cleared selector sends nothing, which means off.
            options[CONF_TODO_ENTITY_ID] = clean_todo_entity_id(options.get(CONF_TODO_ENTITY_ID))
            # Only when submitted, so "never chose" stays distinct from a list.
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
        """Handle the initial step; the card title also names the entry."""
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
