"""Подготовка фото: обрезка до квадрата, ч/б, контраст, круглая маска."""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# io.BytesIO — читать картинку прямо из байтов в памяти, без временного файла
import io

# numpy — работа с картинкой как с массивом чисел
import numpy as np
# Pillow: открыть картинку, фильтры (резкость), операции (поворот по EXIF, обрезка), ошибка «не картинка»
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

# Допустимые форматы, размер рабочей картинки и гамма из настроек
from .config import ALLOWED_IMAGE_FORMATS, PROCESSING_SIZE, TARGET_GAMMA


# Своя ошибка «плохая картинка» — API превращает её в ответ 400 с понятным текстом
class ImageError(ValueError):
    """Файл не является поддерживаемым изображением."""


# Открываем загруженный файл как картинку и проверяем его
def load_image(data: bytes) -> Image.Image:
    # Пустой файл — сразу ошибка
    if not data:
        # Текст увидит пользователь
        raise ImageError("Пустой файл")
    # Pillow бросает разные исключения на битые файлы — ловим их
    try:
        # Открываем из памяти (Pillow пока только читает заголовок)
        img = Image.open(io.BytesIO(data))
        # Загружаем пиксели целиком — так битый файл выявится здесь, а не позже
        img.load()
    # Не картинка или повреждённый файл
    except (UnidentifiedImageError, OSError) as exc:
        # Переводим в нашу ошибку с понятным текстом; from exc — сохраняем исходную причину для лога
        raise ImageError("Файл не похож на изображение") from exc
    # Формат вне белого списка (например, экзотический ICO)
    if img.format not in ALLOWED_IMAGE_FORMATS:
        # Называем формат, чтобы было понятно, что не так
        raise ImageError(f"Формат {img.format} не поддерживается")
    # Телефоны хранят поворот в EXIF — поворачиваем фото так, как его видит человек
    return ImageOps.exif_transpose(img)


# Старый (простой) путь подготовки: центральный квадрат в оттенках серого
def to_grayscale_square(img: Image.Image, size: int = PROCESSING_SIZE) -> Image.Image:
    """Центральный квадрат → оттенки серого → автоконтраст."""
    # Картинки с прозрачностью (PNG) или палитрой
    if img.mode in ("RGBA", "LA", "P"):
        # Приводим к RGBA, чтобы корректно работать с альфа-каналом
        img = img.convert("RGBA")
        # Белый фон того же размера
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        # Кладём картинку на белый фон — прозрачное станет белым, а не чёрным
        img = Image.alpha_composite(background, img)
    # Переводим в оттенки серого (L — 8 бит яркости)
    gray = img.convert("L")
    # Вырезаем центральный квадрат и уменьшаем до size×size качественным фильтром Ланцоша
    square = ImageOps.fit(gray, (size, size), method=Image.Resampling.LANCZOS)
    # Растягиваем яркость на весь диапазон, отбрасывая 1 % самых тёмных и светлых пикселей
    return ImageOps.autocontrast(square, cutoff=1)


# Маска круга: True внутри круга гвоздей, False снаружи
def circle_mask(size: int) -> np.ndarray:
    # Сетки координат: yy — номер строки, xx — номер столбца каждого пикселя
    yy, xx = np.mgrid[0:size, 0:size]
    # Центр картинки
    c = (size - 1) / 2
    # Пиксель внутри круга, если расстояние до центра не больше радиуса
    return (xx - c) ** 2 + (yy - c) ** 2 <= (size / 2) ** 2


# Карта «темноты» — сколько нити нужно в каждом пикселе
def darkness_map(gray: Image.Image) -> np.ndarray:
    """0 — белое (нить не нужна), 1 — чёрное. Вне круга — 0."""
    # Яркость пикселей в диапазоне 0..1
    arr = np.asarray(gray, dtype=np.float32) / 255.0
    # Темнота = 1 − яркость
    dark = 1.0 - arr
    # За пределами круга нитей нет — обнуляем
    dark[~circle_mask(gray.width)] = 0.0
    # Готовая карта
    return dark


# Цель для алгоритма: чуть более резкая и контрастная версия карты темноты
def target_map(gray: Image.Image, gamma: float = TARGET_GAMMA) -> np.ndarray:
    """Карта, которую «рисует» алгоритм: лёгкая резкость + гамма к темноте.

    Резкость чуть снижает совпадение крупных тонов, но заметно лучше передаёт
    мелкие детали (глаза, губы) — для портрета это важнее.
    """
    # Фильтр «нерезкая маска» подчёркивает контуры (радиус 3 px, сила 120 %)
    sharp = gray.filter(ImageFilter.UnsharpMask(radius=3, percent=120, threshold=2))
    # Возводим темноту в степень гаммы: светлые места становятся ещё светлее
    return darkness_map(sharp) ** gamma


# Серую картинку → PNG-байты (для ответа API)
def gray_png(gray: Image.Image) -> bytes:
    # Буфер в памяти
    buf = io.BytesIO()
    # Сохраняем как PNG с оптимизацией размера
    gray.save(buf, format="PNG", optimize=True)
    # Отдаём байты
    return buf.getvalue()
