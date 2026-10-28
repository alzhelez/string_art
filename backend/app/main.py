"""HTTP API (FastAPI). Запуск: uvicorn app.main:app --reload --port 8000"""

# Современная запись типов (str | None) в любой версии Python 3
from __future__ import annotations

# Чтение картинок из байтов
import io
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
from typing import Annotated, Any
# Кодирование русского имени файла в заголовке скачивания
from urllib.parse import quote

# FastAPI: приложение, загрузка файла, поле формы, HTTP-ошибка, параметр адреса, запрос, ответ, загруженный файл
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
# Готовые ответы: файл с диска, HTML-страница, перенаправление
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
# Разрешение запросов с другого адреса (фронтенд на порту 3000 обращается к API на 8000)
from fastapi.middleware.cors import CORSMiddleware
# Работа с картинками
from PIL import Image
# Pydantic — описание и автоматическая проверка входных/выходных данных
from pydantic import BaseModel, ConfigDict, Field

# Наши модули: настройки, подготовка фото, база данных
from . import config, photo, storage
# Алгоритм и предрасчёт линий
from .algorithm import build_line_cache, generate_sequence
# Шаг гвоздей по дуге и метки гвоздей
from .geometry import arc_spacing, nail_label
# Загрузка картинки, её ошибка, PNG из серой картинки, карта темноты
from .image_prep import ImageError, gray_png, load_image, target_map
# PDF-инструкция
from .pdf import build_instructions_pdf
# Шаблон разметки 1:1
from .template import build_template_pdf
# Превью картины
from .render import render_png
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


# Проект целиком — всё из списка плюс последовательность гвоздей
class ProjectDetail(ProjectSummary):
    # Последовательность гвоздей
    sequence: list[int] = Field(description="Гвозди по порядку, длина = max_lines + 1, первый — A1")


# Что можно изменить в проекте (PATCH); каждое поле необязательно
class ProjectUpdate(BaseModel):
    # Лишние поля запрещены
    model_config = ConfigDict(extra="forbid")

    # Название 1…100 символов
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # Диаметр 20…150 см
    diameter_cm: float | None = Field(default=None, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    # Число линий 1000…5000
    line_count: int | None = Field(default=None, ge=config.MIN_LINES, le=config.MAX_LINES)
    # Текущий шаг 1…5000 (дополнительно проверяется по числу линий)
    current_step: int | None = Field(default=None, ge=1, le=config.MAX_LINES)
    # Скорость 0,5…10 с
    speed_sec: float | None = Field(default=None, ge=config.MIN_SPEED_SEC, le=config.MAX_SPEED_SEC)
    # Своя катушка 10…100 000 м
    own_spool_m: float | None = Field(
        # null явно — сбросить
        default=None, ge=10, le=100_000, description="Длина своей катушки, м; null — сбросить (взять стандартную)"
    )


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


# Проект из базы → краткий ответ (без последовательности)
def _summary(p: dict[str, Any]) -> dict[str, Any]:
    # Расчёт лески для текущих настроек
    stats = thread_stats(p["sequence"], p["line_count"], p["diameter_cm"]).to_dict()
    # Все поля, кроме длинной последовательности
    out = {k: v for k, v in p.items() if k != "sequence"}
    # Добавляем расчёт лески
    out["stats"] = stats
    # И журнал в формате API
    out["activity"] = _activity(p.get("activity") or {})
    # Готово
    return out


# Проект из базы → полный ответ
def _detail(p: dict[str, Any]) -> dict[str, Any]:
    # Краткая часть
    out = _summary(p)
    # Плюс последовательность
    out["sequence"] = p["sequence"]
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


# Подготовка + расчёт последовательности
def _generate(image: dict[str, Any], prep: photo.Prep) -> tuple[list[int], Image.Image]:
    """Подготовка фото + расчёт последовательности гвоздей."""
    # «Выделить лицо» без найденного лица — ошибка пользователя
    if prep.face_focus and not image["faces"]:
        # 422 с подсказкой
        raise HTTPException(422, "На фото не найдено лицо — снимите галочку «Выделить лицо»")
    # Подготовленное фото
    gray = _prepare(image, prep)
    # Карта важности (по умолчанию нет)
    importance = None
    # Если включено «Выделить лицо»
    if prep.face_focus:
        # Самое крупное лицо
        face = photo.Box(**image["faces"][0])
        # Карта важности с эллипсом на лице
        importance = photo.face_importance(image["width"], image["height"], prep, face)
    # Последовательность и подготовленное фото (оно станет эталоном сходства)
    return generate_sequence(target_map(gray), importance=importance), gray


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
        # Версия программы и признак «это программа для Windows»
        "app": {"version": config.app_version(), "desktop": static_dir() is not None},
        # Какие возможности доступны в этой установке
        "features": {
            # Поиск лица
            "face_detection": photo.face_detection_available(),
            # Удаление фона
            "background_removal": photo.background_removal_available(),
        },
        # Состояние модели удаления фона
        "background": photo.engine.status(),
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
    return _create_from(image, name, body.diameter_cm, photo.clamp_prep(body.prep.to_prep()))


# Рекомендуемое число линий
def _best_lines(sequence: list[int], gray: Image.Image, diameter_cm: float) -> int:
    """Рекомендация: число линий с максимальным сходством с подготовленным фото."""
    # Максимум кривой сходства; берём число линий
    return best_point(similarity_curve(sequence, gray, diameter_cm))[0]


# Общая часть создания проекта
def _create_from(image: dict[str, Any], name: str, diameter_cm: float, prep: photo.Prep) -> dict[str, Any]:
    # Подготовка и расчёт
    sequence, gray = _generate(image, prep)
    # Сохраняем проект
    project = storage.create_project(
        # Название
        name=name,
        # Диаметр с точностью до миллиметра
        diameter_cm=round(diameter_cm, 1),
        # Сразу ставим рекомендуемое число линий
        line_count=_best_lines(sequence, gray, diameter_cm),
        # Скорость по умолчанию
        speed_sec=config.DEFAULT_SPEED_SEC,
        # Последовательность
        sequence=sequence,
        # Подготовленное фото
        source_png=gray_png(gray),
        # Ссылка на оригинал
        image_id=image["id"],
        # Настройки кадра
        prep=prep.to_dict(),
    )
    # Полный ответ
    return _detail(project)


# Правка фото готового портрета
@app.put("/api/projects/{project_id}/photo", response_model=ProjectDetail)
# Тело — новые настройки кадра
def update_photo(project_id: str, body: PrepIn) -> dict[str, Any]:
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
    # Новый расчёт
    sequence, gray = _generate(image, prep)
    # Сохраняем, сбрасывая прогресс
    updated = storage.replace_photo(
        # Какой проект
        project_id,
        # Новая последовательность
        sequence=sequence,
        # Новое подготовленное фото
        source_png=gray_png(gray),
        # Новые настройки
        prep=prep.to_dict(),
        # Новая рекомендация числа линий (для текущего диаметра)
        line_count=_best_lines(sequence, gray, project["diameter_cm"]),
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
    # Число линий после изменения
    line_count = fields.get("line_count", project["line_count"])
    # Шаг за пределами числа линий
    if "current_step" in fields and fields["current_step"] > line_count:
        # 422
        raise HTTPException(422, f"Шаг должен быть в пределах 1..{line_count}")
    # Линий стало меньше текущего шага
    if "line_count" in fields and "current_step" not in fields and project["current_step"] > line_count:
        # Подтягиваем шаг к концу
        fields["current_step"] = line_count  # линий стало меньше — не выходим за конец
    # Сохраняем
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


# Кривая сходства
@app.get("/api/projects/{project_id}/similarity", response_model=SimilarityOut)
# Параметры
def get_similarity(
    # id проекта
    project_id: str,
    # Необязательный другой диаметр («а если сделать 70 см?»)
    diameter_cm: Annotated[float | None, Query(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)] = None,
# Ответ — кривая
) -> dict[str, Any]:
    """Кривая «сходство с фото ↔ число линий» и рекомендация для диаметра (по умолчанию — текущего)."""
    # Проект
    p = _get_or_404(project_id)
    # «Версия» последовательности: после правки фото кэш не должен отдавать старую кривую
    version = format(hash(bytes(p["sequence"])), "x")
    # Подготовленное фото — эталон
    source = storage.get_source_png(project_id)
    # Есть всегда
    assert source is not None
    # Кривая (из кэша или посчитать)
    return project_similarity(project_id, version, p["sequence"], source, diameter_cm or p["diameter_cm"])


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
# Ответ — страница шагов
) -> dict[str, Any]:
    # Проект
    p = _get_or_404(project_id)
    # Последовательность и выбранное число линий
    seq, total = p["sequence"], p["line_count"]
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
