"""Цветные портреты: какие нити взять и сколько каждой нужно в каждой точке.

Три режима:
    * mono  — одна чёрная нить на белой доске (как раньше);
    * bw    — белая нить (блики) и чёрная (тени) на серой или цветной доске;
    * color — 2–4 цветные нити на белой доске, цвета подбираются под фото.

Модель смешивания такая же, как у превью: каждая нить закрывает часть пикселя.
Цвет точки ≈ доска · (1 − Σaₖ) + Σ aₖ · нитьₖ, где aₖ ≥ 0 — «сколько нити k нужно»,
и Σaₖ ≤ 1. Для каждой точки ищем aₖ, при которых цвет ближе всего к фото
(метод проекции градиента — тысячи точек считаются разом матрицами numpy).
Карта aₖ дальше работает как карта темноты для обычного алгоритма: каждая нить
плетётся отдельным слоем со своей последовательностью гвоздей.
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Неизменяемые структуры для каталога нитей
from dataclasses import dataclass

# Массивы пикселей
import numpy as np
# Картинки
from PIL import Image


# Режимы портрета: одна чёрная нить, чёрная + белая, несколько цветных
MODES: tuple[str, ...] = ("mono", "bw", "color")
# Сколько цветов можно выбрать в цветном режиме
MIN_COLORS = 2
# Больше четырёх слоёв — слишком долго плести и считать
MAX_COLORS = 4
# В режимах из нескольких слоёв у слоя может быть совсем мало линий (маленькое красное пятно)
LAYER_MIN_LINES = 100
# Шаг кривой сходства для слоёв: грубее, чем у одной нити, — иначе 4 слоя считаются минуту
LAYER_CURVE_STEP = 200


# Неизменяемая запись каталога
@dataclass(frozen=True)
# Нить или цвет доски: ключ для API, название по-русски, цвет в HEX
class Swatch:
    # Ключ латиницей — его передают в API
    key: str
    # Название для людей
    name: str
    # Цвет в формате #rrggbb
    hex: str

    # Цвет как три числа 0..1
    @property
    # Свойство rgb
    def rgb(self) -> np.ndarray:
        # Переводим HEX в массив
        return hex_to_rgb(self.hex)


# Каталог нитей: цвета, которые легко купить (леска, мулине, швейные нитки)
THREADS: tuple[Swatch, ...] = (
    # Основная нить для теней и деталей
    Swatch("black", "Чёрная", "#1b1b1b"),
    # Блики в режиме «чёрная + белая»
    Swatch("white", "Белая", "#f5f5f0"),
    # Тёмно-серая — мягкие тени
    Swatch("gray", "Серая", "#7a7a7a"),
    # Тёплые цвета кожи и губ
    Swatch("red", "Красная", "#c0262d"),
    # Телесная — светлая кожа
    Swatch("beige", "Бежевая", "#d9b48f"),
    # Волосы, загар, дерево
    Swatch("brown", "Коричневая", "#6b4226"),
    # Яркие акценты
    Swatch("orange", "Оранжевая", "#e3742a"),
    # Светлые волосы, солнце
    Swatch("yellow", "Жёлтая", "#f0c419"),
    # Одежда, небо
    Swatch("blue", "Синяя", "#2457a6"),
    # Тёмная одежда, глубокие тени
    Swatch("navy", "Тёмно-синяя", "#1f2b4d"),
    # Листва, глаза
    Swatch("green", "Зелёная", "#2f7d3a"),
    # Румянец
    Swatch("pink", "Розовая", "#e48aa8"),
    # Акценты в одежде
    Swatch("purple", "Фиолетовая", "#6a3d8f"),
)

# Цвета доски (или подложки), на которой плетут
BOARDS: tuple[Swatch, ...] = (
    # Обычная белая доска — для одной нити и цветного режима
    Swatch("white", "Белая", "#ffffff"),
    # Средне-серая — лучший фон для «чёрная + белая»
    Swatch("gray", "Серая", "#9a9a9a"),
    # Тёмно-серая — контрастнее белая нить
    Swatch("graphite", "Графитовая", "#5c5c5c"),
    # Тёплый фон под дерево или крафт
    Swatch("beige", "Бежевая", "#d6c4a3"),
    # Тёмно-синяя — эффектно с белой нитью
    Swatch("navy", "Тёмно-синяя", "#2b3a55"),
)

# Быстрый поиск нити по ключу
THREAD_BY_KEY = {t.key: t for t in THREADS}
# Быстрый поиск доски по ключу
BOARD_BY_KEY = {b.key: b for b in BOARDS}
# Доска по умолчанию для каждого режима
DEFAULT_BOARD = {"mono": "white", "bw": "gray", "color": "white"}
# Сколько цветов по умолчанию в цветном режиме
DEFAULT_COLORS = 3


# Перевод «#rrggbb» в три числа 0..1
def hex_to_rgb(value: str) -> np.ndarray:
    # Убираем решётку
    value = value.lstrip("#")
    # Каждые два символа — один канал
    return np.array([int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


# Яркость цвета 0..1 (те же коэффициенты, что у перевода фото в серое)
def luminance(rgb: np.ndarray) -> float:
    # Взвешенная сумма каналов
    return float(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])


# Порядок плетения: сначала светлые нити, тёмные — последними, поверх (так тени остаются чёткими)
def weave_order(keys: list[str]) -> list[str]:
    # Сортируем по убыванию яркости нити
    return sorted(keys, key=lambda k: -luminance(THREAD_BY_KEY[k].rgb))


# Проекция строк матрицы на множество {a ≥ 0, Σa ≤ 1} (каждая строка — одна точка)
def _project(a: np.ndarray) -> np.ndarray:
    # Отрицательной «нити» не бывает
    a = np.maximum(a, 0.0)
    # Точки, где нитей «больше 100 %» — их нужно спроецировать на симплекс Σa = 1
    over = a.sum(axis=1) > 1.0
    # Если таких нет — готово
    if not over.any():
        # Отдаём без изменений
        return a
    # Строки, требующие проекции
    v = a[over]
    # Сортируем каждую строку по убыванию (стандартный алгоритм проекции на симплекс)
    u = -np.sort(-v, axis=1)
    # Накопленные суммы минус 1
    css = np.cumsum(u, axis=1) - 1.0
    # Номера 1..K для каждой позиции
    ind = np.arange(1, v.shape[1] + 1, dtype=np.float32)
    # Где элемент ещё больше «средней поправки»
    cond = u - css / ind > 0
    # Сколько элементов остаются положительными
    rho = cond.sum(axis=1)
    # Поправка θ для каждой строки
    theta = css[np.arange(len(v)), rho - 1] / rho
    # Вычитаем поправку и обрезаем снизу нулём
    a[over] = np.maximum(v - theta[:, None], 0.0)
    # Готовые доли
    return a


# Сколько каждой нити нужно в каждой точке: target H×W×3 (0..1) → K×H×W
def coverage(target: np.ndarray, board: np.ndarray, threads: list[np.ndarray], iters: int = 200) -> np.ndarray:
    # Размеры картинки
    h, w, _ = target.shape
    # Матрица «насколько нить сдвигает цвет от доски»: 3×K
    d = np.stack([t - board for t in threads], axis=1).astype(np.float32)
    # Цель — разница между фото и доской, по точкам: N×3
    y = (target.reshape(-1, 3) - board).astype(np.float32)
    # Dᵀ·D — K×K, нужна для градиента
    dtd = d.T @ d
    # Dᵀ·y для каждой точки — N×K
    dty = y @ d
    # Шаг градиента 1/L, где L — наибольшее собственное число DᵀD (гарантирует сходимость)
    step = 1.0 / max(float(np.linalg.eigvalsh(dtd).max()), 1e-6)
    # Начинаем с «нитей нет»
    a = np.zeros((h * w, len(threads)), dtype=np.float32)
    # Итерации проекции градиента
    for _ in range(iters):
        # Шаг против градиента ошибки ‖D·a − y‖² и возврат в допустимую область
        a = _project(a - step * (a @ dtd - dty))
    # Переставляем оси: K×H×W
    return a.T.reshape(len(threads), h, w)


# Ошибка восстановления фото набором нитей (меньше — лучше)
def _error(target: np.ndarray, board: np.ndarray, threads: list[np.ndarray]) -> float:
    # Доли нитей
    a = coverage(target, board, threads, iters=80)
    # Восстановленный цвет: доска + Σ aₖ·(нитьₖ − доска)
    restored = board + np.tensordot(a, np.stack([t - board for t in threads]), axes=([0], [0]))
    # Средний квадрат отличия от фото
    return float(((restored - target) ** 2).mean())


# Автоподбор цветов: начинаем с чёрной и добавляем ту нить, что сильнее всего уменьшает ошибку
def choose_palette(target: np.ndarray, board: np.ndarray, count: int, required: tuple[str, ...] = ("black",)) -> list[str]:
    # Уменьшенная копия фото 64×64 — подбор в десятки раз быстрее, а цвета те же
    small = np.asarray(
        # Переводим в картинку 0..255
        Image.fromarray(np.clip(target * 255, 0, 255).astype(np.uint8)).resize((64, 64), Image.Resampling.BOX),
        # Тип для расчёта
        np.float32,
        # 0..255 → 0..1
    ) / 255.0
    # Обязательные нити (чёрная — для деталей)
    chosen = list(required)
    # Кандидаты: все нити каталога, кроме уже выбранных и белой (на белой доске она не видна)
    candidates = [t.key for t in THREADS if t.key not in chosen and t.key != "white"]
    # Пока не набрали нужное число цветов —
    while len(chosen) < count and candidates:
        # — для каждого кандидата считаем ошибку с ним
        scored = [(_error(small, board, [THREAD_BY_KEY[k].rgb for k in chosen + [c]]), c) for c in candidates]
        # — берём лучшего
        best = min(scored)[1]
        # — добавляем в палитру
        chosen.append(best)
        # — и убираем из кандидатов
        candidates.remove(best)
    # Палитра в порядке плетения
    return weave_order(chosen)


# Нити и доска для режима: ключи нитей в порядке плетения и ключ доски
def resolve_palette(mode: str, colors: list[str] | None, board: str | None, target: np.ndarray | None, count: int) -> tuple[list[str], str]:
    # Неизвестный режим — ошибка
    if mode not in MODES:
        # Понятный текст
        raise ValueError(f"Неизвестный режим: {mode}")
    # Доска: указанная или по умолчанию для режима
    board_key = board or DEFAULT_BOARD[mode]
    # Неизвестная доска — ошибка
    if board_key not in BOARD_BY_KEY:
        # Понятный текст
        raise ValueError(f"Неизвестный цвет доски: {board_key}")
    # Одна нить — всегда чёрная (как в первой версии)
    if mode == "mono":
        # Один слой
        return ["black"], board_key
    # Чёрная и белая: сначала белая (блики), потом чёрная (тени)
    if mode == "bw":
        # Два слоя
        return ["white", "black"], board_key
    # Цветной режим с цветами, выбранными вручную
    if colors:
        # Без повторов, порядок не важен
        keys = list(dict.fromkeys(colors))
        # Неизвестные ключи —
        unknown = [k for k in keys if k not in THREAD_BY_KEY]
        # — ошибка
        if unknown:
            # Понятный текст
            raise ValueError(f"Неизвестные цвета нити: {', '.join(unknown)}")
        # Количество в допустимых пределах
        if not MIN_COLORS <= len(keys) <= MAX_COLORS:
            # Понятный текст
            raise ValueError(f"Выберите от {MIN_COLORS} до {MAX_COLORS} цветов")
        # В порядке плетения
        return weave_order(keys), board_key
    # Без фото подобрать цвета нельзя
    if target is None:
        # Ошибка программиста, а не пользователя
        raise ValueError("Для автоподбора цветов нужно фото")
    # Автоподбор под фото
    return choose_palette(target, BOARD_BY_KEY[board_key].rgb, count), board_key


# Карта «сколько этой нити нужно» → серое изображение (белое — нить не нужна), как у одной нити
def layer_gray(cov: np.ndarray) -> Image.Image:
    # 0 нити → 255 (белое), полная доля → 0 (чёрное)
    return Image.fromarray(np.clip(np.rint(255.0 * (1.0 - cov)), 0, 255).astype(np.uint8), mode="L")


# Серые «карты слоёв» для цветного фото: по одной на каждую нить
def layer_maps(target: np.ndarray, board_key: str, thread_keys: list[str]) -> list[Image.Image]:
    # Цвет доски
    board = BOARD_BY_KEY[board_key].rgb
    # Доли нитей
    cov = coverage(target, board, [THREAD_BY_KEY[k].rgb for k in thread_keys])
    # Каждую долю — в серую карту
    return [layer_gray(c) for c in cov]


# Описание палитры для API и интерфейса
def catalog() -> dict:
    # Нити, доски, режимы и ограничения
    return {
        # Режимы
        "modes": list(MODES),
        # Нити каталога
        "threads": [{"key": t.key, "name": t.name, "hex": t.hex} for t in THREADS],
        # Цвета доски
        "boards": [{"key": b.key, "name": b.name, "hex": b.hex} for b in BOARDS],
        # Доска по умолчанию для режимов
        "default_board": dict(DEFAULT_BOARD),
        # Число цветов в цветном режиме
        "colors": {"min": MIN_COLORS, "max": MAX_COLORS, "default": DEFAULT_COLORS},
        # Наименьшее число линий слоя
        "layer_min_lines": LAYER_MIN_LINES,
    }
