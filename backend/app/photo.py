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

import functools
import importlib.util
import io
import logging
import math
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from .config import FACE_IMPORTANCE, PROCESSING_SIZE

# Пишем в лог uvicorn — сообщения про модель фона видны в окне бэкенда.
log = logging.getLogger("uvicorn.error")

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
# Основной детектор — YuNet (нейросеть OpenCV, 230 КБ, лежит в app/models, лицензия MIT):
# находит лица в профиль и в три четверти, не путает надписи на футболке с лицом.
# Запасной — каскады Хаара (если OpenCV старый и не умеет FaceDetectorYN).
YUNET_MODEL = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"
YUNET_SCORE = 0.7
HAAR_TO_YUNET_H = 1.2  # рамка Хаара ниже рамки YuNet (без лба и подбородка) — приводим к одной


@functools.cache
def face_detection_available() -> bool:
    try:
        import cv2  # noqa: F401

        return hasattr(cv2, "FaceDetectorYN") or hasattr(cv2, "CascadeClassifier")
    except ImportError:
        return False


def _detect_yunet(img: Image.Image) -> list[Box] | None:
    import cv2

    if not hasattr(cv2, "FaceDetectorYN") or not YUNET_MODEL.exists():
        return None
    small = img.convert("RGB").copy()
    small.thumbnail((960, 960))
    w, h = small.size
    bgr = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2BGR)
    try:
        det = cv2.FaceDetectorYN.create(str(YUNET_MODEL), "", (w, h), YUNET_SCORE, 0.3, 50)
        _, faces = det.detect(bgr)
    except cv2.error:
        log.exception("YuNet не запустился — используем каскады Хаара")
        return None
    boxes = []
    for f in [] if faces is None else faces:
        x, y, bw, bh = (float(v) for v in f[:4])
        x0, y0 = max(0.0, x), max(0.0, y)
        x1, y1 = min(float(w), x + bw), min(float(h), y + bh)
        if x1 - x0 > 8 and y1 - y0 > 8:
            boxes.append(Box(x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h))
    return boxes


def _detect_haar(img: Image.Image) -> list[Box]:
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
    out = []
    for x, y, bw, bh in found:
        nh = bh * HAAR_TO_YUNET_H
        y0 = max(0.0, y + bh / 2 - nh / 2)
        out.append(Box(x / w, y0 / h, bw / w, min(nh, h - y0) / h))
    return out


def detect_faces(img: Image.Image) -> list[Box]:
    """Лица на фото, крупные первыми. Пустой список, если OpenCV нет или лиц не найдено."""
    if not face_detection_available():
        return []
    boxes = _detect_yunet(img)
    if boxes is None:
        boxes = _detect_haar(img)
    return sorted(boxes, key=lambda b: b.w * b.h, reverse=True)


def face_prep(width: int, height: int, face: Box, base: Prep | None = None) -> Prep:
    """Кадр «голова и плечи»: лицо по центру чуть выше середины, сторона ≈ 2 высоты лица."""
    base = base or Prep()
    face_px = face.h * height
    side = min(min(width, height), face_px * 2.0)
    zoom = min(4.0, max(1.0, min(width, height) / side))
    cx = face.x + face.w / 2
    cy = face.y + face.h / 2 + 0.1 * face.h
    return Prep(**{**base.to_dict(), "center_x": cx, "center_y": cy, "zoom": round(zoom, 3), "face_focus": True})


def face_importance(width: int, height: int, prep: Prep, face: Box, size: int = PROCESSING_SIZE) -> np.ndarray:
    """Карта важности: 1 везде, до 1 + FACE_IMPORTANCE внутри эллипса лица, мягкий спад наружу."""
    x0, y0, side = crop_box(width, height, prep)
    k = size / side
    cx = ((face.x + face.w / 2) * width - x0) * k
    cy = ((face.y + face.h / 2) * height - y0) * k
    rx = face.w * width * k * 0.6
    ry = face.h * height * k * 0.65
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    ell = ((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2
    return (1.0 + FACE_IMPORTANCE * np.exp(-np.maximum(ell - 1.0, 0.0) * 3.0)).astype(np.float32)


# --- фон --------------------------------------------------------------------
# Удаление фона — нейросеть U²-Net (вариант для людей, ~170 МБ), запускается через
# onnxruntime. Модель скачивается один раз при первом использовании. Импорт onnxruntime и
# загрузка модели идут в фоне, а HTTP-запросы только узнают статус — ни один запрос не
# висит дольше секунды (прокси Next.js рвёт долгие соединения).
BACKGROUND_MODEL = "u2net_human_seg"
MODEL_FILE = "u2net_human_seg.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
MODEL_MIN_BYTES = 100 * 1024 * 1024  # настоящий файл ~168 МБ; меньше — недокачан
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
_STD = np.array([0.229, 0.224, 0.225], np.float32)


def background_removal_available() -> bool:
    """Установлен ли onnxruntime. Только поиск модуля, без импорта — это мгновенно."""
    return importlib.util.find_spec("onnxruntime") is not None


def model_dir() -> Path:
    """Куда скачивать модель: STRINGART_MODELS_DIR или общая папка rembg (~/.rembg/models/…)."""
    import os

    custom = os.environ.get("STRINGART_MODELS_DIR")
    if custom:
        return Path(custom)
    return Path.home() / ".rembg" / "models" / BACKGROUND_MODEL


def model_candidates() -> list[Path]:
    """Где модель может уже лежать: наша папка и папки, куда её качал rembg прежних версий."""
    import os

    paths = [model_dir() / MODEL_FILE, Path.home() / ".rembg" / "models" / BACKGROUND_MODEL / MODEL_FILE]
    for env in ("U2NET_HOME", "REMBG_HOME"):
        if os.environ.get(env):
            base = Path(os.environ[env]).expanduser()
            paths += [base / MODEL_FILE, base / "models" / BACKGROUND_MODEL / MODEL_FILE]
    paths.append(Path.home() / ".u2net" / MODEL_FILE)
    return paths


def find_model() -> Path | None:
    for path in model_candidates():
        if path.is_file() and path.stat().st_size >= MODEL_MIN_BYTES:
            return path
    return None


class BackgroundEngine:
    """Модель удаления фона и очередь масок. Один экземпляр на процесс."""

    def __init__(self) -> None:
        self.state = "idle"  # idle → loading → ready | error
        self.error: str | None = None
        self.progress: float | None = None  # доля скачанной модели, пока качается
        self._session = None
        self._lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._ready = threading.Event()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bg-mask")
        self._jobs: dict[str, Future] = {}

    def status(self) -> dict:
        return {
            "installed": background_removal_available(),
            "state": self.state,
            "error": self.error,
            "progress": self.progress,
        }

    def warm_up(self) -> None:
        """Начать загрузку модели в фоне (вызывается при старте бэкенда)."""
        if not background_removal_available():
            return
        with self._lock:
            if self.state not in ("idle", "error"):
                return
            self.state = "loading"
            self.error = None
            self._ready.clear()
        threading.Thread(target=self._load, name="bg-model", daemon=True).start()

    def _download(self) -> Path:
        import urllib.request

        target = model_dir() / MODEL_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(".part")
        log.info("Удаление фона: скачиваем модель (~170 МБ) в %s", target)
        with urllib.request.urlopen(MODEL_URL, timeout=60) as resp, open(part, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                self.progress = done / total if total else None
        if part.stat().st_size < MODEL_MIN_BYTES:
            part.unlink(missing_ok=True)
            raise RuntimeError("модель скачалась не полностью — проверьте интернет и попробуйте ещё раз")
        part.replace(target)
        self.progress = None
        return target

    def _load(self) -> None:
        try:
            import onnxruntime as ort

            path = find_model() or self._download()
            log.info("Удаление фона: загружаем модель %s", path)
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            self._session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
            self.state = "ready"
            log.info("Удаление фона: модель готова")
        except Exception as exc:  # noqa: BLE001 — показываем пользователю любую причину
            self.state = "error"
            self.progress = None
            self.error = f"Не удалось загрузить модель удаления фона: {exc}"
            log.exception("Удаление фона: ошибка загрузки модели")
        finally:
            self._ready.set()

    def mask(self, img: Image.Image) -> Image.Image:
        """Синхронно: дождаться модели и посчитать сырую маску (L, 255 — человек)."""
        self.warm_up()
        self._ready.wait()
        if self.state != "ready":
            raise RuntimeError(self.error or "Модель удаления фона недоступна")
        rgb = img.convert("RGB")
        small = np.asarray(rgb.resize((320, 320), Image.Resampling.LANCZOS), np.float32)
        x = small / max(float(small.max()), 1e-6)
        x = ((x - _MEAN) / _STD).transpose(2, 0, 1)[None].astype(np.float32)
        with self._run_lock:
            out = self._session.run(None, {self._session.get_inputs()[0].name: x})[0][0, 0]
        lo, hi = float(out.min()), float(out.max())
        pred = (out - lo) / (hi - lo) if hi > lo else np.zeros_like(out)
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        return mask.resize(rgb.size, Image.Resampling.LANCZOS)

    def submit(self, key: str, job) -> Future:
        """Поставить расчёт маски в очередь (повторный вызов вернёт ту же задачу)."""
        with self._lock:
            fut = self._jobs.get(key)
            if fut is None or (fut.done() and fut.exception() is not None):
                fut = self._pool.submit(job)
                self._jobs[key] = fut
            return fut

    def job(self, key: str) -> Future | None:
        return self._jobs.get(key)


engine = BackgroundEngine()


def background_mask(img: Image.Image, faces: list[Box] | None = None) -> Image.Image:
    """Маска «человек/фон» (L, 255 — человек) после чистки — см. refine_mask."""
    raw = engine.mask(img)
    return Image.fromarray(refine_mask(np.asarray(img.convert("RGB")), np.asarray(raw), faces or []))


# --- чистка маски ---------------------------------------------------------------
def _box_filter(a: np.ndarray, r: int) -> np.ndarray:
    import cv2

    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def _guided_filter(guide: np.ndarray, src: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Guided filter (He et al.): края маски «прилипают» к краям на фото — волосы, плечи."""
    mi, mp = _box_filter(guide, r), _box_filter(src, r)
    cov = _box_filter(guide * src, r) - mi * mp
    var = _box_filter(guide * guide, r) - mi * mi
    a = cov / (var + eps)
    b = mp - a * mi
    return _box_filter(a, r) * guide + _box_filter(b, r)


def refine_mask(rgb: np.ndarray, mask: np.ndarray, faces: list[Box] = ()) -> np.ndarray:
    """Чистит сырую маску нейросети.

    1. Убирает «островки» фона, которые модель приняла за человека: остаются крупные куски
       (≥ 8 % от самого большого) и всё, что пересекается с найденным лицом.
    2. Заполняет мелкие дыры внутри фигуры (блики, пуговицы, серьги).
    3. Убирает полупрозрачную дымку: что модель считала «скорее фоном», становится фоном.
    4. Подгоняет край к краям на фото (guided filter) — волосы и плечи без ступенек и ореола.
    """
    import cv2

    h, w = mask.shape
    a = mask.astype(np.float32) / 255.0
    core = (a > 0.5).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = np.zeros(n, dtype=bool)
        keep[1:] = areas >= 0.08 * areas.max()
        for f in faces:
            x0, y0 = int(f.x * w), int(f.y * h)
            x1, y1 = max(x0 + 1, int((f.x + f.w) * w)), max(y0 + 1, int((f.y + f.h) * h))
            ids = np.unique(labels[y0:y1, x0:x1])
            keep[ids[ids > 0]] = True
        kept = keep[labels]
        k = max(3, round(min(h, w) / 60)) | 1
        near = cv2.dilate(kept.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
        a = np.where(near & ~(core.astype(bool) & ~kept), a, 0.0)

    solid = (a > 0.5).astype(np.uint8)
    person = int(solid.sum())
    n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(1 - solid, connectivity=4)
    for i in range(1, n2):
        x, y, bw, bh, area = stats2[i]
        inside = x > 0 and y > 0 and x + bw < w and y + bh < h
        if inside and area < 0.01 * person:
            a[labels2 == i] = 1.0

    a = np.clip((a - 0.2) / 0.6, 0.0, 1.0)
    a = a * a * (3.0 - 2.0 * a)

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    a = _guided_filter(gray, a.astype(np.float32), max(2, round(min(h, w) / 200)), 1e-3)
    return np.clip(np.rint(a * 255.0), 0, 255).astype(np.uint8)


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
