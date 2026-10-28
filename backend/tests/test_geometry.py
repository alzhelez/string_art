# Расстояние между точками
import math

# Тестовый фреймворк
import pytest

# Константы
from app.config import NAILS_PER_SECTOR, TOTAL_NAILS
# Функции геометрии
from app.geometry import (
    # Длина дуги между гвоздями
    arc_spacing,
    # Длина хорды
    chord_length,
    # Угол гвоздя
    nail_angle,
    # Расстояние по кругу
    nail_gap,
    # Метка
    nail_label,
    # Координаты
    nail_xy,
    # Разбор метки
    parse_label,
)


# Тест: 240 гвоздей по 60 в секторе
def test_total_nails_is_240():
    # Всего
    assert TOTAL_NAILS == 240
    # В секторе
    assert NAILS_PER_SECTOR == 60


# Параметризованный тест границ секторов
@pytest.mark.parametrize(
    # Параметры
    "index, label",
    # Первый и последний гвоздь каждого сектора
    [(0, "A1"), (59, "A60"), (60, "B1"), (119, "B60"), (120, "C1"), (179, "C60"), (180, "D1"), (239, "D60")],
)
# Тест: номер ↔ метка
def test_sector_boundaries_labels(index, label):
    # Номер → метка
    assert nail_label(index) == label
    # Метка → номер
    assert parse_label(label) == index


# Тест: все метки уникальны и обратимы
def test_label_roundtrip_for_every_nail():
    # Все метки
    labels = [nail_label(i) for i in range(TOTAL_NAILS)]
    # Уникальны
    assert len(set(labels)) == TOTAL_NAILS
    # Разбор возвращает номера по порядку
    assert [parse_label(lbl) for lbl in labels] == list(range(TOTAL_NAILS))


# Разные написания одной метки
@pytest.mark.parametrize("raw, expected", [("a1", 0), (" C 37 ", 156), ("d-60", 239), ("B05", 64)])
# Тест: разбор прощает регистр, пробелы, дефис, ведущий ноль
def test_parse_label_is_lenient_to_format(raw, expected):
    # Проверка
    assert parse_label(raw) == expected


# Мусор: пусто, без цифр, наоборот, неизвестный сектор, 0, 61, две буквы, 100, кириллица
@pytest.mark.parametrize("bad", ["", "A", "1A", "E1", "A0", "A61", "AA1", "A100", "Ж5"])
# Тест: мусор отклоняется
def test_parse_label_rejects_garbage(bad):
    # Ожидаем ValueError
    with pytest.raises(ValueError):
        # Разбор
        parse_label(bad)


# Номера вне 0…239
@pytest.mark.parametrize("bad", [-1, 240, 1000])
# Тест: ошибка на неверный номер
def test_index_out_of_range(bad):
    # Метка
    with pytest.raises(ValueError):
        # Вызов
        nail_label(bad)
    # Угол
    with pytest.raises(ValueError):
        # Вызов
        nail_angle(bad)


# Экранные координаты: Y вниз, поэтому «сверху» = y < 0.
# Параметры: сектор и знаки x, y его четверти
@pytest.mark.parametrize(
    # Наборы
    "sector, x_sign, y_sign",
    # Понятные имена наборов в отчёте
    [(0, -1, -1), (1, +1, -1), (2, +1, +1), (3, -1, +1)],
    # Ожидаем
    ids=["A=лево-верх", "B=право-верх", "C=право-низ", "D=лево-низ"],
)
# Тест: сектора — четверти круга, разделённые осями
def test_sectors_are_quadrants_split_by_axes(sector, x_sign, y_sign):
    # Каждый гвоздь сектора
    for n in range(NAILS_PER_SECTOR):
        # Координаты на единичном круге
        x, y = nail_xy(sector * NAILS_PER_SECTOR + n, radius=1.0)
        # Знаки совпадают с четвертью
        assert x * x_sign > 0 and y * y_sign > 0


# Тест: ни один гвоздь не стоит на оси
def test_no_nail_lies_on_axis():
    # Каждый гвоздь
    for i in range(TOTAL_NAILS):
        # Координаты
        x, y = nail_xy(i, radius=1.0)
        # Обе не ноль
        assert abs(x) > 1e-6 and abs(y) > 1e-6


# Тест: нумерация по часовой стрелке
def test_numbering_goes_clockwise():
    # Углы всех гвоздей
    angles = [nail_angle(i) for i in range(TOTAL_NAILS)]
    # Растут по порядку
    assert angles == sorted(angles)
    # A1 — сразу над левой точкой оси X: x около -R, y чуть меньше 0 (выше оси)
    # Координаты A1
    x, y = nail_xy(0, radius=1.0)
    # Слева и чуть выше оси
    assert x < -0.99 and -0.02 < y < 0
    # A60 — сразу слева от верхней точки, B1 — сразу справа от неё
    # A60
    x60, y60 = nail_xy(59, radius=1.0)
    # B1
    xb1, yb1 = nail_xy(60, radius=1.0)
    # По разные стороны верхней точки, у самого верха
    assert -0.02 < x60 < 0 < xb1 < 0.02 and y60 < -0.99 and yb1 < -0.99


# Тест: гвозди на одинаковом расстоянии
def test_nails_are_equidistant():
    # Координаты на круге радиуса 100
    pts = [nail_xy(i, radius=100.0) for i in range(TOTAL_NAILS)]
    # Расстояния между соседями (включая D60 → A1)
    dists = [math.dist(pts[i], pts[(i + 1) % TOTAL_NAILS]) for i in range(TOTAL_NAILS)]
    # Все равны
    assert max(dists) - min(dists) < 1e-9


# Тест: расстояние по кругу
def test_nail_gap_is_symmetric_and_circular():
    # A1 и D60 — соседи
    assert nail_gap(0, 239) == 1
    # В обратную сторону так же
    assert nail_gap(239, 0) == 1
    # Противоположные — 120
    assert nail_gap(0, 120) == 120
    # Больше 120 не бывает
    assert max(nail_gap(0, j) for j in range(TOTAL_NAILS)) == 120


# Тест: хорда между противоположными гвоздями = диаметр
def test_chord_between_opposite_nails_equals_diameter():
    # 50 см
    assert chord_length(0, 120, 50) == pytest.approx(50)
    # Другая пара, 70 см
    assert chord_length(45, 165, 70) == pytest.approx(70)


# Тест: короткая хорда почти равна дуге
def test_chord_of_neighbours_is_close_to_arc():
    # Отличие меньше 0,1 %
    assert chord_length(0, 1, 50) == pytest.approx(arc_spacing(50), rel=1e-3)


# Тест: шаг гвоздей для 50 см
def test_arc_spacing_for_50cm():
    # 6,545 мм
    assert arc_spacing(500) == pytest.approx(6.545, abs=1e-3)  # мм
