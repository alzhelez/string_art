"""Рисует значок приложения: desktop/icon.ico (Windows) и frontend/app/icon.svg (вкладка браузера).

python desktop/make_icon.py — запускать после изменения дизайна значка.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ACCENT = (53, 80, 240)
INK = (23, 27, 36)
NAILS = 24
CHORDS = [(1, 13), (4, 17), (7, 20), (10, 22), (2, 9), (15, 21), (5, 12), (18, 3)]


def nail(i: int, c: float, r: float) -> tuple[float, float]:
    a = 2 * math.pi * i / NAILS - math.pi / 2
    return c + r * math.cos(a), c + r * math.sin(a)


def draw(size: int) -> Image.Image:
    k = 4  # рисуем крупнее и уменьшаем — гладкие края
    s = size * k
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = s / 2, s * 0.47
    d.ellipse((c - r, c - r, c + r, c + r), fill=(255, 255, 255, 255), outline=(*INK, 255), width=max(k, s // 40))
    rn = r * 0.82
    w = max(k, s // 64)
    for a, b in CHORDS:
        d.line((*nail(a, c, rn), *nail(b, c, rn)), fill=(*INK, 200), width=w)
    d.line((*nail(19, c, rn), *nail(8, c, rn)), fill=(*ACCENT, 255), width=w * 2)
    dot = max(k, s // 48)
    for i in range(NAILS):
        x, y = nail(i, c, rn)
        d.ellipse((x - dot, y - dot, x + dot, y + dot), fill=(*INK, 255))
    return img.resize((size, size), Image.Resampling.LANCZOS)


def svg() -> str:
    c, r, rn = 16, 15, 12.3
    p = lambda i: tuple(round(v, 2) for v in nail(i, c, rn))  # noqa: E731
    lines = "".join(f'<line x1="{p(a)[0]}" y1="{p(a)[1]}" x2="{p(b)[0]}" y2="{p(b)[1]}"/>' for a, b in CHORDS)
    dots = "".join(f'<circle cx="{p(i)[0]}" cy="{p(i)[1]}" r="0.75"/>' for i in range(NAILS))
    a, b = p(19), p(8)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<circle cx="16" cy="16" r="{r}" fill="#fff" stroke="#171b24" stroke-width="1"/>'
        f'<g stroke="#171b24" stroke-opacity=".8" stroke-width=".5">{lines}</g>'
        f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="#3550f0" stroke-width="1.1"/>'
        f'<g fill="#171b24">{dots}</g></svg>\n'
    )


if __name__ == "__main__":
    big = draw(256)
    big.save(ROOT / "desktop" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.save(ROOT / "desktop" / "icon.png")
    (ROOT / "frontend" / "app" / "icon.svg").write_text(svg(), encoding="utf-8")
    print("готово")
