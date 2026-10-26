"""Жадный алгоритм string art.

Идея: на каждом шаге из текущего гвоздя пробуем все допустимые гвозди и
выбираем ту линию, под которой картинка в среднем темнее всего. Затем
«стираем» эту линию с карты темноты на LINE_WEIGHT и повторяем.

Опционально передаётся карта важности (например, область лица): там линии
«ценятся» дороже, и алгоритм раньше прорабатывает детали лица.

Ключевое свойство: результат для N линий — это ровно первые N шагов
результата для 5000 линий. Поэтому ползунок количества линий на фронтенде
просто берёт префикс последовательности, без пересчёта.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from .config import (
    LINE_WEIGHT,
    MAX_LINES,
    MIN_NAIL_GAP,
    PROCESSING_SIZE,
    START_NAIL,
    TOTAL_NAILS,
)
from .geometry import nail_gap, nail_xy


@dataclass(frozen=True)
class NailLines:
    """Все линии из одного гвоздя, упакованные для np.add.reduceat."""

    targets: np.ndarray  # гвозди, куда можно тянуть нить
    offsets: np.ndarray  # начало пикселей каждой линии в pixels
    counts: np.ndarray  # число пикселей каждой линии
    pixels: np.ndarray  # плоские индексы пикселей всех линий подряд


def line_pixels(a: int, b: int, size: int) -> np.ndarray:
    """Плоские индексы пикселей прямой между гвоздями a и b."""
    r = size / 2 - 0.5
    c = (size - 1) / 2
    x0, y0 = nail_xy(a, r, c, c)
    x1, y1 = nail_xy(b, r, c, c)
    n = int(np.ceil(np.hypot(x1 - x0, y1 - y0))) + 1
    xs = np.clip(np.rint(np.linspace(x0, x1, n)), 0, size - 1).astype(np.int32)
    ys = np.clip(np.rint(np.linspace(y0, y1, n)), 0, size - 1).astype(np.int32)
    flat = ys * size + xs
    keep = np.ones(len(flat), dtype=bool)
    keep[1:] = flat[1:] != flat[:-1]
    return flat[keep]


_cache: dict[tuple[int, int], list[NailLines]] = {}
_cache_lock = threading.Lock()


def build_line_cache(size: int = PROCESSING_SIZE, min_gap: int = MIN_NAIL_GAP) -> list[NailLines]:
    """Предрасчёт всех линий. Делается один раз на процесс (~1–2 с)."""
    key = (size, min_gap)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
        pair: dict[tuple[int, int], np.ndarray] = {}
        for a in range(TOTAL_NAILS):
            for b in range(a + 1, TOTAL_NAILS):
                if nail_gap(a, b) >= min_gap:
                    pair[(a, b)] = line_pixels(a, b, size)
        result = []
        for a in range(TOTAL_NAILS):
            targets = [b for b in range(TOTAL_NAILS) if b != a and nail_gap(a, b) >= min_gap]
            lines = [pair[(min(a, b), max(a, b))] for b in targets]
            counts = np.array([len(l) for l in lines], dtype=np.int64)
            offsets = np.concatenate(([0], np.cumsum(counts)[:-1])).astype(np.int64)
            result.append(
                NailLines(
                    targets=np.array(targets, dtype=np.int32),
                    offsets=offsets,
                    counts=counts,
                    pixels=np.concatenate(lines),
                )
            )
        _cache[key] = result
        return result


def generate_sequence(
    darkness: np.ndarray,
    max_lines: int = MAX_LINES,
    line_weight: float = LINE_WEIGHT,
    start: int = START_NAIL,
    min_gap: int = MIN_NAIL_GAP,
    importance: np.ndarray | None = None,
) -> list[int]:
    """Последовательность гвоздей длиной max_lines + 1 (первый — стартовый).

    importance — карта весов того же размера (1 — обычная важность, 2 — вдвое важнее).
    """
    size = darkness.shape[0]
    if darkness.shape != (size, size):
        raise ValueError("Карта темноты должна быть квадратной")
    if importance is not None and importance.shape != darkness.shape:
        raise ValueError("Карта важности должна совпадать по размеру с картой темноты")
    if max_lines < 1:
        raise ValueError("max_lines должен быть >= 1")
    cache = build_line_cache(size, min_gap)
    work = darkness.astype(np.float32).ravel().copy()
    weight = None if importance is None else importance.astype(np.float32).ravel()
    used = np.zeros((TOTAL_NAILS, TOTAL_NAILS), dtype=bool)
    sequence = [start]
    current = start
    for _ in range(max_lines):
        lines = cache[current]
        values = work[lines.pixels]
        if weight is not None:
            values = values * weight[lines.pixels]
        sums = np.add.reduceat(values, lines.offsets)
        scores = sums / lines.counts
        # Одну и ту же линию дважды не тянем — иначе алгоритм «залипает».
        scores[used[current, lines.targets]] = -np.inf
        best = int(np.argmax(scores))
        if not np.isfinite(scores[best]):
            break  # все линии из гвоздя уже использованы (на практике не бывает)
        nxt = int(lines.targets[best])
        start_px = lines.offsets[best]
        px = lines.pixels[start_px : start_px + lines.counts[best]]
        work[px] -= line_weight
        used[current, nxt] = used[nxt, current] = True
        sequence.append(nxt)
        current = nxt
    return sequence
