"""Build generic Lymow card artwork (neutral / transparent backgrounds)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "lymow_card"
ASSETS = Path(r"C:\Users\Admin\.cursor\projects\c-Users-Admin-Desktop-R-R-Maintenance-program\assets")

GENERIC_DOCKED = ASSETS / "lymow_docked_generic.png"
GENERIC_EMPTY = ASSETS / "lymow_dock_empty_generic.png"
CARD_W = 800

# Studio backdrop sampled from generated generic images.
BG_RGB = (229, 231, 235)


def resize_width(img: Image.Image, width: int) -> Image.Image:
    w, h = img.size
    if w == width:
        return img
    nh = max(1, round(h * width / w))
    return img.resize((width, nh), Image.Resampling.LANCZOS)


def remove_studio_bg(img: Image.Image, tolerance: int = 42) -> Image.Image:
    """Turn flat gray studio backdrop into transparency."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    br, bg, bb = BG_RGB
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            dr = abs(r - br)
            dg = abs(g - bg)
            db = abs(b - bb)
            if dr <= tolerance and dg <= tolerance and db <= tolerance:
                px[x, y] = (r, g, b, 0)
            elif dr <= tolerance + 18 and dg <= tolerance + 18 and db <= tolerance + 18:
                # Soft edge feather for anti-aliasing.
                dist = max(dr, dg, db)
                alpha = int(255 * (dist - tolerance) / 18)
                alpha = max(0, min(255, alpha))
                px[x, y] = (r, g, b, alpha)
    return rgba


def add_soft_shadow(rgba: Image.Image) -> Image.Image:
    """Drop shadow on transparent canvas for depth on any card theme."""
    w, h = rgba.size
    pad = 24
    canvas = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    alpha = rgba.split()[3]
    shadow = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    shadow.putalpha(alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=10))
    # Tint shadow
    st = shadow.load()
    sw, sh = shadow.size
    for y in range(sh):
        for x in range(sw):
            r, g, b, a = st[x, y]
            if a:
                st[x, y] = (0, 0, 0, min(a, 55))
    canvas.alpha_composite(shadow, (pad + 6, pad + 10))
    canvas.alpha_composite(rgba, (pad, pad))
    return canvas


def export_pair(src: Path, out_name: str, transparent: bool = True) -> Path:
    img = Image.open(src).convert("RGB")
    img = resize_width(img, CARD_W)
    if transparent:
        cut = remove_studio_bg(img)
        cut = add_soft_shadow(cut)
        path = OUT / out_name
        cut.save(path, optimize=True)
    else:
        path = OUT / out_name.replace(".png", "_studio.png")
        img.save(path, optimize=True, quality=88)
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if not GENERIC_DOCKED.exists() or not GENERIC_EMPTY.exists():
        raise SystemExit(
            "Missing generic source PNGs in assets/. Regenerate with GenerateImage first."
        )
    paths = [
        export_pair(GENERIC_DOCKED, "lymow_docked.png"),
        export_pair(GENERIC_EMPTY, "lymow_dock_empty.png"),
    ]
    for p in paths:
        print(f"Wrote {p} ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
