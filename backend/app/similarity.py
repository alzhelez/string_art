"""Насколько картина из нитей похожа на фото — по ней выбирается рекомендуемое число линий.

Картина «рендерится» так, как её видно вживую: каждая леска 0,2 мм закрывает долю
пикселя (на маленьком круге — большую), перекрытия складываются как полупрозрачные слои.

Сходство состоит из двух частей:

* **Детали (основной вес).** Рисунок и фото слегка размываются (1,5 и 3 мм — с какого
  расстояния картину рассматривают), затем в каждой точке вычитается местная средняя
  яркость и делится на местный контраст (окно ~8 мм). Остаются черты лица, контуры,
  складки — то, по чему узнают человека. Корреляция этих «карт деталей» и есть оценка.
  От общей яркости она не зависит: тёмная картина с чёткими глазами считается похожей.
* **Тон (малый вес 0,1).** Обычная корреляция яркостей при размытии 3 мм — чтобы
  не советовать столько линий, что картина уходит в сплошную черноту.

Первая версия смотрела только на тон и недооценивала детали: на большом круге
рекомендация была ~1800–2200 линий, хотя при 3000–4000 лицо заметно чётче.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Sequence

import numpy as np
from PIL import Image

from .algorithm import generate_sequence, line_pixels
from .config import MAX_LINES, MIN_LINES, PROCESSING_SIZE
from .image_prep import circle_mask, target_map
from .render import line_alpha

DETAIL_SCALES_MM = (1.5, 3.0)  # размытие «глазом» для деталей
LOCAL_WINDOW_MM = 8.0  # окно местной яркости/контраста
TONE_BLUR_MM = 3.0
TONE_WEIGHT = 0.1
CURVE_STEP = 100


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    import cv2

    return cv2.GaussianBlur(a.astype(np.float32), (0, 0), max(0.3, sigma))


def _local_normalize(a: np.ndarray, sigma: float) -> np.ndarray:
    """Вычесть местную среднюю и поделить на местный контраст — остаются только детали."""
    mean = _blur(a, sigma)
    var = _blur((a - mean) ** 2, sigma)
    return (a - mean) / np.sqrt(var + 25.0)


def _centered(a: np.ndarray) -> tuple[np.ndarray, float]:
    a = a - a.mean()
    return a, float(np.sqrt((a * a).sum())) or 1.0


class _Scorer:
    """Готовит эталон один раз и оценивает много рендеров (кривая — десятки точек)."""

    def __init__(self, reference: Image.Image, diameter_cm: float, size: int) -> None:
        ref_img = reference.convert("L")
        if ref_img.size != (size, size):
            ref_img = ref_img.resize((size, size), Image.Resampling.LANCZOS)
        ref = np.asarray(ref_img, np.float32)
        self.px = diameter_cm * 10 / size  # мм на пиксель
        self.mask = circle_mask(size)
        self.window = LOCAL_WINDOW_MM / self.px
        self.details = [
            _centered(_local_normalize(_blur(ref, mm / self.px), self.window)[self.mask]) for mm in DETAIL_SCALES_MM
        ]
        self.tone = _centered(_blur(ref, TONE_BLUR_MM / self.px)[self.mask])

    @staticmethod
    def _corr(a: np.ndarray, ref: tuple[np.ndarray, float]) -> float:
        a, norm = _centered(a)
        return float((a * ref[0]).sum() / (norm * ref[1]))

    def score(self, render: np.ndarray) -> float:
        detail = np.mean(
            [
                self._corr(_local_normalize(_blur(render, mm / self.px), self.window)[self.mask], ref)
                for mm, ref in zip(DETAIL_SCALES_MM, self.details)
            ]
        )
        tone = self._corr(_blur(render, TONE_BLUR_MM / self.px)[self.mask], self.tone)
        return float((detail + TONE_WEIGHT * tone) / (1 + TONE_WEIGHT))


def similarity_curve(
    sequence: Sequence[int],
    reference: Image.Image,
    diameter_cm: float,
    start: int = MIN_LINES,
    stop: int | None = None,
    step: int = CURVE_STEP,
    size: int = PROCESSING_SIZE,
) -> list[tuple[int, float]]:
    """[(число линий, сходство), …] от start до stop с шагом step."""
    stop = min(stop or MAX_LINES, len(sequence) - 1)
    if stop < start:
        raise ValueError("Последовательность короче минимального числа линий")
    scorer = _Scorer(reference, diameter_cm, size)
    log_keep = np.log1p(-line_alpha(size, diameter_cm))  # ln(1 − α): каждая линия умножает яркость
    counts = np.zeros(size * size, dtype=np.float32)
    out: list[tuple[int, float]] = []
    done = 0
    for n in range(start, stop + 1, step):
        if n > done:
            px = np.concatenate([line_pixels(sequence[i], sequence[i + 1], size) for i in range(done, n)])
            counts += np.bincount(px, minlength=size * size).astype(np.float32)
            done = n
        render = (255.0 * np.exp(counts * log_keep)).reshape(size, size)
        out.append((n, round(scorer.score(render), 4)))
    return out


def best_point(curve: list[tuple[int, float]]) -> tuple[int, float]:
    """Максимум сходства; при равенстве — меньше линий (меньше работы и лески)."""
    return max(curve, key=lambda p: (p[1], -p[0]))


# --- кэш кривых для проектов ---------------------------------------------------
_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = threading.Lock()


def project_similarity(project_id: str, version: str, sequence: Sequence[int], reference_png: bytes, diameter_cm: float) -> dict:
    import io

    key = (project_id, version, round(diameter_cm, 1))
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    curve = similarity_curve(sequence, Image.open(io.BytesIO(reference_png)), diameter_cm)
    best_n, best_s = best_point(curve)
    result = {
        "diameter_cm": round(diameter_cm, 1),
        "best_lines": best_n,
        "best_score": best_s,
        "curve": [{"lines": n, "score": s} for n, s in curve],
    }
    with _lock:
        _cache[key] = result
        while len(_cache) > 64:
            _cache.popitem(last=False)
    return result


# --- автонастройка тона ----------------------------------------------------------
AUTO_CONTRASTS = (-0.3, -0.15, 0.0, 0.25)
AUTO_BRIGHTNESS = (-0.12, 0.12)
AUTO_LINES = MAX_LINES  # лучшее число линий теперь часто 3000–4500


def _score_tone(gray: Image.Image, reference: Image.Image, diameter_cm: float, importance) -> tuple[int, float]:
    seq = generate_sequence(target_map(gray), max_lines=AUTO_LINES, importance=importance)
    return best_point(similarity_curve(seq, reference, diameter_cm, start=MIN_LINES, stop=AUTO_LINES, step=250))


def auto_tone(prepare, diameter_cm: float, importance=None) -> dict:
    """Подбор яркости и контраста, при которых нитяная картина больше всего похожа на фото.

    prepare(brightness, contrast) → подготовленное серое изображение.
    Эталон — то же фото без коррекций. Перебор в два этапа: сначала контраст,
    потом яркость при лучшем контрасте (6 расчётов вместо 12).
    """
    reference = prepare(0.0, 0.0)
    tried: dict[tuple[float, float], tuple[int, float]] = {}

    def score(b: float, c: float) -> tuple[int, float]:
        if (b, c) not in tried:
            tried[(b, c)] = _score_tone(prepare(b, c), reference, diameter_cm, importance)
        return tried[(b, c)]

    for c in AUTO_CONTRASTS:
        score(0.0, c)
    best_c = max(AUTO_CONTRASTS, key=lambda c: tried[(0.0, c)][1])
    for b in AUTO_BRIGHTNESS:
        score(b, best_c)
    (b, c), (lines, s) = max(tried.items(), key=lambda kv: kv[1][1])
    before_lines, before = tried[(0.0, 0.0)]
    return {
        "brightness": b,
        "contrast": c,
        "score_before": before,
        "score_after": s,
        "lines_before": before_lines,
        "best_lines": lines,
        "candidates": len(tried),
    }
