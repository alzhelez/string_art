"""Расчёт портрета из нескольких нитей: по слою на каждый цвет.

Каждая нить — отдельная непрерывная леска со своей последовательностью гвоздей
(все слои начинаются с A1). Слой считается тем же жадным алгоритмом, что и
одна чёрная нить: картой темноты служит «сколько этой нити нужно» из palette.py.

Сколько линий взять в каждом слое, подбирается по картине целиком: рисуем все
слои поверх доски, как их увидит человек, и сравниваем с фото — по деталям
яркости (та же оценка, что у одной нити) и по цвету. Порядок плетения тоже
выбирается: пробуем «светлые нити снизу» и «тёмные снизу» и берём лучший
(для чёрной и белой нити обычно лучше белая поверх, для цветных — наоборот).
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Массивы
import numpy as np
# Картинки
from PIL import Image

# Палитра, доли нитей и ограничения слоёв
from . import palette
# Жадный алгоритм выбора гвоздей и пиксели линии
from .algorithm import generate_sequence, line_pixels
# Число линий по умолчанию и рабочий размер
from .config import MAX_LINES, PROCESSING_SIZE
# Карта, которую «рисует» алгоритм (резкость + гамма) и маска круга
from .image_prep import circle_mask, target_map
# Прозрачность одной линии и счётчик линий в каждом пикселе
from .render import line_alpha, line_counts
# Оценка сходства по деталям (та же, что для одной нити) и размытие
from .similarity import _blur, _Scorer

# Шаг сетки числа линий при подборе: 100 линий
GRID = 100
# Вес отличия цвета в общей оценке: чем больше, тем важнее попасть в цвет, а не в детали
COLOR_WEIGHT = 10.0
# Размытие «глазом» для сравнения цвета, мм
COLOR_BLUR_MM = 3.0


# Яркость цветной картинки (H×W×3 → H×W), те же коэффициенты, что у фото
def luminance(rgb: np.ndarray) -> np.ndarray:
    # Взвешенная сумма каналов
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


# Цвет без яркости: что остаётся, если вычесть серое
def _chroma(rgb: np.ndarray) -> np.ndarray:
    # Из каждого канала вычитаем яркость
    return rgb - luminance(rgb)[..., None]


# Счётчики линий слоя через каждые GRID линий: [0 линий, 100, 200, …] — для быстрого подбора
def grid_counts(sequence: list[int], size: int = PROCESSING_SIZE) -> list[np.ndarray]:
    # Первая точка — ни одной линии
    out = [np.zeros(size * size, np.int16)]
    # Накопленный счётчик
    current = np.zeros(size * size, np.int32)
    # Через каждые 100 линий —
    for n in range(GRID, len(sequence), GRID):
        # — пиксели очередных 100 линий
        px = np.concatenate([line_pixels(sequence[i], sequence[i + 1], size) for i in range(n - GRID, n)])
        # — прибавляем к счётчику
        current += np.bincount(px, minlength=size * size)
        # — запоминаем копию (int16 хватает: через пиксель проходит меньше 32 тысяч линий)
        out.append(current.astype(np.int16))
    # Список счётчиков
    return out


# Картина из слоёв: счётчики линий по слоям, цвета нитей, доска → H×W×3 (0..1)
def composite(counts: list[np.ndarray], colors: list[np.ndarray], board: np.ndarray, alpha: float, size: int) -> np.ndarray:
    # Холст цвета доски
    canvas = np.tile(board.astype(np.float32), (size * size, 1))
    # Слои по порядку плетения
    for c, color in zip(counts, colors):
        # Доля нижнего цвета, которая остаётся видна
        keep = ((1.0 - alpha) ** c.astype(np.float32))[:, None]
        # Новая нить поверх
        canvas = canvas * keep + color * (1.0 - keep)
    # В форму картинки
    return canvas.reshape(size, size, 3)


# Оценщик картины целиком: детали яркости + попадание в цвет
class Judge:
    # Готовим эталон один раз
    def __init__(self, target: np.ndarray, board: np.ndarray, diameter_cm: float, size: int = PROCESSING_SIZE) -> None:
        # Размер картинки
        self.size = size
        # Доска
        self.board = board
        # Прозрачность одной линии для этого диаметра
        self.alpha = line_alpha(size, diameter_cm)
        # Оценка деталей — по яркости фото (0..255), как у одной нити
        self.scorer = _Scorer(Image.fromarray(np.clip(np.rint(luminance(target) * 255), 0, 255).astype(np.uint8)), diameter_cm, size)
        # Размытие для цвета, в пикселях
        self.sigma = COLOR_BLUR_MM / (diameter_cm * 10 / size)
        # Маска круга
        self.mask = circle_mask(size)
        # Цвет фото после размытия, только внутри круга
        self.chroma = _chroma(_blur_rgb(target, self.sigma))[self.mask]

    # Оценка картины: больше — лучше
    def score(self, counts: list[np.ndarray], colors: list[np.ndarray]) -> float:
        # Рисуем картину
        comp = composite(counts, colors, self.board, self.alpha, self.size)
        # Детали яркости
        detail = self.scorer.score(luminance(comp) * 255.0)
        # Отличие цвета после размытия
        color = float(((_chroma(_blur_rgb(comp, self.sigma))[self.mask] - self.chroma) ** 2).mean())
        # Итог: детали минус штраф за цвет
        return detail - COLOR_WEIGHT * color


# Размытие цветной картинки по каждому каналу
def _blur_rgb(rgb: np.ndarray, sigma: float) -> np.ndarray:
    # Каждый канал отдельно, затем обратно вместе
    return np.stack([_blur(rgb[..., i], sigma) for i in range(3)], axis=-1)


# Подбор числа линий слоёв (номера точек сетки) покоординатным спуском
def _fit(judge: Judge, grids: list[list[np.ndarray]], colors: list[np.ndarray]) -> tuple[list[int], float]:
    # Начало: по 1000 линий в каждом слое (или сколько есть)
    idx = [min(10, len(g) - 1) for g in grids]
    # Оценка начальной точки
    best = judge.score([g[i] for g, i in zip(grids, idx)], colors)
    # Два грубых прохода (шаг 300 линий) и один точный (±200 с шагом 100)
    for coarse in (True, True, False):
        # По очереди для каждого слоя —
        for k, grid in enumerate(grids):
            # — какие точки пробуем
            options = range(1, len(grid), 3) if coarse else range(max(1, idx[k] - 2), min(len(grid), idx[k] + 3))
            # — перебираем
            for i in options:
                # Пробная точка: меняем только слой k
                trial = list(idx)
                # Новое число линий слоя k
                trial[k] = i
                # Оценка
                value = judge.score([g[j] for g, j in zip(grids, trial)], colors)
                # Лучше — запоминаем
                if value > best:
                    # Новая лучшая точка
                    best, idx = value, trial
    # Точки сетки и оценка
    return idx, best


# Посчитать все слои: target — цветное фото 0..1, keys — нити (порядок уточнится)
def build_layers(
    # Цветное фото, доска, нити, карта важности (лицо) и диаметр для оценки сходства
    target: np.ndarray, board_key: str, keys: list[str], importance: np.ndarray | None, diameter_cm: float
# Слои в порядке плетения: цвет, последовательность, рекомендуемое число линий
) -> list[dict]:
    # Цвет доски
    board = palette.BOARD_BY_KEY[board_key].rgb
    # Серые карты «сколько нити нужно» — по одной на каждый цвет
    maps = palette.layer_maps(target, board_key, keys)
    # Последовательности гвоздей на максимум линий
    sequences = {key: generate_sequence(target_map(gray), importance=importance) for key, gray in zip(keys, maps)}
    # Одна нить — подбирать нечего (режим mono считается отдельно, это на всякий случай)
    if len(keys) == 1:
        # Один слой на рекомендуемое число линий
        return [{"color": keys[0], "sequence": sequences[keys[0]], "line_count": MAX_LINES // 2}]
    # Счётчики линий через каждые 100 линий
    grids = {key: grid_counts(seq) for key, seq in sequences.items()}
    # Оценщик
    judge = Judge(target, board, diameter_cm)
    # Лучший вариант: (оценка, порядок, точки сетки)
    best: tuple[float, list[str], list[int]] | None = None
    # Два порядка плетения: светлые снизу и тёмные снизу
    for order in (palette.weave_order(keys), palette.weave_order(keys)[::-1]):
        # Подбор числа линий для этого порядка
        idx, value = _fit(judge, [grids[k] for k in order], [palette.THREAD_BY_KEY[k].rgb for k in order])
        # Лучше прежнего — запоминаем
        if best is None or value > best[0]:
            # Новый лучший вариант
            best = (value, order, idx)
    # Распаковываем
    _, order, idx = best
    # Слои в выбранном порядке: число линий — точка сетки × 100, не меньше минимума слоя
    return [
        # Один слой
        {"color": key, "sequence": sequences[key], "line_count": max(palette.LAYER_MIN_LINES, i * GRID)}
        # Для каждой нити по порядку
        for key, i in zip(order, idx)
    ]


# Кривая «оценка картины ↔ число линий слоя k» при остальных слоях как есть
def layer_curve(
    # Цветное фото, доска, слои (цвет, последовательность, число линий), номер слоя, диаметр
    target: np.ndarray, board_key: str, layers: list[dict], k: int, diameter_cm: float
# Точки (число линий, оценка)
) -> list[tuple[int, float]]:
    # Оценщик
    judge = Judge(target, palette.BOARD_BY_KEY[board_key].rgb, diameter_cm)
    # Цвета нитей по порядку
    colors = [palette.THREAD_BY_KEY[layer["color"]].rgb for layer in layers]
    # Счётчики остальных слоёв — на их текущем числе линий
    fixed = [line_counts(layer["sequence"], layer["line_count"], judge.size) if i != k else None for i, layer in enumerate(layers)]
    # Сетка для изменяемого слоя
    grid = grid_counts(layers[k]["sequence"])
    # Результат
    out = []
    # Каждые 200 линий, начиная с минимума слоя
    for i in range(palette.LAYER_MIN_LINES // GRID, len(grid), 2):
        # Счётчики: остальные как есть, слой k — на i·100 линий
        counts = [grid[i] if j == k else c for j, c in enumerate(fixed)]
        # Точка кривой
        out.append((i * GRID, round(judge.score(counts, colors), 4)))
    # Кривая
    return out


# Эталон для серого «превью» цветного портрета: фото в оттенках серого
def preview_gray(target: np.ndarray) -> Image.Image:
    # В 8-битную серую картинку
    return Image.fromarray(np.clip(np.rint(luminance(target) * 255.0), 0, 255).astype(np.uint8), mode="L")
