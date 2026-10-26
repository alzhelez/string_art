"""Подготовка фото: обрезка до квадрата, ч/б, контраст, круглая маска."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

from .config import ALLOWED_IMAGE_FORMATS, PROCESSING_SIZE, TARGET_GAMMA


class ImageError(ValueError):
    """Файл не является поддерживаемым изображением."""


def load_image(data: bytes) -> Image.Image:
    if not data:
        raise ImageError("Пустой файл")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageError("Файл не похож на изображение") from exc
    if img.format not in ALLOWED_IMAGE_FORMATS:
        raise ImageError(f"Формат {img.format} не поддерживается")
    return ImageOps.exif_transpose(img)


def to_grayscale_square(img: Image.Image, size: int = PROCESSING_SIZE) -> Image.Image:
    """Центральный квадрат → оттенки серого → автоконтраст."""
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(background, img)
    gray = img.convert("L")
    square = ImageOps.fit(gray, (size, size), method=Image.Resampling.LANCZOS)
    return ImageOps.autocontrast(square, cutoff=1)


def circle_mask(size: int) -> np.ndarray:
    yy, xx = np.mgrid[0:size, 0:size]
    c = (size - 1) / 2
    return (xx - c) ** 2 + (yy - c) ** 2 <= (size / 2) ** 2


def darkness_map(gray: Image.Image) -> np.ndarray:
    """0 — белое (нить не нужна), 1 — чёрное. Вне круга — 0."""
    arr = np.asarray(gray, dtype=np.float32) / 255.0
    dark = 1.0 - arr
    dark[~circle_mask(gray.width)] = 0.0
    return dark


def target_map(gray: Image.Image, gamma: float = TARGET_GAMMA) -> np.ndarray:
    """Карта, которую «рисует» алгоритм: лёгкая резкость + гамма к темноте.

    Резкость чуть снижает совпадение крупных тонов, но заметно лучше передаёт
    мелкие детали (глаза, губы) — для портрета это важнее.
    """
    sharp = gray.filter(ImageFilter.UnsharpMask(radius=3, percent=120, threshold=2))
    return darkness_map(sharp) ** gamma


def gray_png(gray: Image.Image) -> bytes:
    buf = io.BytesIO()
    gray.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
