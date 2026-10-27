"""Метрика сходства и рекомендация числа линий."""

import numpy as np
import pytest
from PIL import Image

from app import photo
from app.algorithm import generate_sequence
from app.image_prep import target_map
from app.similarity import _Scorer, best_point, similarity_curve

from .conftest import FIXTURES


@pytest.fixture(scope="module")
def face_case():
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    faces = photo.detect_faces(img)
    prep = photo.face_prep(img.width, img.height, faces[0]) if faces else photo.Prep()
    gray = photo.prepare_gray(img, prep)
    return gray, generate_sequence(target_map(gray))


def _pattern(size=400):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    return 128 + 60 * np.sin(xx / 9) * np.cos(yy / 13) + 40 * (xx > size / 2)


def test_score_ignores_overall_brightness_and_contrast():
    """Тёмная картина с теми же деталями так же похожа — лески всегда темнее фото."""
    ref = _pattern()
    s = _Scorer(Image.fromarray(ref.clip(0, 255).astype(np.uint8)), 50, 400)
    assert s.score(ref) == pytest.approx(s.score(ref * 0.4 + 10), abs=0.02)
    assert s.score(ref) > 0.95


def test_score_prefers_details():
    ref = _pattern()
    s = _Scorer(Image.fromarray(ref.clip(0, 255).astype(np.uint8)), 50, 400)
    yy, xx = np.mgrid[0:400, 0:400].astype(np.float32)
    no_details = 128 + 40 * (xx > 200)  # общий тон тот же, мелких деталей нет
    noisy = ref + np.random.default_rng(1).normal(0, 60, ref.shape).astype(np.float32)
    assert s.score(ref) > s.score(no_details) + 0.3
    assert s.score(ref) > s.score(noisy) + 0.1


def test_recommendation_counts_details_and_diameter(face_case):
    """Регрессия: раньше для лица на 50 см советовалось ~1800 линий, хотя при 3000+ лицо чётче."""
    gray, seq = face_case
    best = {d: best_point(similarity_curve(seq, gray, d, step=250))[0] for d in (30, 50, 70)}
    assert best[50] >= 2800
    assert best[30] <= best[50] <= best[70]  # на маленьком круге та же леска темнее — линий нужно меньше
