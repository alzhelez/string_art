"""Константы и настройки приложения.

Все «магические числа» собраны здесь, чтобы фронтенд (через /api/config),
PDF и автотесты опирались на один источник правды.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Гвозди -----------------------------------------------------------------
SECTORS: tuple[str, ...] = ("A", "B", "C", "D")
NAILS_PER_SECTOR = 60
TOTAL_NAILS = NAILS_PER_SECTOR * len(SECTORS)  # 240
START_NAIL = 0  # A1 — с него всегда начинается плетение

# --- Алгоритм ---------------------------------------------------------------
PROCESSING_SIZE = 400  # сторона квадрата (px), в котором считается картина
# Параметры подобраны замером на тестовых портретах (корреляция размытого результата
# с исходником при 1500/2000/3000 линиях): было 0,903/0,897/0,828, стало 0,900/0,908/0,879.
# Подробности и что ещё пробовали — docs/ALGORITHM.md.
MIN_NAIL_GAP = 15  # минимальная «дистанция» между гвоздями одной линии (по кругу)
LINE_WEIGHT = 0.12  # сколько «темноты» снимает одна линия лески (0..1)
TARGET_GAMMA = 1.2  # >1 — светлый фон получает меньше линий
FACE_IMPORTANCE = 1.0  # насколько важнее лицо при «Выделить лицо»: 1.0 — вдвое
MAX_LINES = 5000  # алгоритм всегда считает максимум, ползунок берёт префикс

# --- Ограничения ввода ------------------------------------------------------
MIN_LINES = 1000
DIAMETER_PRESETS_CM: tuple[int, ...] = (30, 40, 50, 60, 70)
DEFAULT_DIAMETER_CM = 50.0
MIN_DIAMETER_CM = 20.0
MAX_DIAMETER_CM = 150.0
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "BMP", "GIF", "TIFF", "MPO"}

# --- Леска и катушка --------------------------------------------------------
THREAD_DIAMETER_MM = 0.2  # эталон: чёрная леска 0,2 мм (влияет только на превью)
LINES_PER_CM = 40  # рекомендация: ~40 линий на 1 см диаметра (50 см → 2000)
THREAD_MARGIN = 0.15  # +15 % на обмотку гвоздей, узлы и ошибки
STANDARD_SPOOLS_M: tuple[int, ...] = (100, 150, 200, 300, 500, 1000, 1500, 2000, 3000, 5000)
BIG_SPOOL_M = 1000  # если не хватает самой большой катушки — считаем по 1000 м

# --- Пошаговый режим --------------------------------------------------------
DEFAULT_SPEED_SEC = 2.0
SPEED_STEP_SEC = 0.1
MIN_SPEED_SEC = 0.5
MAX_SPEED_SEC = 10.0

# --- Хранилище --------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
FONTS_DIR = BASE_DIR / "assets" / "fonts"


def app_version() -> str:
    """Версия сборки: файл app/_version.txt пишет сборка .exe (GitHub Actions); иначе — «dev»."""
    try:
        return (BASE_DIR / "_version.txt").read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


def db_path() -> Path:
    """Путь к SQLite. Переопределяется переменной STRINGART_DB (нужно тестам)."""
    default = BASE_DIR.parent / "data" / "string_art.db"
    return Path(os.environ.get("STRINGART_DB", default))
