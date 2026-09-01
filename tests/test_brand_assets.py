"""The mark is drawn in three places and nothing but this file makes them agree.

- ``cards/haventory-card/src/ui/brand-icon.ts`` — the sidebar icon, one ``<path d>``
  under the default ``nonzero`` fill rule, so the crates are wound against the house
  to cut themselves out of it.
- ``docs/assets/social-preview.html`` — the repository's preview image, one ``<path
  d>`` under ``fill-rule="evenodd"``, where winding carries no meaning and every
  subpath is wound alike.
- ``custom_components/haventory/brand/`` — the images Home Assistant serves for the
  integrations page and the add-integration dialog, generated from the first of the
  three by ``scripts/render_brand_assets.py``.

The first two are the same outline written for two fill rules, and read side by side
they look like they contradict each other. What follows normalises both to one
winding and asserts they describe the same shape, then pins each file's winding so
the property its fill rule depends on cannot be "tidied" into the other one's.
"""

from __future__ import annotations

import re
import struct
import sys
import zlib
from dataclasses import replace
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from brand_wordmark import (  # noqa: E402
    WORDMARK_CAP_HEIGHT,
    WORDMARK_PATH,
)
from render_brand_assets import (  # noqa: E402
    DENSITIES,
    FLATTENING,
    LIGHT,
    Line,
    Quad,
    Segment,
    Subpath,
    flatten,
    flattened,
    lockup,
    on_square,
    palettes,
    parse_path,
    render,
)

BRAND_ICON_TS = REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts"
SOCIAL_PREVIEW_HTML = REPO_ROOT / "docs" / "assets" / "social-preview.html"
BRAND_DIR = REPO_ROOT / "custom_components" / "haventory" / "brand"

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


def card_mark_path() -> str:
    """``HAVENTORY_MARK_PATH``, rebuilt from the groups it is joined from.

    Read independently of ``scripts/render_brand_assets.py``: the script writes the
    artwork from its own reading, and the two only agree if both are right.
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


def png_parts(data: bytes) -> tuple[bytes, bytes]:
    """A PNG's header and its uncompressed scanlines — the parts that are the picture.

    Deliberately not the file's bytes. zlib's output depends on which build of zlib
    produced it, so two runs on two machines encode the same image to different
    IDAT payloads; what they cannot differ on is what those payloads decompress to.
    """
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    header, body, at = b"", bytearray(), 8
    while at < len(data):
        length = struct.unpack(">I", data[at : at + 4])[0]
        kind, payload = data[at + 4 : at + 8], data[at + 8 : at + 8 + length]
        if kind == b"IHDR":
            header = payload
        elif kind == b"IDAT":
            body += payload
        at += 12 + length
    return header, zlib.decompress(bytes(body))


def png_shape(filename: str) -> tuple[int, int, int, int]:
    """``(width, height, bit depth, colour type)`` from a PNG's IHDR."""
    header, _ = png_parts((BRAND_DIR / filename).read_bytes())
    width, height, depth, color_type = struct.unpack(">IIBB", header[:10])
    return width, height, depth, color_type


def _point(point: tuple[float, float]) -> tuple[float, float]:
    return (round(point[0], PLACES), round(point[1], PLACES))


def _key(segment: Segment) -> tuple[object, ...]:
    """A hashable description of one segment, independent of how it was spelled.

    ``H``/``V``/``L`` all arrive as a :class:`Line`, and a relative command has
    already been resolved, so only the geometry is left.
    """
    if isinstance(segment, Line):
        return ("line", _point(segment.start), _point(segment.end))
    if isinstance(segment, Quad):
        return ("quad", _point(segment.start), _point(segment.end), _point(segment.control))
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
        if isinstance(segment, Line | Quad):
            walked.append(replace(segment, start=segment.end, end=segment.start))
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


def brand_files() -> dict[str, tuple[int, int]]:
    """Every file the renderer writes, mapped to the size it must come out at.

    The logo's width is not a constant anywhere: it falls out of setting the mark
    beside the word and trimming to the ink. Asking ``lockup`` for it — which
    computes the layout without rasterising anything — is what ties the committed
    strip to that arrangement rather than to a number somebody wrote down.
    """
    expected: dict[str, tuple[int, int]] = {}
    for suffix, size in DENSITIES.items():
        _, width = lockup(card_mark_path(), WORDMARK_PATH, size)
        for palette in palettes(SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8")):
            expected[f"{palette.prefix}icon{suffix}.png"] = (size, size)
            expected[f"{palette.prefix}logo{suffix}.png"] = (width, size)
    return expected


@pytest.mark.parametrize("filename", sorted(brand_files()))
def test_every_brand_image_is_the_shape_home_assistant_serves(filename: str) -> None:
    """8-bit RGBA at the sizes the brands specification names, trimmed to the ink.

    The icon is square at 256 and 512. The logo's shortest side is its height, which
    has the same two brackets, and its width is whatever the lockup makes it — a
    logo padded out to a rounder number would be showing empty space where the
    frontend expects artwork.
    """
    width, height, depth, color_type = png_shape(filename)

    assert (width, height) == brand_files()[filename]
    assert (depth, color_type) == (8, 6)


def test_the_committed_icon_is_what_the_renderer_draws_from_the_cards_mark() -> None:
    """Pixel for pixel, so a mark that moved and artwork that did not cannot both ship.

    This is the one file re-rendered here rather than merely measured, and it stands
    in for the other seven: they come out of the same run of the same script, so an
    ``icon.png`` that still matches is an ``icon.png`` written after the last edit to
    the mark. Regenerate with ``uv run python scripts/render_brand_assets.py``.
    """
    size = DENSITIES[""]
    extent = max(float(part) for part in card_view_box().split())
    icon = on_square([flattened(card_mark_path(), FLATTENING * extent / size)], size)

    assert png_parts(render(icon, [LIGHT.mark], size, size)) == png_parts(
        (BRAND_DIR / "icon.png").read_bytes()
    )


def test_the_dark_artwork_is_painted_in_the_colour_the_preview_names() -> None:
    """The mark has one colour, and the social preview is where it is written down.

    The dark-theme images are the ones that carry it — the preview's own background
    is dark. The light-theme pair uses a deeper blue, which nothing else in the
    repository states, so it is declared next to the renderer rather than copied
    from a file that means something else.
    """
    _, dark = palettes(SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8"))

    assert dark.mark == brand_color()
    assert dark.mark != LIGHT.mark


def test_the_wordmark_is_stated_at_the_size_the_lockup_measures_against() -> None:
    """The outlines and ``WORDMARK_CAP_HEIGHT`` have to describe the same lettering.

    The lockup sizes and centres the mark against the cap band, so a wordmark re-cut
    at another size would keep rendering — at the right size, because the strip is
    scaled to fit — with the mark suddenly the wrong height beside it. Capitals are
    the tallest thing in "HAventory", and its baseline is y=0 by construction.
    """
    ys = [y for polygon in flattened(WORDMARK_PATH, FLATTEN_TOLERANCE) for _, y in polygon]

    assert min(ys) == pytest.approx(-WORDMARK_CAP_HEIGHT, abs=0.01)
    # The descender of the "y", which is what puts the baseline where it is.
    assert max(ys) > 0.0


def test_the_brand_directory_holds_only_what_the_renderer_writes() -> None:
    """A file here that the renderer does not write is a hand-made asset.

    That is the third independent copy of the mark this whole file exists to
    prevent, and it would reach every install looking exactly like the generated
    ones — this directory ships inside the integration.
    """
    assert {path.name for path in BRAND_DIR.iterdir() if path.is_file()} == set(brand_files())
