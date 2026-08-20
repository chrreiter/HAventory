"""The mark is drawn in three places and nothing but this file makes them agree.

- ``cards/haventory-card/src/ui/brand-icon.ts`` — the sidebar icon, one ``<path d>``
  under the default ``nonzero`` fill rule, so the crates are wound against the house
  to cut themselves out of it.
- ``docs/assets/social-preview.html`` — the repository's preview image, one ``<path
  d>`` under ``fill-rule="evenodd"``, where winding carries no meaning and every
  subpath is wound alike.
- ``docs/assets/brand/`` — the artwork ``home-assistant/brands`` serves for the HACS
  listing and the integrations page, generated from the first of the three by
  ``scripts/render_brand_assets.py``.

The first two are the same outline written for two fill rules, and read side by side
they look like they contradict each other. What follows normalises both to one
winding and asserts they describe the same shape, then pins each file's winding so
the property its fill rule depends on cannot be "tidied" into the other one's.
"""

from __future__ import annotations

import re
import struct
import sys
from dataclasses import replace
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from render_brand_assets import (  # noqa: E402
    ICON_SIZES,
    Line,
    Segment,
    Subpath,
    flatten,
    parse_path,
)

BRAND_ICON_TS = REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts"
SOCIAL_PREVIEW_HTML = REPO_ROOT / "docs" / "assets" / "social-preview.html"
BRAND_DIR = REPO_ROOT / "docs" / "assets" / "brand"

# In SVG the y axis grows downward, which flips the sign the shoelace formula
# carries in school geometry: a positive signed area is clockwise *on screen*.
CLOCKWISE = 1
COUNTER_CLOCKWISE = -1

# Coordinates are decimal literals in both files and are only ever copied or
# reordered here, so this rounds away float noise rather than a real difference.
PLACES = 6

# The house, three crates and three handle slots.
SUBPATHS = 7

# Fine enough that the flattened outline of an arc of radius 9 — the smallest in the
# mark — cannot be mistaken for a differently wound one.
FLATTEN_TOLERANCE = 0.05


# --------------------------------------------------------------------------- #
# Reading the three copies
# --------------------------------------------------------------------------- #


def card_mark_path() -> str:
    """``HAVENTORY_MARK_PATH``, rebuilt from the groups it is joined from.

    Read independently of ``scripts/render_brand_assets.py``: the script writes the
    brand SVG from its own reading, and the two only agree if both are right.
    """
    source = BRAND_ICON_TS.read_text(encoding="utf-8")
    groups = []
    for name, expected in (("HOUSE", 1), ("CRATES", 3), ("HANDLES", 3)):
        match = re.search(rf"^const {name} =(.*?);$", source, re.MULTILINE | re.DOTALL)
        assert match is not None, f"{name} is no longer declared in brand-icon.ts"
        # Split between array elements — a comma right after a closing quote —
        # and not inside one, where a subpath is concatenated across lines with
        # `+` and every comma sits inside the quotes.
        parts = [
            "".join(re.findall(r"'([^']*)'", entry))
            for entry in re.split(r"(?<='),", match.group(1))
        ]
        parts = [part for part in parts if part]
        assert len(parts) == expected, f"read {len(parts)} subpaths from {name}, want {expected}"
        groups.extend(parts)
    return " ".join(groups)


def card_view_box() -> str:
    source = BRAND_ICON_TS.read_text(encoding="utf-8")
    match = re.search(r"^export const HAVENTORY_MARK_VIEW_BOX = '([^']+)';$", source, re.MULTILINE)
    assert match is not None, "HAVENTORY_MARK_VIEW_BOX is no longer declared in brand-icon.ts"
    return match.group(1)


def _sole_attribute(source: str, name: str, where: str) -> str:
    found = re.findall(rf'(?<![\w-]){name}="([^"]+)"', source)
    assert len(found) == 1, f"{where} declares {len(found)} {name} attributes, want exactly 1"
    return found[0]


def preview_mark_path() -> str:
    return _sole_attribute(
        SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8"), "d", "social-preview.html"
    )


def brand_color() -> str:
    return _sole_attribute(
        SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8"), "fill", "social-preview.html"
    )


# --------------------------------------------------------------------------- #
# Normalising one outline to a canonical form
# --------------------------------------------------------------------------- #


def _point(point: tuple[float, float]) -> tuple[float, float]:
    return (round(point[0], PLACES), round(point[1], PLACES))


def _key(segment: Segment) -> tuple[object, ...]:
    """A hashable description of one segment, independent of how it was spelled.

    ``H``/``V``/``L`` all arrive as a :class:`Line`, and a relative command has
    already been resolved, so only the geometry is left.
    """
    if isinstance(segment, Line):
        return ("line", _point(segment.start), _point(segment.end))
    return (
        "arc",
        _point(segment.start),
        _point(segment.end),
        round(segment.rx, PLACES),
        round(segment.ry, PLACES),
        round(segment.rotation, PLACES),
        segment.large_arc,
        segment.sweep,
    )


def _closed(subpath: Subpath) -> list[Segment]:
    """The subpath's segments plus the closing edge ``Z`` draws implicitly."""
    segments = list(subpath.segments)
    first, last = segments[0].start, segments[-1].end
    if _point(first) != _point(last):
        segments.append(Line(last, first))
    return segments


def _reversed(segments: list[Segment]) -> list[Segment]:
    """Walk the same outline the other way round.

    An arc traversed backwards keeps its radii and its large-arc flag and swaps
    only its sweep — that flag says which of the two arcs joining the endpoints was
    meant, and the answer changes with the direction of travel.
    """
    walked: list[Segment] = []
    for segment in reversed(segments):
        if isinstance(segment, Line):
            walked.append(Line(segment.end, segment.start))
        else:
            walked.append(
                replace(segment, start=segment.end, end=segment.start, sweep=not segment.sweep)
            )
    return walked


def winding(subpath: Subpath) -> int:
    """``CLOCKWISE`` or ``COUNTER_CLOCKWISE``, from the flattened outline's area."""
    points = flatten(subpath, FLATTEN_TOLERANCE)
    area = sum(
        x0 * y1 - x1 * y0
        for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1], strict=True)
    )
    return CLOCKWISE if area > 0 else COUNTER_CLOCKWISE


def canonical(subpath: Subpath) -> tuple[tuple[object, ...], ...]:
    """One outline in the one form two spellings of it must share.

    Wound clockwise, and rotated to begin at its lowest-numbered vertex — so
    neither the direction of travel nor the choice of which corner ``M`` names can
    make two spellings of the same outline compare unequal.
    """
    segments = _closed(subpath)
    if winding(subpath) == COUNTER_CLOCKWISE:
        segments = _reversed(segments)
    keys = [_key(segment) for segment in segments]
    first = min(range(len(keys)), key=lambda index: keys[index][1:3])
    return tuple(keys[first:] + keys[:first])


def outline(path: str) -> list[tuple[tuple[object, ...], ...]]:
    """Every subpath of a ``d`` attribute, canonicalised and ordered."""
    return sorted(canonical(subpath) for subpath in parse_path(path))


# --------------------------------------------------------------------------- #
# The mark, across the copies
# --------------------------------------------------------------------------- #


def test_the_card_mark_and_the_social_preview_describe_one_shape() -> None:
    """Two spellings, two fill rules, one outline.

    Neither file can see the other, and nothing about a divergence would look like
    a defect: both keep rendering, just no longer the same mark. The preview is what
    a link unfurl shows, so the copy that drifts is the one nobody has open.
    """
    assert outline(card_mark_path()) == outline(preview_mark_path())


def test_a_shifted_corner_is_not_one_shape() -> None:
    """The comparison above has to be able to fail.

    Normalising away winding and start vertex is exactly the kind of leniency that
    ends up normalising away the difference too, and a comparison that cannot say
    "no" would pass on for ever after the mark had already drifted.
    """
    moved = card_mark_path().replace("M148,294", "M148,296", 1)

    assert outline(moved) != outline(card_mark_path())


def test_the_cards_crates_are_wound_against_its_house() -> None:
    """``nonzero`` makes the crates holes only while they run counter to the house.

    ``ha-svg-icon`` renders one ``<path d>`` and sets no ``fill-rule``. Rewinding a
    crate to match the house — which is what "tidying" the file to one convention
    would do — fills it in as a solid block, and no test of the shape itself would
    notice, because the outline would be identical.
    """
    house, *rest = parse_path(card_mark_path())
    crates, handles = rest[:3], rest[3:]

    assert winding(house) == CLOCKWISE
    assert [winding(crate) for crate in crates] == [COUNTER_CLOCKWISE] * 3
    # Wound back with the house, which fills the handle slots in inside the crates.
    assert [winding(handle) for handle in handles] == [CLOCKWISE] * 3


def test_the_social_previews_subpaths_are_all_wound_alike() -> None:
    """``fill-rule="evenodd"`` is what lets the preview ignore winding.

    Under evenodd a subpath enclosed by another is a hole whichever way it runs, so
    the preview writes all seven the same way. That is only safe while the
    ``fill-rule`` is there; the assertion pairs the two so dropping the attribute
    fails here rather than turning the crates solid in every link unfurl.
    """
    source = SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8")
    subpaths = parse_path(preview_mark_path())

    assert 'fill-rule="evenodd"' in source
    assert len(subpaths) == SUBPATHS
    assert {winding(subpath) for subpath in subpaths} == {CLOCKWISE}


# --------------------------------------------------------------------------- #
# The brands artwork
# --------------------------------------------------------------------------- #


def test_the_brand_svg_is_the_mark_the_card_publishes() -> None:
    """``docs/assets/brand/icon.svg`` is a rendering of the card's constant, not a copy.

    It is the source the PNGs below are rasterised from, so this is the assertion
    that keeps the artwork the brands repository serves tied to the icon the sidebar
    draws. Regenerate with ``uv run python scripts/render_brand_assets.py``.
    """
    svg = (BRAND_DIR / "icon.svg").read_text(encoding="utf-8")

    assert svg.count("<path") == 1
    assert _sole_attribute(svg, "d", "icon.svg") == card_mark_path()
    assert _sole_attribute(svg, "viewBox", "icon.svg") == card_view_box()
    assert _sole_attribute(svg, "fill", "icon.svg") == brand_color()
    # No fill-rule: nonzero is the default, and the crates are wound for it.
    assert "fill-rule" not in svg


@pytest.mark.parametrize(("filename", "size"), sorted(ICON_SIZES.items()))
def test_the_brand_rasters_are_the_shape_brands_asks_for(filename: str, size: int) -> None:
    """Square, 8-bit RGBA, at the two sizes the brands repository names.

    Its own CI rejects anything else, on a review timeline measured in days, so the
    cheap half of that check runs here.
    """
    data = (BRAND_DIR / filename).read_bytes()

    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, depth, color_type = struct.unpack(">IIBB", data[16:26])
    assert (width, height) == (size, size)
    assert (depth, color_type) == (8, 6)


def test_the_brand_directory_holds_only_what_the_renderer_writes() -> None:
    """A file here that the renderer does not write is a hand-made asset.

    That is the third independent copy of the mark this whole file exists to
    prevent, and it would reach the brands repository looking exactly like the
    generated ones.
    """
    written = {"icon.svg", *ICON_SIZES}

    assert {path.name for path in BRAND_DIR.iterdir() if path.is_file()} == written
