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

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# functools.cache — запомнить результат проверки «есть ли OpenCV»
import functools
# importlib.util.find_spec — узнать, установлен ли модуль, не импортируя его (быстро)
import importlib.util
# Буферы в памяти для JPEG/PNG
import io
# Журнал сообщений сервера
import logging
# math.isfinite — проверка, что число не NaN и не бесконечность
import math
# Потоки: замки и событие «модель готова»
import threading
# Пул из одного рабочего потока для расчёта масок и «обещание результата» (Future)
from concurrent.futures import Future, ThreadPoolExecutor
# Структуры с полями и их перевод в словарь
from dataclasses import asdict, dataclass
# Пути к модели
from pathlib import Path

# Массивы пикселей
import numpy as np
# Картинки
from PIL import Image

# Вес лица и размер рабочей картинки
from .config import FACE_IMPORTANCE, PROCESSING_SIZE

# Пишем в лог uvicorn — сообщения про модель фона видны в окне бэкенда.
# Журнал, сообщения которого видны в консоли сервера
log = logging.getLogger("uvicorn.error")

# Оригинал храним не больше 1600 px по длинной стороне — хватает для кадра и экономит место
MAX_ORIGINAL_SIDE = 1600
# Автоуровни отсекают по 1 % самых тёмных и самых светлых пикселей
AUTO_LEVELS_CUTOFF = 0.01


# Неизменяемая структура настроек кадра
@dataclass(frozen=True)
# Настройки подготовки фото (то, что человек меняет в редакторе)
class Prep:
    # Центр кадра по горизонтали (0 — левый край, 1 — правый)
    center_x: float = 0.5  # центр кадра, доля ширины оригинала
    # Центр кадра по вертикали
    center_y: float = 0.5  # центр кадра, доля высоты оригинала
    # Масштаб: во сколько раз приблизить
    zoom: float = 1.0  # 1 — сторона кадра = короткая сторона фото; 4 — в 4 раза ближе
    # Яркость: сдвиг всех пикселей
    brightness: float = 0.0  # −0,5…0,5
    # Контраст: растяжение от середины серого
    contrast: float = 0.0  # −0,5…1,0
    # Заменить фон на белый
    remove_background: bool = False
    # Лицу — больше нитей
    face_focus: bool = False

    # Настройки → словарь (для JSON и базы)
    def to_dict(self) -> dict:
        # Все поля в словарь
        return asdict(self)


# Неизменяемая структура прямоугольника
@dataclass(frozen=True)
# Прямоугольник лица в долях от размеров фото (не зависит от разрешения)
class Box:
    """Прямоугольник в долях от размеров изображения."""

    # Левый край
    x: float
    # Верхний край
    y: float
    # Ширина
    w: float
    # Высота
    h: float


# --- кадр -------------------------------------------------------------------
# Где на оригинале находится квадрат кадра
def crop_box(width: int, height: int, prep: Prep) -> tuple[float, float, float]:
    """(x0, y0, side) в пикселях оригинала. Кадр не выходит за края фото."""
    # Сторона квадрата: короткая сторона фото, делённая на масштаб (не меньше 1)
    side = min(width, height) / max(1.0, prep.zoom)
    # Левый край: центр минус половина стороны
    x0 = prep.center_x * width - side / 2
    # Верхний край
    y0 = prep.center_y * height - side / 2
    # Не даём кадру выйти за левый/правый край
    x0 = min(max(x0, 0.0), width - side)
    # И за верхний/нижний
    y0 = min(max(y0, 0.0), height - side)
    # Левый верхний угол и сторона
    return x0, y0, side


# Вырезать кадр и привести к нужному размеру
def crop(img: Image.Image, prep: Prep, size: int) -> Image.Image:
    """Вырезает кадр с субпиксельной точностью и уменьшает с антиалиасингом."""
    # Где кадр
    x0, y0, side = crop_box(img.width, img.height, prep)
    # resize с box вырезает область с дробными координатами и масштабирует фильтром Ланцоша
    return img.resize((size, size), Image.Resampling.LANCZOS, box=(x0, y0, x0 + side, y0 + side))


# --- тональные операции (те же формулы — в frontend/lib/prep.ts) -------------
# Цветную картинку → оттенки серого
def to_gray(rgb: np.ndarray) -> np.ndarray:
    """uint8 H×W×3 → float32 H×W (0..255)."""
    # Переводим в дробные числа, чтобы не терять точность
    rgb = rgb.astype(np.float32)
    # Стандартная формула яркости: зелёный глаз видит лучше всего, синий — хуже
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


# Заменить фон на белый по маске
def apply_mask(gray: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """mask 0..255: 255 — объект, 0 — фон (станет белым)."""
    # Доля «человека» в каждом пикселе 0..1
    a = mask.astype(np.float32) / 255.0
    # Плавное смешивание: человек остаётся, фон становится белым, на краях — переход
    return gray * a + 255.0 * (1.0 - a)


# Автоуровни: растянуть яркость на весь диапазон 0..255
def auto_levels(gray: np.ndarray, cutoff: float = AUTO_LEVELS_CUTOFF) -> np.ndarray:
    # Границы растяжения по гистограмме
    bounds = levels(gray, cutoff)
    # Картинка почти однотонная — растягивать нечего
    if bounds is None:
        # Возвращаем как есть
        return gray.astype(np.float32)
    # Нижняя и верхняя границы
    lo, hi = bounds
    # Линейно растягиваем [lo, hi] на [0, 255] и обрезаем выходящие значения
    return np.clip((gray - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.float32)


# Границы автоуровней (lo, hi) — общие для серого и цветного конвейера; None — растягивать нечего
def levels(gray: np.ndarray, cutoff: float = AUTO_LEVELS_CUTOFF) -> tuple[int, int] | None:
    # Яркости в целые 0..255 (для гистограммы)
    values = np.clip(np.rint(gray), 0, 255).astype(np.int32)
    # Гистограмма: сколько пикселей каждой яркости
    hist = np.bincount(values.ravel(), minlength=256)
    # Накопленная сумма гистограммы
    cum = np.cumsum(hist)
    # Всего пикселей
    total = cum[-1]
    # Нижняя граница: яркость, ниже которой 1 % пикселей
    lo = int(np.searchsorted(cum, total * cutoff, side="right"))
    # Верхняя граница: яркость, выше которой 1 % пикселей
    hi = int(np.searchsorted(cum, total * (1 - cutoff), side="left"))
    # Границы совпали — картинка однотонная
    if hi <= lo:
        # Растягивать нечего
        return None
    # Границы растяжения
    return lo, hi


# Яркость и контраст, заданные пользователем
def brightness_contrast(gray: np.ndarray, brightness: float, contrast: float) -> np.ndarray:
    # Контраст растягивает от середины (128), яркость сдвигает всё; результат в пределах 0..255
    return np.clip((gray - 128.0) * (1.0 + contrast) + 128.0 + brightness * 255.0, 0, 255)


# Весь конвейер подготовки фото
def prepare_gray(
    # Оригинал, настройки, необязательная маска фона, размер результата
    original: Image.Image, prep: Prep, mask: Image.Image | None = None, size: int = PROCESSING_SIZE
# Возвращает серую квадратную картинку
) -> Image.Image:
    """Полный конвейер → квадрат size×size в оттенках серого (то, что «рисует» алгоритм)."""
    # 1. Кадр из цветного оригинала
    rgb = np.asarray(crop(original.convert("RGB"), prep, size))
    # 2. Серый
    gray = to_gray(rgb)
    # 3. Убрать фон, если включено и маска есть
    if prep.remove_background and mask is not None:
        # Маску вырезаем тем же кадром, что и фото
        gray = apply_mask(gray, np.asarray(crop(mask.convert("L"), prep, size)))
    # 4. Автоуровни
    gray = auto_levels(gray)
    # 5. Яркость и контраст пользователя
    gray = brightness_contrast(gray, prep.brightness, prep.contrast)
    # Округляем до целых и собираем 8-битную серую картинку
    return Image.fromarray(np.clip(np.rint(gray), 0, 255).astype(np.uint8), mode="L")


# Тот же конвейер в цвете — для портретов из нескольких цветных нитей
def prepare_color(
    # Оригинал, настройки, маска фона, размер и цвет доски (три числа 0..1)
    original: Image.Image, prep: Prep, mask: Image.Image | None = None, size: int = PROCESSING_SIZE, board=(1.0, 1.0, 1.0)
# Возвращает массив size×size×3 со значениями 0..1
) -> np.ndarray:
    """Кадр → автоуровни и коррекции (границы — по серому, как в prepare_gray) → фон цвета доски."""
    # 1. Кадр из цветного оригинала, дробные числа
    rgb = np.asarray(crop(original.convert("RGB"), prep, size)).astype(np.float32)
    # Маска фона этим же кадром (если включено удаление фона)
    alpha = None
    # Маска нужна и есть —
    if prep.remove_background and mask is not None:
        # — доля «человека» в каждой точке, 0..1, с осью канала для умножения
        alpha = (np.asarray(crop(mask.convert("L"), prep, size)).astype(np.float32) / 255.0)[..., None]
    # Серый для границ автоуровней: фон белый, как в одноцветном режиме, — тон лица совпадёт
    gray = to_gray(rgb) if alpha is None else apply_mask(to_gray(rgb), alpha[..., 0] * 255.0)
    # 2. Границы автоуровней
    bounds = levels(gray)
    # Растягиваем все три канала одинаково — цвета не «плывут»
    if bounds is not None:
        # Нижняя и верхняя границы
        lo, hi = bounds
        # Растяжение [lo, hi] → [0, 255]
        rgb = np.clip((rgb - lo) * (255.0 / (hi - lo)), 0, 255)
    # 3. Яркость и контраст пользователя, по каждому каналу
    rgb = brightness_contrast(rgb, prep.brightness, prep.contrast)
    # 4. Фон — цвет доски: там нить не нужна
    if alpha is not None:
        # Смешиваем фото и доску по маске
        rgb = rgb * alpha + np.asarray(board, np.float32) * 255.0 * (1.0 - alpha)
    # Результат 0..1
    return (rgb / 255.0).astype(np.float32)


# --- оригинал ---------------------------------------------------------------
# Привести загруженный оригинал к единому виду перед сохранением
def normalize_original(img: Image.Image) -> Image.Image:
    """RGB, прозрачность → белый фон, длинная сторона не больше 1600 px."""
    # Картинки с прозрачностью или палитрой
    if img.mode in ("RGBA", "LA", "P"):
        # В RGBA
        img = img.convert("RGBA")
        # Белая подложка
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        # Прозрачное становится белым
        img = Image.alpha_composite(bg, img)
    # Обычный цветной RGB
    img = img.convert("RGB")
    # Уменьшаем, если больше 1600 px (пропорции сохраняются, увеличения нет)
    img.thumbnail((MAX_ORIGINAL_SIDE, MAX_ORIGINAL_SIDE), Image.Resampling.LANCZOS)
    # Готовый оригинал
    return img


# Картинку → JPEG-байты (оригинал храним в JPEG — компактно)
def jpeg_bytes(img: Image.Image, quality: int = 90) -> bytes:
    # Буфер
    buf = io.BytesIO()
    # Сохраняем с качеством 90 %
    img.save(buf, format="JPEG", quality=quality)
    # Байты
    return buf.getvalue()


# Картинку → PNG-байты (без потерь — для масок и подготовленного кадра)
def png_bytes(img: Image.Image) -> bytes:
    # Буфер
    buf = io.BytesIO()
    # Сохраняем PNG с оптимизацией размера
    img.save(buf, format="PNG", optimize=True)
    # Байты
    return buf.getvalue()


# --- лицо -------------------------------------------------------------------
# Основной детектор — YuNet (нейросеть OpenCV, 230 КБ, лежит в app/models, лицензия MIT):
# находит лица в профиль и в три четверти, не путает надписи на футболке с лицом.
# Запасной — каскады Хаара (если OpenCV старый и не умеет FaceDetectorYN).
# Файл модели YuNet, который лежит рядом с кодом
YUNET_MODEL = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"
# Порог уверенности: лица с оценкой ниже 0,7 не считаем
YUNET_SCORE = 0.7
# Поправка размера рамки Хаара, чтобы кадр получался таким же, как с YuNet
HAAR_TO_YUNET_H = 1.2  # рамка Хаара ниже рамки YuNet (без лба и подбородка) — приводим к одной


# Результат запоминается — проверка выполняется один раз за запуск
@functools.cache
# Можно ли вообще искать лица (установлен ли OpenCV)
def face_detection_available() -> bool:
    # Импорт может не получиться
    try:
        # Пробуем импортировать OpenCV
        import cv2  # noqa: F401

        # Нужен хотя бы один из детекторов
        return hasattr(cv2, "FaceDetectorYN") or hasattr(cv2, "CascadeClassifier")
    # OpenCV не установлен
    except ImportError:
        # Поиск лица недоступен
        return False


# Поиск лиц нейросетью YuNet; None — детектор недоступен (тогда используем Хаара)
def _detect_yunet(img: Image.Image) -> list[Box] | None:
    # OpenCV
    import cv2

    # Старый OpenCV без YuNet или нет файла модели
    if not hasattr(cv2, "FaceDetectorYN") or not YUNET_MODEL.exists():
        # Сигнал «используй запасной детектор»
        return None
    # Копия фото в RGB
    small = img.convert("RGB").copy()
    # Уменьшаем до 960 px — быстрее и для поиска лица достаточно
    small.thumbnail((960, 960))
    # Размер уменьшенной картинки
    w, h = small.size
    # OpenCV ждёт порядок каналов BGR
    bgr = cv2.cvtColor(np.asarray(small), cv2.COLOR_RGB2BGR)
    # Модель может не загрузиться (несовместимая версия)
    try:
        # Создаём детектор: модель, размер входа, порог уверенности, порог пересечения, максимум лиц
        det = cv2.FaceDetectorYN.create(str(YUNET_MODEL), "", (w, h), YUNET_SCORE, 0.3, 50)
        # Ищем лица
        _, faces = det.detect(bgr)
    # Ошибка внутри OpenCV
    except cv2.error:
        # Пишем в лог и переходим на запасной детектор
        log.exception("YuNet не запустился — используем каскады Хаара")
        # Сигнал «используй Хаара»
        return None
    # Найденные прямоугольники
    boxes = []
    # Каждое лицо: x, y, ширина, высота, затем точки глаз/носа/рта (они нам не нужны)
    for f in [] if faces is None else faces:
        # Первые 4 числа — рамка
        x, y, bw, bh = (float(v) for v in f[:4])
        # Обрезаем рамку краями фото (лицо может быть частично за кадром)
        x0, y0 = max(0.0, x), max(0.0, y)
        # Правый нижний угол тоже в пределах фото
        x1, y1 = min(float(w), x + bw), min(float(h), y + bh)
        # Совсем маленькие «лица» (меньше 8 px) — шум
        if x1 - x0 > 8 and y1 - y0 > 8:
            # Переводим в доли от размеров фото
            boxes.append(Box(x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h))
    # Список лиц (возможно, пустой)
    return boxes


# Запасной поиск лиц — классические каскады Хаара
def _detect_haar(img: Image.Image) -> list[Box]:
    # OpenCV
    import cv2

    # Серая копия
    small = img.convert("L").copy()
    # Уменьшаем до 800 px
    small.thumbnail((800, 800))
    # Выравниваем гистограмму — лица лучше находятся на тёмных/светлых фото
    gray = cv2.equalizeHist(np.asarray(small))
    # Минимальный размер лица — 1/12 короткой стороны, но не меньше 30 px
    min_side = max(30, min(small.size) // 12)
    # Найденные рамки
    found: list[tuple[int, int, int, int]] = []
    # Пробуем две модели каскадов по очереди
    for name in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml"):
        # Загружаем каскад из папки, которая идёт с OpenCV
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        # Ищем лица; minNeighbors=6 — строже, меньше ложных срабатываний
        rects = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(min_side, min_side))
        # Что-то нашли
        if len(rects):
            # Запоминаем рамки как кортежи целых
            found = [tuple(int(v) for v in r) for r in rects]
            # Вторую модель не пробуем
            break
    # Размер уменьшенной картинки
    w, h = small.size
    # Результат в долях
    out = []
    # Для каждой рамки
    for x, y, bw, bh in found:
        # Рамка Хаара ниже — увеличиваем высоту в 1,2 раза
        nh = bh * HAAR_TO_YUNET_H
        # Сохраняем центр по вертикали, не выходя за верх фото
        y0 = max(0.0, y + bh / 2 - nh / 2)
        # Переводим в доли (высоту не даём выйти за низ фото)
        out.append(Box(x / w, y0 / h, bw / w, min(nh, h - y0) / h))
    # Список лиц
    return out


# Найти лица на фото
def detect_faces(img: Image.Image) -> list[Box]:
    """Лица на фото, крупные первыми. Пустой список, если OpenCV нет или лиц не найдено."""
    # Без OpenCV лиц не ищем
    if not face_detection_available():
        # Пустой список
        return []
    # Сначала нейросеть
    boxes = _detect_yunet(img)
    # Нейросеть недоступна
    if boxes is None:
        # Запасной детектор
        boxes = _detect_haar(img)
    # Самое крупное лицо — первым (обычно это главный герой фото)
    return sorted(boxes, key=lambda b: b.w * b.h, reverse=True)


# Кадр «голова и плечи» по найденному лицу
def face_prep(width: int, height: int, face: Box, base: Prep | None = None) -> Prep:
    """Кадр «голова и плечи»: лицо по центру чуть выше середины, сторона ≈ 2 высоты лица."""
    # Остальные настройки берём из base (или по умолчанию)
    base = base or Prep()
    # Высота лица в пикселях
    face_px = face.h * height
    # Сторона кадра — две высоты лица, но не больше короткой стороны фото
    side = min(min(width, height), face_px * 2.0)
    # Масштаб, при котором получится такая сторона (1…4)
    zoom = min(4.0, max(1.0, min(width, height) / side))
    # Центр по горизонтали — центр лица
    cx = face.x + face.w / 2
    # Центр по вертикали — чуть ниже центра лица, чтобы лицо было выше середины и влезли плечи
    cy = face.y + face.h / 2 + 0.1 * face.h
    # Новые настройки: всё из base + центр, масштаб и «Выделить лицо»
    return Prep(**{**base.to_dict(), "center_x": cx, "center_y": cy, "zoom": round(zoom, 3), "face_focus": True})


# Карта важности: на лице нити «ценятся» дороже
def face_importance(width: int, height: int, prep: Prep, face: Box, size: int = PROCESSING_SIZE) -> np.ndarray:
    """Карта важности: 1 везде, до 1 + FACE_IMPORTANCE внутри эллипса лица, мягкий спад наружу."""
    # Где кадр на оригинале
    x0, y0, side = crop_box(width, height, prep)
    # Масштаб: пикселей рабочей картинки на пиксель оригинала
    k = size / side
    # Центр лица в координатах рабочей картинки
    cx = ((face.x + face.w / 2) * width - x0) * k
    # То же по вертикали
    cy = ((face.y + face.h / 2) * height - y0) * k
    # Полуось эллипса по горизонтали — чуть больше половины ширины лица
    rx = face.w * width * k * 0.6
    # Полуось по вертикали
    ry = face.h * height * k * 0.65
    # Сетки координат всех пикселей
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    # «Расстояние» до центра в единицах эллипса: < 1 — внутри
    ell = ((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2
    # Внутри эллипса вес 2, снаружи плавно спадает к 1
    return (1.0 + FACE_IMPORTANCE * np.exp(-np.maximum(ell - 1.0, 0.0) * 3.0)).astype(np.float32)


# --- фон --------------------------------------------------------------------
# Удаление фона — нейросеть U²-Net (вариант для людей, ~170 МБ), запускается через
# onnxruntime. Модель скачивается один раз при первом использовании. Импорт onnxruntime и
# загрузка модели идут в фоне, а HTTP-запросы только узнают статус — ни один запрос не
# висит дольше секунды (прокси Next.js рвёт долгие соединения).
# Название модели (и папки, куда её кладёт rembg)
BACKGROUND_MODEL = "u2net_human_seg"
# Имя файла модели
MODEL_FILE = "u2net_human_seg.onnx"
# Откуда скачивать модель
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
# Файл меньше 100 МБ считаем недокачанным
MODEL_MIN_BYTES = 100 * 1024 * 1024  # настоящий файл ~168 МБ; меньше — недокачан
# Средние значения каналов, на которых обучалась сеть (нормализация входа)
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
# Стандартные отклонения каналов
_STD = np.array([0.229, 0.224, 0.225], np.float32)


# Можно ли убирать фон в этой установке
def background_removal_available() -> bool:
    """Установлен ли onnxruntime. Только поиск модуля, без импорта — это мгновенно."""
    # find_spec ищет модуль, но не загружает его (импорт onnxruntime занимает секунды)
    return importlib.util.find_spec("onnxruntime") is not None


# Папка для скачивания модели
def model_dir() -> Path:
    """Куда скачивать модель: STRINGART_MODELS_DIR или общая папка rembg (~/.rembg/models/…)."""
    # Переменные окружения
    import os

    # Своя папка, заданная переменной (программа для Windows кладёт модель рядом с данными)
    custom = os.environ.get("STRINGART_MODELS_DIR")
    # Если задана
    if custom:
        # Используем её
        return Path(custom)
    # Иначе — туда же, куда качал модель rembg (чтобы не скачивать 170 МБ ещё раз)
    return Path.home() / ".rembg" / "models" / BACKGROUND_MODEL


# Все места, где модель уже может лежать
def model_candidates() -> list[Path]:
    """Где модель может уже лежать: наша папка и папки, куда её качал rembg прежних версий."""
    # Переменные окружения
    import os

    # Наша папка и стандартная папка rembg
    paths = [model_dir() / MODEL_FILE, Path.home() / ".rembg" / "models" / BACKGROUND_MODEL / MODEL_FILE]
    # Старые версии rembg использовали эти переменные
    for env in ("U2NET_HOME", "REMBG_HOME"):
        # Переменная задана
        if os.environ.get(env):
            # Путь из переменной (~ раскрываем в домашнюю папку)
            base = Path(os.environ[env]).expanduser()
            # Модель может лежать прямо там или в подпапке models/…
            paths += [base / MODEL_FILE, base / "models" / BACKGROUND_MODEL / MODEL_FILE]
    # Самая старая папка rembg
    paths.append(Path.home() / ".u2net" / MODEL_FILE)
    # Список кандидатов по приоритету
    return paths


# Найти уже скачанную модель
def find_model() -> Path | None:
    # Перебираем кандидатов
    for path in model_candidates():
        # Файл есть и он достаточно большой (не обрывок)
        if path.is_file() and path.stat().st_size >= MODEL_MIN_BYTES:
            # Нашли
            return path
    # Модели нигде нет
    return None


# Движок удаления фона: модель + очередь расчёта масок
class BackgroundEngine:
    """Модель удаления фона и очередь масок. Один экземпляр на процесс."""

    # Начальное состояние
    def __init__(self) -> None:
        # Состояние модели
        self.state = "idle"  # idle → loading → ready | error
        # Текст ошибки, если загрузка не удалась
        self.error: str | None = None
        # Прогресс скачивания 0..1 (None — не качаем)
        self.progress: float | None = None  # доля скачанной модели, пока качается
        # Сессия onnxruntime (загруженная модель)
        self._session = None
        # Замок для смены состояния и очереди задач
        self._lock = threading.Lock()
        # Замок для запуска модели (одна сессия — по одному расчёту за раз)
        self._run_lock = threading.Lock()
        # Событие «загрузка закончилась» (успешно или с ошибкой)
        self._ready = threading.Event()
        # Один рабочий поток: маски считаются по очереди и не перегружают процессор
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bg-mask")
        # Задачи по ключу (id фото): повторный запрос получает ту же задачу
        self._jobs: dict[str, Future] = {}

    # Состояние для /api/config и запросов маски
    def status(self) -> dict:
        # Словарь состояния
        return {
            # Установлен ли onnxruntime
            "installed": background_removal_available(),
            # idle / loading / ready / error
            "state": self.state,
            # Текст ошибки
            "error": self.error,
            # Прогресс скачивания
            "progress": self.progress,
        }

    # Начать загрузку модели заранее (при старте сервера)
    def warm_up(self) -> None:
        """Начать загрузку модели в фоне (вызывается при старте бэкенда)."""
        # onnxruntime не установлен — нечего грузить
        if not background_removal_available():
            # Выходим
            return
        # Под замком меняем состояние
        with self._lock:
            # Уже грузится или готова — второй раз не начинаем
            if self.state not in ("idle", "error"):
                # Выходим
                return
            # Помечаем «грузится»
            self.state = "loading"
            # Старую ошибку сбрасываем (это повторная попытка)
            self.error = None
            # Событие «готово» сбрасываем
            self._ready.clear()
        # Загружаем в отдельном фоновом потоке; daemon — не мешает закрыть программу
        threading.Thread(target=self._load, name="bg-model", daemon=True).start()

    # Скачать модель из интернета
    def _download(self) -> Path:
        # Стандартная библиотека для HTTP-запросов
        import urllib.request

        # Куда сохранить
        target = model_dir() / MODEL_FILE
        # Создаём папку
        target.parent.mkdir(parents=True, exist_ok=True)
        # Качаем во временный файл .part — недокачанный файл не примут за модель
        part = target.with_suffix(".part")
        # Сообщение в консоль
        log.info("Удаление фона: скачиваем модель (~170 МБ) в %s", target)
        # Открываем соединение (таймаут 60 с) и файл на запись
        with urllib.request.urlopen(MODEL_URL, timeout=60) as resp, open(part, "wb") as out:
            # Полный размер файла из заголовка (0, если сервер не сообщил)
            total = int(resp.headers.get("Content-Length") or 0)
            # Сколько уже скачано
            done = 0
            # Читаем кусками по 1 МБ, пока не кончится
            while chunk := resp.read(1 << 20):
                # Пишем кусок в файл
                out.write(chunk)
                # Считаем скачанное
                done += len(chunk)
                # Обновляем прогресс для интерфейса
                self.progress = done / total if total else None
        # Файл подозрительно маленький — связь оборвалась
        if part.stat().st_size < MODEL_MIN_BYTES:
            # Удаляем обрывок
            part.unlink(missing_ok=True)
            # Понятная ошибка для пользователя
            raise RuntimeError("модель скачалась не полностью — проверьте интернет и попробуйте ещё раз")
        # Переименовываем .part в настоящее имя (атомарно)
        part.replace(target)
        # Скачивание закончено
        self.progress = None
        # Путь к модели
        return target

    # Загрузка модели (выполняется в фоновом потоке)
    def _load(self) -> None:
        # Любая ошибка должна стать понятным статусом, а не тихим падением потока
        try:
            # Тяжёлый импорт — только здесь, в фоне
            import onnxruntime as ort

            # Уже скачанная модель или скачать
            path = find_model() or self._download()
            # Сообщение в консоль
            log.info("Удаление фона: загружаем модель %s", path)
            # Настройки сессии
            opts = ort.SessionOptions()
            # Показывать только ошибки (без предупреждений onnxruntime в консоли)
            opts.log_severity_level = 3
            # Загружаем модель для расчёта на процессоре
            self._session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
            # Готово
            self.state = "ready"
            # Сообщение в консоль
            log.info("Удаление фона: модель готова")
        # Любая ошибка
        except Exception as exc:  # noqa: BLE001 — показываем пользователю любую причину
            # Состояние «ошибка»
            self.state = "error"
            # Прогресс больше не нужен
            self.progress = None
            # Текст для интерфейса
            self.error = f"Не удалось загрузить модель удаления фона: {exc}"
            # Подробности в лог
            log.exception("Удаление фона: ошибка загрузки модели")
        # В любом случае
        finally:
            # Сообщаем ждущим, что загрузка закончилась
            self._ready.set()

    # Посчитать сырую маску человека для фото
    def mask(self, img: Image.Image) -> Image.Image:
        """Синхронно: дождаться модели и посчитать сырую маску (L, 255 — человек)."""
        # Запускаем загрузку, если ещё не начата
        self.warm_up()
        # Ждём окончания загрузки
        self._ready.wait()
        # Загрузилась с ошибкой
        if self.state != "ready":
            # Передаём текст ошибки дальше
            raise RuntimeError(self.error or "Модель удаления фона недоступна")
        # Фото в RGB
        rgb = img.convert("RGB")
        # Сеть принимает 320 × 320 — уменьшаем
        small = np.asarray(rgb.resize((320, 320), Image.Resampling.LANCZOS), np.float32)
        # Делим на максимум — значения 0..1
        x = small / max(float(small.max()), 1e-6)
        # Нормализуем как при обучении сети и меняем порядок осей на [1, каналы, высота, ширина]
        x = ((x - _MEAN) / _STD).transpose(2, 0, 1)[None].astype(np.float32)
        # Одна сессия — один расчёт за раз
        with self._run_lock:
            # Запускаем сеть; берём первый выход, первую картинку, первый канал
            out = self._session.run(None, {self._session.get_inputs()[0].name: x})[0][0, 0]
        # Минимум и максимум выхода сети
        lo, hi = float(out.min()), float(out.max())
        # Нормируем к 0..1 (если выход постоянный — маска пустая)
        pred = (out - lo) / (hi - lo) if hi > lo else np.zeros_like(out)
        # Переводим в 8-битную серую картинку
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        # Растягиваем обратно до размера фото
        return mask.resize(rgb.size, Image.Resampling.LANCZOS)

    # Поставить задачу в очередь
    def submit(self, key: str, job) -> Future:
        """Поставить расчёт маски в очередь (повторный вызов вернёт ту же задачу)."""
        # Под замком
        with self._lock:
            # Есть ли уже задача для этого фото
            fut = self._jobs.get(key)
            # Задачи нет или прошлая упала с ошибкой — ставим новую
            if fut is None or (fut.done() and fut.exception() is not None):
                # Отдаём задачу рабочему потоку
                fut = self._pool.submit(job)
                # Запоминаем
                self._jobs[key] = fut
            # Задача (новая или уже идущая)
            return fut

    # Узнать задачу по ключу
    def job(self, key: str) -> Future | None:
        # Задача или None
        return self._jobs.get(key)


# Единственный движок на весь процесс
engine = BackgroundEngine()


# Готовая маска «человек/фон»
def background_mask(img: Image.Image, faces: list[Box] | None = None) -> Image.Image:
    """Маска «человек/фон» (L, 255 — человек) после чистки — см. refine_mask."""
    # Сырая маска нейросети
    raw = engine.mask(img)
    # Чистим её с учётом лиц и возвращаем картинкой
    return Image.fromarray(refine_mask(np.asarray(img.convert("RGB")), np.asarray(raw), faces or []))


# --- чистка маски ---------------------------------------------------------------
# Быстрое среднее по квадратному окну
def _box_filter(a: np.ndarray, r: int) -> np.ndarray:
    # OpenCV
    import cv2

    # Окно (2r+1)×(2r+1); у краёв картинка «отражается», чтобы не было тёмной рамки
    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


# Направленный фильтр: сглаживает маску, но сохраняет края, видимые на фото
def _guided_filter(guide: np.ndarray, src: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Guided filter (He et al.): края маски «прилипают» к краям на фото — волосы, плечи."""
    # Местные средние фото и маски
    mi, mp = _box_filter(guide, r), _box_filter(src, r)
    # Местная ковариация фото и маски
    cov = _box_filter(guide * src, r) - mi * mp
    # Местная дисперсия фото
    var = _box_filter(guide * guide, r) - mi * mi
    # Коэффициент линейной модели «маска ≈ a·фото + b»; eps — сглаживание на ровных местах
    a = cov / (var + eps)
    # Свободный член модели
    b = mp - a * mi
    # Усредняем коэффициенты и применяем к фото
    return _box_filter(a, r) * guide + _box_filter(b, r)


# Чистка сырой маски нейросети
def refine_mask(rgb: np.ndarray, mask: np.ndarray, faces: list[Box] = ()) -> np.ndarray:
    """Чистит сырую маску нейросети.

    1. Убирает «островки» фона, которые модель приняла за человека: остаются крупные куски
       (≥ 8 % от самого большого) и всё, что пересекается с найденным лицом.
    2. Заполняет мелкие дыры внутри фигуры (блики, пуговицы, серьги).
    3. Убирает полупрозрачную дымку: что модель считала «скорее фоном», становится фоном.
    4. Подгоняет край к краям на фото (guided filter) — волосы и плечи без ступенек и ореола.
    """
    # OpenCV
    import cv2

    # Размер маски
    h, w = mask.shape
    # Маска в долях 0..1
    a = mask.astype(np.float32) / 255.0
    # «Уверенно человек» — где больше 0,5
    core = (a > 0.5).astype(np.uint8)
    # Находим связные куски «человека»: число, номер куска у каждого пикселя, размеры кусков
    n, labels, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    # Есть хотя бы один кусок (0 — это фон)
    if n > 1:
        # Площади кусков (без фона)
        areas = stats[1:, cv2.CC_STAT_AREA]
        # Какие куски оставить
        keep = np.zeros(n, dtype=bool)
        # Оставляем крупные: не меньше 8 % от самого большого
        keep[1:] = areas >= 0.08 * areas.max()
        # И все куски, которые пересекаются с найденными лицами (например, отдельная рука у лица)
        for f in faces:
            # Левый верхний угол лица в пикселях маски
            x0, y0 = int(f.x * w), int(f.y * h)
            # Правый нижний угол (не меньше 1 px от левого верхнего)
            x1, y1 = max(x0 + 1, int((f.x + f.w) * w)), max(y0 + 1, int((f.y + f.h) * h))
            # Номера кусков внутри рамки лица
            ids = np.unique(labels[y0:y1, x0:x1])
            # Оставляем их (кроме фона 0)
            keep[ids[ids > 0]] = True
        # Пиксели оставленных кусков
        kept = keep[labels]
        # Размер «расширения» — около 1/60 стороны, нечётный, не меньше 3
        k = max(3, round(min(h, w) / 60)) | 1
        # Зона рядом с оставленными кусками (полупрозрачные края волос не теряем)
        near = cv2.dilate(kept.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
        # Обнуляем всё вдали от оставленных кусков и сами выброшенные куски
        a = np.where(near & ~(core.astype(bool) & ~kept), a, 0.0)

    # Снова «уверенно человек» после удаления островков
    solid = (a > 0.5).astype(np.uint8)
    # Площадь человека в пикселях
    person = int(solid.sum())
    # Связные куски фона (дыры внутри фигуры — тоже куски фона)
    n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(1 - solid, connectivity=4)
    # Перебираем куски фона
    for i in range(1, n2):
        # Рамка и площадь куска
        x, y, bw, bh, area = stats2[i]
        # Кусок не касается краёв картинки — значит, это дыра внутри
        inside = x > 0 and y > 0 and x + bw < w and y + bh < h
        # Маленькая дыра (меньше 1 % площади человека)
        if inside and area < 0.01 * person:
            # Заливаем её — это часть человека
            a[labels2 == i] = 1.0

    # Убираем дымку: всё ниже 0,2 — фон, выше 0,8 — человек, между — растягиваем
    a = np.clip((a - 0.2) / 0.6, 0.0, 1.0)
    # Плавная S-кривая (smoothstep) — переход без резких ступенек
    a = a * a * (3.0 - 2.0 * a)

    # Фото в оттенках серого 0..1 — «направляющая» для фильтра
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    # Подгоняем края маски к краям фото (радиус ~1/200 стороны)
    a = _guided_filter(gray, a.astype(np.float32), max(2, round(min(h, w) / 200)), 1e-3)
    # Назад в 8-битную маску 0..255
    return np.clip(np.rint(a * 255.0), 0, 255).astype(np.uint8)


# Ограничить настройки кадра допустимыми пределами
def clamp_prep(prep: Prep) -> Prep:
    # Ограничение одного числа; NaN и бесконечность заменяются нижней границей
    def c(v: float, lo: float, hi: float) -> float:
        # Число в пределах [lo, hi]
        return float(min(hi, max(lo, v))) if math.isfinite(v) else lo

    # Новые настройки с ограниченными значениями
    return Prep(
        # Центр — в пределах фото
        center_x=c(prep.center_x, 0, 1),
        # По вертикали тоже
        center_y=c(prep.center_y, 0, 1),
        # Масштаб 1…4
        zoom=c(prep.zoom, 1, 4),
        # Яркость −0,5…0,5
        brightness=c(prep.brightness, -0.5, 0.5),
        # Контраст −0,5…1
        contrast=c(prep.contrast, -0.5, 1.0),
        # Флаги без изменений
        remove_background=prep.remove_background,
        # Флаг «Выделить лицо»
        face_focus=prep.face_focus,
    )
