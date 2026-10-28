"""Отрисовка готовой картины в PNG (для превью в списке и для PDF).

Модель смешивания та же, что на фронтенде (canvas, source-over):
каждая линия умножает яркость пикселя на (1 - alpha).
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Буфер в памяти для PNG
import io
# Тип «последовательность номеров гвоздей»
from typing import Sequence

# Массивы для подсчёта, сколько нитей прошло через каждый пиксель
import numpy as np
# Pillow: картинка и рисование кругов
from PIL import Image, ImageDraw

# Те же пиксели линий, что использует алгоритм, — картинка совпадает с расчётом
from .algorithm import line_pixels
# Толщина лески и число гвоздей
from .config import THREAD_DIAMETER_MM, TOTAL_NAILS
# Координаты гвоздей для точек на кольце
from .geometry import nail_xy


# Насколько тёмной выглядит одна нить на картинке данного размера
def line_alpha(size: int, diameter_cm: float) -> float:
    """Непрозрачность линии толщиной 1 px: доля пикселя, которую закрывает леска.

    Чем больше круг, тем крупнее «пиксель» в миллиметрах и тем светлее одна линия —
    так превью честно показывает, что на маленьком круге 5000 линий дадут черноту.
    """
    # Сколько миллиметров настоящей доски приходится на один пиксель картинки
    pixel_mm = diameter_cm * 10 / size
    # Доля пикселя, которую закрывает леска 0,2 мм; ограничиваем 2 %…100 %
    return float(min(1.0, max(0.02, THREAD_DIAMETER_MM / pixel_mm)))


# Рисуем картину как массив яркостей
def render_array(sequence: Sequence[int], steps: int, size: int, diameter_cm: float) -> np.ndarray:
    """Массив яркостей 0..255 (uint8) размером size×size."""
    # Число шагов не меньше 0 и не больше длины последовательности
    steps = max(0, min(steps, len(sequence) - 1))
    # Есть что рисовать
    if steps:
        # Все пиксели всех нитей одним длинным массивом
        pixels = np.concatenate(
            # Пиксели каждой нити от гвоздя i к гвоздю i+1
            [line_pixels(sequence[i], sequence[i + 1], size) for i in range(steps)]
        )
        # Сколько раз каждый пиксель встречается = сколько нитей через него прошло
        counts = np.bincount(pixels, minlength=size * size).reshape(size, size)
    # Ни одной нити
    else:
        # Все счётчики — ноль
        counts = np.zeros((size, size), dtype=np.int64)
    # Каждая нить умножает яркость на (1 − alpha): k нитей → (1 − alpha)^k
    brightness = 255.0 * (1.0 - line_alpha(size, diameter_cm)) ** counts
    # Переводим в 8-битные значения для картинки
    return brightness.astype(np.uint8)


# Картинка с кольцом и точками гвоздей
def render_image(
    # Последовательность, число шагов, диаметр, размер картинки, рисовать ли гвозди
    sequence: Sequence[int], steps: int, diameter_cm: float, size: int = 800, nails: bool = True
# Возвращает картинку Pillow
) -> Image.Image:
    # Рисуем нити и переводим в цветную картинку (чтобы гвозди были серыми)
    img = Image.fromarray(render_array(sequence, steps, size, diameter_cm)).convert("RGB")
    # Инструмент рисования поверх картинки
    draw = ImageDraw.Draw(img)
    # Радиус кольца гвоздей
    r = size / 2 - 0.5
    # Центр
    c = (size - 1) / 2
    # Светло-серая окружность — контур доски
    draw.ellipse([c - r, c - r, c + r, c + r], outline=(200, 200, 200), width=max(1, size // 400))
    # Если нужны точки гвоздей
    if nails:
        # Радиус точки зависит от размера картинки, но не меньше 1 px
        dot = max(1.0, size / 500)
        # Для каждого из 240 гвоздей
        for i in range(TOTAL_NAILS):
            # Координаты гвоздя на картинке
            x, y = nail_xy(i, r, c, c)
            # Серая точка
            draw.ellipse([x - dot, y - dot, x + dot, y + dot], fill=(150, 150, 150))
    # всё вне круга — белое
    # Маска: белый круг на чёрном фоне (с запасом 2 px, чтобы не обрезать кольцо)
    mask = Image.new("L", (size, size), 0)
    # Рисуем круг маски
    ImageDraw.Draw(mask).ellipse([c - r - 2, c - r - 2, c + r + 2, c + r + 2], fill=255)
    # Белый лист того же размера
    white = Image.new("RGB", (size, size), (255, 255, 255))
    # Внутри круга — картина, снаружи — белое
    return Image.composite(img, white, mask)


# То же, но сразу PNG-байты для ответа API или вставки в PDF
def render_png(sequence: Sequence[int], steps: int, diameter_cm: float, size: int = 800) -> bytes:
    # Буфер в памяти
    buf = io.BytesIO()
    # Рисуем и сохраняем PNG с оптимизацией
    render_image(sequence, steps, diameter_cm, size).save(buf, format="PNG", optimize=True)
    # Байты PNG
    return buf.getvalue()
