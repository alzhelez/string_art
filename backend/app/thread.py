"""Расчёт длины лески и подбор катушки."""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# math.ceil — округление вверх при подсчёте числа катушек
import math
# dataclass — короткое описание структуры с полями; asdict — превратить её в словарь для JSON
from dataclasses import asdict, dataclass
# Sequence — тип «любой список/кортеж номеров гвоздей»
from typing import Sequence

# Импортируем нужные константы из настроек (несколько строк — для читаемости)
from .config import (
    # Размер «большой» катушки, если не хватает самой длинной стандартной
    BIG_SPOOL_M,
    # Сколько линий ставить на 1 см диаметра в рекомендации
    LINES_PER_CM,
    # Верхняя граница числа линий (5000)
    MAX_LINES,
    # Нижняя граница числа линий (1000)
    MIN_LINES,
    # Длины катушек, которые продаются
    STANDARD_SPOOLS_M,
    # Запас лески на узлы и обмотку (15 %)
    THREAD_MARGIN,
)
# Длина хорды между гвоздями и расстояние между гвоздями по дуге
from .geometry import arc_spacing, chord_length


# frozen=True — объект нельзя изменить после создания (безопасно отдавать наружу)
@dataclass(frozen=True)
# Итоговая сводка по леске для выбранного числа линий и диаметра
class ThreadStats:
    # Сколько линий (шагов) учтено
    steps: int
    # Диаметр доски в сантиметрах
    diameter_cm: float
    # Длина всех нитей без запаса, метры
    raw_length_m: float  # чистая сумма всех хорд
    # Доля запаса (0.15 = 15 %)
    margin: float
    # Длина с запасом, метры — столько нужно купить
    total_length_m: float  # с запасом
    # Подходящая стандартная катушка, метры
    spool_m: int  # размер одной катушки
    # Сколько таких катушек нужно
    spool_count: int  # сколько таких катушек нужно
    # Расстояние между соседними гвоздями, миллиметры — для разметки доски
    nail_spacing_mm: float  # расстояние между гвоздями по дуге

    # Превращаем сводку в обычный словарь — так её можно отдать в JSON
    def to_dict(self) -> dict:
        # asdict рекурсивно копирует все поля
        return asdict(self)


# Чистая длина лески (без запаса) для первых `steps` линий
def raw_length_m(sequence: Sequence[int], steps: int, diameter_cm: float) -> float:
    """Сумма хорд первых `steps` линий, в метрах."""
    # Шагов не может быть меньше нуля и больше, чем есть в последовательности
    if steps < 0 or steps > len(sequence) - 1:
        # Сообщаем допустимый диапазон
        raise ValueError(f"steps должен быть 0..{len(sequence) - 1}")
    # Переводим диаметр из сантиметров в метры, чтобы длина вышла в метрах
    diameter_m = diameter_cm / 100
    # Складываем длины всех отрезков: от гвоздя i к гвоздю i+1
    return sum(chord_length(sequence[i], sequence[i + 1], diameter_m) for i in range(steps))


# Накопленная длина после каждого шага — нужна, чтобы показать «израсходовано N м» на шаге
def cumulative_lengths_m(sequence: Sequence[int], diameter_cm: float) -> list[float]:
    """Накопленная длина (без запаса) после каждого шага: [0, l1, l1+l2, ...]."""
    # Диаметр в метрах
    diameter_m = diameter_cm / 100
    # До первого шага израсходовано 0 м
    out = [0.0]
    # Проходим по всем отрезкам последовательности
    for i in range(len(sequence) - 1):
        # Новое значение = предыдущее + длина очередного отрезка
        out.append(out[-1] + chord_length(sequence[i], sequence[i + 1], diameter_m))
    # Список длиной len(sequence): индекс = номер шага
    return out


# Подбор катушки: самая короткая из продающихся, которой хватит
def pick_spool(length_m: float) -> tuple[int, int]:
    """Минимальная стандартная катушка, которой хватит. → (размер, количество)."""
    # Отрицательная длина — ошибка в расчёте, сообщаем сразу
    if length_m < 0:
        # Понятный текст ошибки
        raise ValueError("Длина не может быть отрицательной")
    # Перебираем катушки от короткой к длинной
    for spool in STANDARD_SPOOLS_M:
        # Первая катушка, в которую помещается нужная длина
        if length_m <= spool:
            # Одной такой катушки достаточно
            return spool, 1
    # Если не хватает даже самой длинной — считаем, сколько нужно катушек по 1000 м (округляя вверх)
    return BIG_SPOOL_M, math.ceil(length_m / BIG_SPOOL_M)


# Полная сводка по леске для проекта
def thread_stats(
    # Последовательность гвоздей, число линий, диаметр и запас (по умолчанию 15 %)
    sequence: Sequence[int], steps: int, diameter_cm: float, margin: float = THREAD_MARGIN
# Возвращает сводку ThreadStats
) -> ThreadStats:
    # Чистая длина без запаса
    raw = raw_length_m(sequence, steps, diameter_cm)
    # Добавляем запас: длина × 1,15
    total = raw * (1 + margin)
    # Подбираем катушку под длину с запасом
    spool, count = pick_spool(total)
    # Собираем результат
    return ThreadStats(
        # Число линий
        steps=steps,
        # Диаметр доски
        diameter_cm=diameter_cm,
        # Длина без запаса, округлённая до сантиметров
        raw_length_m=round(raw, 2),
        # Сам запас
        margin=margin,
        # Длина с запасом, округлённая до 10 см
        total_length_m=round(total, 1),
        # Размер катушки
        spool_m=spool,
        # Количество катушек
        spool_count=count,
        # Шаг между гвоздями по дуге в мм (диаметр × 10 — из сантиметров в миллиметры)
        nail_spacing_mm=round(arc_spacing(diameter_cm * 10), 2),
    )


# Простая рекомендация числа линий по диаметру («ориентир», без анализа фото)
def recommended_lines(diameter_cm: float) -> int:
    """Рекомендуемое число линий для диаметра (кратно 100, в пределах 1000..5000)."""
    # 40 линий на сантиметр, округлено до сотни
    value = round(diameter_cm * LINES_PER_CM / 100) * 100
    # Не меньше 1000 и не больше 5000
    return int(min(MAX_LINES, max(MIN_LINES, value)))
