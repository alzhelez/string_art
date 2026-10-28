"""Метрика сходства и рекомендация числа линий."""

# Массивы для тестовых «картинок»
import numpy as np
# Тестовый фреймворк
import pytest
# Работа с картинками
from PIL import Image

# Подготовка фото
from app import photo
# Алгоритм
from app.algorithm import generate_sequence
# Целевая карта темноты
from app.image_prep import target_map
# Оценщик сходства, лучшая точка и кривая
from app.similarity import _Scorer, best_point, similarity_curve

# Папка с фикстурами
from .conftest import FIXTURES


# Фикстура на весь модуль — расчёт долгий, делаем один раз
@pytest.fixture(scope="module")
# Настоящее фото: подготовленное и его последовательность
def face_case():
    # Открываем фото астронавта
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    # Ищем лицо
    faces = photo.detect_faces(img)
    # Кадр по лицу (если лицо нашлось)
    prep = photo.face_prep(img.width, img.height, faces[0]) if faces else photo.Prep()
    # Подготовленное серое фото
    gray = photo.prepare_gray(img, prep)
    # Фото и последовательность из 5000 линий
    return gray, generate_sequence(target_map(gray))


# Синтетический узор с деталями
def _pattern(size=400):
    # Сетки координат
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    # Волны (детали) + разный тон слева и справа
    return 128 + 60 * np.sin(xx / 9) * np.cos(yy / 13) + 40 * (xx > size / 2)


# Тест: оценка не зависит от общей яркости и контраста
def test_score_ignores_overall_brightness_and_contrast():
    """Тёмная картина с теми же деталями так же похожа — лески всегда темнее фото."""
    # Эталон
    ref = _pattern()
    # Оценщик для эталона
    s = _Scorer(Image.fromarray(ref.clip(0, 255).astype(np.uint8)), 50, 400)
    # Та же картинка, но темнее и бледнее — оценка почти та же
    assert s.score(ref) == pytest.approx(s.score(ref * 0.4 + 10), abs=0.02)
    # Сама с собой — почти 1
    assert s.score(ref) > 0.95


# Тест: детали важнее общего тона
def test_score_prefers_details():
    # Эталон
    ref = _pattern()
    # Оценщик
    s = _Scorer(Image.fromarray(ref.clip(0, 255).astype(np.uint8)), 50, 400)
    # Сетки координат
    yy, xx = np.mgrid[0:400, 0:400].astype(np.float32)
    # Тот же тон без деталей
    no_details = 128 + 40 * (xx > 200)  # общий тон тот же, мелких деталей нет
    # Детали, испорченные сильным шумом
    noisy = ref + np.random.default_rng(1).normal(0, 60, ref.shape).astype(np.float32)
    # Без деталей — заметно хуже
    assert s.score(ref) > s.score(no_details) + 0.3
    # С шумом — тоже хуже
    assert s.score(ref) > s.score(noisy) + 0.1


# Регрессия: рекомендация для портрета
def test_recommendation_counts_details_and_diameter(face_case):
    """Регрессия: раньше для лица на 50 см советовалось ~1800 линий, хотя при 3000+ лицо чётче."""
    # Фото и последовательность
    gray, seq = face_case
    # Лучшее число линий для 30, 50 и 70 см (шаг кривой 250 — быстрее)
    best = {d: best_point(similarity_curve(seq, gray, d, step=250))[0] for d in (30, 50, 70)}
    # На 50 см — не меньше 2800 (раньше ошибочно было ~1800)
    assert best[50] >= 2800
    # Чем больше круг, тем больше линий нужно
    assert best[30] <= best[50] <= best[70]  # на маленьком круге та же леска темнее — линий нужно меньше
