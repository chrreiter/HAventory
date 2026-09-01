#!/usr/bin/env python3
"""Render the brand artwork Home Assistant serves, from the card's own mark.

The mark is geometry the card already carries: `HOUSE` + `CRATES` + `HANDLES` in
`cards/haventory-card/src/ui/brand-icon.ts`, joined into one `d`. Drawing the brand
images by hand would make a third independent spelling of that geometry — this script
makes them a rendering of the first one instead, so the artwork cannot drift from the
sidebar icon without `tests/test_brand_assets.py` failing.

Everything lands in `custom_components/haventory/brand/`, which is where Home Assistant
reads a custom integration's own brand images from and serves them at
`/api/brands/integration/haventory/<file>`. Local images win over the brands CDN, and
the feature arrived well below this project's minimum Home Assistant version, so every
supported install shows them. Eight files, the full set that route recognises:

- `icon.png` / `icon@2x.png` — the square mark, 256 and 512
- `logo.png` / `logo@2x.png` — the mark beside the word, 256 and 512 tall
- `dark_icon*.png` / `dark_logo*.png` — the same artwork in the dark-theme palette

Run it after any change to the mark:

    uv run python scripts/render_brand_assets.py

The rasteriser is written out longhand so regenerating needs no imaging library, and
the wordmark comes in as outlines (`scripts/brand_wordmark.py`) so it needs no font
either: `uv sync` installs neither, and this script has to run in that environment.
"""

from __future__ import annotations

import math
import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

from brand_wordmark import WORDMARK_CAP_HEIGHT, WORDMARK_FONT_SIZE, WORDMARK_PATH

REPO_ROOT = Path(__file__).resolve().parents[1]
BRAND_ICON_TS = REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts"
SOCIAL_PREVIEW_HTML = REPO_ROOT / "docs" / "assets" / "social-preview.html"
BRAND_DIR = REPO_ROOT / "custom_components" / "haventory" / "brand"

# The plain file and its hDPI twin. Brands wants the icon square at 256 and 512, and a
# logo whose shortest side lands in the same two brackets — so one table sizes both,
# the icon by its side and the logo by its height.
DENSITIES = {"": 256, "@2x": 512}

# Sub-scanlines per output row. Coverage is exact horizontally and sampled
# vertically, so this alone decides how clean the diagonal roof edges come out.
SUBSAMPLES = 8

# The lockup, measured in the wordmark's own terms. The mark stands 1.4 cap-heights
# tall and is centred on the cap band rather than on the whole line, so it reads as
# level with the word instead of being dragged down by the descender of the "y". The
# gap is ink to ink, so it survives a change of tracking.
MARK_TO_CAP_HEIGHT = 1.4
MARK_TO_WORD_GAP = 0.34 * WORDMARK_FONT_SIZE

# How far a flattened curve may sit from the curve, as a fraction of an output pixel.
# A quarter of one disappears once the sub-scanlines average over it.
FLATTENING = 0.25

Point = tuple[float, float]


@dataclass(frozen=True)
class Palette:
    """One theme's ink. `prefix` is what Home Assistant's route looks the file up by."""

    prefix: str
    mark: str
    text: str


# The pale blue is the mark's own colour — what the social preview paints it and what
# the sidebar gives it on a dark theme; it goes thin against white. The deep blue is
# the same hue at the weight a white background needs. Each palette's text sits at the
# opposite end from its background, near-black on light and plain white on dark.
LIGHT = Palette(prefix="", mark="#1F63C4", text="#16222E")
DARK_TEXT = "#FFFFFF"


def palettes(social_preview: str) -> tuple[Palette, Palette]:
    """The light palette and the dark one, in the order they are drawn in."""
    return LIGHT, Palette(
        prefix="dark_", mark=brand_color_from_social_preview(social_preview), text=DARK_TEXT
    )


# --------------------------------------------------------------------------- #
# Reading the two authorities
# --------------------------------------------------------------------------- #


def mark_path_from_typescript(source: str) -> str:
    """Join the mark's three groups the way `HAVENTORY_MARK_PATH` joins them.

    `HAVENTORY_MARK_PATH` is computed, so it cannot be read out directly; the groups
    it is computed from can. The counts are checked, because a pattern that silently
    matched fewer elements would render artwork missing a crate.
    """
    house = _declared_strings(source, "HOUSE")
    crates = _declared_strings(source, "CRATES")
    handles = _declared_strings(source, "HANDLES")
    if (len(house), len(crates), len(handles)) != (1, 3, 3):
        raise SystemExit(
            f"expected 1 house, 3 crates and 3 handles; "
            f"read {len(house)}, {len(crates)} and {len(handles)}"
        )
    return " ".join([*house, *crates, *handles])


def view_box_from_typescript(source: str) -> str:
    match = re.search(r"^export const HAVENTORY_MARK_VIEW_BOX = '([^']+)';$", source, re.MULTILINE)
    if match is None:
        raise SystemExit("HAVENTORY_MARK_VIEW_BOX is no longer declared in brand-icon.ts")
    return match.group(1)


def brand_color_from_social_preview(source: str) -> str:
    """The one place the mark's own colour is written down: the preview's `fill`.

    The card never names it — `ha-svg-icon` paints the mark in `currentColor` and
    takes whatever the sidebar theme gives it — so the preview holds the only copy,
    and the dark-theme artwork follows it rather than starting a second.
    """
    match = re.search(r'fill="(#[0-9A-Fa-f]{6})"', source)
    if match is None:
        raise SystemExit("no fill colour found in social-preview.html")
    return match.group(1)


def _declared_strings(source: str, name: str) -> list[str]:
    """Read `const NAME = …;` as its string literals, one entry per top-level comma.

    Scanning for quotes rather than matching a layout keeps this working across a
    reformat: `'a' + 'b'` concatenates into one entry, an array yields one entry per
    element, and a trailing comma contributes nothing.
    """
    match = re.search(rf"^const {name} =(.*?);$", source, re.MULTILINE | re.DOTALL)
    if match is None:
        raise SystemExit(f"{name} is no longer declared in brand-icon.ts")

    entries = [""]
    inside = False
    for char in match.group(1):
        if char == "'":
            inside = not inside
        elif inside:
            entries[-1] += char
        elif char == ",":
            entries.append("")
    return [entry for entry in entries if entry]


# --------------------------------------------------------------------------- #
# Path data
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Line:
    """A straight segment, in absolute user units."""

    start: Point
    end: Point


@dataclass(frozen=True)
class Quad:
    """A quadratic Bézier — what a TrueType glyph outline is made of."""

    start: Point
    control: Point
    end: Point


@dataclass(frozen=True)
class Arc:
    """An elliptical arc in SVG's endpoint parameterisation."""

    start: Point
    end: Point
    rx: float
    ry: float
    rotation: float
    large_arc: bool
    sweep: bool


type Segment = Line | Quad | Arc


@dataclass(frozen=True)
class Subpath:
    """One `M`-to-`Z` run. Every subpath drawn here closes."""

    segments: tuple[Segment, ...]
    closed: bool


_TOKENS = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")

# Commands neither the mark nor the wordmark uses. Handling them would need cubic and
# smooth-curve code nothing here has, and skipping one would compare or render a
# different shape — so an unrecognised command stops the run rather than being ignored.
_UNSUPPORTED = frozenset("CcSsTt")


class _Cursor:
    """Token walk over one `d` attribute."""

    def __init__(self, data: str) -> None:
        self._tokens = _TOKENS.findall(data)
        self._at = 0

    def done(self) -> bool:
        return self._at >= len(self._tokens)

    def at_command(self) -> bool:
        return not self.done() and self._tokens[self._at].isalpha()

    def take(self) -> str:
        token = self._tokens[self._at]
        self._at += 1
        return token

    def number(self) -> float:
        return float(self.take())

    def point(self) -> Point:
        return (self.number(), self.number())

    def flag(self) -> bool:
        return self.number() != 0


def parse_path(data: str) -> list[Subpath]:
    """Split a `d` attribute into absolute subpaths of lines, quadratics and arcs."""
    cursor = _Cursor(data)
    subpaths: list[Subpath] = []
    segments: list[Segment] = []
    current = start = (0.0, 0.0)
    command = ""

    while not cursor.done():
        if cursor.at_command():
            command = cursor.take()
        if command in _UNSUPPORTED or not command:
            raise SystemExit(f"path command {command!r} is not supported by this renderer")

        if command in "Mm":
            if segments:
                subpaths.append(Subpath(tuple(segments), closed=False))
                segments = []
            current = start = _absolute(cursor.point(), current, command)
            # A second coordinate pair after M continues as an implicit lineto.
            command = "L" if command == "M" else "l"
        elif command in "Zz":
            subpaths.append(Subpath(tuple(segments), closed=True))
            segments = []
            current = start
        else:
            segment = _read_segment(cursor, command, current)
            segments.append(segment)
            current = segment.end

    if segments:
        subpaths.append(Subpath(tuple(segments), closed=False))
    return subpaths


def _absolute(point: Point, current: Point, command: str) -> Point:
    if command.isupper():
        return point
    return (current[0] + point[0], current[1] + point[1])


def _read_segment(cursor: _Cursor, command: str, current: Point) -> Segment:
    if command in "Ll":
        return Line(current, _absolute(cursor.point(), current, command))
    if command in "Hh":
        x = cursor.number()
        return Line(current, (x if command == "H" else current[0] + x, current[1]))
    if command in "Vv":
        y = cursor.number()
        return Line(current, (current[0], y if command == "V" else current[1] + y))
    if command in "Qq":
        control = _absolute(cursor.point(), current, command)
        return Quad(current, control, _absolute(cursor.point(), current, command))
    if command in "Aa":
        rx, ry = cursor.point()
        rotation = cursor.number()
        large_arc, sweep = cursor.flag(), cursor.flag()
        end = _absolute(cursor.point(), current, command)
        return Arc(current, end, rx, ry, rotation, large_arc, sweep)
    raise SystemExit(f"path command {command!r} is not supported by this renderer")


# --------------------------------------------------------------------------- #
# Flattening
# --------------------------------------------------------------------------- #


def flatten(subpath: Subpath, tolerance: float) -> list[Point]:
    """Turn a subpath into a polygon that stays within `tolerance` of it.

    The closing edge is left implicit: a filled subpath closes itself, and the
    consumers here wrap the last point back to the first.
    """
    if not subpath.segments:
        return []

    points: list[Point] = [subpath.segments[0].start]
    for segment in subpath.segments:
        if isinstance(segment, Line):
            points.append(segment.end)
        elif isinstance(segment, Quad):
            points.extend(quad_points(segment, tolerance)[1:])
        else:
            points.extend(arc_points(segment, tolerance)[1:])
    return points


def quad_points(quad: Quad, tolerance: float) -> list[Point]:
    """Sample a quadratic, both endpoints included, finely enough for `tolerance`."""
    (x0, y0), (cx, cy), (x1, y1) = quad.start, quad.control, quad.end
    # A quadratic sits furthest from its chord at the midpoint, by half the vector
    # from that midpoint to the control point; splitting it into `n` even pieces
    # divides that by `n` squared, which is what this solves for.
    deviation = math.hypot(cx - (x0 + x1) / 2.0, cy - (y0 + y1) / 2.0) / 2.0
    count = 1 if deviation <= tolerance else math.ceil(math.sqrt(deviation / tolerance))
    points: list[Point] = []
    for index in range(count + 1):
        t = index / count
        u = 1.0 - t
        points.append(
            (
                u * u * x0 + 2.0 * u * t * cx + t * t * x1,
                u * u * y0 + 2.0 * u * t * cy + t * t * y1,
            )
        )
    points[0], points[-1] = quad.start, quad.end
    return points


def arc_points(arc: Arc, tolerance: float) -> list[Point]:
    """Sample an arc, both endpoints included, finely enough for `tolerance`."""
    center, radii, theta, delta = _arc_center(arc)
    if center is None:
        return [arc.start, arc.end]

    radius = max(radii)
    # A chord subtending `step` on a circle of `radius` sits `radius * (1 -
    # cos(step / 2))` off it; solving that for the tolerance gives the step.
    step = 2.0 * math.acos(1.0 - tolerance / radius) if radius > tolerance else math.pi
    count = max(2, math.ceil(abs(delta) / max(step, 1e-9)))

    phi = math.radians(arc.rotation)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    rx, ry = radii
    points: list[Point] = []
    for index in range(count + 1):
        angle = theta + delta * index / count
        x, y = rx * math.cos(angle), ry * math.sin(angle)
        points.append(
            (center[0] + cos_phi * x - sin_phi * y, center[1] + sin_phi * x + cos_phi * y)
        )
    points[0], points[-1] = arc.start, arc.end
    return points


def _arc_center(arc: Arc) -> tuple[Point | None, tuple[float, float], float, float]:
    """SVG's endpoint-to-centre conversion (implementation notes F.6.5)."""
    rx, ry = abs(arc.rx), abs(arc.ry)
    if rx == 0.0 or ry == 0.0 or arc.start == arc.end:
        return None, (rx, ry), 0.0, 0.0

    phi = math.radians(arc.rotation)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx = (arc.start[0] - arc.end[0]) / 2.0
    dy = (arc.start[1] - arc.end[1]) / 2.0
    x1 = cos_phi * dx + sin_phi * dy
    y1 = -sin_phi * dx + cos_phi * dy

    # F.6.6: radii too small to span the endpoints are scaled up until they fit.
    oversize = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if oversize > 1.0:
        rx *= math.sqrt(oversize)
        ry *= math.sqrt(oversize)

    numerator = max(0.0, rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1)
    denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    scale = math.sqrt(numerator / denominator) * (1.0 if arc.large_arc != arc.sweep else -1.0)
    cx1 = scale * rx * y1 / ry
    cy1 = -scale * ry * x1 / rx
    center = (
        cos_phi * cx1 - sin_phi * cy1 + (arc.start[0] + arc.end[0]) / 2.0,
        sin_phi * cx1 + cos_phi * cy1 + (arc.start[1] + arc.end[1]) / 2.0,
    )

    theta = math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx)
    delta = math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - theta
    if arc.sweep and delta < 0.0:
        delta += 2.0 * math.pi
    elif not arc.sweep and delta > 0.0:
        delta -= 2.0 * math.pi
    return center, (rx, ry), theta, delta


# --------------------------------------------------------------------------- #
# Laying the artwork out on a canvas
# --------------------------------------------------------------------------- #

# One drawing: the polygons of each differently coloured group, in painting order.
type Groups = list[list[list[Point]]]


def bounds(groups: Groups) -> tuple[float, float, float, float]:
    """`(left, top, right, bottom)` of everything in `groups`."""
    xs = [x for polygons in groups for polygon in polygons for x, _ in polygon]
    ys = [y for polygons in groups for polygon in polygons for _, y in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def moved(groups: Groups, scale: float, dx: float, dy: float) -> Groups:
    return [
        [[(x * scale + dx, y * scale + dy) for x, y in polygon] for polygon in polygons]
        for polygons in groups
    ]


def _place(mark: list[list[Point]], word: list[list[Point]]) -> tuple[Groups, float]:
    """Set the mark beside the word; also report what the mark was scaled by.

    The word arrives with its baseline on y=0, which is what both measurements below
    are taken against.
    """
    _, top, right, bottom = bounds([mark])
    scale = MARK_TO_CAP_HEIGHT * WORDMARK_CAP_HEIGHT / (bottom - top)
    placed = moved(
        [mark],
        scale,
        bounds([word])[0] - MARK_TO_WORD_GAP - right * scale,
        -WORDMARK_CAP_HEIGHT / 2.0 - (top + bottom) / 2.0 * scale,
    )
    return [*placed, word], scale


def lockup(mark_path: str, word_path: str, height: int) -> tuple[Groups, int]:
    """The mark beside the word, trimmed to a strip `height` pixels tall.

    Flattening happens twice. How large an output pixel is differs between the mark's
    coordinates and the word's, and neither is known until the two have been set
    against each other — but the proportions of the lockup do not depend on how finely
    the curves were sampled, so a coarse pass answers that, and the pass that gets
    rasterised is flattened against the answer.
    """
    draft, scale = _place(flattened(mark_path, 1.0), flattened(word_path, 1.0))
    _, top, _, bottom = bounds(draft)
    pixel = (bottom - top) / height
    groups, _ = _place(
        flattened(mark_path, FLATTENING * pixel / scale),
        flattened(word_path, FLATTENING * pixel),
    )
    return on_strip(groups, height)


def on_square(groups: Groups, size: int) -> Groups:
    """Scale the artwork's own bounds to fill `size` on its longer axis, centred.

    Brands asks for a square icon trimmed to "the minimum amount of empty space". The
    mark is a shade wider than it is tall, so the two are only satisfiable together:
    it touches the canvas left and right, and the remainder is centred.
    """
    left, top, right, bottom = bounds(groups)
    scale = size / max(right - left, bottom - top)
    return moved(
        groups,
        scale,
        (size - (right - left) * scale) / 2.0 - left * scale,
        (size - (bottom - top) * scale) / 2.0 - top * scale,
    )


def on_strip(groups: Groups, height: int) -> tuple[Groups, int]:
    """Scale to `height` and trim to the ink, which is what a logo is asked to be.

    Nothing is centred and no margin is added: the artwork touches all four edges, so
    whatever lays the logo out downstream is sizing the mark and not the whitespace
    around it.
    """
    left, top, right, bottom = bounds(groups)
    scale = height / (bottom - top)
    width = max(1, round((right - left) * scale))
    return moved(groups, scale, -left * scale, -top * scale), width


# --------------------------------------------------------------------------- #
# Rasterising
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _Edge:
    top: float
    bottom: float
    x_at_top: float
    slope: float
    direction: int


def _edges(polygons: list[list[Point]]) -> list[_Edge]:
    edges: list[_Edge] = []
    for polygon in polygons:
        for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1], strict=True):
            if y0 == y1:
                continue
            direction = 1 if y1 > y0 else -1
            top, bottom = (y0, y1) if direction == 1 else (y1, y0)
            edges.append(
                _Edge(top, bottom, x0 if direction == 1 else x1, (x1 - x0) / (y1 - y0), direction)
            )
    return edges


def _by_row(edges: list[_Edge], height: int) -> list[list[_Edge]]:
    """Bucket edges by output row so a scanline only tests what can cross it."""
    buckets: list[list[_Edge]] = [[] for _ in range(height)]
    for edge in edges:
        for row in range(max(0, math.floor(edge.top)), min(height - 1, math.ceil(edge.bottom)) + 1):
            buckets[row].append(edge)
    return buckets


def _add_span(coverage: list[float], x0: float, x1: float, weight: float) -> None:
    size = len(coverage)
    x0, x1 = max(x0, 0.0), min(x1, float(size))
    if x1 <= x0:
        return
    first, last = int(x0), int(x1)
    if first == last:
        coverage[first] += (x1 - x0) * weight
        return
    coverage[first] += (first + 1 - x0) * weight
    for index in range(first + 1, last):
        coverage[index] += weight
    if last < size:
        coverage[last] += (x1 - last) * weight


def _scan(row_edges: list[_Edge], y: float, coverage: list[float], weight: float) -> None:
    crossings = sorted(
        (edge.x_at_top + (y - edge.top) * edge.slope, edge.direction)
        for edge in row_edges
        if edge.top <= y < edge.bottom
    )
    winding = 0
    span_start = 0.0
    for x, direction in crossings:
        if winding == 0:
            span_start = x
        winding += direction
        if winding == 0:
            _add_span(coverage, span_start, x, weight)


def rasterize(polygons: list[list[Point]], width: int, height: int) -> list[list[int]]:
    """Fill `polygons` under the nonzero rule into a `width`x`height` coverage map.

    Nonzero is what makes the crates holes rather than blocks — the same rule
    `ha-svg-icon` leaves at its default, and the reason the card winds them against
    the house. Reversing a crate here would fill it in, exactly as it would there.
    """
    buckets = _by_row(_edges(polygons), height)
    weight = 1.0 / SUBSAMPLES
    rows: list[list[int]] = []
    for row in range(height):
        coverage = [0.0] * width
        for sub in range(SUBSAMPLES):
            _scan(buckets[row], row + (sub + 0.5) * weight, coverage, weight)
        rows.append([min(255, int(value * 255.0 + 0.5)) for value in coverage])
    return rows


# --------------------------------------------------------------------------- #
# PNG
# --------------------------------------------------------------------------- #


def _shift(row: bytes, bpp: int) -> bytes:
    return bytes(bpp) + row[:-bpp]


def _paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    da, db, dc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
    if da <= db and da <= dc:
        return left
    return up if db <= dc else upper_left


def _candidates(raw: bytes, previous: bytes, bpp: int) -> list[tuple[int, bytes]]:
    """The five PNG row filters, each paired with its type byte."""
    left = _shift(raw, bpp)
    upper_left = _shift(previous, bpp)
    return [
        (0, raw),
        (1, bytes((v - a) & 0xFF for v, a in zip(raw, left, strict=True))),
        (2, bytes((v - b) & 0xFF for v, b in zip(raw, previous, strict=True))),
        (
            3,
            bytes((v - (a + b) // 2) & 0xFF for v, a, b in zip(raw, left, previous, strict=True)),
        ),
        (
            4,
            bytes(
                (v - _paeth(a, b, c)) & 0xFF
                for v, a, b, c in zip(raw, left, previous, upper_left, strict=True)
            ),
        ),
    ]


def _filtered(rows: list[bytes], stride: int, bpp: int) -> bytes:
    """Pick the filter per row that leaves the least for zlib to do."""
    out = bytearray()
    previous = bytes(stride)
    for raw in rows:
        kind, filtered = min(
            _candidates(raw, previous, bpp),
            # Bytes are deltas: score them as signed magnitudes, which is what
            # the PNG specification's own filter heuristic sums.
            key=lambda pair: sum(min(byte, 256 - byte) for byte in pair[1]),
        )
        out.append(kind)
        out.extend(filtered)
        previous = raw
    return bytes(out)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def _rgb(color: str) -> tuple[int, int, int]:
    red, green, blue = (int(color[index : index + 2], 16) for index in (1, 3, 5))
    return red, green, blue


# Full coverage, and the scale every alpha here is expressed on.
OPAQUE = 255


def _over(rows: list[bytearray], coverage: list[list[int]], color: str) -> None:
    """Paint one flat colour onto `rows` through `coverage`, source-over.

    The groups of a lockup do not overlap, so this is only ever compositing ink onto
    nothing — but a layout that let them touch would otherwise put a hard edge where
    the two meet, and the straight-alpha arithmetic below has no such seam.
    """
    red, green, blue = _rgb(color)
    for row, alphas in zip(rows, coverage, strict=True):
        for index, alpha in enumerate(alphas):
            if alpha == 0:
                continue
            at = index * 4
            if alpha == OPAQUE or row[at + 3] == 0:
                row[at : at + 4] = bytes((red, green, blue, alpha))
                continue
            under = row[at + 3] * (OPAQUE - alpha)
            total = alpha * OPAQUE + under
            for channel, value in enumerate((red, green, blue)):
                row[at + channel] = (value * alpha * OPAQUE + row[at + channel] * under) // total
            row[at + 3] = total // OPAQUE


def png_bytes(layers: list[tuple[list[list[int]], str]], width: int, height: int) -> bytes:
    """Encode straight-alpha RGBA from coverage maps, one flat colour each."""
    rows = [bytearray(width * 4) for _ in range(height)]
    for coverage, color in layers:
        _over(rows, coverage, color)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    body = zlib.compress(_filtered([bytes(row) for row in rows], width * 4, 4), 9)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(b"IHDR", header),
            _chunk(b"IDAT", body),
            _chunk(b"IEND", b""),
        ]
    )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def flattened(path: str, tolerance: float) -> list[list[Point]]:
    return [flatten(subpath, tolerance) for subpath in parse_path(path)]


def render(groups: Groups, colors: list[str], width: int, height: int) -> bytes:
    layers = [
        (rasterize(polygons, width, height), color)
        for polygons, color in zip(groups, colors, strict=True)
    ]
    return png_bytes(layers, width, height)


def main() -> None:
    ts_source = BRAND_ICON_TS.read_text(encoding="utf-8")
    mark_path = mark_path_from_typescript(ts_source)
    extent = max(float(part) for part in view_box_from_typescript(ts_source).split())
    themes = palettes(SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8"))

    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    for suffix, size in DENSITIES.items():
        icon = on_square([flattened(mark_path, FLATTENING * extent / size)], size)
        strip, width = lockup(mark_path, WORDMARK_PATH, size)
        for palette in themes:
            for name, groups, colors, shape in (
                (f"{palette.prefix}icon{suffix}.png", icon, [palette.mark], (size, size)),
                (
                    f"{palette.prefix}logo{suffix}.png",
                    strip,
                    [palette.mark, palette.text],
                    (width, size),
                ),
            ):
                target = BRAND_DIR / name
                target.write_bytes(render(groups, colors, *shape))
                print(f"wrote {target.relative_to(REPO_ROOT)} ({shape[0]}x{shape[1]})")


if __name__ == "__main__":
    main()
