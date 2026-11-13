"""Offline tests for the refusals a person reads, in their own language.

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
from types import SimpleNamespace
from typing import Any

import pytest
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import (
    ConflictError,
    NotFoundError,
    NotLoadedError,
    StorageError,
    ValidationError,
    translation_fields,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from runtime_helpers import setup_entry, unload_entry, ws_hass
from ws_helpers import ws_send

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


def test_a_keyed_refusal_keeps_its_english_message_and_stringifies_placeholders() -> None:
    exc = ConflictError(
        "version conflict: expected 1, actual 2",
        key="version_conflict",
        placeholders={"expected": 1, "actual": 2},
    )

    assert str(exc) == "version conflict: expected 1, actual 2"
    assert translation_fields(exc) == {
        "translation_domain": DOMAIN,
        "translation_key": "version_conflict",
        "translation_placeholders": {"expected": "1", "actual": "2"},
    }


def test_an_unkeyed_refusal_carries_no_translation_fields() -> None:
    exc = ValidationError("cursor is not a valid pagination cursor")

    assert exc.translation_key is None
    assert exc.translation_domain is None
    assert translation_fields(exc) == {}


@pytest.mark.asyncio
async def test_the_websocket_envelope_names_the_key_and_its_placeholders() -> None:
    hass = ws_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Drill")
    item = created["result"]

    res = await ws_send(
        hass,
        2,
        "haventory/item/update",
        item_id=item["id"],
        name="Drill 2",
        expected_version=item["version"] + 5,
    )

    error = res["error"]
    assert error["code"] == "conflict"
    assert error["message"].startswith("version conflict")
    assert error["translation_domain"] == DOMAIN
    assert error["translation_key"] == "version_conflict"
    assert error["translation_placeholders"] == {
        "expected": str(item["version"] + 5),
        "actual": str(item["version"]),
    }


@pytest.mark.asyncio
async def test_an_unkeyed_websocket_refusal_carries_only_its_message() -> None:
    hass = ws_hass()

    res = await ws_send(hass, 1, "haventory/subscribe", topic="nope")

    assert res["error"]["code"] == "validation_error"
    assert "translation_key" not in res["error"]


@pytest.mark.asyncio
async def test_a_refused_bulk_row_names_its_key() -> None:
    hass = ws_hass()

    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[{"op_id": "a", "kind": "item_delete", "payload": {"item_id": _UNKNOWN_ID}}],
    )

    row = res["result"]["results"]["a"]
    assert row["success"] is False
    assert row["error"]["translation_key"] == "item_not_found"


@pytest.mark.asyncio
async def test_an_invalid_import_names_its_key_and_keys_each_row_it_can() -> None:
    hass = ws_hass()
    exported = (await ws_send(hass, 1, "haventory/export"))["result"]
    exported["items"] = [{"id": _UNKNOWN_ID, "name": "", "quantity": -1}]

    res = await ws_send(hass, 2, "haventory/import/execute", document=exported)

    error = res["error"]
    assert error["translation_key"] == "import_document_invalid"
    rows: list[dict[str, Any]] = error["data"]["errors"]
    keys = {row.get("translation_key") for row in rows}
    assert {"name_required", "quantity_negative"} <= keys
    assert all(row["message"] for row in rows)


@pytest.mark.asyncio
async def test_services_are_registered_once_by_async_setup_and_not_by_the_entry(
    monkeypatch,
) -> None:
    """`setup_entry` runs `async_setup` first, as Home Assistant does; the entry adds nothing."""

    hass = HomeAssistant()
    calls: list[HomeAssistant] = []
    real_setup = services_mod.setup

    def _spy(h: HomeAssistant) -> None:
        calls.append(h)
        real_setup(h)

    monkeypatch.setattr(services_mod, "setup", _spy)

    entry = await setup_entry(hass)
    await unload_entry(hass, entry)
    await setup_entry(hass, entry)

    assert calls == [hass]
    names = {name for (_d, name, *_rest) in hass.services.registered}
    assert names == {name for name, _handler, _schema in services_mod.SERVICES}


@pytest.mark.asyncio
async def test_a_service_called_with_no_entry_loaded_refuses_with_a_keyed_validation_error() -> (
    None
):
    from custom_components.haventory import async_setup  # noqa: PLC0415

    hass = HomeAssistant()
    await async_setup(hass, {})
    handler = next(h for (_d, n, h, *_r) in hass.services.registered if n == "item_create")

    call = SimpleNamespace(data={"name": "Torch"})

    with pytest.raises(NotLoadedError) as raised:
        await handler(call)  # type: ignore[operator]

    assert isinstance(raised.value, ServiceValidationError)
    assert raised.value.translation_key == "not_loaded"
    assert raised.value.translation_domain == DOMAIN


_UNKNOWN_ID = "6f1c2b9e-3f7a-4c1d-9b2e-8a7d6c5b4a3f"
