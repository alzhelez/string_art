"""Подготовка фото перед расчётом: кадр, яркость/контраст, удаление фона, лицо.

Тот же конвейер повторён на фронтенде (frontend/lib/prep.ts), чтобы редактор
показывал ровно то, что увидит алгоритм. Совпадение проверяется общим
эталоном autotests/fixtures/prep-golden.json в pytest и Vitest.

Порядок шагов:
    1. Кадр: квадрат со стороной min(W, H) / zoom с центром (center_x, center_y).
    2. Оттенки серого (ITU-R 601: 0,299 R + 0,587 G + 0,114 B).
    3. Удаление фона (по желанию): фон заливается белым по маске.
    4. Автоуровни: 1 % самых тёмных и светлых пикселей отсекаются, остальное растягивается.
    5. Яркость и контраст пользователя: v' = (v − 128)·(1 + contrast) + 128 + brightness·255.
"""

from __future__ import annotations

import io
import logging
import math
import threading
from dataclasses import asdict, dataclass

import numpy as np
from PIL import Image

from .config import FACE_IMPORTANCE, PROCESSING_SIZE

log = logging.getLogger(__name__)

MAX_ORIGINAL_SIDE = 1600
AUTO_LEVELS_CUTOFF = 0.01


@dataclass(frozen=True)
class Prep:
    center_x: float = 0.5  # центр кадра, доля ширины оригинала
    center_y: float = 0.5  # центр кадра, доля высоты оригинала
    zoom: float = 1.0  # 1 — сторона кадра = короткая сторона фото; 4 — в 4 раза ближе
    brightness: float = 0.0  # −0,5…0,5
    contrast: float = 0.0  # −0,5…1,0
    remove_background: bool = False
    face_focus: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Box:
    """Прямоугольник в долях от размеров изображения."""

    x: float
    y: float
    w: float
    h: float


# --- кадр -------------------------------------------------------------------
def crop_box(width: int, height: int, prep: Prep) -> tuple[float, float, float]:
    """(x0, y0, side) в пикселях оригинала. Кадр не выходит за края фото."""
    side = min(width, height) / max(1.0, prep.zoom)
    x0 = prep.center_x * width - side / 2
    y0 = prep.center_y * height - side / 2
    x0 = min(max(x0, 0.0), width - side)
    y0 = min(max(y0, 0.0), height - side)
    return x0, y0, side


def crop(img: Image.Image, prep: Prep, size: int) -> Image.Image:
    """Вырезает кадр с субпиксельной точностью и уменьшает с антиалиасингом."""
    x0, y0, side = crop_box(img.width, img.height, prep)
    return img.resize((size, size), Image.Resampling.LANCZOS, box=(x0, y0, x0 + side, y0 + side))


# --- тональные операции (те же формулы — в frontend/lib/prep.ts) -------------
def to_gray(rgb: np.ndarray) -> np.ndarray:
    """uint8 H×W×3 → float32 H×W (0..255)."""
    rgb = rgb.astype(np.float32)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def apply_mask(gray: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """mask 0..255: 255 — объект, 0 — фон (станет белым)."""
    a = mask.astype(np.float32) / 255.0
    return gray * a + 255.0 * (1.0 - a)


def auto_levels(gray: np.ndarray, cutoff: float = AUTO_LEVELS_CUTOFF) -> np.ndarray:
    values = np.clip(np.rint(gray), 0, 255).astype(np.int32)
    hist = np.bincount(values.ravel(), minlength=256)
    cum = np.cumsum(hist)
    total = cum[-1]
    lo = int(np.searchsorted(cum, total * cutoff, side="right"))
    hi = int(np.searchsorted(cum, total * (1 - cutoff), side="left"))
    if hi <= lo:
        return gray.astype(np.float32)
    return np.clip((gray - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.float32)


def brightness_contrast(gray: np.ndarray, brightness: float, contrast: float) -> np.ndarray:
    return np.clip((gray - 128.0) * (1.0 + contrast) + 128.0 + brightness * 255.0, 0, 255)


def prepare_gray(
    original: Image.Image, prep: Prep, mask: Image.Image | None = None, size: int = PROCESSING_SIZE
) -> Image.Image:
    """Полный конвейер → квадрат size×size в оттенках серого (то, что «рисует» алгоритм)."""
    rgb = np.asarray(crop(original.convert("RGB"), prep, size))
    gray = to_gray(rgb)
    if prep.remove_background and mask is not None:
        gray = apply_mask(gray, np.asarray(crop(mask.convert("L"), prep, size)))
    gray = auto_levels(gray)
    gray = brightness_contrast(gray, prep.brightness, prep.contrast)
    return Image.fromarray(np.clip(np.rint(gray), 0, 255).astype(np.uint8), mode="L")


# --- оригинал ---------------------------------------------------------------
def normalize_original(img: Image.Image) -> Image.Image:
    """RGB, прозрачность → белый фон, длинная сторона не больше 1600 px."""
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("RGB")
    img.thumbnail((MAX_ORIGINAL_SIDE, MAX_ORIGINAL_SIDE), Image.Resampling.LANCZOS)
    return img


def jpeg_bytes(img: Image.Image, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# --- лицо -------------------------------------------------------------------
def face_detection_available() -> bool:
    try:
        import cv2  # noqa: F401

        return hasattr(cv2, "CascadeClassifier")
    except ImportError:
        return False


def detect_faces(img: Image.Image) -> list[Box]:
    """Лица анфас (OpenCV Haar). Крупные — первыми. Пустой список, если OpenCV нет."""
    if not face_detection_available():
        return []
    import cv2

    small = img.convert("L").copy()
    small.thumbnail((800, 800))
    gray = cv2.equalizeHist(np.asarray(small))
    min_side = max(30, min(small.size) // 12)
    found: list[tuple[int, int, int, int]] = []
    for name in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml"):
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        rects = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        if len(rects):
            found = [tuple(int(v) for v in r) for r in rects]
            break
    w, h = small.size
    boxes = [Box(x / w, y / h, bw / w, bh / h) for x, y, bw, bh in found]
    return sorted(boxes, key=lambda b: b.w * b.h, reverse=True)


def face_prep(width: int, height: int, face: Box, base: Prep | None = None) -> Prep:
    """Кадр «голова и плечи»: лицо по центру чуть выше середины, сторона ≈ 2,4 высоты лица."""
    base = base or Prep()
    face_px = face.h * height
    side = min(min(width, height), face_px * 2.4)
    zoom = min(4.0, max(1.0, min(width, height) / side))
    cx = face.x + face.w / 2
    cy = face.y + face.h / 2 + 0.12 * face.h
    return Prep(**{**base.to_dict(), "center_x": cx, "center_y": cy, "zoom": round(zoom, 3), "face_focus": True})


def face_importance(width: int, height: int, prep: Prep, face: Box, size: int = PROCESSING_SIZE) -> np.ndarray:
    """Карта важности: 1 везде, до 1 + FACE_IMPORTANCE внутри эллипса лица, мягкий спад наружу."""
    x0, y0, side = crop_box(width, height, prep)
    k = size / side
    cx = ((face.x + face.w / 2) * width - x0) * k
    cy = ((face.y + face.h / 2) * height - y0) * k
    rx = face.w * width * k * 0.6
    ry = face.h * height * k * 0.75
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    ell = ((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2
    return (1.0 + FACE_IMPORTANCE * np.exp(-np.maximum(ell - 1.0, 0.0) * 3.0)).astype(np.float32)


# --- фон --------------------------------------------------------------------
_session = None
_session_lock = threading.Lock()
BACKGROUND_MODEL = "u2net_human_seg"


def background_removal_available() -> bool:
    try:
        import rembg  # noqa: F401

        return True
    except ImportError:
        return False


def background_mask(img: Image.Image) -> Image.Image:
    """Маска «человек / фон» (L, 255 — человек). Модель ~170 МБ скачивается при первом вызове."""
    global _session
    from rembg import new_session, remove

    with _session_lock:
        if _session is None:
            log.info("Загружаем модель удаления фона %s (один раз)…", BACKGROUND_MODEL)
            _session = new_session(BACKGROUND_MODEL)
        mask = remove(img.convert("RGB"), session=_session, only_mask=True)
    return mask.convert("L")


def clamp_prep(prep: Prep) -> Prep:
    def c(v: float, lo: float, hi: float) -> float:
        return float(min(hi, max(lo, v))) if math.isfinite(v) else lo

    return Prep(
        center_x=c(prep.center_x, 0, 1),
        center_y=c(prep.center_y, 0, 1),
        zoom=c(prep.zoom, 1, 4),
        brightness=c(prep.brightness, -0.5, 0.5),
        contrast=c(prep.contrast, -0.5, 1.0),
        remove_background=prep.remove_background,
        face_focus=prep.face_focus,
    )
