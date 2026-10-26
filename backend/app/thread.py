"""Расчёт длины лески и подбор катушки."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Sequence

from .config import (
    BIG_SPOOL_M,
    LINES_PER_CM,
    MAX_LINES,
    MIN_LINES,
    STANDARD_SPOOLS_M,
    THREAD_MARGIN,
)
from .geometry import arc_spacing, chord_length


@dataclass(frozen=True)
class ThreadStats:
    steps: int
    diameter_cm: float
    raw_length_m: float  # чистая сумма всех хорд
    margin: float
    total_length_m: float  # с запасом
    spool_m: int  # размер одной катушки
    spool_count: int  # сколько таких катушек нужно
    nail_spacing_mm: float  # расстояние между гвоздями по дуге

    def to_dict(self) -> dict:
        return asdict(self)


def raw_length_m(sequence: Sequence[int], steps: int, diameter_cm: float) -> float:
    """Сумма хорд первых `steps` линий, в метрах."""
    if steps < 0 or steps > len(sequence) - 1:
        raise ValueError(f"steps должен быть 0..{len(sequence) - 1}")
    diameter_m = diameter_cm / 100
    return sum(chord_length(sequence[i], sequence[i + 1], diameter_m) for i in range(steps))


def cumulative_lengths_m(sequence: Sequence[int], diameter_cm: float) -> list[float]:
    """Накопленная длина (без запаса) после каждого шага: [0, l1, l1+l2, ...]."""
    diameter_m = diameter_cm / 100
    out = [0.0]
    for i in range(len(sequence) - 1):
        out.append(out[-1] + chord_length(sequence[i], sequence[i + 1], diameter_m))
    return out


def pick_spool(length_m: float) -> tuple[int, int]:
    """Минимальная стандартная катушка, которой хватит. → (размер, количество)."""
    if length_m < 0:
        raise ValueError("Длина не может быть отрицательной")
    for spool in STANDARD_SPOOLS_M:
        if length_m <= spool:
            return spool, 1
    return BIG_SPOOL_M, math.ceil(length_m / BIG_SPOOL_M)


def thread_stats(
    sequence: Sequence[int], steps: int, diameter_cm: float, margin: float = THREAD_MARGIN
) -> ThreadStats:
    raw = raw_length_m(sequence, steps, diameter_cm)
    total = raw * (1 + margin)
    spool, count = pick_spool(total)
    return ThreadStats(
        steps=steps,
        diameter_cm=diameter_cm,
        raw_length_m=round(raw, 2),
        margin=margin,
        total_length_m=round(total, 1),
        spool_m=spool,
        spool_count=count,
        nail_spacing_mm=round(arc_spacing(diameter_cm * 10), 2),
    )


def recommended_lines(diameter_cm: float) -> int:
    """Рекомендуемое число линий для диаметра (кратно 100, в пределах 1000..5000)."""
    value = round(diameter_cm * LINES_PER_CM / 100) * 100
    return int(min(MAX_LINES, max(MIN_LINES, value)))
