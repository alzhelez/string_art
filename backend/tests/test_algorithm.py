# Массивы
import numpy as np
# Тестовый фреймворк
import pytest

# Что проверяем: кэш линий, алгоритм, пиксели линии
from app.algorithm import build_line_cache, generate_sequence, line_pixels
# Константы
from app.config import MIN_NAIL_GAP, PROCESSING_SIZE, TOTAL_NAILS
# Расстояние между гвоздями
from app.geometry import nail_gap
# Маска круга
from app.image_prep import circle_mask


# Фикстура на весь модуль
@pytest.fixture(scope="module")
# Простая «картинка»: где темно — понятно заранее
def left_dark() -> np.ndarray:
    """Левая половина круга чёрная, правая белая."""
    # Размер рабочей картинки
    size = PROCESSING_SIZE
    # Всё белое
    dark = np.zeros((size, size), dtype=np.float32)
    # Левая половина — чёрная
    dark[:, : size // 2] = 1.0
    # Вне круга — ноль
    dark[~circle_mask(size)] = 0
    # Готово
    return dark


# Фикстура на модуль — расчёт один раз
@pytest.fixture(scope="module")
# Последовательность для этой картинки
def seq(left_dark) -> list[int]:
    # 800 линий — быстро и достаточно
    return generate_sequence(left_dark, max_lines=800)


# Тест: длина и старт
def test_length_and_start(seq):
    # 800 линий → 801 гвоздь
    assert len(seq) == 801
    # Начало — A1
    assert seq[0] == 0  # A1


# Тест: все номера — существующие гвозди
def test_values_are_valid_nails(seq):
    # 0…239
    assert all(0 <= n < TOTAL_NAILS for n in seq)


# Тест: соседние гвозди одной нити не слишком близко
def test_min_gap_respected(seq):
    # Каждая пара подряд
    assert all(nail_gap(a, b) >= MIN_NAIL_GAP for a, b in zip(seq, seq[1:]))


# Тест: одна и та же нить не тянется дважды
def test_no_line_used_twice(seq):
    # Пары без учёта направления
    pairs = [tuple(sorted(p)) for p in zip(seq, seq[1:])]
    # Повторов нет
    assert len(pairs) == len(set(pairs))


# Тест: детерминированность — тот же вход, тот же результат
def test_is_deterministic(left_dark, seq):
    # Пересчёт совпадает
    assert generate_sequence(left_dark, max_lines=800) == seq


# Тест: 300 линий — ровно первые 300 шагов из 800
def test_fewer_lines_is_prefix_of_more_lines(left_dark, seq):
    """На этом держится мгновенный ползунок количества линий."""
    # Префикс
    assert generate_sequence(left_dark, max_lines=300) == seq[:301]


# Тест: нити идут туда, где темно
def test_lines_follow_dark_area(seq):
    # Координаты гвоздей
    from app.geometry import nail_xy

    # Сколько нитей посередине левее центра
    left = 0
    # Каждая нить
    for a, b in zip(seq, seq[1:]):
        # X-координаты концов
        (xa, _), (xb, _) = nail_xy(a, 1.0), nail_xy(b, 1.0)
        # Середина нити левее центра — +1
        left += (xa + xb) / 2 < 0
    # Больше 70 % нитей — в тёмной половине
    assert left / (len(seq) - 1) > 0.7


# Тест: на белой картинке алгоритм не ломается
def test_blank_image_still_produces_valid_sequence():
    # Пустая карта
    blank = np.zeros((PROCESSING_SIZE, PROCESSING_SIZE), dtype=np.float32)
    # 50 линий
    out = generate_sequence(blank, max_lines=50)
    # Длина правильная
    assert len(out) == 51


# Тест: неквадратная картинка — ошибка
def test_rejects_non_square():
    # Ожидаем ValueError
    with pytest.raises(ValueError):
        # 10 × 20
        generate_sequence(np.zeros((10, 20)), max_lines=5)


# Тест: 0 линий — ошибка
def test_rejects_zero_lines(left_dark):
    # Ожидаем ValueError
    with pytest.raises(ValueError):
        # Вызов
        generate_sequence(left_dark, max_lines=0)


# Тест: пиксели линии
def test_line_pixels_in_bounds_and_without_repeats():
    # Маленькая картинка
    size = 200
    # Линия A1 → C1 (через центр)
    px = line_pixels(0, 120, size)
    # Все индексы внутри картинки
    assert px.min() >= 0 and px.max() < size * size
    # Без повторов подряд
    assert np.all(px[1:] != px[:-1])
    # вертикальная линия через центр: длина ~ диаметр
    # Длина около диаметра
    assert size - 5 <= len(px) <= size + 1


# Тест: кэш линий строится один раз (тот же объект)
def test_line_cache_is_built_once():
    # Два вызова — один объект
    assert build_line_cache() is build_line_cache()
