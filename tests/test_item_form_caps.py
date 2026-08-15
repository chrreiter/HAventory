"""The card's input caps must be the backend's, and something has to say so.

``cards/haventory-card/src/ui/item-form.ts`` copies the size limits out of
``models.py`` so the editor refuses input before the round trip rather than
showing a server error on save. Both halves are internally consistent — the
card's own test checks the card's numbers against the card's numbers — so a
drift shows up in neither suite:

- a card cap *below* the backend's makes the editor refuse input the API would
  have accepted, with a message naming a limit nobody set;
- a card cap *above* it turns the client-side check into a round trip that fails
  at the server with the ``validation_error`` the form exists to prevent.

This is the same shape as ``tests/test_frontend_registration.py`` pinning
``PANEL_ICON`` to the bundle's exported identifier, and as the platform floors in
``tests/test_min_ha_version.py`` and ``tests/test_toolchain_pins.py``: a value
written on both sides of a language boundary neither side can check alone. The
caps are read out of the TypeScript with a regex, which is what those tests do to
YAML and TOML — generating the card's constants from the Python would be a build
step for nine numbers.

The registered caps are checked by name and by value; the TypeScript is then
swept for every ``*_MAX_*`` / ``*_MAX`` constant it declares, so a cap added on
one side alone fails rather than passing unnoticed.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from custom_components.haventory import models

REPO_ROOT = Path(__file__).resolve().parents[1]
ITEM_FORM_TS = REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "item-form.ts"

#: ``const NAME_MAX_LENGTH = 120;`` — the card writes its caps as plain integers,
#: with no numeric separators, so nothing has to be normalized away.
TS_NUMERIC_CONST = re.compile(r"^const (?P<name>\w*MAX\w*) *(?::[^=]+)? *= *(?P<value>\d+);", re.M)

#: ``export const REMINDER_UNITS: readonly ReminderUnit[] = ['days', ...];``
TS_REMINDER_UNITS = re.compile(r"REMINDER_UNITS[^=]*= *\[(?P<items>[^\]]*)\]")

#: Every size cap the editor enforces, named identically on both sides. The name
#: is the pairing: a cap renamed on one side is a cap the other no longer holds.
PAIRED_CAPS: tuple[str, ...] = (
    "NAME_MAX_LENGTH",
    "DESCRIPTION_MAX_LENGTH",
    "CATEGORY_MAX_LENGTH",
    "TAG_MAX_LENGTH",
    "TAGS_MAX_COUNT",
    "CUSTOM_FIELDS_MAX_KEYS",
    "CUSTOM_FIELD_KEY_MAX_LENGTH",
    "CUSTOM_FIELD_VALUE_MAX_LENGTH",
    "REMINDER_COUNT_MAX",
)


def card_source() -> str:
    return ITEM_FORM_TS.read_text(encoding="utf-8")


def card_caps() -> dict[str, int]:
    """Every ``MAX``-named integer constant the editor declares."""
    return {
        match.group("name"): int(match.group("value"))
        for match in TS_NUMERIC_CONST.finditer(card_source())
    }


def card_reminder_units() -> tuple[str, ...]:
    match = TS_REMINDER_UNITS.search(card_source())
    assert match is not None, f"no REMINDER_UNITS declaration found in {ITEM_FORM_TS.name}"
    return tuple(re.findall(r"['\"](\w+)['\"]", match.group("items")))


def test_the_card_source_is_where_this_test_thinks_it_is() -> None:
    """A moved or renamed editor would make every check below vacuously pass."""

    assert ITEM_FORM_TS.is_file(), f"{ITEM_FORM_TS} is missing"
    assert card_caps(), "no MAX-named constants parsed; the regex no longer matches the source"


@pytest.mark.parametrize("cap", PAIRED_CAPS)
def test_each_card_cap_equals_the_backend_cap(cap: str) -> None:
    """Same name, same number, on both sides of the language boundary."""

    parsed = card_caps()
    assert cap in parsed, f"{ITEM_FORM_TS.name} declares no {cap}"
    assert hasattr(models, cap), f"models.py declares no {cap}"
    assert parsed[cap] == getattr(models, cap), (
        f"{cap}: card has {parsed[cap]}, models.py has {getattr(models, cap)} — "
        "the editor and the API would disagree about what to accept"
    )


def test_no_unregistered_cap_hides_in_the_editor() -> None:
    """A cap added on one side alone fails, rather than passing unnoticed."""

    assert set(card_caps()) == set(PAIRED_CAPS), (
        f"unregistered in {ITEM_FORM_TS.name}: {sorted(set(card_caps()) - set(PAIRED_CAPS))}; "
        f"registered but no longer declared there: {sorted(set(PAIRED_CAPS) - set(card_caps()))}"
    )


def test_the_reminder_units_match() -> None:
    """The unit vocabulary is a cap on input too: an extra one is refused."""

    assert card_reminder_units() == models.REMINDER_UNITS
