# Тестовый фреймворк
import pytest

# Функции расчёта лески
from app.thread import cumulative_lengths_m, pick_spool, raw_length_m, recommended_lines, thread_stats

# Последовательность с известной геометрией
# A1 → C1 (противоположные, хорда = D) → A1 (ещё раз D) → A31 (gap 30 → D·sin(22.5°))
# Тестовая последовательность гвоздей
SEQ = [0, 120, 0, 30]


# Тест: две хорды через центр на 50 см = 1 м
def test_raw_length_known_sequence():
    # Первые 2 шага — два диаметра по 0,5 м
    assert raw_length_m(SEQ, 2, 50) == pytest.approx(1.0)  # 2 × 0.5 м


# Тест: накопленная длина
def test_cumulative_lengths():
    # Считаем
    cum = cumulative_lengths_m(SEQ, 50)
    # Начинается с нуля
    assert cum[0] == 0
    # Только растёт
    assert cum == sorted(cum)
    # Последнее значение = полная длина
    assert cum[-1] == pytest.approx(raw_length_m(SEQ, 3, 50))


# Тест: шаги вне диапазона
def test_steps_out_of_range():
    # Ожидаем ошибку
    with pytest.raises(ValueError):
        # Шагов больше, чем в последовательности
        raw_length_m(SEQ, 4, 50)
    # Ожидаем ошибку
    with pytest.raises(ValueError):
        # Отрицательное число шагов
        raw_length_m(SEQ, -1, 50)


# Тест: запас по умолчанию
def test_margin_is_15_percent_by_default():
    # Сводка для 2 шагов
    stats = thread_stats(SEQ, 2, 50)
    # Запас 15 %
    assert stats.margin == 0.15
    # 1 м × 1,15
    assert stats.total_length_m == pytest.approx(1.15, abs=0.05)


# Тест: длина пропорциональна диаметру
def test_length_scales_with_diameter():
    # На 30 см
    small = thread_stats(SEQ, 3, 30).raw_length_m
    # На 60 см
    big = thread_stats(SEQ, 3, 60).raw_length_m
    # Вдвое больше
    assert big == pytest.approx(2 * small, rel=1e-2)


# Параметризованный тест: один тест — много наборов данных
@pytest.mark.parametrize(
    # Имена параметров
    "length, expected",
    # Наборы: длина → (катушка, количество)
    [
        # Ноль — самая маленькая катушка
        (0, (100, 1)),
        # Чуть меньше 100
        (99.9, (100, 1)),
        # Ровно 100 — граница включается
        (100, (100, 1)),
        # Чуть больше 100 — следующая катушка
        (100.1, (150, 1)),
        # Почти 1000
        (999, (1000, 1)),
        # Обычный портрет
        (1176.7, (1500, 1)),
        # Ровно самая большая
        (5000, (5000, 1)),
        # Больше самой большой — катушки по 1000 м
        (5000.1, (1000, 6)),
        # Много больше
        (12345, (1000, 13)),
    ],
)
# Тест границ подбора катушки
def test_pick_spool_boundaries(length, expected):
    # Ожидаемый результат
    assert pick_spool(length) == expected


# Тест: отрицательная длина
def test_pick_spool_negative():
    # Ожидаем ошибку
    with pytest.raises(ValueError):
        # Вызов
        pick_spool(-1)


# Тест-свойство: катушки хватает всегда
def test_spool_is_never_smaller_than_required():
    # Много длин с шагом 37 м
    for length in range(0, 20000, 37):
        # Подбор
        size, count = pick_spool(length)
        # Общая длина катушек не меньше нужной
        assert size * count >= length


# Ориентир числа линий: 40 на см, в пределах 1000…5000, кратно 100
@pytest.mark.parametrize("d, lines", [(20, 1000), (25, 1000), (30, 1200), (50, 2000), (70, 2800), (125, 5000), (150, 5000)])
# Тест ориентира
def test_recommended_lines(d, lines):
    # Проверка
    assert recommended_lines(d) == lines
