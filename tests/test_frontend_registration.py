"""Checks across the Python/TypeScript boundary that neither side can make alone.

Each reads the card's source or build config and compares it with the constant, vocabulary
or filename the backend holds, so a rename on one side fails here instead of in a browser.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from custom_components.haventory import frontend_registration
from custom_components.haventory.const import (
    MEDIA_NAME_TOKEN_PARAM,
    MEDIA_SIZE_PARAM,
    MEDIA_SIZE_THUMB,
    MEDIA_URL_TEMPLATE,
    PANEL_ICON,
    QUICK_FILTER_KEYS,
    STATUS_COLORS,
    STATUS_ICONS,
)
from custom_components.haventory.models import seed_status_definitions

REPO_ROOT = Path(__file__).resolve().parents[1]


def _vite_config() -> str:
    return (REPO_ROOT / "cards" / "haventory-card" / "vite.config.ts").read_text(encoding="utf-8")


def test_the_card_build_names_its_entry_after_the_loaded_file() -> None:
    """The entry keeps the one fixed name every loader and ``_CARD_FILENAME`` use.

    A hashed entry name would leave the extra module URL, the Lovelace resource and
    the static-path check pointing at a file the build no longer writes.
    """
    config = _vite_config()

    match = re.search(r"entryFileNames: '([^']+)'", config)
    assert match is not None
    assert match.group(1) == frontend_registration._CARD_FILENAME == "haventory-card.js"


def test_the_card_build_puts_hashed_chunks_under_chunks() -> None:
    """Chunks live in ``www/chunks/`` and carry a content hash.

    The setup sweep and the build's own cleanup only look inside ``chunks/``, so a
    chunk written beside the entry would never be removed. The hash is what makes
    a changed chunk a new URL; without it a browser keeps the old one.
    """
    config = _vite_config()

    match = re.search(r"chunkFileNames: '([^']+)'", config)
    assert match is not None
    assert match.group(1).startswith("chunks/")
    assert "[hash]" in match.group(1)


def test_the_card_build_writes_its_manifest_where_the_sweep_reads_it() -> None:
    """The build manifest goes to ``chunks/manifest.json``.

    The setup sweep decides which chunks are stale from it, and the release check
    requires it in the zip. Both read that exact path.
    """
    config = _vite_config()

    assert re.search(r"manifest: 'chunks/manifest\.json',", config) is not None


def test_the_card_build_keeps_the_eager_graph_out_of_the_entry() -> None:
    """``manualChunks`` moves everything the entry imports into a separate chunk.

    A chunk that imports the entry loads it a second time without its ``?v=`` and
    defines every custom element twice, so the entry must import chunks and never
    the other way round.
    """
    config = _vite_config()

    assert re.search(r"^\s*manualChunks:", config, re.MULTILINE) is not None


def test_the_sidebar_icon_is_the_one_the_card_bundle_publishes() -> None:
    """``PANEL_ICON`` names an icon set that only the card bundle registers.

    A non-``mdi:`` prefix is resolved against the frontend's icon registry, so
    the sidebar shows the mark only while the two spellings agree — and a
    disagreement is silent, costing the entry its icon and nothing else.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts").read_text(
        encoding="utf-8"
    )

    def declared(name: str) -> str:
        match = re.search(rf"^export const {name} = '([^']+)';$", source, re.MULTILINE)
        assert match is not None, f"{name} is no longer declared in brand-icon.ts"
        return match.group(1)

    assert PANEL_ICON == f"{declared('HAVENTORY_ICONSET')}:{declared('HAVENTORY_ICON_NAME')}"


def test_the_card_builds_media_urls_on_the_route_the_backend_serves() -> None:
    """The attachment route is a constant on both sides and checked by neither.

    The card builds a media path itself, signs it, and puts the result straight
    into an ``<img src>``; a disagreement here is a 404 per photo, with nothing
    in any log to say the two spellings drifted apart.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^export const MEDIA_URL_TEMPLATE = '([^']+)';$", source, re.MULTILINE)
    assert match is not None, "MEDIA_URL_TEMPLATE is no longer declared in media.ts"

    assert match.group(1) == MEDIA_URL_TEMPLATE


def test_the_card_versions_media_urls_under_the_parameter_the_backend_reads() -> None:
    """The name-token parameter is a constant on both sides and checked by neither.

    Drift here fails silently in the direction that matters least at first: the
    card keeps working, the backend simply stops seeing the token and serves
    every attachment uncacheable. The visible symptom is a photo grid that
    refetches on every render, which reads as a performance problem rather than
    a renamed constant.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^export const MEDIA_NAME_TOKEN_PARAM = '([^']+)';$", source, re.MULTILINE)
    assert match is not None, "MEDIA_NAME_TOKEN_PARAM is no longer declared in media.ts"

    assert match.group(1) == MEDIA_NAME_TOKEN_PARAM


def test_the_card_asks_for_a_row_tile_by_the_name_the_backend_accepts() -> None:
    """The size parameter and its one value are constants on both sides.

    Neither side can see the other, and the view answers an unknown ``size``
    with a 400 — so a rename on the card turns every row tile into a broken
    image, and a rename on the backend quietly serves the whole picture again
    with nothing but the download size to say so.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    for name, expected in (
        ("MEDIA_SIZE_PARAM", MEDIA_SIZE_PARAM),
        ("MEDIA_VARIANT_THUMB", MEDIA_SIZE_THUMB),
    ):
        match = re.search(
            rf"^export const {name}(?:: MediaVariant)? = '([^']+)';$", source, re.MULTILINE
        )
        assert match is not None, f"{name} is no longer declared in media.ts"
        assert match.group(1) == expected


def test_every_status_icon_has_a_glyph_in_the_bundle() -> None:
    """``STATUS_ICONS`` names glyphs only the card defines.

    The backend validates a status's icon against this vocabulary and the card
    looks it up in ``ICONS``; neither can see the other. A name the card lacks
    stores fine and then renders nothing, with no error anywhere to say why.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "icons.ts").read_text(
        encoding="utf-8"
    )
    defined = set(re.findall(r"^  ([A-Za-z][A-Za-z0-9]*):", source, re.MULTILINE))

    assert set(STATUS_ICONS) <= defined, f"no glyph for: {sorted(set(STATUS_ICONS) - defined)}"


def test_the_card_offers_exactly_the_vocabularies_the_backend_accepts() -> None:
    """The management picker enumerates colours and glyphs from its own arrays.

    These are the *offered* palettes, and they have to match: a card offering
    one token more hands the user a control that fails on save, and one
    offering fewer hides a colour the store may already hold. Beside them the
    backend also accepts a `#rrggbb` literal, which is not a vocabulary either
    side enumerates — the card's own picker produces it.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "status.ts").read_text(
        encoding="utf-8"
    )

    def declared(name: str) -> list[str]:
        match = re.search(rf"export const {name}: readonly \w+\[\] = \[(.*?)\];", source, re.S)
        assert match is not None, f"{name} is no longer declared in status.ts"
        return re.findall(r"'([^']+)'", match.group(1))

    assert declared("STATUS_COLORS") == list(STATUS_COLORS)
    assert declared("STATUS_ICONS") == list(STATUS_ICONS)


def test_the_cards_built_in_statuses_are_the_ones_the_backend_seeds() -> None:
    """``BUILT_IN_STATUSES`` mirrors ``seed_status_definitions()``, label included.

    The card draws that array until ``haventory/config`` answers, so a label
    that differs reworded three chips for the first moment of every page load.
    The label carries a second job since #536: a built-in still storing the
    English the seed wrote is printed in the reader's language, and the card
    decides that by comparing the stored label against this copy. A seed the
    card does not know the wording of translates nowhere — every language keeps
    the English, silently, which is the state that issue was filed about.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "status.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(
        r"export const BUILT_IN_STATUSES: readonly StatusDefinition\[\] = \[(.*?)\n\];",
        source,
        re.S,
    )
    assert match is not None, "BUILT_IN_STATUSES is no longer declared in status.ts"

    def field(entry: str, name: str) -> str:
        found = re.search(rf"\b{name}:\s*'([^']*)'", entry)
        assert found is not None, f"{name} is missing from a BUILT_IN_STATUSES entry"
        return found.group(1)

    def order(entry: str) -> int:
        found = re.search(r"\border:\s*(\d+)", entry)
        assert found is not None, "order is missing from a BUILT_IN_STATUSES entry"
        return int(found.group(1))

    declared = [
        (
            field(entry, "slug"),
            field(entry, "label"),
            order(entry),
            field(entry, "color"),
            field(entry, "icon"),
        )
        for entry in re.findall(r"\{([^{}]*)\}", match.group(1))
    ]
    seeded = [
        (d.slug, d.label, d.order, d.color, d.icon) for d in seed_status_definitions().values()
    ]

    assert declared == seeded


def test_the_options_flow_offers_exactly_the_pills_the_card_draws() -> None:
    """The pill vocabulary is spelled out in both languages and must agree.

    Neither side can check the other: the options flow stores names the card
    looks up, and a name only one of them knows is dropped in silence — the
    household ticks a pill that never appears, or loses one it never untucked.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "quick-filters.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"export const QUICK_FILTER_KEYS = \[(.*?)\] as const;", source, re.S)
    assert match is not None, "QUICK_FILTER_KEYS is no longer declared in quick-filters.ts"
    declared = re.findall(r"'([^']+)'", match.group(1))

    assert declared == list(QUICK_FILTER_KEYS)


def test_every_pill_the_options_flow_offers_carries_a_label() -> None:
    """A selector option with no translation renders its raw wire name.

    Home Assistant looks the labels up under `selector.<key>.options.<value>`,
    so a pill added on the Python side alone reaches the form as `low_stock`.
    """
    strings = json.loads(
        (REPO_ROOT / "custom_components" / "haventory" / "strings.json").read_text(encoding="utf-8")
    )
    labels = strings["selector"]["quick_filters"]["options"]

    assert sorted(labels) == sorted(QUICK_FILTER_KEYS)
    assert all(isinstance(text, str) and text for text in labels.values())


def test_every_status_colour_has_a_rule_in_the_chip_stylesheet() -> None:
    """``STATUS_COLORS`` names tones only the card can paint.

    Same blind spot as the icons: a token with no rule falls back to the base
    chip and the status renders in the wrong colour rather than failing.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "chip.ts").read_text(
        encoding="utf-8"
    )
    styled = set(re.findall(r"\.hv-status-chip\.tone-([a-z-]+)", source))

    expected = {token.replace("_", "-") for token in STATUS_COLORS}
    assert expected <= styled, f"no rule for: {sorted(expected - styled)}"
