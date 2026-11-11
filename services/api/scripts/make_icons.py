"""Generate the PWA PNG icons (192, 512, Apple touch 180) from the brand mark."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[3] / "apps" / "web" / "public"


def mark(size: int, maskable: bool = False) -> Image.Image:
    s = size * 4  # supersample, then downscale for smooth edges
    img = Image.new("RGBA", (s, s))
    top, bottom = (11, 107, 103), (59, 42, 168)
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / s
        gd.line([(0, y), (s, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (s, s), 0)
    radius = 0 if maskable else int(s * 0.25)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    pad = 0.18 if maskable else 0.0  # keep the mark inside the maskable safe zone
    sc = (1 - 2 * pad) * s / 64

    def P(x: float, y: float) -> tuple[float, float]:
        return (pad * s + x * sc, pad * s + y * sc)

    w = int(5 * sc)
    x0, y0 = P(13, 22)
    x1, y1 = P(51, 60)
    d.arc([x0, y0, x1, y1], 180, 360, fill="white", width=w)
    for x, ytop in ((23, 34), (32, 27), (41, 34)):
        d.line([P(x, ytop), P(x, 41)], fill=(255, 255, 255, 210), width=int(3.5 * sc))
    for (cx, cy), col in (((13, 41), (255, 180, 110)), ((51, 41), (127, 240, 228))):
        r = 5 * sc
        px, py = P(cx, cy)
        d.ellipse([px - r, py - r, px + r, py + r], fill=col)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    mark(192).save(OUT / "icon-192.png")
    mark(512, maskable=True).save(OUT / "icon-512.png")
    bg = Image.new("RGB", (180, 180), (11, 107, 103))
    m = mark(180, maskable=True)
    bg.paste(m, (0, 0), m)
    bg.save(OUT / "apple-touch-icon.png")
    print("icons written to", OUT)
