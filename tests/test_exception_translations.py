"""Tests for the refusals a person reads, in their own language.

A refusal names a key under ``exceptions`` in ``strings.json``. Home Assistant's
frontend words a service error from that file, and the card words a WebSocket
refusal from its own catalog under ``hv.serverError.<key>``. Neither side can
see the other, so the keys, their placeholders and their wording are held
together here, across the language boundary, along with the raise sites that
name them.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest
from custom_components.haventory.exceptions import (
    ConflictError,
    NotFoundError,
    NotLoadedError,
    StorageError,
    ValidationError,
)
from homeassistant.exceptions import ServiceValidationError

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "custom_components" / "haventory"
I18N = ROOT / "cards" / "haventory-card" / "src" / "i18n"
CARD_PREFIX = "hv.serverError."
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _exceptions(path: Path) -> dict[str, str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return {key: entry["message"] for key, entry in document["exceptions"].items()}


def _card_catalog(name: str) -> dict[str, str]:
    """The card's `hv.serverError.*` entries, read off the dictionary's source."""

    source = (I18N / f"{name}.ts").read_text(encoding="utf-8")
    pattern = re.compile(r"'" + re.escape(CARD_PREFIX) + r"(\w+)':\s*'((?:[^'\\]|\\.)*)'")
    return {key: text.replace("\\'", "'") for key, text in pattern.findall(source)}


_EXCEPTIONS = {
    "HaventoryError",
    "ValidationError",
    "NotFoundError",
    "ConflictError",
    "StorageError",
    "NotLoadedError",
}


def _names_an_exception(func: ast.expr) -> bool:
    name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
    return name in _EXCEPTIONS


def _raised_keys() -> dict[str, set[str]]:
    """Every `key=` a raise site names, with the placeholder names it passes."""

    found: dict[str, set[str]] = {}
    for path in sorted(PACKAGE.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and _names_an_exception(node.func)):
                continue
            kwargs = {kw.arg: kw.value for kw in node.keywords if kw.arg}
            key = kwargs.get("key")
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                continue
            names: set[str] = set()
            placeholders = kwargs.get("placeholders")
            if isinstance(placeholders, ast.Dict):
                names = {k.value for k in placeholders.keys if isinstance(k, ast.Constant)}
            found.setdefault(key.value, set()).update(names)
    return found


STRINGS = _exceptions(PACKAGE / "strings.json")
TRANSLATIONS = {tag: _exceptions(PACKAGE / "translations" / f"{tag}.json") for tag in ("en", "de")}


def test_every_key_a_raise_site_names_is_in_strings_json_and_none_is_dead() -> None:
    """A key nothing declares shows the English fallback; one nothing raises is dead."""

    assert sorted(_raised_keys()) == sorted(STRINGS)


def test_each_raise_site_passes_exactly_the_placeholders_its_sentence_uses() -> None:
    raised = _raised_keys()
    mismatched = {
        key: (sorted(raised[key]), sorted(set(PLACEHOLDER.findall(text))))
        for key, text in STRINGS.items()
        if raised.get(key, set()) != set(PLACEHOLDER.findall(text))
    }
    assert mismatched == {}


@pytest.mark.parametrize(("tag", "card"), [("en", "en"), ("de", "de")])
def test_the_card_words_each_refusal_as_home_assistant_does(tag: str, card: str) -> None:
    """One sentence per key per language, whichever surface the person meets it on."""

    assert _card_catalog(card) == TRANSLATIONS[tag]


def test_strings_json_and_english_translation_agree() -> None:
    assert TRANSLATIONS["en"] == STRINGS


def test_no_sentence_carries_an_ascii_apostrophe() -> None:
    """Home Assistant formats these as ICU messages, where `'` beside a brace escapes it."""

    offending = {
        f"{tag}:{key}": text
        for tag, catalog in TRANSLATIONS.items()
        for key, text in catalog.items()
        if "'" in text
    }
    assert offending == {}


def test_a_callers_mistake_is_a_service_validation_error_and_a_fault_is_not() -> None:
    """Home Assistant logs a traceback for any other error a service raises."""

    for cls in (ValidationError, NotFoundError, ConflictError, NotLoadedError):
        assert issubclass(cls, ServiceValidationError), cls
    assert not issubclass(StorageError, ServiceValidationError)
