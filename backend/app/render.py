"""Отрисовка готовой картины в PNG (для превью в списке и для PDF).

Модель смешивания та же, что на фронтенде (canvas, source-over):
каждая линия умножает яркость пикселя на (1 - alpha).
"""

from __future__ import annotations

import io
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw

from .algorithm import line_pixels
from .config import THREAD_DIAMETER_MM, TOTAL_NAILS
from .geometry import nail_xy


def line_alpha(size: int, diameter_cm: float) -> float:
    """Непрозрачность линии толщиной 1 px: доля пикселя, которую закрывает леска.

    Чем больше круг, тем крупнее «пиксель» в миллиметрах и тем светлее одна линия —
    так превью честно показывает, что на маленьком круге 5000 линий дадут черноту.
    """
    pixel_mm = diameter_cm * 10 / size
    return float(min(1.0, max(0.02, THREAD_DIAMETER_MM / pixel_mm)))


def render_array(sequence: Sequence[int], steps: int, size: int, diameter_cm: float) -> np.ndarray:
    """Массив яркостей 0..255 (uint8) размером size×size."""
    steps = max(0, min(steps, len(sequence) - 1))
    if steps:
        pixels = np.concatenate(
            [line_pixels(sequence[i], sequence[i + 1], size) for i in range(steps)]
        )
        counts = np.bincount(pixels, minlength=size * size).reshape(size, size)
    else:
        counts = np.zeros((size, size), dtype=np.int64)
    brightness = 255.0 * (1.0 - line_alpha(size, diameter_cm)) ** counts
    return brightness.astype(np.uint8)


def render_image(
    sequence: Sequence[int], steps: int, diameter_cm: float, size: int = 800, nails: bool = True
) -> Image.Image:
    img = Image.fromarray(render_array(sequence, steps, size, diameter_cm)).convert("RGB")
    draw = ImageDraw.Draw(img)
    r = size / 2 - 0.5
    c = (size - 1) / 2
    draw.ellipse([c - r, c - r, c + r, c + r], outline=(200, 200, 200), width=max(1, size // 400))
    if nails:
        dot = max(1.0, size / 500)
        for i in range(TOTAL_NAILS):
            x, y = nail_xy(i, r, c, c)
            draw.ellipse([x - dot, y - dot, x + dot, y + dot], fill=(150, 150, 150))
    # всё вне круга — белое
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([c - r - 2, c - r - 2, c + r + 2, c + r + 2], fill=255)
    white = Image.new("RGB", (size, size), (255, 255, 255))
    return Image.composite(img, white, mask)


def render_png(sequence: Sequence[int], steps: int, diameter_cm: float, size: int = 800) -> bytes:
    buf = io.BytesIO()
    render_image(sequence, steps, diameter_cm, size).save(buf, format="PNG", optimize=True)
    return buf.getvalue()
