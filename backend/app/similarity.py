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

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Замок для общего кэша кривых (запросы обрабатываются в нескольких потоках)
import threading
# Упорядоченный словарь — удобно выкидывать самые старые записи кэша
from collections import OrderedDict
# Тип «последовательность номеров гвоздей»
from typing import Sequence

# Вычисления над массивами
import numpy as np
# Работа с картинкой-эталоном
from PIL import Image

# Алгоритм (для автонастройки) и пиксели линий (для быстрого рендера)
from .algorithm import generate_sequence, line_pixels
# Пределы числа линий и размер рабочей картинки
from .config import MAX_LINES, MIN_LINES, PROCESSING_SIZE
# Маска круга и целевая карта темноты
from .image_prep import circle_mask, target_map
# Непрозрачность одной нити — та же, что в превью
from .render import line_alpha

# Два масштаба размытия для «деталей»: 1,5 мм и 3 мм — как видит глаз с разных расстояний
DETAIL_SCALES_MM = (1.5, 3.0)  # размытие «глазом» для деталей
# Размер окна, внутри которого считаем местную яркость и контраст
LOCAL_WINDOW_MM = 8.0  # окно местной яркости/контраста
# Размытие для сравнения общего тона
TONE_BLUR_MM = 3.0
# Доля тона в итоговой оценке (детали — главное)
TONE_WEIGHT = 0.1
# Кривую сходства считаем через каждые 100 линий
CURVE_STEP = 100


# Гауссово размытие картинки (sigma — в пикселях)
def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    # OpenCV импортируем здесь, а не вверху файла — так сервер стартует быстрее
    import cv2

    # (0, 0) — размер ядра OpenCV подберёт по sigma; sigma не меньше 0,3, чтобы не было нуля
    return cv2.GaussianBlur(a.astype(np.float32), (0, 0), max(0.3, sigma))


# «Карта деталей»: убираем общую яркость и контраст, оставляем только черты
def _local_normalize(a: np.ndarray, sigma: float) -> np.ndarray:
    """Вычесть местную среднюю и поделить на местный контраст — остаются только детали."""
    # Местная средняя яркость вокруг каждой точки
    mean = _blur(a, sigma)
    # Местная дисперсия (насколько точки отличаются от средней рядом)
    var = _blur((a - mean) ** 2, sigma)
    # Отклонение от средней, делённое на местный контраст; +25 — чтобы не делить на ноль на ровном фоне
    return (a - mean) / np.sqrt(var + 25.0)


# Подготовка к корреляции: вычесть среднее и посчитать «длину» вектора
def _centered(a: np.ndarray) -> tuple[np.ndarray, float]:
    # Вычитаем среднее значение
    a = a - a.mean()
    # Возвращаем центрированный массив и его норму (или 1, если массив постоянный, — защита от деления на 0)
    return a, float(np.sqrt((a * a).sum())) or 1.0


# Оценщик сходства: эталон (фото) готовится один раз, а рендеров оценивается много
class _Scorer:
    """Готовит эталон один раз и оценивает много рендеров (кривая — десятки точек)."""

    # Готовим всё, что зависит только от фото
    def __init__(self, reference: Image.Image, diameter_cm: float, size: int) -> None:
        # Эталон в оттенках серого
        ref_img = reference.convert("L")
        # Если размер не совпадает с рабочим
        if ref_img.size != (size, size):
            # Приводим к нужному размеру качественным фильтром
            ref_img = ref_img.resize((size, size), Image.Resampling.LANCZOS)
        # Эталон как массив чисел
        ref = np.asarray(ref_img, np.float32)
        # Сколько миллиметров доски в одном пикселе (нужно, чтобы размытия были в мм)
        self.px = diameter_cm * 10 / size  # мм на пиксель
        # Сравниваем только внутри круга
        self.mask = circle_mask(size)
        # Окно местной нормализации в пикселях
        self.window = LOCAL_WINDOW_MM / self.px
        # Карты деталей эталона для каждого масштаба размытия
        self.details = [
            # Размыли → нормализовали → взяли пиксели круга → центрировали
            _centered(_local_normalize(_blur(ref, mm / self.px), self.window)[self.mask]) for mm in DETAIL_SCALES_MM
        ]
        # Карта тона эталона: просто размытое фото внутри круга
        self.tone = _centered(_blur(ref, TONE_BLUR_MM / self.px)[self.mask])

    # Метод не использует self — делаем его статическим
    @staticmethod
    # Корреляция Пирсона между рендером и подготовленным эталоном
    def _corr(a: np.ndarray, ref: tuple[np.ndarray, float]) -> float:
        # Центрируем рендер
        a, norm = _centered(a)
        # Скалярное произведение, делённое на произведение норм: от −1 до 1
        return float((a * ref[0]).sum() / (norm * ref[1]))

    # Итоговая оценка одного рендера
    def score(self, render: np.ndarray) -> float:
        # Среднее сходство деталей по двум масштабам
        detail = np.mean(
            # Список корреляций
            [
                # Рендер готовим так же, как эталон, и сравниваем
                self._corr(_local_normalize(_blur(render, mm / self.px), self.window)[self.mask], ref)
                # Для каждого масштаба и соответствующей карты эталона
                for mm, ref in zip(DETAIL_SCALES_MM, self.details)
            ]
        )
        # Сходство общего тона
        tone = self._corr(_blur(render, TONE_BLUR_MM / self.px)[self.mask], self.tone)
        # Взвешенное среднее: детали с весом 1, тон с весом 0,1
        return float((detail + TONE_WEIGHT * tone) / (1 + TONE_WEIGHT))


# Кривая «число линий → сходство»
def similarity_curve(
    # Последовательность гвоздей
    sequence: Sequence[int],
    # Эталон — подготовленное фото
    reference: Image.Image,
    # Диаметр доски (влияет на толщину нити на картинке)
    diameter_cm: float,
    # С какого числа линий начинать
    start: int = MIN_LINES,
    # До какого (по умолчанию — до максимума)
    stop: int | None = None,
    # Шаг кривой
    step: int = CURVE_STEP,
    # Размер рабочей картинки
    size: int = PROCESSING_SIZE,
# Возвращает список пар (число линий, сходство)
) -> list[tuple[int, float]]:
    """[(число линий, сходство), …] от start до stop с шагом step."""
    # Конец кривой не дальше длины последовательности
    stop = min(stop or MAX_LINES, len(sequence) - 1)
    # Последовательность короче начала кривой — считать нечего
    if stop < start:
        # Сообщаем об ошибке
        raise ValueError("Последовательность короче минимального числа линий")
    # Готовим эталон
    scorer = _Scorer(reference, diameter_cm, size)
    # Логарифм доли света, которую пропускает одна нить (так k нитей = умножение на k)
    log_keep = np.log1p(-line_alpha(size, diameter_cm))  # ln(1 − α): каждая линия умножает яркость
    # Сколько нитей прошло через каждый пиксель (копим постепенно)
    counts = np.zeros(size * size, dtype=np.float32)
    # Точки кривой
    out: list[tuple[int, float]] = []
    # Сколько линий уже добавлено в counts
    done = 0
    # Идём по точкам кривой: 1000, 1100, …
    for n in range(start, stop + 1, step):
        # Нужно добавить линии с done до n
        if n > done:
            # Пиксели новых линий одним массивом
            px = np.concatenate([line_pixels(sequence[i], sequence[i + 1], size) for i in range(done, n)])
            # Прибавляем к счётчикам
            counts += np.bincount(px, minlength=size * size).astype(np.float32)
            # Теперь учтено n линий
            done = n
        # Картинка: яркость 255 × (1 − α)^k через экспоненту логарифма (быстрее степени)
        render = (255.0 * np.exp(counts * log_keep)).reshape(size, size)
        # Сохраняем точку кривой с округлением до 4 знаков
        out.append((n, round(scorer.score(render), 4)))
    # Готовая кривая
    return out


# Лучшая точка кривой
def best_point(curve: list[tuple[int, float]]) -> tuple[int, float]:
    """Максимум сходства; при равенстве — меньше линий (меньше работы и лески)."""
    # Сравниваем по сходству, а при равенстве выигрывает меньшее число линий (поэтому минус)
    return max(curve, key=lambda p: (p[1], -p[0]))


# --- кэш кривых для проектов ---------------------------------------------------
# Кэш готовых кривых: ключ — (проект, версия расчёта, диаметр)
_cache: OrderedDict[tuple, dict] = OrderedDict()
# Замок для кэша
_lock = threading.Lock()


# Кривая сходства для проекта с кэшированием (считается ~1 с, а запрашивается часто)
def project_similarity(project_id: str, version: str, sequence: Sequence[int], reference_png: bytes, diameter_cm: float) -> dict:
    # io нужен только тут — для чтения PNG из байтов
    import io

    # Ключ кэша; диаметр округляем, чтобы 50.0 и 50.04 считались одинаковыми
    key = (project_id, version, round(diameter_cm, 1))
    # Проверяем кэш под замком
    with _lock:
        # Уже считали
        if key in _cache:
            # Отмечаем запись как недавно использованную
            _cache.move_to_end(key)
            # Отдаём из кэша
            return _cache[key]
    # Считаем кривую (без замка — пусть другие запросы не ждут)
    curve = similarity_curve(sequence, Image.open(io.BytesIO(reference_png)), diameter_cm)
    # Находим максимум
    best_n, best_s = best_point(curve)
    # Ответ для API
    result = {
        # Диаметр, для которого считали
        "diameter_cm": round(diameter_cm, 1),
        # Рекомендуемое число линий
        "best_lines": best_n,
        # Сходство в этой точке
        "best_score": best_s,
        # Вся кривая для графика
        "curve": [{"lines": n, "score": s} for n, s in curve],
    }
    # Сохраняем в кэш под замком
    with _lock:
        # Новая запись
        _cache[key] = result
        # Держим не больше 64 записей
        while len(_cache) > 64:
            # Выкидываем самую старую
            _cache.popitem(last=False)
    # Отдаём результат
    return result


# --- автонастройка тона ----------------------------------------------------------
# Какие значения контраста пробуем
AUTO_CONTRASTS = (-0.3, -0.15, 0.0, 0.25)
# Какие значения яркости пробуем (0 уже входит в перебор контраста)
AUTO_BRIGHTNESS = (-0.12, 0.12)
# Для оценки считаем полную последовательность — лучшее число линий бывает большим
AUTO_LINES = MAX_LINES  # лучшее число линий теперь часто 3000–4500


# Оценка одного варианта яркости/контраста: строим картину и берём максимум сходства
def _score_tone(gray: Image.Image, reference: Image.Image, diameter_cm: float, importance) -> tuple[int, float]:
    # Строим последовательность для этого варианта подготовки
    seq = generate_sequence(target_map(gray), max_lines=AUTO_LINES, importance=importance)
    # Кривая с шагом 250 (грубее — быстрее) и её максимум
    return best_point(similarity_curve(seq, reference, diameter_cm, start=MIN_LINES, stop=AUTO_LINES, step=250))


# Автонастройка: подбираем яркость и контраст, при которых картина больше всего похожа на фото
def auto_tone(prepare, diameter_cm: float, importance=None) -> dict:
    """Подбор яркости и контраста, при которых нитяная картина больше всего похожа на фото.

    prepare(brightness, contrast) → подготовленное серое изображение.
    Эталон — то же фото без коррекций. Перебор в два этапа: сначала контраст,
    потом яркость при лучшем контрасте (6 расчётов вместо 12).
    """
    # Эталон — фото без коррекций
    reference = prepare(0.0, 0.0)
    # Уже посчитанные варианты: (яркость, контраст) → (линии, сходство)
    tried: dict[tuple[float, float], tuple[int, float]] = {}

    # Оценить вариант, если его ещё не считали
    def score(b: float, c: float) -> tuple[int, float]:
        # Новый вариант
        if (b, c) not in tried:
            # Считаем и запоминаем
            tried[(b, c)] = _score_tone(prepare(b, c), reference, diameter_cm, importance)
        # Результат из памяти
        return tried[(b, c)]

    # Этап 1: перебираем контраст при нулевой яркости
    for c in AUTO_CONTRASTS:
        # Оцениваем вариант
        score(0.0, c)
    # Лучший контраст
    best_c = max(AUTO_CONTRASTS, key=lambda c: tried[(0.0, c)][1])
    # Этап 2: перебираем яркость при лучшем контрасте
    for b in AUTO_BRIGHTNESS:
        # Оцениваем вариант
        score(b, best_c)
    # Лучший из всех испробованных
    (b, c), (lines, s) = max(tried.items(), key=lambda kv: kv[1][1])
    # Что было без коррекций — для сравнения «до/после»
    before_lines, before = tried[(0.0, 0.0)]
    # Ответ для API
    return {
        # Подобранная яркость
        "brightness": b,
        # Подобранный контраст
        "contrast": c,
        # Сходство без коррекций
        "score_before": before,
        # Сходство после
        "score_after": s,
        # Лучшее число линий без коррекций
        "lines_before": before_lines,
        # Лучшее число линий после
        "best_lines": lines,
        # Сколько вариантов перебрали (6)
        "candidates": len(tried),
    }
