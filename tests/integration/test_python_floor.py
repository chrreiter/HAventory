"""Integration: the declared Python floor is one this Home Assistant installs on.

``pyproject.toml`` declares the interpreter this project needs, and the Home
Assistant release ``requirements-integration.txt`` pins declares its own. The
second number exists only where Home Assistant is installed, which is here —
offline there is nothing to compare against, so ``tests/test_toolchain_pins.py``
holds every copy of the floor to the declaration and this holds the declaration
to Home Assistant.

A floor below HA's own is not a lax declaration but a misleading one: uv is free
to hand such an environment an interpreter that then cannot resolve Home
Assistant at all, and the failure reads as an unsatisfiable dependency rather
than as an interpreter too old.
"""

from __future__ import annotations

import re
import tomllib
from importlib.metadata import metadata
from pathlib import Path

import pytest

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def lowest_admitted(requires_python: str) -> tuple[int, ...]:
    """The oldest interpreter a ``Requires-Python`` specifier set admits."""
    lower_bounds = re.findall(r">=\s*(\d+(?:\.\d+)*)", requires_python)
    assert len(lower_bounds) == 1, f"{requires_python!r} states no single lower bound"
    return tuple(int(part) for part in lower_bounds[0].split("."))


def declared_floor() -> tuple[int, ...]:
    """The floor ``requires-python`` declares."""
    requires_python = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"][
        "requires-python"
    ]
    return lowest_admitted(requires_python)


def test_the_declared_floor_is_not_below_what_this_ha_release_demands() -> None:
    """`requires-python` admits no interpreter Home Assistant would refuse."""
    home_assistant = lowest_admitted(str(metadata("homeassistant")["Requires-Python"]))

    assert declared_floor() >= home_assistant, (
        f"pyproject.toml declares Python {declared_floor()}, Home Assistant "
        f"{metadata('homeassistant')['Version']} demands {home_assistant}"
    )


def test_a_lower_bound_is_read_out_of_a_compound_specifier() -> None:
    """Home Assistant may bound the top as well; only the bottom is the floor."""
    assert lowest_admitted(">=3.14.2,<3.16") == (3, 14, 2)
    assert lowest_admitted(">= 3.14") == (3, 14)


def test_a_specifier_without_a_lower_bound_is_refused() -> None:
    """An unbounded specifier compares as no floor at all, so it must not pass."""
    with pytest.raises(AssertionError):
        lowest_admitted("<3.16")
