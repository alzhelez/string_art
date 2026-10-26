"""Насколько картина из нитей похожа на фото.

Метрика: корреляция яркости «как видит глаз» — и результат, и фото размываются на
3 мм (так картину видно с пары метров), затем считается коэффициент корреляции
внутри круга. 1,0 — тона совпадают идеально, 0 — ничего общего.

Почему есть максимум: при малом числе линий не хватает тёмных мест, при большом —
вся картина уходит в серое. Где именно максимум, зависит и от фото, и от диаметра:
та же леска на маленьком круге закрывает больше площади.
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

VIEW_BLUR_MM = 3.0
CURVE_STEP = 100


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    import cv2

    return cv2.GaussianBlur(a.astype(np.float32), (0, 0), max(0.3, sigma))


def similarity_curve(
    sequence: Sequence[int],
    reference: Image.Image,
    diameter_cm: float,
    start: int = MIN_LINES,
    stop: int | None = None,
    step: int = CURVE_STEP,
    size: int = PROCESSING_SIZE,
) -> list[tuple[int, float]]:
    """[(число линий, сходство 0..1), …] от start до stop с шагом step."""
    stop = min(stop or MAX_LINES, len(sequence) - 1)
    if stop < start:
        raise ValueError("Последовательность короче минимального числа линий")
    ref_img = reference.convert("L")
    if ref_img.size != (size, size):
        ref_img = ref_img.resize((size, size), Image.Resampling.LANCZOS)
    sigma = VIEW_BLUR_MM / (diameter_cm * 10 / size)
    mask = circle_mask(size)
    ref = _blur(np.asarray(ref_img, np.float32), sigma)[mask]
    ref = ref - ref.mean()
    ref_norm = float(np.sqrt((ref * ref).sum())) or 1.0
    log_keep = np.log1p(-line_alpha(size, diameter_cm))  # ln(1 − α): каждая линия умножает яркость
    counts = np.zeros(size * size, dtype=np.float32)
    checkpoints = list(range(start, stop + 1, step))
    out: list[tuple[int, float]] = []
    done = 0
    for n in checkpoints:
        if n > done:
            px = np.concatenate([line_pixels(sequence[i], sequence[i + 1], size) for i in range(done, n)])
            counts += np.bincount(px, minlength=size * size).astype(np.float32)
            done = n
        render = (255.0 * np.exp(counts * log_keep)).reshape(size, size)
        r = _blur(render, sigma)[mask]
        r = r - r.mean()
        r_norm = float(np.sqrt((r * r).sum()))
        score = float((r * ref).sum() / (r_norm * ref_norm)) if r_norm > 0 else 0.0
        out.append((n, round(score, 4)))
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
AUTO_LINES = 3000


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
