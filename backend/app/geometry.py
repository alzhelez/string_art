"""Геометрия круга с гвоздями.

Круг делится осями X и Y на 4 сектора (четверти), обход — по часовой стрелке
от левой точки оси X (9 часов):

    A — левая верхняя четверть   (9 → 12 часов)
    B — правая верхняя четверть  (12 → 3 часа)
    C — правая нижняя четверть   (3 → 6 часов)
    D — левая нижняя четверть    (6 → 9 часов)

В каждой четверти 60 гвоздей, нумерация 1..60 по часовой стрелке.
Все 240 гвоздей равноудалены (шаг 1,5°). Гвозди сдвинуты на полшага от осей,
поэтому ни один гвоздь не лежит ровно на оси, а четверти строго симметричны:
A1 — сразу над левой точкой оси X, A60 — сразу слева от верхней точки.
"""

from __future__ import annotations

import math
import re

from .config import NAILS_PER_SECTOR, SECTORS, TOTAL_NAILS

ANGLE_STEP = 2 * math.pi / TOTAL_NAILS
# Сектор A начинается в левой точке оси X: −90° от верхней точки, если считать по часовой.
START_ANGLE = -math.pi / 2
_LABEL_RE = re.compile(r"^\s*([A-Da-d])\s*-?\s*(\d{1,2})\s*$")


def nail_angle(index: int) -> float:
    """Угол гвоздя в радианах, по часовой стрелке от верхней точки (A1 ≈ −90°)."""
    _check_index(index)
    return START_ANGLE + (index + 0.5) * ANGLE_STEP


def sector_center_angle(sector: int) -> float:
    """Угол середины сектора (0 — A, 3 — D): куда ставить крупную букву на схеме."""
    return START_ANGLE + (sector + 0.5) * math.pi / 2


def nail_label(index: int) -> str:
    """0 → 'A1', 59 → 'A60', 60 → 'B1', 239 → 'D60'."""
    _check_index(index)
    sector, number = divmod(index, NAILS_PER_SECTOR)
    return f"{SECTORS[sector]}{number + 1}"


def parse_label(label: str) -> int:
    """'A1' → 0, 'd60' → 239. Бросает ValueError на мусор."""
    match = _LABEL_RE.match(label)
    if not match:
        raise ValueError(f"Некорректная метка гвоздя: {label!r}")
    sector = SECTORS.index(match.group(1).upper())
    number = int(match.group(2))
    if not 1 <= number <= NAILS_PER_SECTOR:
        raise ValueError(f"Номер гвоздя должен быть 1..{NAILS_PER_SECTOR}: {label!r}")
    return sector * NAILS_PER_SECTOR + number - 1


def nail_xy(index: int, radius: float, cx: float = 0.0, cy: float = 0.0) -> tuple[float, float]:
    """Координаты гвоздя в экранной системе (ось Y направлена вниз)."""
    angle = nail_angle(index)
    return cx + radius * math.sin(angle), cy - radius * math.cos(angle)


def nail_gap(a: int, b: int) -> int:
    """Минимальное число шагов между гвоздями по кругу (0..120)."""
    diff = abs(a - b) % TOTAL_NAILS
    return min(diff, TOTAL_NAILS - diff)


def chord_length(a: int, b: int, diameter: float) -> float:
    """Длина прямой нити между гвоздями (в тех же единицах, что и диаметр)."""
    return diameter * math.sin(nail_gap(a, b) * ANGLE_STEP / 2)


def arc_spacing(diameter: float) -> float:
    """Расстояние между соседними гвоздями по окружности."""
    return math.pi * diameter / TOTAL_NAILS


def _check_index(index: int) -> None:
    if not 0 <= index < TOTAL_NAILS:
        raise ValueError(f"Индекс гвоздя должен быть 0..{TOTAL_NAILS - 1}, получено {index}")
