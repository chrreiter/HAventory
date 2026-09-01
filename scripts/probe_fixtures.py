r"""Generate the image fixtures the attachment probes upload.

Usage:
  uv sync --group probes
  uv run --group probes python scripts/probe_fixtures.py --out /tmp/haventory-fixtures

Options:
  --out DIR    where to write the fixtures (created if absent; required)
  --force      overwrite fixtures that are already there

Environment variables: none — everything is an argument.

The five frames are what the attachment path has to survive: an oversized
photographic JPEG, the same frame carrying an EXIF orientation tag, an oversized
PNG with real transparency, an animated GIF, and a small JPEG that must arrive
byte for byte. Together they are ~30 MB, which is why they are generated and
never committed — and generating them is also the only way the orientation tag
is readable rather than buried in a blob. That case is the one attachment defect
that looks correct in every automated test and wrong on every phone.

Pillow lives in the non-default ``probes`` dependency group: the integration
itself does not depend on it and does not want to, so a plain ``uv sync`` must
not pull it in.

Type-checked manually — ``scripts/`` sits outside mypy's ``files``:
  uv run --group probes mypy scripts/probe_fixtures.py

Exit codes: 0 written, 2 Pillow missing or the output directory unusable.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - the group is opt-in
    print(
        "Pillow is missing. Install the probes group: uv sync --group probes",
        file=sys.stderr,
    )
    sys.exit(2)

# EXIF tag 0x0112. Value 6 means "rotate 90° clockwise to display", which is what
# a phone held upright writes rather than rotating 12 megapixels on the device.
EXIF_ORIENTATION_TAG = 0x0112
EXIF_ORIENTATION_ROTATE_90_CW = 6

# Grain strength for the synthetic frames. High enough that JPEG and PNG cannot
# compress the result away: a fixture that lands under the card's 2 MiB
# re-encode threshold would silently stop testing the re-encode.
GRAIN_SIGMA = 64.0
GRAIN_WEIGHT = 0.55

# Longest edge of the two oversized frames. Both are past the card's 2048 cap,
# so a probe can tell a real downscale from a file that was passed through.
LARGE_PHOTO_SIZE = (4032, 3024)
LARGE_PNG_SIZE = (2400, 1800)
SMALL_PHOTO_SIZE = (800, 600)
GIF_SIZE = (240, 180)
GIF_FRAMES = 24


@dataclass(frozen=True)
class Fixture:
    """One generated file and what makes it interesting."""

    name: str
    purpose: str


FIXTURES: tuple[Fixture, ...] = (
    Fixture("photo_large.jpg", "4032x3024 photographic JPEG, past the re-encode threshold"),
    Fixture("photo_large_exif6.jpg", "the same frame with EXIF Orientation=6"),
    Fixture("transparent_large.png", "2400x1800 RGBA PNG, transparency that must survive"),
    Fixture("animated.gif", f"{GIF_FRAMES}-frame GIF, never re-encoded (a canvas holds one frame)"),
    Fixture("photo_small.jpg", "sub-threshold JPEG that must round-trip byte-identical"),
)


def _photographic(size: tuple[int, int]) -> Image.Image:
    """A frame with camera-like entropy: smooth gradients under fine grain.

    Flat colour would compress to nothing, and a file small enough to skip the
    card's re-encode tests the opposite of what it was generated for.
    """

    bands = []
    for gradient in (
        Image.linear_gradient("L"),
        Image.radial_gradient("L"),
        Image.linear_gradient("L").transpose(Image.Transpose.ROTATE_90),
    ):
        smooth = gradient.resize(size, Image.Resampling.BICUBIC)
        grain = Image.effect_noise(size, GRAIN_SIGMA)
        bands.append(Image.blend(smooth, grain, GRAIN_WEIGHT))
    return Image.merge("RGB", bands)


def _write_large_photo(target: Path) -> None:
    frame = _photographic(LARGE_PHOTO_SIZE)
    frame.save(target, "JPEG", quality=92)


def _write_large_photo_with_orientation(target: Path, source: Path) -> None:
    """The same frame, tagged the way a phone tags a portrait shot.

    The tag is set here rather than copied from a real photo so the value is
    readable: a viewer that honours it shows 3024x4032, and anything that
    re-encodes without applying it first stores the picture on its side.
    """

    with Image.open(source) as frame:
        exif = frame.getexif()
        exif[EXIF_ORIENTATION_TAG] = EXIF_ORIENTATION_ROTATE_90_CW
        frame.save(target, "JPEG", quality=92, exif=exif.tobytes())

    with Image.open(target) as written:
        stored = written.getexif().get(EXIF_ORIENTATION_TAG)
    if stored != EXIF_ORIENTATION_ROTATE_90_CW:
        raise RuntimeError(f"orientation tag did not survive the save: {stored!r}")


def _write_transparent_png(target: Path) -> None:
    """Noise under a radial alpha ramp — translucent, not merely masked."""

    colour = _photographic(LARGE_PNG_SIZE)
    alpha = Image.radial_gradient("L").resize(LARGE_PNG_SIZE, Image.Resampling.BICUBIC)
    colour.putalpha(Image.eval(alpha, lambda level: 255 - level))
    colour.save(target, "PNG")


def _write_animated_gif(target: Path) -> None:
    """A shape crossing the frame, so a dropped frame is visible, not inferred."""

    width, height = GIF_SIZE
    frames = []
    for index in range(GIF_FRAMES):
        frame = Image.new("RGB", GIF_SIZE, (16, 16, 32))
        left = int(index * (width - 40) / (GIF_FRAMES - 1))
        frame.paste((240, 120, 0), (left, height // 3, left + 40, height // 3 + 40))
        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))
    frames[0].save(target, "GIF", save_all=True, append_images=frames[1:], duration=60, loop=0)


def _write_small_photo(target: Path) -> None:
    _photographic(SMALL_PHOTO_SIZE).save(target, "JPEG", quality=85)


def generate(out_dir: Path, *, force: bool = False) -> list[Path]:
    """Write every fixture into ``out_dir`` and return the paths."""

    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    large = out_dir / "photo_large.jpg"
    if force or not large.is_file():
        _write_large_photo(large)
    written.append(large)

    oriented = out_dir / "photo_large_exif6.jpg"
    if force or not oriented.is_file():
        _write_large_photo_with_orientation(oriented, large)
    written.append(oriented)

    png = out_dir / "transparent_large.png"
    if force or not png.is_file():
        _write_transparent_png(png)
    written.append(png)

    gif = out_dir / "animated.gif"
    if force or not gif.is_file():
        _write_animated_gif(gif)
    written.append(gif)

    small = out_dir / "photo_small.jpg"
    if force or not small.is_file():
        _write_small_photo(small)
    written.append(small)

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate HAventory attachment fixtures")
    parser.add_argument("--out", required=True, help="directory to write the fixtures into")
    parser.add_argument("--force", action="store_true", help="overwrite existing fixtures")
    args = parser.parse_args()

    out_dir = Path(args.out)
    try:
        paths = generate(out_dir, force=bool(args.force))
    except OSError as err:
        print(f"Could not write fixtures to {out_dir}: {err}", file=sys.stderr)
        sys.exit(2)

    purposes = {fixture.name: fixture.purpose for fixture in FIXTURES}
    for path in paths:
        print(f"{path}  ({path.stat().st_size / 1024 / 1024:.1f} MB) — {purposes[path.name]}")
    sys.exit(0)


if __name__ == "__main__":
    main()
