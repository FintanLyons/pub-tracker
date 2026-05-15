#!/usr/bin/env python3
"""Build app-icon.png and adaptive-icon-foreground.png from pub_marker_visited.png."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/pub_marker_visited.png"
OUT_FG = ROOT / "assets/adaptive-icon-foreground.png"
OUT_ICON = ROOT / "assets/app-icon.png"

CHARCOAL = (0x1C, 0x1C, 0x1C, 255)
CANVAS = 1024
SAFE_MAX = 620  # centre 66% safe zone on 1024


def main() -> int:
    src = Image.open(SRC).convert("RGBA")
    pixels = src.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r < 40 and g < 40 and b < 40:
                pixels[x, y] = (r, g, b, 0)

    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)

    sw, sh = src.size
    scale = min(SAFE_MAX / sw, SAFE_MAX / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    scaled = src.resize((nw, nh), Image.Resampling.LANCZOS)
    pos = ((CANVAS - nw) // 2, (CANVAS - nh) // 2)

    fg = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    fg.paste(scaled, pos, scaled)
    fg.save(OUT_FG, optimize=True)

    ios = Image.new("RGBA", (CANVAS, CANVAS), CHARCOAL)
    ios.paste(scaled, pos, scaled)
    ios.save(OUT_ICON, optimize=True)

    print(f"Wrote {OUT_FG.name} and {OUT_ICON.name} ({nw}x{nh} artwork on {CANVAS}px)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
