from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


ICON_SIZES = [
    (16, 16),
    (20, 20),
    (24, 24),
    (32, 32),
    (40, 40),
    (48, 48),
    (64, 64),
    (128, 128),
    (256, 256),
]


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python generate-app-icon.py <input.png> <output.ico>", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()

    if not input_path.is_file():
        print(f"Missing input PNG: {input_path}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(input_path) as image:
        rgba = image.convert("RGBA")
        rgba.save(output_path, format="ICO", sizes=ICON_SIZES)

    print(f"[ok] Wrote multi-size icon: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
