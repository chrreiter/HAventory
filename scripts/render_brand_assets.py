#!/usr/bin/env python3
"""Render the brand artwork `home-assistant/brands` asks for, from the card's own mark.

The mark is geometry the card already carries: `HOUSE` + `CRATES` + `HANDLES` in
`cards/haventory-card/src/ui/brand-icon.ts`, joined into one `d`. Drawing the brands
PNGs by hand would make a third independent spelling of that geometry — this script
makes them a rendering of the first one instead, so the artwork cannot drift from the
sidebar icon without `tests/test_brand_assets.py` failing.

Outputs, all under `docs/assets/brand/`:

- `icon.svg`     — the mark at its own viewBox, the source the rasters come from
- `icon.png`     — 256x256, what the brands repository wants as `icon.png`
- `icon@2x.png`  — 512x512, its hDPI twin

Run it after any change to the mark:

    uv run python scripts/render_brand_assets.py

The rasteriser is written out longhand so regenerating needs no imaging library: the
integration ships no image code and the offline suite installs none.
"""

from __future__ import annotations

import math
import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BRAND_ICON_TS = REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts"
SOCIAL_PREVIEW_HTML = REPO_ROOT / "docs" / "assets" / "social-preview.html"
BRAND_DIR = REPO_ROOT / "docs" / "assets" / "brand"

# Brands wants the normal icon square at 256 and the hDPI one at double.
ICON_SIZES = {"icon.png": 256, "icon@2x.png": 512}

# Sub-scanlines per output row. Coverage is exact horizontally and sampled
# vertically, so this alone decides how clean the diagonal roof edges come out.
SUBSAMPLES = 8

Point = tuple[float, float]


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
    """The one place a brand colour is written down: the preview's `fill`.

    The card never names it — `ha-svg-icon` paints the mark in `currentColor` and
    takes whatever the sidebar theme gives it — so the preview holds the only copy,
    and the rasters follow it rather than starting a second.
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
class Arc:
    """An elliptical arc in SVG's endpoint parameterisation."""

    start: Point
    end: Point
    rx: float
    ry: float
    rotation: float
    large_arc: bool
    sweep: bool


type Segment = Line | Arc


@dataclass(frozen=True)
class Subpath:
    """One `M`-to-`Z` run. Every subpath in the mark closes."""

    segments: tuple[Segment, ...]
    closed: bool


_TOKENS = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")

# Commands the mark does not use. Handling them would need Bézier code nothing here
# has, and skipping one would compare or render a different shape — so an
# unrecognised command stops the run rather than being ignored.
_UNSUPPORTED = frozenset("CcQqSsTt")


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
    """Split a `d` attribute into absolute subpaths of lines and arcs."""
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
        else:
            points.extend(arc_points(segment, tolerance)[1:])
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


def _by_row(edges: list[_Edge], size: int) -> list[list[_Edge]]:
    """Bucket edges by output row so a scanline only tests what can cross it."""
    buckets: list[list[_Edge]] = [[] for _ in range(size)]
    for edge in edges:
        for row in range(max(0, math.floor(edge.top)), min(size - 1, math.ceil(edge.bottom)) + 1):
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


def rasterize(polygons: list[list[Point]], size: int) -> list[list[int]]:
    """Fill `polygons` under the nonzero rule into a `size`x`size` coverage map.

    Nonzero is what makes the crates holes rather than blocks — the same rule
    `ha-svg-icon` leaves at its default, and the reason the card winds them against
    the house. Reversing a crate here would fill it in, exactly as it would there.
    """
    buckets = _by_row(_edges(polygons), size)
    weight = 1.0 / SUBSAMPLES
    rows: list[list[int]] = []
    for row in range(size):
        coverage = [0.0] * size
        for sub in range(SUBSAMPLES):
            _scan(buckets[row], row + (sub + 0.5) * weight, coverage, weight)
        rows.append([min(255, int(value * 255.0 + 0.5)) for value in coverage])
    return rows


def fit(polygons: list[list[Point]], size: int) -> list[list[Point]]:
    """Scale the artwork's own bounds to fill `size` on its longer axis, centred.

    Brands asks for a square image trimmed to "the minimum amount of empty space".
    The mark is a shade wider than it is tall, so the two are only satisfiable
    together: it touches the canvas left and right, and the remainder is centred.
    """
    xs = [x for polygon in polygons for x, _ in polygon]
    ys = [y for polygon in polygons for _, y in polygon]
    left, top = min(xs), min(ys)
    width, height = max(xs) - left, max(ys) - top
    scale = size / max(width, height)
    offset_x = (size - width * scale) / 2.0
    offset_y = (size - height * scale) / 2.0
    return [
        [((x - left) * scale + offset_x, (y - top) * scale + offset_y) for x, y in polygon]
        for polygon in polygons
    ]


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


def png_bytes(coverage_rows: list[list[int]], color: str) -> bytes:
    """Encode straight-alpha RGBA: one flat colour, coverage in the alpha channel."""
    red, green, blue = (int(color[index : index + 2], 16) for index in (1, 3, 5))
    size = len(coverage_rows)
    rows = [bytes(b for alpha in row for b in (red, green, blue, alpha)) for row in coverage_rows]
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    body = zlib.compress(_filtered(rows, size * 4, 4), 9)
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


def svg_bytes(mark_path: str, view_box: str, color: str) -> bytes:
    """One `<path>` and no `fill-rule`, so nonzero keeps the crates cut out."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" width="512" height="512"'
        f' role="img" aria-label="HAventory">\n'
        f'  <path fill="{color}" d="{mark_path}" />\n'
        f"</svg>\n"
    ).encode()


def main() -> None:
    ts_source = BRAND_ICON_TS.read_text(encoding="utf-8")
    mark_path = mark_path_from_typescript(ts_source)
    view_box = view_box_from_typescript(ts_source)
    color = brand_color_from_social_preview(SOCIAL_PREVIEW_HTML.read_text(encoding="utf-8"))

    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    svg = BRAND_DIR / "icon.svg"
    svg.write_bytes(svg_bytes(mark_path, view_box, color))
    print(f"wrote {svg.relative_to(REPO_ROOT)}")

    subpaths = parse_path(mark_path)
    extent = max(float(part) for part in view_box.split())
    for filename, size in ICON_SIZES.items():
        # A quarter of an output pixel of flattening error disappears once the
        # sub-scanlines average over it.
        polygons = [flatten(subpath, extent / size / 4.0) for subpath in subpaths]
        target = BRAND_DIR / filename
        target.write_bytes(png_bytes(rasterize(fit(polygons, size), size), color))
        print(f"wrote {target.relative_to(REPO_ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
