"""HTTP API (FastAPI). Запуск: uvicorn app.main:app --reload --port 8000"""

# Современная запись типов (str | None) в любой версии Python 3
from __future__ import annotations

# Чтение картинок из байтов
import io
# JSON файла проекта
import json
# Переменные окружения (адрес фронтенда, папка статики)
import os
# Регулярные выражения: проверка id, имя файла без расширения
import re
# Пути к файлам статики
from pathlib import Path
# Декоратор для функции «что делать при старте и остановке сервера»
from contextlib import asynccontextmanager
# Текущая дата — для названия «Портрет от 27.10.2026»
from datetime import datetime
# Annotated — тип с дополнительными правилами проверки; Any — любой тип
from typing import Annotated, Any, Literal
# Кодирование русского имени файла в заголовке скачивания
from urllib.parse import quote

# FastAPI: приложение, загрузка файла, поле формы, HTTP-ошибка, параметр адреса, запрос, ответ, загруженный файл
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
# Готовые ответы: файл с диска, HTML-страница, перенаправление
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
# Разрешение запросов с другого адреса (фронтенд на порту 3000 обращается к API на 8000)
from fastapi.middleware.cors import CORSMiddleware
# Массивы (эталон цветного портрета)
import numpy as np
# Работа с картинками
from PIL import Image
# Pydantic — описание и автоматическая проверка входных/выходных данных
from pydantic import BaseModel, ConfigDict, Field, ValidationError

# Наши модули: настройки, слои цветных портретов, палитра, подготовка фото, база данных
from . import config, layers as color_layers, palette, photo, storage, transfer, updater
# Алгоритм и предрасчёт линий
from .algorithm import build_line_cache, generate_sequence
# Шаг гвоздей по дуге и метки гвоздей
from .geometry import arc_spacing, nail_label
# Загрузка картинки, её ошибка, PNG из серой картинки, карта темноты
from .image_prep import ImageError, gray_png, load_image, target_map
# PDF-инструкция: одна нить и цветной портрет
from .pdf import build_instructions_pdf, build_layers_pdf
# Шаблон разметки 1:1
from .template import build_template_pdf
# Превью картины: одна нить и несколько цветных
from .render import render_layers_png, render_png
# Сходство с фото и автонастройка
from .similarity import auto_tone, best_point, project_similarity, similarity_curve
# Расчёт лески
from .thread import cumulative_lengths_m, recommended_lines, thread_stats


# Превращаем функцию в «жизненный цикл» приложения: код до yield — при старте, после — при остановке
@asynccontextmanager
# Что делаем при запуске сервера
async def lifespan(_: FastAPI):
    # Заранее считаем пиксели всех линий
    build_line_cache()  # первый проект не будет ждать предрасчёт линий
    # Убираем фото, брошенные в редакторе больше суток назад
    storage.delete_orphan_images()
    # Начинаем загрузку модели удаления фона
    photo.engine.warm_up()  # модель удаления фона грузится в фоне, сервер стартует сразу
    # Сервер работает (после yield — действия при остановке, у нас их нет)
    yield


# Создаём приложение FastAPI (заголовок и версия видны в документации /docs)
app = FastAPI(title="String Art Studio API", version="1.1.0", lifespan=lifespan)
# Подключаем CORS — разрешаем браузеру обращаться к API со страниц фронтенда
app.add_middleware(
    # Посредник CORS
    CORSMiddleware,
    # Адреса, с которых разрешены запросы
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    # Любые HTTP-методы
    allow_methods=["*"],
    # Любые заголовки
    allow_headers=["*"],
)

# Формат id проекта/фото: ровно 12 шестнадцатеричных символов
_ID_RE = re.compile(r"[0-9a-f]{12}")


# --- Схемы ------------------------------------------------------------------
# Настройки подготовки фото, приходящие от клиента
class PrepIn(BaseModel):
    """Подготовка фото. Все поля необязательны — по умолчанию центр, без зума и коррекций."""

    # Лишние поля запрещены — опечатка в имени поля даст ошибку 422, а не будет тихо проигнорирована
    model_config = ConfigDict(extra="forbid")

    # Центр кадра по горизонтали, 0…1
    center_x: float = Field(0.5, ge=0, le=1, description="Центр кадра, доля ширины фото")
    # Центр кадра по вертикали, 0…1
    center_y: float = Field(0.5, ge=0, le=1, description="Центр кадра, доля высоты фото")
    # Масштаб 1…4
    zoom: float = Field(1.0, ge=1, le=4, description="1 — кадр по короткой стороне фото, 4 — в 4 раза ближе")
    # Яркость −0,5…0,5
    brightness: float = Field(0.0, ge=-0.5, le=0.5)
    # Контраст −0,5…1
    contrast: float = Field(0.0, ge=-0.5, le=1.0)
    # Убрать фон
    remove_background: bool = False
    # Выделить лицо
    face_focus: bool = Field(False, description="Детальнее прорабатывать найденное лицо")

    # Перевести в внутреннюю структуру photo.Prep
    def to_prep(self) -> photo.Prep:
        # Все поля → именованные аргументы Prep
        return photo.Prep(**self.model_dump())


# Прямоугольник лица в ответе
class FaceOut(BaseModel):
    # Левый край (доля ширины)
    x: float
    # Верхний край (доля высоты)
    y: float
    # Ширина
    w: float
    # Высота
    h: float


# Информация о загруженном фото
class ImageOut(BaseModel):
    # id фото
    id: str
    # Ширина в пикселях
    width: int
    # Высота
    height: int
    # Найденные лица
    faces: list[FaceOut] = Field(description="Найденные лица, крупные первыми; координаты в долях фото")
    # Есть ли готовая маска фона
    has_mask: bool = False
    # Готовый кадр по лицу (для кнопки «Выделить лицо»)
    face_prep: PrepIn | None = Field(None, description="Готовый кадр «голова и плечи» по самому крупному лицу")


# Расчёт лески в ответе (повторяет thread.ThreadStats)
class ThreadStatsOut(BaseModel):
    # Число линий
    steps: int
    # Диаметр
    diameter_cm: float
    # Длина без запаса
    raw_length_m: float
    # Запас
    margin: float
    # Длина с запасом
    total_length_m: float
    # Катушка
    spool_m: int
    # Сколько катушек
    spool_count: int
    # Шаг гвоздей
    nail_spacing_mm: float


# Время плетения за один день
class ActivityDay(BaseModel):
    # Дата ГГГГ-ММ-ДД
    date: str
    # Секунд
    sec: float
    # Шагов
    steps: int


# Журнал плетения целиком
class ActivityOut(BaseModel):
    # Всего секунд
    total_sec: float
    # Всего шагов
    total_steps: int
    # По дням
    days: list[ActivityDay] = Field(description="По дням, последние 60, по возрастанию даты")


# Цвет из каталога: нить или доска
class SwatchOut(BaseModel):
    # Ключ латиницей
    key: str
    # Название по-русски
    name: str
    # Цвет #rrggbb
    hex: str


# Слой портрета — одна нить своего цвета (у портрета из одной нити — один слой)
class LayerSummary(BaseModel):
    # Номер слоя по порядку плетения, с 0
    index: int
    # Ключ цвета нити
    color: str
    # Название цвета
    name: str
    # Цвет #rrggbb
    hex: str
    # Число линий этого слоя
    line_count: int
    # Текущий шаг плетения этого слоя
    current_step: int
    # Расчёт лески этого цвета
    stats: ThreadStatsOut


# Слой целиком — с последовательностью гвоздей
class LayerDetail(LayerSummary):
    # Гвозди по порядку, первый — A1
    sequence: list[int]


# Проект в списке (без длинной последовательности)
class ProjectSummary(BaseModel):
    # id
    id: str
    # Название
    name: str
    # Когда создан
    created_at: str
    # Когда изменён
    updated_at: str
    # Диаметр
    diameter_cm: float
    # Выбранное число линий
    line_count: int
    # Текущий шаг плетения
    current_step: int
    # Скорость автоперелистывания
    speed_sec: float
    # Исходное фото
    image_id: str | None = Field(None, description="Фото, из которого сделан портрет (для правки кадра)")
    # Настройки кадра
    prep: dict[str, Any] = Field(default_factory=dict, description="Параметры подготовки фото")
    # Своя катушка
    own_spool_m: float | None = Field(None, description="Длина своей катушки, м (если указана)")
    # Журнал времени
    activity: ActivityOut = Field(description="Сколько времени и шагов плели, по дням")
    # Расчёт лески
    stats: ThreadStatsOut
    # Режим: одна нить, чёрная + белая, цветные
    mode: str = Field("mono", description="mono — одна чёрная нить, bw — чёрная и белая, color — цветные")
    # Цвет доски
    board: SwatchOut
    # Какой слой сейчас плетут
    current_layer: int = 0
    # Слои по порядку плетения (первый повторяет line_count/current_step/stats)
    layers: list[LayerSummary]


# Проект целиком — всё из списка плюс последовательность гвоздей
class ProjectDetail(ProjectSummary):
    # Последовательность гвоздей
    sequence: list[int] = Field(description="Гвозди по порядку, длина = max_lines + 1, первый — A1")
    # Слои с последовательностями
    layers: list[LayerDetail]


# Что можно изменить в проекте (PATCH); каждое поле необязательно
class ProjectUpdate(BaseModel):
    # Лишние поля запрещены
    model_config = ConfigDict(extra="forbid")

    # Название 1…100 символов
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # Диаметр 20…150 см
    diameter_cm: float | None = Field(default=None, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    # Число линий: 1000…5000 для одной нити, 100…5000 для слоя цветного портрета (проверяется ниже)
    line_count: int | None = Field(default=None, ge=palette.LAYER_MIN_LINES, le=config.MAX_LINES)
    # Текущий шаг 1…5000 (дополнительно проверяется по числу линий)
    current_step: int | None = Field(default=None, ge=1, le=config.MAX_LINES)
    # Скорость 0,5…10 с
    speed_sec: float | None = Field(default=None, ge=config.MIN_SPEED_SEC, le=config.MAX_SPEED_SEC)
    # Своя катушка 10…100 000 м
    own_spool_m: float | None = Field(
        # null явно — сбросить
        default=None, ge=10, le=100_000, description="Длина своей катушки, м; null — сбросить (взять стандартную)"
    )
    # К какому слою относятся line_count и current_step (по умолчанию — к первому)
    layer: int | None = Field(default=None, ge=0, le=palette.MAX_COLORS - 1, description="Номер слоя для line_count/current_step")
    # Какой слой сейчас плетут
    current_layer: int | None = Field(default=None, ge=0, le=palette.MAX_COLORS - 1)


# Отметка времени плетения от клиента
class ActivityIn(BaseModel):
    # Лишние поля запрещены
    model_config = ConfigDict(extra="forbid")

    # Дата у человека (его часовой пояс)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$", description="Местная дата у человека, ГГГГ-ММ-ДД")
    # Секунды с прошлой отметки (не больше 10 минут — защита от мусора)
    seconds: float = Field(ge=0, le=600, description="Сколько секунд плели с прошлой отметки")
    # Шаги с прошлой отметки
    steps: int = Field(ge=0, le=10_000, description="Сколько шагов прошли за это время")


# Точка кривой сходства
class SimilarityPoint(BaseModel):
    # Число линий
    lines: int
    # Сходство
    score: float


# Кривая сходства целиком
class SimilarityOut(BaseModel):
    # Для какого диаметра
    diameter_cm: float
    # Рекомендация
    best_lines: int = Field(description="Число линий с максимальным сходством с фото")
    # Сходство в рекомендуемой точке
    best_score: float = Field(description="Сходство 0..1 (корреляция тонов при взгляде с ~2 м)")
    # Все точки
    curve: list[SimilarityPoint]


# Запрос автонастройки
class AutoToneIn(BaseModel):
    # Лишние поля запрещены
    model_config = ConfigDict(extra="forbid")

    # Текущий кадр и флаги (яркость/контраст будут подобраны)
    prep: PrepIn = Field(default_factory=PrepIn)
    # Диаметр доски
    diameter_cm: float = Field(config.DEFAULT_DIAMETER_CM, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)


# Результат автонастройки
class AutoToneOut(BaseModel):
    # Подобранная яркость
    brightness: float
    # Подобранный контраст
    contrast: float
    # Сходство до
    score_before: float
    # Сходство после
    score_after: float
    # Лучшее число линий до
    lines_before: int
    # Лучшее число линий после
    best_lines: int
    # Сколько вариантов перебрано
    candidates: int


# Создание портрета из фото редактора
class CreateFromImage(BaseModel):
    # Лишние поля запрещены
    model_config = ConfigDict(extra="forbid")

    # id загруженного фото
    image_id: str
    # Название (необязательно)
    name: str | None = Field(None, max_length=100)
    # Диаметр
    diameter_cm: float = Field(config.DEFAULT_DIAMETER_CM, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    # Настройки кадра
    prep: PrepIn = Field(default_factory=PrepIn)
    # Режим портрета
    mode: Literal["mono", "bw", "color"] = "mono"
    # Цвета нити для цветного режима (пусто — подобрать под фото)
    colors: list[str] | None = Field(None, max_length=palette.MAX_COLORS, description="Ключи нитей; пусто — подобрать")
    # Сколько цветов подобрать
    color_count: int = Field(palette.DEFAULT_COLORS, ge=palette.MIN_COLORS, le=palette.MAX_COLORS)
    # Цвет доски (пусто — по умолчанию для режима)
    board: str | None = None


# Новый кадр готового портрета; режим и цвета можно поменять (null — оставить как было)
class PhotoIn(PrepIn):
    # Режим портрета
    mode: Literal["mono", "bw", "color"] | None = None
    # Цвета нити
    colors: list[str] | None = Field(None, max_length=palette.MAX_COLORS)
    # Сколько цветов подобрать
    color_count: int | None = Field(None, ge=palette.MIN_COLORS, le=palette.MAX_COLORS)
    # Цвет доски
    board: str | None = None

    # Только настройки кадра — без режима и цветов
    def to_prep(self) -> photo.Prep:
        # Поля кадра из общей части
        return photo.Prep(**self.model_dump(include=set(PrepIn.model_fields)))


# Один шаг плетения
class Step(BaseModel):
    # Номер шага с 1
    number: int
    # Откуда (номер гвоздя)
    from_nail: int
    # Куда
    to_nail: int
    # Откуда (метка «A12»)
    from_label: str
    # Куда (метка)
    to_label: str
    # Израсходовано лески к концу шага
    thread_used_m: float = Field(description="Сколько лески (без запаса) уйдёт к концу этого шага")


# Страница шагов (шаги отдаются порциями)
class StepsPage(BaseModel):
    # Всего шагов
    total: int
    # С какого шага (с 0)
    offset: int
    # Сколько запрошено
    limit: int
    # Сами шаги
    items: list[Step]


# --- Хелперы ----------------------------------------------------------------
# Журнал из базы → ответ API
def _activity(log: dict[str, list]) -> dict[str, Any]:
    # Дни по порядку дат: {"date", "sec", "steps"}
    days = [{"date": d, "sec": v[0], "steps": v[1]} for d, v in sorted(log.items())]
    # Ответ
    return {
        # Сумма секунд
        "total_sec": round(sum(d["sec"] for d in days), 1),
        # Сумма шагов
        "total_steps": sum(d["steps"] for d in days),
        # Последние 60 дней (для графика)
        "days": days[-60:],
    }


# Цвет каталога → ответ API
def _swatch(item: palette.Swatch) -> dict[str, str]:
    # Ключ, название, HEX
    return {"key": item.key, "name": item.name, "hex": item.hex}


# Слои проекта: у портрета из одной нити — один чёрный слой из основных полей
def _layers_of(p: dict[str, Any]) -> list[dict[str, Any]]:
    # Сохранённые слои (у цветных портретов)
    if p.get("layers"):
        # Как есть
        return p["layers"]
    # Одна чёрная нить
    return [{"color": "black", "sequence": p["sequence"], "line_count": p["line_count"], "current_step": p["current_step"]}]


# Проект из базы → краткий ответ (без последовательности)
def _summary(p: dict[str, Any]) -> dict[str, Any]:
    # Расчёт лески для текущих настроек
    stats = thread_stats(p["sequence"], p["line_count"], p["diameter_cm"]).to_dict()
    # Все поля, кроме длинных последовательностей
    out = {k: v for k, v in p.items() if k not in ("sequence", "layers")}
    # Добавляем расчёт лески
    out["stats"] = stats
    # И журнал в формате API
    out["activity"] = _activity(p.get("activity") or {})
    # Режим (у старых проектов в базе его нет — значит одна нить)
    out["mode"] = p.get("mode") or "mono"
    # Цвет доски
    out["board"] = _swatch(palette.BOARD_BY_KEY.get(p.get("board") or "white", palette.BOARD_BY_KEY["white"]))
    # Слои без последовательностей, но с расчётом лески каждого цвета
    out["layers"] = [
        # Один слой
        {
            # Номер
            "index": i,
            # Ключ цвета
            "color": layer["color"],
            # Название цвета
            "name": palette.THREAD_BY_KEY[layer["color"]].name,
            # HEX
            "hex": palette.THREAD_BY_KEY[layer["color"]].hex,
            # Число линий
            "line_count": layer["line_count"],
            # Текущий шаг
            "current_step": layer["current_step"],
            # Леска этого цвета
            "stats": thread_stats(layer["sequence"], layer["line_count"], p["diameter_cm"]).to_dict(),
        }
        # Для каждого слоя
        for i, layer in enumerate(_layers_of(p))
    ]
    # Готово
    return out


# Проект из базы → полный ответ
def _detail(p: dict[str, Any]) -> dict[str, Any]:
    # Краткая часть
    out = _summary(p)
    # Плюс последовательность
    out["sequence"] = p["sequence"]
    # И последовательности слоёв
    for layer, full in zip(out["layers"], _layers_of(p)):
        # Гвозди слоя
        layer["sequence"] = full["sequence"]
    # Готово
    return out


# Найти проект или ответить 404
def _get_or_404(project_id: str) -> dict[str, Any]:
    # Кривой id не ищем в базе вовсе
    if not _ID_RE.fullmatch(project_id):
        # 404 с понятным текстом
        raise HTTPException(404, "Проект не найден")
    # Ищем в базе
    project = storage.get_project(project_id)
    # Нет такого
    if project is None:
        # 404
        raise HTTPException(404, "Проект не найден")
    # Нашли
    return project


# Название по умолчанию: имя файла без расширения или «Портрет от <дата>»
def _default_name(filename: str | None) -> str:
    # Убираем расширение (.jpg, .jpeg, .png …)
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", (filename or "").strip())
    # Не длиннее 100 символов; если пусто — с датой
    return stem[:100] or f"Портрет от {datetime.now():%d.%m.%Y}"


# Найти фото или ответить 404
def _image_or_404(image_id: str, *, with_blobs: bool = False) -> dict[str, Any]:
    # Кривой id → сразу None, иначе ищем в базе
    image = storage.get_image(image_id, with_blobs=with_blobs) if _ID_RE.fullmatch(image_id) else None
    # Не нашли
    if image is None:
        # 404
        raise HTTPException(404, "Фото не найдено")
    # Нашли
    return image


# Прочитать загруженный файл как картинку с проверками
def _read_upload(file: UploadFile) -> Image.Image:
    # Читаем на 1 байт больше лимита — так узнаем, что файл слишком большой, не читая его целиком
    data = file.file.read(config.MAX_UPLOAD_BYTES + 1)
    # Больше 15 МБ
    if len(data) > config.MAX_UPLOAD_BYTES:
        # 413 «слишком большой»
        raise HTTPException(413, "Файл слишком большой (максимум 15 МБ)")
    # Картинка может оказаться битой
    try:
        # Открываем, проверяем и приводим к единому виду
        return photo.normalize_original(load_image(data))
    # Не картинка
    except ImageError as exc:
        # 400 с текстом причины
        raise HTTPException(400, str(exc)) from exc


# Сохранить оригинал фото и найденные лица
def _store_image(original: Image.Image) -> dict[str, Any]:
    # Ищем лица и превращаем в словари
    faces = [f.__dict__ for f in photo.detect_faces(original)]
    # Записываем в базу
    return storage.create_image(
        # Размеры, оригинал в JPEG, лица
        width=original.width, height=original.height, original=photo.jpeg_bytes(original), faces=faces
    )


# Фото из базы → ответ API
def _image_out(image: dict[str, Any]) -> dict[str, Any]:
    # Основные поля
    out = {k: image[k] for k in ("id", "width", "height", "faces")}
    # Есть ли маска (в краткой выборке — has_mask, в полной — сама маска)
    out["has_mask"] = bool(image.get("has_mask") or image.get("mask"))
    # Если нашлись лица
    if image["faces"]:
        # Самое крупное лицо
        face = photo.Box(**image["faces"][0])
        # Готовый кадр по нему
        out["face_prep"] = photo.face_prep(image["width"], image["height"], face).to_dict()
    # Готово
    return out


# Подсказка, если модуль удаления фона не установлен
_NOT_INSTALLED = (
    # Первая часть текста
    "Удаление фона не установлено. В папке backend выполните: pip install -r requirements-bg.txt "
    # Вторая часть (строки склеиваются)
    "и перезапустите бэкенд (scripts\\start.bat делает это сам)."
)


# Задача для фоновой очереди: посчитать маску фона
def _compute_mask(image_id: str) -> None:
    """Задача для очереди: посчитать маску и сохранить в БД."""
    # Фото с байтами
    image = storage.get_image(image_id, with_blobs=True)
    # Фото удалено или маска уже есть
    if image is None or image.get("mask"):
        # Делать нечего
        return
    # Лица — чтобы не потерять при чистке маски части человека у лица
    faces = [photo.Box(**f) for f in image["faces"]]
    # Считаем маску
    mask = photo.background_mask(Image.open(io.BytesIO(image["original"])), faces)
    # Сохраняем как автоматическую
    storage.save_mask(image_id, photo.png_bytes(mask))


# Статус маски + прогресс скачивания модели
def _mask_status(image: dict[str, Any]) -> dict[str, Any]:
    # Основной статус
    status = _mask_status_raw(image)
    # Прогресс скачивания модели (если качается)
    status["progress"] = photo.engine.progress
    # Готово
    return status


# Статус маски для фото
def _mask_status_raw(image: dict[str, Any]) -> dict[str, Any]:
    # Маска уже есть
    if image.get("mask") or image.get("has_mask"):
        # Готова
        return {
            # Статус
            "status": "ready",
            # Состояние модели
            "model": photo.engine.state,
            # Ошибки нет
            "message": None,
            # Поправлена ли кистью
            "edited": image.get("mask_source") == "edited",
        }
    # Модуля нет
    if not photo.background_removal_available():
        # 503 «сервис недоступен» с подсказкой, как установить
        raise HTTPException(503, _NOT_INSTALLED)
    # Задача в очереди для этого фото
    job = photo.engine.job(image["id"])
    # Не запускали
    if job is None:
        # Ожидает запуска
        return {"status": "idle", "model": photo.engine.state, "message": None}
    # Считается
    if not job.done():
        # В процессе
        return {"status": "processing", "model": photo.engine.state, "message": None}
    # Задача закончилась — была ли ошибка
    exc = job.exception()
    # Была
    if exc is not None:
        # Ошибка с текстом
        return {"status": "error", "model": photo.engine.state, "message": str(exc)}
    # Закончилась успешно (маска уже в базе)
    return {"status": "ready", "model": photo.engine.state, "message": None}


# Маска для расчёта портрета: из базы или посчитать и дождаться
def _mask_for(image: dict[str, Any]) -> Image.Image:
    """Маска фона для расчёта портрета: из БД или считаем (ждём очередь)."""
    # Маски ещё нет
    if not image.get("mask"):
        # И модуль не установлен
        if not photo.background_removal_available():
            # 503 с подсказкой
            raise HTTPException(503, _NOT_INSTALLED)
        # Расчёт может упасть
        try:
            # Ставим задачу и ждём результата (.result() блокирует до конца)
            photo.engine.submit(image["id"], lambda: _compute_mask(image["id"])).result()
        # Любая ошибка
        except Exception as exc:  # noqa: BLE001
            # 500 с причиной
            raise HTTPException(500, f"Не удалось убрать фон: {exc}") from exc
        # Перечитываем фото из базы — там теперь есть маска
        fresh = storage.get_image(image["id"], with_blobs=True)
        # Фото никуда не делось
        assert fresh is not None
        # Подставляем маску
        image["mask"] = fresh["mask"]
    # Открываем маску как картинку
    return Image.open(io.BytesIO(image["mask"]))


# Подготовить фото по настройкам
def _prepare(image: dict[str, Any], prep: photo.Prep) -> Image.Image:
    # Оригинал
    original = Image.open(io.BytesIO(image["original"]))
    # Маска — только если включено «Убрать фон»
    mask = _mask_for(image) if prep.remove_background else None
    # Конвейер подготовки
    return photo.prepare_gray(original, prep, mask)


# Карта важности лица для «Выделить лицо» (или None)
def _importance(image: dict[str, Any], prep: photo.Prep):
    # «Выделить лицо» без найденного лица — ошибка пользователя
    if prep.face_focus and not image["faces"]:
        # 422 с подсказкой
        raise HTTPException(422, "На фото не найдено лицо — снимите галочку «Выделить лицо»")
    # Галочка не стоит —
    if not prep.face_focus:
        # — карты нет
        return None
    # Самое крупное лицо
    face = photo.Box(**image["faces"][0])
    # Карта важности с эллипсом на лице
    return photo.face_importance(image["width"], image["height"], prep, face)


# Цветная картинка 0..1 → PNG-байты (эталон цветного портрета)
def _rgb_png(rgb) -> bytes:
    # Буфер в памяти
    buf = io.BytesIO()
    # Картинка RGB из массива и сохранение
    Image.fromarray((rgb * 255.0 + 0.5).clip(0, 255).astype("uint8"), mode="RGB").save(buf, format="PNG", optimize=True)
    # Байты
    return buf.getvalue()


# Подготовка + расчёт: одна нить или несколько цветных слоёв
def _generate(
    # Фото, настройки кадра, режим, цвета, сколько цветов подобрать, доска, диаметр
    image: dict[str, Any], prep: photo.Prep, mode: str, colors: list[str] | None, color_count: int, board: str | None, diameter_cm: float
# Словарь: sequence, line_count, source_png, mode, board, layers
) -> dict[str, Any]:
    """Подготовка фото + расчёт последовательности гвоздей и рекомендуемого числа линий."""
    # Карта важности лица
    importance = _importance(image, prep)
    # Одна чёрная нить — как в первой версии
    if mode == "mono":
        # Подготовленное фото
        gray = _prepare(image, prep)
        # Последовательность гвоздей
        sequence = generate_sequence(target_map(gray), importance=importance)
        # Результат без слоёв
        return {
            # Гвозди
            "sequence": sequence,
            # Рекомендуемое число линий
            "line_count": _best_lines(sequence, gray, diameter_cm),
            # Подготовленное фото — эталон сходства
            "source_png": gray_png(gray),
            # Режим
            "mode": "mono",
            # Доска всегда белая
            "board": "white",
            # Слоёв нет
            "layers": [],
        }
    # Ключ доски: указанный или по умолчанию для режима
    board_key = board or palette.DEFAULT_BOARD[mode]
    # Неизвестная доска —
    if board_key not in palette.BOARD_BY_KEY:
        # — понятная ошибка
        raise HTTPException(422, f"Неизвестный цвет доски: {board_key}")
    # Оригинал
    original = Image.open(io.BytesIO(image["original"]))
    # Маска — только если включено «Убрать фон»
    mask = _mask_for(image) if prep.remove_background else None
    # Цветное фото того же кадра, фон — цвет доски
    target = photo.prepare_color(original, prep, mask, board=palette.BOARD_BY_KEY[board_key].rgb)
    # Нити: заданные или подобранные под фото
    try:
        # Палитра
        keys, board_key = palette.resolve_palette(mode, colors, board_key, target, color_count)
    # Неверные цвета —
    except ValueError as exc:
        # — 422 с текстом
        raise HTTPException(422, str(exc)) from exc
    # Слои: последовательности и рекомендуемые числа линий
    built = color_layers.build_layers(target, board_key, keys, importance, diameter_cm)
    # Первый слой повторяется в основных полях проекта
    return {
        # Гвозди первого слоя
        "sequence": built[0]["sequence"],
        # Его число линий
        "line_count": built[0]["line_count"],
        # Цветное подготовленное фото — эталон сходства и картинка «до»
        "source_png": _rgb_png(target),
        # Режим
        "mode": mode,
        # Доска
        "board": board_key,
        # Все слои
        "layers": built,
    }


# --- Маршруты ---------------------------------------------------------------
# Адрес фронтенда для перенаправления с корня API
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")


# Папка собранного фронтенда (только в программе для Windows)
def static_dir() -> Path | None:
    """Папка с собранным фронтендом (десктопная версия): бэкенд сам раздаёт приложение."""
    # Путь из переменной окружения
    path = os.environ.get("STRINGART_STATIC_DIR")
    # Папка годится, только если в ней есть index.html
    return Path(path) if path and (Path(path) / "index.html").is_file() else None


# Корень сайта; HEAD тоже — его используют проверки доступности
@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
# Что открывается по адресу http://localhost:8000/
def root() -> Response:
    """Это API, а не сайт: открывший http://localhost:8000 в браузере попадёт на приложение."""
    # Программа для Windows?
    web = static_dir()
    # Да — отдаём главную страницу приложения
    if web:
        # no-cache — после обновления программы браузер не покажет старую страницу
        return FileResponse(web / "index.html", headers={"Cache-Control": "no-cache"})
    # Режим разработки — перенаправляем на фронтенд (307 — временное перенаправление)
    return RedirectResponse(FRONTEND_URL, status_code=307)


# Значок сайта
@app.get("/favicon.ico", include_in_schema=False)
# Отдать значок
def favicon() -> Response:
    # Папка статики
    web = static_dir()
    # Если значок есть
    if web and (web / "favicon.ico").is_file():
        # Отдаём файл
        return FileResponse(web / "favicon.ico")
    # Иначе «нет содержимого» — браузер не будет ругаться ошибкой 404
    return Response(status_code=204)


# Страница-подсказка по адресу /api
@app.get("/api", include_in_schema=False)
# Короткий HTML с ссылками
def api_index() -> HTMLResponse:
    # HTML-ответ
    return HTMLResponse(
        # Текст подсказки
        "<meta charset=utf-8><p>Это API «Нитеграфа». Приложение открывается по адресу "
        # Ссылки на приложение и документацию
        f'<a href="{FRONTEND_URL}">{FRONTEND_URL}</a>, документация API — <a href="/docs">/docs</a>.</p>'
    )


# Проверка «сервер жив»
@app.get("/api/health")
# Ответ health
def health() -> dict[str, str]:
    # Всегда ok
    return {"status": "ok"}


# Умеет ли эта установка обновляться в одну кнопку
def _update_supported() -> bool:
    # Программа для Windows с номером версии (сборка разработчика не обновляется)
    return updater.supported(static_dir() is not None) and config.app_version() != "dev"


# Состояние обновления: ждём / качаем (сколько) / устанавливаем / ошибка
@app.get("/api/update")
# Ответ — состояние и признак «доступно»
def update_status() -> dict[str, Any]:
    # Состояние и признак
    return {**updater.status(), "supported": _update_supported()}


# Начать обновление: скачать установщик с GitHub, проверить, поставить и перезапуститься
@app.post("/api/update", status_code=202)
# Ответ — состояние сразу после начала
def update_start() -> dict[str, Any]:
    # Не программа для Windows или сборка разработчика
    if not _update_supported():
        # 404 с пояснением
        raise HTTPException(404, "Обновление в одну кнопку есть только в программе для Windows")
    # Начинаем (повторное нажатие — просто текущее состояние)
    return {**updater.start(config.app_version()), "supported": True}


# Константы для фронтенда — один источник правды
@app.get("/api/config")
# Собрать настройки
def get_config() -> dict[str, Any]:
    # Словарь настроек
    return {
        # Буквы секторов
        "sectors": list(config.SECTORS),
        # Гвоздей в секторе
        "nails_per_sector": config.NAILS_PER_SECTOR,
        # Гвоздей всего
        "total_nails": config.TOTAL_NAILS,
        # Стартовый гвоздь
        "start_nail": config.START_NAIL,
        # Пределы числа линий
        "lines": {"min": config.MIN_LINES, "max": config.MAX_LINES, "per_cm": config.LINES_PER_CM},
        # Диаметр
        "diameter": {
            # Кнопки-пресеты
            "presets_cm": list(config.DIAMETER_PRESETS_CM),
            # По умолчанию
            "default_cm": config.DEFAULT_DIAMETER_CM,
            # Минимум
            "min_cm": config.MIN_DIAMETER_CM,
            # Максимум
            "max_cm": config.MAX_DIAMETER_CM,
        },
        # Леска
        "thread": {
            # Толщина
            "diameter_mm": config.THREAD_DIAMETER_MM,
            # Запас
            "margin": config.THREAD_MARGIN,
            # Стандартные катушки
            "spools_m": list(config.STANDARD_SPOOLS_M),
            # Большая катушка
            "big_spool_m": config.BIG_SPOOL_M,
        },
        # Скорость автоперелистывания
        "speed": {
            # По умолчанию
            "default_sec": config.DEFAULT_SPEED_SEC,
            # Шаг кнопок
            "step_sec": config.SPEED_STEP_SEC,
            # Минимум
            "min_sec": config.MIN_SPEED_SEC,
            # Максимум
            "max_sec": config.MAX_SPEED_SEC,
        },
        # Предел размера загрузки
        "max_upload_bytes": config.MAX_UPLOAD_BYTES,
        # Программа для Windows сама проверяет, не вышла ли новая версия
        # Версия программы, признак «это программа для Windows» и «умеет обновляться сама»
        "app": {"version": config.app_version(), "desktop": static_dir() is not None, "update": _update_supported()},
        # Какие возможности доступны в этой установке
        "features": {
            # Поиск лица
            "face_detection": photo.face_detection_available(),
            # Удаление фона
            "background_removal": photo.background_removal_available(),
        },
        # Состояние модели удаления фона
        "background": photo.engine.status(),
        # Нити, цвета доски и режимы для цветных портретов
        "palette": palette.catalog(),
    }


# Список проектов
@app.get("/api/projects", response_model=list[ProjectSummary])
# Все проекты в кратком виде
def list_projects() -> list[dict[str, Any]]:
    # Каждый проект → краткий ответ
    return [_summary(p) for p in storage.list_projects()]


# Создать проект из файла одним запросом; 201 — «создано»
@app.post("/api/projects", response_model=ProjectDetail, status_code=201)
# Параметры приходят формой multipart/form-data
def create_project(
    # Файл фото (обязателен)
    file: Annotated[UploadFile, File(description="Фото: JPEG/PNG/WEBP/…")],
    # Название (необязательно, до 100 символов)
    name: Annotated[str | None, Form(max_length=100)] = None,
    # Диаметр с проверкой пределов
    diameter_cm: Annotated[
        # Число из формы в пределах 20…150
        float, Form(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    # По умолчанию 50 см
    ] = config.DEFAULT_DIAMETER_CM,
# Возвращает полный проект
) -> dict[str, Any]:
    """Быстрый путь: фото → портрет с настройками по умолчанию (кадр по центру)."""
    # Читаем, проверяем и сохраняем фото
    image = _store_image(_read_upload(file))
    # Перечитываем вместе с байтами
    full = storage.get_image(image["id"], with_blobs=True)
    # Только что сохранили — точно есть
    assert full is not None
    # Название: введённое или из имени файла; настройки кадра — по умолчанию
    return _create_from(full, (name or "").strip() or _default_name(file.filename), diameter_cm, photo.Prep())


# Создать проект из фото, загруженного в редактор
@app.post("/api/projects/from-image", response_model=ProjectDetail, status_code=201)
# Тело запроса — JSON по схеме CreateFromImage
def create_project_from_image(body: CreateFromImage) -> dict[str, Any]:
    """Портрет из фото, загруженного в редактор, с выбранным кадром и коррекциями."""
    # Фото с байтами
    image = _image_or_404(body.image_id, with_blobs=True)
    # Название или «Портрет от <дата>»
    name = (body.name or "").strip() or f"Портрет от {datetime.now():%d.%m.%Y}"
    # Создаём с ограниченными настройками кадра
    return _create_from(
        # Фото, название, диаметр, кадр
        image, name, body.diameter_cm, photo.clamp_prep(body.prep.to_prep()),
        # Режим и цвета
        body.mode, body.colors, body.color_count, body.board,
    )


# Рекомендуемое число линий
def _best_lines(sequence: list[int], gray: Image.Image, diameter_cm: float) -> int:
    """Рекомендация: число линий с максимальным сходством с подготовленным фото."""
    # Максимум кривой сходства; берём число линий
    return best_point(similarity_curve(sequence, gray, diameter_cm))[0]


# Общая часть создания проекта
def _create_from(
    # Фото, название, диаметр, настройки кадра
    image: dict[str, Any], name: str, diameter_cm: float, prep: photo.Prep,
    # Режим, цвета, число цветов, доска (по умолчанию — одна чёрная нить)
    mode: str = "mono", colors: list[str] | None = None, color_count: int = palette.DEFAULT_COLORS, board: str | None = None,
# Полный ответ API
) -> dict[str, Any]:
    # Подготовка и расчёт
    result = _generate(image, prep, mode, colors, color_count, board, diameter_cm)
    # Сохраняем проект
    project = storage.create_project(
        # Название
        name=name,
        # Диаметр с точностью до миллиметра
        diameter_cm=round(diameter_cm, 1),
        # Сразу ставим рекомендуемое число линий
        line_count=result["line_count"],
        # Скорость по умолчанию
        speed_sec=config.DEFAULT_SPEED_SEC,
        # Последовательность
        sequence=result["sequence"],
        # Подготовленное фото
        source_png=result["source_png"],
        # Ссылка на оригинал
        image_id=image["id"],
        # Настройки кадра
        prep=prep.to_dict(),
        # Режим
        mode=result["mode"],
        # Доска
        board=result["board"],
        # Слои
        layers=result["layers"],
    )
    # Полный ответ
    return _detail(project)


# Правка фото готового портрета
@app.put("/api/projects/{project_id}/photo", response_model=ProjectDetail)
# Тело — новые настройки кадра (и, по желанию, режим и цвета)
def update_photo(project_id: str, body: PhotoIn) -> dict[str, Any]:
    """Новый кадр/коррекции → схема пересчитывается, прогресс плетения начинается с шага 1."""
    # Проект
    project = _get_or_404(project_id)
    # Старые проекты, созданные до редактора, не хранят оригинал
    if not project.get("image_id"):
        # 409 «конфликт состояния»
        raise HTTPException(409, "У этого проекта не сохранилось исходное фото")
    # Оригинал фото
    image = _image_or_404(project["image_id"], with_blobs=True)
    # Новые настройки в допустимых пределах
    prep = photo.clamp_prep(body.to_prep())
    # Режим: новый или прежний
    mode = body.mode or project.get("mode") or "mono"
    # Цвета: новые, иначе прежние (если режим не сменился)
    colors = body.colors if body.colors is not None else ([l["color"] for l in project["layers"]] if mode == "color" and project.get("mode") == "color" else None)
    # Доска: новая, иначе прежняя (если режим не сменился)
    board = body.board or (project.get("board") if mode == project.get("mode") else None)
    # Новый расчёт
    result = _generate(image, prep, mode, colors, body.color_count or palette.DEFAULT_COLORS, board, project["diameter_cm"])
    # Сохраняем, сбрасывая прогресс
    updated = storage.replace_photo(
        # Какой проект
        project_id,
        # Новая последовательность
        sequence=result["sequence"],
        # Новое подготовленное фото
        source_png=result["source_png"],
        # Новые настройки
        prep=prep.to_dict(),
        # Новая рекомендация числа линий (для текущего диаметра)
        line_count=result["line_count"],
        # Режим
        mode=result["mode"],
        # Доска
        board=result["board"],
        # Слои
        layers=result["layers"],
    )
    # Проект существует — мы его только что читали
    assert updated is not None
    # Полный ответ
    return _detail(updated)


# --- Фото для редактора -----------------------------------------------------
# Загрузить фото в редактор
@app.post("/api/images", response_model=ImageOut, status_code=201)
# Принимает файл
def upload_image(file: Annotated[UploadFile, File(description="Фото: JPEG/PNG/WEBP/…")]) -> dict[str, Any]:
    """Загружает фото в редактор: уменьшает до 1600 px, поворачивает по EXIF, ищет лица."""
    # Читаем, сохраняем и отдаём информацию
    return _image_out(_store_image(_read_upload(file)))


# Информация о фото
@app.get("/api/images/{image_id}", response_model=ImageOut)
# По id
def get_image(image_id: str) -> dict[str, Any]:
    # Найти и отдать
    return _image_out(_image_or_404(image_id))


# Оригинал фото (для показа в редакторе)
@app.get("/api/images/{image_id}/original.jpg")
# По id
def image_original(image_id: str) -> Response:
    # Фото с байтами
    image = _image_or_404(image_id, with_blobs=True)
    # JPEG; браузер может держать в кэше сутки — оригинал не меняется
    return Response(image["original"], media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


# Статус маски фона в ответе
class MaskStatus(BaseModel):
    # Состояние расчёта маски
    status: str = Field(description="idle — не запрашивали, processing — считается, ready — готова, error — ошибка")
    # Состояние модели
    model: str = Field(description="Состояние модели: idle, loading (скачивается/грузится), ready, error")
    # Текст ошибки
    message: str | None = None
    # Поправлена кистью
    edited: bool = Field(False, description="Маска поправлена вручную кистью")
    # Прогресс скачивания модели
    progress: float | None = Field(None, description="Доля скачанной модели (0..1), пока она качается")


# Запустить расчёт маски
@app.post("/api/images/{image_id}/mask", response_model=MaskStatus)
# response нужен, чтобы поменять код ответа на 202
def start_mask(image_id: str, response: Response) -> dict[str, Any]:
    """Запускает удаление фона в фоне и сразу отвечает. Статус — GET того же адреса."""
    # Фото
    image = _image_or_404(image_id)
    # Текущий статус
    status = _mask_status(image)
    # Не считали или упало — запускаем (повторно)
    if status["status"] in ("idle", "error"):
        # В очередь
        photo.engine.submit(image_id, lambda: _compute_mask(image_id))
        # Новый статус
        status = _mask_status(_image_or_404(image_id))
    # Ещё не готово
    if status["status"] != "ready":
        # 202 «принято, выполняется»
        response.status_code = 202
    # Статус
    return status


# Узнать статус маски
@app.get("/api/images/{image_id}/mask", response_model=MaskStatus)
# По id
def mask_status(image_id: str) -> dict[str, Any]:
    # Статус
    return _mask_status(_image_or_404(image_id))


# Готовая маска картинкой
@app.get("/api/images/{image_id}/mask.png")
# По id
def image_mask(image_id: str) -> Response:
    """Готовая маска «человек/фон» в размере оригинала: белое — человек, чёрное — фон."""
    # Фото с байтами
    image = _image_or_404(image_id, with_blobs=True)
    # Маски ещё нет
    if not image.get("mask"):
        # 409 с подсказкой, что делать
        raise HTTPException(409, "Маска ещё не готова: сначала POST /api/images/{id}/mask и дождитесь status=ready")
    # PNG; no-cache — после правки кистью браузер должен взять новую
    return Response(image["mask"], media_type="image/png", headers={"Cache-Control": "no-cache"})


# Предел размера маски от кисти — 8 МБ
MAX_MASK_BYTES = 8 * 1024 * 1024


# Сохранить маску, поправленную кистью
@app.put("/api/images/{image_id}/mask.png", response_model=MaskStatus)
# async — тело запроса читаем асинхронно
async def put_mask(image_id: str, request: Request) -> dict[str, Any]:
    """Маска, поправленная кистью в редакторе (PNG, белое — человек). Приводится к размеру фото."""
    # Фото существует
    image = _image_or_404(image_id)
    # Байты тела запроса
    data = await request.body()
    # Пусто или слишком много
    if not data or len(data) > MAX_MASK_BYTES:
        # 413 — большое, 400 — пустое
        raise HTTPException(413 if data else 400, "Маска пустая или слишком большая")
    # Это может быть не картинка
    try:
        # Открываем
        mask = Image.open(io.BytesIO(data))
        # Загружаем пиксели (битый файл упадёт здесь)
        mask.load()
    # Не картинка
    except Exception as exc:  # noqa: BLE001
        # 400
        raise HTTPException(400, "Маска должна быть PNG-картинкой") from exc
    # Берём яркость
    mask = mask.convert("L")  # canvas отдаёт RGBA с непрозрачной альфой — берём яркость
    # Размер не совпадает с фото
    if mask.size != (image["width"], image["height"]):
        # Растягиваем до размера фото
        mask = mask.resize((image["width"], image["height"]), Image.Resampling.BILINEAR)
    # Сохраняем как поправленную
    storage.save_mask(image_id, photo.png_bytes(mask), edited=True)
    # Новый статус
    return _mask_status(_image_or_404(image_id))


# Сбросить правки кистью
@app.delete("/api/images/{image_id}/mask/edits", response_model=MaskStatus)
# По id
def reset_mask_edits(image_id: str, response: Response) -> dict[str, Any]:
    """Отменить правки кистью — вернуть автоматическую маску."""
    # Фото существует
    _image_or_404(image_id)
    # Возвращаем автоматическую маску
    storage.reset_mask(image_id)
    # Перечитываем
    image = _image_or_404(image_id)
    # Статус
    status = _mask_status(image)
    # Автоматической не было — считаем
    if status["status"] in ("idle", "error"):
        # В очередь
        photo.engine.submit(image_id, lambda: _compute_mask(image_id))
        # Новый статус
        status = _mask_status(_image_or_404(image_id))
    # Ещё не готово
    if status["status"] != "ready":
        # 202
        response.status_code = 202
    # Статус
    return status


# Автонастройка яркости и контраста
@app.post("/api/images/{image_id}/auto-tone", response_model=AutoToneOut)
# Тело — текущий кадр и диаметр
def image_auto_tone(image_id: str, body: AutoToneIn) -> dict[str, Any]:
    """Подбирает яркость и контраст под нити: перебор вариантов по сходству результата с фото.

    Кадр, фон и «Выделить лицо» берутся из prep как есть. Занимает 5–15 секунд.
    """
    # Фото с байтами
    image = _image_or_404(image_id, with_blobs=True)
    # Настройки в пределах
    base = photo.clamp_prep(body.prep.to_prep())
    # Лицо выделять нечего
    if base.face_focus and not image["faces"]:
        # 422
        raise HTTPException(422, "На фото не найдено лицо — снимите галочку «Выделить лицо»")
    # Оригинал
    original = Image.open(io.BytesIO(image["original"]))
    # Маска фона, если включено
    mask = _mask_for(image) if base.remove_background else None
    # Карта важности (по умолчанию нет)
    importance = None
    # Если выделяем лицо
    if base.face_focus:
        # Карта с эллипсом лица
        importance = photo.face_importance(image["width"], image["height"], base, photo.Box(**image["faces"][0]))

    # Функция «подготовить фото с такой яркостью и контрастом» — её вызывает перебор
    def prepare(b: float, c: float) -> Image.Image:
        # Те же настройки, но с другими яркостью и контрастом
        p = photo.Prep(**{**base.to_dict(), "brightness": b, "contrast": c})
        # Подготовленное фото
        return photo.prepare_gray(original, p, mask)

    # Перебор вариантов
    return auto_tone(prepare, body.diameter_cm, importance)


# Подготовленный кадр картинкой (то, что увидит алгоритм)
@app.get("/api/images/{image_id}/prepared.png")
# Настройки приходят параметрами адреса (?zoom=2&brightness=0.1)
def image_prepared(image_id: str, prep: Annotated[PrepIn, Query()]) -> Response:
    """Ровно то, что получит алгоритм (400×400, оттенки серого)."""
    # Фото с байтами
    image = _image_or_404(image_id, with_blobs=True)
    # Готовим
    gray = _prepare(image, photo.clamp_prep(prep.to_prep()))
    # PNG без кэширования (меняется вместе с настройками)
    return Response(gray_png(gray), media_type="image/png", headers={"Cache-Control": "no-store"})


# Получить проект целиком
@app.get("/api/projects/{project_id}", response_model=ProjectDetail)
# По id
def get_project(project_id: str) -> dict[str, Any]:
    # Полный ответ
    return _detail(_get_or_404(project_id))


# Изменить проект
@app.patch("/api/projects/{project_id}", response_model=ProjectDetail)
# Тело — изменяемые поля
def update_project(project_id: str, body: ProjectUpdate) -> dict[str, Any]:
    # Текущее состояние
    project = _get_or_404(project_id)
    # Только переданные поля (None — «не менять»)
    fields = body.model_dump(exclude_none=True)
    # Но явный null у катушки означает «сбросить»
    if "own_spool_m" in body.model_fields_set and body.own_spool_m is None:
        # Записываем NULL в базу
        fields["own_spool_m"] = None  # явный null — вернуть стандартную катушку
    # Меняется название
    if "name" in fields:
        # Обрезаем пробелы по краям
        fields["name"] = fields["name"].strip()
        # Из одних пробелов
        if not fields["name"]:
            # 422
            raise HTTPException(422, "Название не может быть пустым")
    # Меняется диаметр
    if "diameter_cm" in fields:
        # До миллиметра
        fields["diameter_cm"] = round(fields["diameter_cm"], 1)
    # Меняется скорость
    if "speed_sec" in fields:
        # До десятой секунды
        fields["speed_sec"] = round(fields["speed_sec"], 1)
    # Слои проекта (у одной нити — один)
    layers = _layers_of(project)
    # Номер слоя, к которому относятся число линий и шаг
    index = fields.pop("layer", 0)
    # Такого слоя нет —
    if index >= len(layers) or fields.get("current_layer", 0) >= len(layers):
        # — 422
        raise HTTPException(422, f"У портрета {len(layers)} сл. — номер слоя от 0 до {len(layers) - 1}")
    # Одна нить: как и раньше, не меньше 1000 линий
    if not project.get("layers") and fields.get("line_count", config.MIN_LINES) < config.MIN_LINES:
        # 422
        raise HTTPException(422, f"Число линий — от {config.MIN_LINES} до {config.MAX_LINES}")
    # Изменения слоя: число линий и шаг
    layer_fields = {k: fields.pop(k) for k in ("line_count", "current_step") if k in fields}
    # Текущий слой
    layer = layers[index]
    # Число линий после изменения
    line_count = layer_fields.get("line_count", layer["line_count"])
    # Шаг за пределами числа линий
    if "current_step" in layer_fields and layer_fields["current_step"] > line_count:
        # 422
        raise HTTPException(422, f"Шаг должен быть в пределах 1..{line_count}")
    # Линий стало меньше текущего шага
    if "line_count" in layer_fields and "current_step" not in layer_fields and layer["current_step"] > line_count:
        # Подтягиваем шаг к концу
        layer_fields["current_step"] = line_count  # линий стало меньше — не выходим за конец
    # У одной нити поля слоя — это основные поля проекта
    if not project.get("layers"):
        # Объединяем
        fields.update(layer_fields)
    # У цветного портрета — отдельная запись слоя
    elif layer_fields:
        # Сохраняем слой
        storage.update_layer(project_id, index, layer_fields)
    # Сохраняем остальное
    updated = storage.update_project(project_id, fields)
    # Проект есть
    assert updated is not None
    # Полный ответ
    return _detail(updated)


# Отметка времени плетения
@app.post("/api/projects/{project_id}/activity", response_model=ActivityOut)
# Тело — дата, секунды, шаги
def add_activity(project_id: str, body: ActivityIn) -> dict[str, Any]:
    """Отметка «плели N секунд, прошли M шагов» — из режима плетения, раз в полминуты."""
    # Проект существует
    _get_or_404(project_id)
    # Прибавляем
    updated = storage.add_activity(project_id, body.date, body.seconds, body.steps)
    # Проект есть
    assert updated is not None
    # Обновлённый журнал
    return _activity(updated["activity"])


# Удалить проект; 204 — «успешно, без содержимого»
@app.delete("/api/projects/{project_id}", status_code=204)
# По id
def delete_project(project_id: str) -> Response:
    # Проект существует (иначе 404)
    _get_or_404(project_id)
    # Удаляем
    storage.delete_project(project_id)
    # Пустой ответ
    return Response(status_code=204)


# Сохранить портрет файлом «.nitegraf» (перенос на другой компьютер или в телефон)
@app.get("/api/projects/{project_id}/export")
# По id
def export_project(project_id: str) -> Response:
    """Файл проекта: схема всех нитей, прогресс, учёт времени, фото и маска."""
    # Проект
    p = _get_or_404(project_id)
    # Содержимое файла — JSON, русские буквы как есть
    body = json.dumps(transfer.export_project(p), ensure_ascii=False)
    # Имя файла латиницей
    ascii_name = f"nitegraf-{p['id']}{transfer.EXTENSION}"
    # Имя по-русски
    utf_name = quote(f"{p['name']}{transfer.EXTENSION}")
    # Ответ-вложение
    return Response(
        # JSON
        body.encode("utf-8"),
        # Тип
        media_type="application/json",
        # Скачать с двумя вариантами имени
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf_name}"},
    )


# Открыть файл проекта: создаётся новый портрет со всем прогрессом
@app.post("/api/projects/import", response_model=ProjectDetail, status_code=201)
# Файл в форме
def import_project(file: Annotated[UploadFile, File(description="Файл .nitegraf")]) -> dict[str, Any]:
    """Новый портрет из файла «.nitegraf» — того же формата, что отдаёт /export."""
    # Читаем не больше лимита + 1 байт
    raw = file.file.read(transfer.MAX_FILE_BYTES + 1)
    # Больше лимита —
    if len(raw) > transfer.MAX_FILE_BYTES:
        # — 413
        raise HTTPException(413, "Файл слишком большой (максимум 40 МБ)")
    # Разбираем JSON
    try:
        # Текст UTF-8 → данные
        body = json.loads(raw.decode("utf-8"))
    # Не текст или не JSON
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        # 400
        raise HTTPException(400, "Это не файл проекта «Нитеграфа»") from exc
    # Не тот формат —
    if not isinstance(body, dict) or body.get("format") != transfer.FORMAT:
        # — 400
        raise HTTPException(400, "Это не файл проекта «Нитеграфа»")
    # Проверка содержимого
    try:
        # Модель файла
        data = transfer.TransferFile.model_validate(body)
    # Испорчен
    except ValidationError as exc:
        # Первая ошибка — понятным текстом
        first = exc.errors()[0]
        # Где и что
        raise HTTPException(422, f"Файл проекта испорчен: {first['msg'].removeprefix('Value error, ')} ({'.'.join(map(str, first['loc']))})") from exc
    # Создаём портрет
    try:
        # Импорт
        project = transfer.import_project(data)
    # Испорченные картинки
    except ValueError as exc:
        # 422
        raise HTTPException(422, str(exc)) from exc
    # Полный ответ
    return _detail(project)


# Кривая сходства
@app.get("/api/projects/{project_id}/similarity", response_model=SimilarityOut)
# Параметры
def get_similarity(
    # id проекта
    project_id: str,
    # Необязательный другой диаметр («а если сделать 70 см?»)
    diameter_cm: Annotated[float | None, Query(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)] = None,
    # Для цветного портрета — какой слой меняем (остальные остаются как есть)
    layer: Annotated[int, Query(ge=0, le=palette.MAX_COLORS - 1)] = 0,
# Ответ — кривая
) -> dict[str, Any]:
    """Кривая «сходство с фото ↔ число линий» и рекомендация для диаметра (по умолчанию — текущего)."""
    # Проект
    p = _get_or_404(project_id)
    # Подготовленное фото — эталон
    source = storage.get_source_png(project_id)
    # Есть всегда
    assert source is not None
    # Диаметр для оценки
    diameter = diameter_cm or p["diameter_cm"]
    # Портрет из нескольких нитей — кривая картины целиком при изменении одного слоя
    if p.get("layers"):
        # Такого слоя нет —
        if layer >= len(p["layers"]):
            # — 422
            raise HTTPException(422, "Нет такого слоя")
        # Кривая
        return _layer_similarity(p, source, layer, diameter)
    # «Версия» последовательности: после правки фото кэш не должен отдавать старую кривую
    version = format(hash(bytes(p["sequence"])), "x")
    # Кривая (из кэша или посчитать)
    return project_similarity(project_id, version, p["sequence"], source, diameter)


# Запомненные кривые слоёв: (проект, версия, диаметр, слой) → ответ
_layer_curves: dict[tuple, dict[str, Any]] = {}


# Кривая сходства для слоя цветного портрета (из кэша или посчитать)
def _layer_similarity(p: dict[str, Any], source: bytes, layer: int, diameter_cm: float) -> dict[str, Any]:
    # Версия: последовательности и числа линий остальных слоёв
    version = hash(tuple((bytes(l["sequence"]), l["line_count"] if i != layer else 0) for i, l in enumerate(p["layers"])))
    # Ключ кэша
    key = (p["id"], version, round(diameter_cm, 1), layer)
    # Уже считали —
    if key in _layer_curves:
        # — отдаём
        return _layer_curves[key]
    # Эталон — цветное подготовленное фото 0..1
    target = np.asarray(Image.open(io.BytesIO(source)).convert("RGB"), dtype=np.float32) / 255.0
    # Кривая картины целиком
    curve = color_layers.layer_curve(target, p.get("board") or "white", p["layers"], layer, diameter_cm)
    # Лучшая точка
    best_n, best_s = best_point(curve)
    # Ответ в том же виде, что у одной нити
    result = {
        # Диаметр
        "diameter_cm": round(diameter_cm, 1),
        # Лучшее число линий слоя
        "best_lines": best_n,
        # Лучшая оценка
        "best_score": best_s,
        # Точки
        "curve": [{"lines": n, "score": v} for n, v in curve],
    }
    # Кэш не больше 32 кривых —
    if len(_layer_curves) > 32:
        # — иначе очищаем целиком
        _layer_curves.clear()
    # Запоминаем
    _layer_curves[key] = result
    # Ответ
    return result


# Шаги плетения порциями
@app.get("/api/projects/{project_id}/steps", response_model=StepsPage)
# Параметры
def get_steps(
    # id проекта
    project_id: str,
    # С какого шага
    offset: Annotated[int, Query(ge=0)] = 0,
    # Сколько шагов (не больше 1000 за раз)
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    # Какой слой (нить) — у цветного портрета
    layer: Annotated[int, Query(ge=0, le=palette.MAX_COLORS - 1)] = 0,
# Ответ — страница шагов
) -> dict[str, Any]:
    # Проект
    p = _get_or_404(project_id)
    # Слои проекта
    layers = _layers_of(p)
    # Такого слоя нет —
    if layer >= len(layers):
        # — 422
        raise HTTPException(422, "Нет такого слоя")
    # Последовательность и выбранное число линий слоя
    seq, total = layers[layer]["sequence"], layers[layer]["line_count"]
    # Накопленная длина лески после каждого шага
    used = cumulative_lengths_m(seq[: total + 1], p["diameter_cm"])
    # Шаги страницы
    items = [
        # Один шаг
        {
            # Номер с единицы
            "number": k + 1,
            # Откуда
            "from_nail": seq[k],
            # Куда
            "to_nail": seq[k + 1],
            # Откуда (метка)
            "from_label": nail_label(seq[k]),
            # Куда (метка)
            "to_label": nail_label(seq[k + 1]),
            # Израсходовано к концу шага
            "thread_used_m": round(used[k + 1], 2),
        }
        # Для шагов с offset до конца страницы (но не дальше числа линий)
        for k in range(offset, min(total, offset + limit))
    ]
    # Ответ
    return {"total": total, "offset": offset, "limit": limit, "items": items}


# Превью картины
@app.get("/api/projects/{project_id}/preview.png")
# Параметры
def preview_png(
    # id
    project_id: str,
    # Размер картинки 100…1600 px
    size: Annotated[int, Query(ge=100, le=1600)] = 600,
    # Сколько линий нарисовать (по умолчанию — выбранное число)
    lines: Annotated[int | None, Query(ge=1, le=config.MAX_LINES)] = None,
# Ответ — PNG
) -> Response:
    # Проект
    p = _get_or_404(project_id)
    # Портрет из нескольких нитей — рисуем все слои поверх доски
    if p.get("layers"):
        # Слои: последовательность, число линий (у первого — lines, если задано), цвет нити
        parts = [
            # Один слой
            (l["sequence"], (lines or l["line_count"]) if i == 0 else l["line_count"], palette.THREAD_BY_KEY[l["color"]].rgb)
            # Для каждого слоя
            for i, l in enumerate(p["layers"])
        ]
        # Цветная картинка
        png = render_layers_png(parts, p["diameter_cm"], palette.BOARD_BY_KEY[p.get("board") or "white"].rgb, size)
    # Одна нить
    else:
        # Рисуем
        png = render_png(p["sequence"], lines or p["line_count"], p["diameter_cm"], size)
    # Без кэша — зависит от параметров
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


# Подготовленное фото проекта
@app.get("/api/projects/{project_id}/source.png")
# По id
def source_png(project_id: str) -> Response:
    # Проект существует
    _get_or_404(project_id)
    # PNG из базы
    return Response(storage.get_source_png(project_id), media_type="image/png")


# Общий ответ «скачать PDF» с русским именем файла
def _pdf_response(pdf: bytes, ascii_name: str, title: str) -> Response:
    # Ответ
    return Response(
        # Байты PDF
        pdf,
        # Тип содержимого
        media_type="application/pdf",
        # attachment — скачать; filename — латиницей для старых браузеров, filename* — по-русски (RFC 5987)
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(title)}"},
    )


# Тип параметра «формат бумаги»: только A4 или A3
Paper = Annotated[str, Query(pattern="^(A4|A3)$", description="Формат бумаги")]


# Шаблон разметки для проекта
@app.get("/api/projects/{project_id}/template.pdf")
# По id и формату бумаги
def project_template_pdf(project_id: str, paper: Paper = "A4") -> Response:
    """Шаблон разметки гвоздей в натуральную величину для диаметра проекта."""
    # Проект
    p = _get_or_404(project_id)
    # Строим PDF для диаметра проекта
    pdf = build_template_pdf(p["diameter_cm"], p["name"], paper)
    # Отдаём на скачивание
    return _pdf_response(pdf, f"template-{p['id']}.pdf", f"Шаблон разметки — {p['name']}.pdf")


# Шаблон разметки для любого диаметра (без проекта)
@app.get("/api/template.pdf")
# Параметры
def template_pdf(
    # Диаметр обязателен
    diameter_cm: Annotated[float, Query(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)],
    # Формат бумаги
    paper: Paper = "A4",
# Ответ — PDF
) -> Response:
    """Шаблон разметки для любого диаметра — без проекта."""
    # Строим PDF
    pdf = build_template_pdf(diameter_cm, "Нитеграф", paper)
    # :g — без лишних нулей (50 вместо 50.0)
    return _pdf_response(pdf, f"template-{diameter_cm:g}cm.pdf", f"Шаблон разметки — {diameter_cm:g} см.pdf")


# PDF-инструкция
@app.get("/api/projects/{project_id}/instructions.pdf")
# По id
def instructions_pdf(project_id: str) -> Response:
    # Проект
    p = _get_or_404(project_id)
    # Цветной портрет — шаги каждой нити отдельно
    if p.get("layers"):
        # Слои с названиями и цветами — из краткого ответа, последовательности — из базы
        layers = [{**info, "sequence": full["sequence"]} for info, full in zip(_summary(p)["layers"], p["layers"])]
        # Строим PDF
        pdf = build_layers_pdf(p["name"], layers, p["diameter_cm"], _summary(p)["board"])
    # Одна нить
    else:
        # Строим PDF
        pdf = build_instructions_pdf(p["name"], p["sequence"], p["line_count"], p["diameter_cm"])
    # Имя латиницей
    ascii_name = f"string-art-{p['id']}.pdf"
    # Имя по-русски, закодированное для заголовка
    utf_name = quote(f"Инструкция — {p['name']}.pdf")
    # Ответ
    return Response(
        # Байты PDF
        pdf,
        # Тип
        media_type="application/pdf",
        # Заголовки
        headers={
            # Скачать с двумя вариантами имени
            "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf_name}"
        },
    )


# Справка по разметке для диаметра
@app.get("/api/geometry")
# Диаметр обязателен
def geometry(diameter_cm: Annotated[float, Query(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)]) -> dict:
    """Справка для разметки: шаг между гвоздями для выбранного диаметра."""
    # Ответ
    return {
        # Диаметр
        "diameter_cm": diameter_cm,
        # Шаг гвоздей по дуге, мм
        "nail_spacing_mm": round(arc_spacing(diameter_cm * 10), 2),
        # Ориентир числа линий
        "recommended_lines": recommended_lines(diameter_cm),
    }


# --- Десктопная версия: статические файлы приложения --------------------------------
# Любой другой адрес (path:path — путь с косыми чертами)
@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
# Отдать файл приложения
def static_files(path: str) -> Response:
    """/project → project.html, /_next/… → файлы сборки. Регистрируется последним — после API."""
    # Папка статики
    web = static_dir()
    # Не программа для Windows или неизвестный адрес API
    if web is None or path.startswith("api/"):
        # 404
        raise HTTPException(404, "Не найдено")
    # Абсолютный путь папки (для проверки выхода за её пределы)
    root_dir = web.resolve()
    # Варианты файла: как есть, с .html, папка с index.html
    for candidate in (path, f"{path}.html", f"{path}/index.html"):
        # Абсолютный путь кандидата (../ раскрывается)
        file = (root_dir / candidate).resolve()
        # Файл есть и лежит внутри папки (защита от «../../секреты»)
        if file.is_file() and file.is_relative_to(root_dir):
            # Файлы /_next/static/ имеют хэш в имени и никогда не меняются
            immutable = path.startswith("_next/static/")
            # Их можно кэшировать на год; остальные — проверять каждый раз
            cache = "public, max-age=31536000, immutable" if immutable else "no-cache"
            # Отдаём файл
            return FileResponse(file, headers={"Cache-Control": cache})
    # Страница «не найдено» из сборки
    not_found = root_dir / "404.html"
    # Если она есть
    if not_found.is_file():
        # Отдаём её с кодом 404
        return FileResponse(not_found, status_code=404)
    # Иначе обычная 404
    raise HTTPException(404, "Не найдено")
