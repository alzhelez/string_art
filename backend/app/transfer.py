"""Перенос портрета файлом «.nitegraf»: экспорт и импорт.

Файл — обычный JSON в UTF-8, его можно открыть блокнотом. Внутри всё, что нужно,
чтобы продолжить работу на другом компьютере или в телефоне: схема (все нити),
прогресс плетения, учёт времени, настройки кадра, подготовленное фото и — если
есть — исходное фото с маской фона (тогда можно снова «Изменить фото»).
Тот же формат читает и пишет версия для телефона (frontend/lib/local).
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Картинки внутри JSON храним в base64
import base64
# Ошибка разбора base64
import binascii
# Дата экспорта
from datetime import datetime, timezone
# Типы
from typing import Any, Literal

# Описание и проверка формата файла
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Настройки, палитра, база данных
from . import config, palette, storage
# Проверка, что внутри действительно картинка
from .image_prep import ImageError, load_image

# Название формата — первое поле файла
FORMAT = "nitegraf"
# Версия формата: меняется, если старые программы не смогут прочитать новые файлы
VERSION = 1
# Расширение файла
EXTENSION = ".nitegraf"
# Наибольший размер файла: оригинал до 15 МБ в base64 + маска + схема
MAX_FILE_BYTES = 40 * 1024 * 1024


# Последовательность гвоздей: номера 0..239, не длиннее максимума
def _check_sequence(seq: list[int]) -> list[int]:
    # Пустая или слишком длинная — ошибка
    if not 2 <= len(seq) <= config.MAX_LINES + 1:
        # Понятный текст
        raise ValueError("Схема должна содержать от 1 до 5000 линий")
    # Номер гвоздя вне круга — ошибка
    if any(not 0 <= n < config.TOTAL_NAILS for n in seq):
        # Понятный текст
        raise ValueError("Номер гвоздя вне 0…239")
    # Всё в порядке
    return seq


# Одна нить в файле
class LayerFile(BaseModel):
    # Лишние поля не принимаем
    model_config = ConfigDict(extra="forbid")

    # Цвет нити из каталога
    color: str
    # Гвозди
    sequence: list[int]
    # Число линий
    line_count: int = Field(ge=1, le=config.MAX_LINES)
    # Текущий шаг
    current_step: int = Field(1, ge=1, le=config.MAX_LINES)

    # Проверка цвета
    @field_validator("color")
    # Метод класса
    @classmethod
    # Цвет должен быть из каталога
    def _known_color(cls, v: str) -> str:
        # Неизвестный — ошибка
        if v not in palette.THREAD_BY_KEY:
            # Понятный текст
            raise ValueError(f"Неизвестный цвет нити: {v}")
        # Ок
        return v

    # Проверка последовательности
    @field_validator("sequence")
    # Метод класса
    @classmethod
    # Номера гвоздей и длина схемы
    def _sequence(cls, v: list[int]) -> list[int]:
        # Общая проверка
        return _check_sequence(v)

    # Число линий и шаг — в пределах схемы
    @model_validator(mode="after")
    # После проверки полей
    def _fits(self) -> "LayerFile":
        # Линий не больше, чем в схеме
        if self.line_count > len(self.sequence) - 1:
            # Ошибка
            raise ValueError("Линий больше, чем в схеме")
        # Шаг не дальше конца
        if self.current_step > self.line_count:
            # Прижимаем к концу (так ведёт себя и сам сервер)
            self.current_step = self.line_count
        # Ок
        return self


# Сам портрет в файле
class ProjectFile(BaseModel):
    # Лишние поля не принимаем
    model_config = ConfigDict(extra="forbid")

    # Название
    name: str = Field(min_length=1, max_length=100)
    # Диаметр
    diameter_cm: float = Field(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    # Число линий (первая нить)
    line_count: int = Field(ge=1, le=config.MAX_LINES)
    # Текущий шаг (первая нить)
    current_step: int = Field(1, ge=1, le=config.MAX_LINES)
    # Скорость перелистывания
    speed_sec: float = Field(config.DEFAULT_SPEED_SEC, ge=config.MIN_SPEED_SEC, le=config.MAX_SPEED_SEC)
    # Настройки кадра
    prep: dict[str, Any] = Field(default_factory=dict)
    # Своя катушка
    own_spool_m: float | None = Field(None, ge=10, le=100_000)
    # Учёт времени: {"2026-10-27": [секунд, шагов]}
    activity: dict[str, list[float]] = Field(default_factory=dict)
    # Режим
    mode: Literal["mono", "bw", "color"] = "mono"
    # Доска
    board: str = "white"
    # Текущая нить
    current_layer: int = Field(0, ge=0, le=palette.MAX_COLORS - 1)
    # Гвозди (первая нить)
    sequence: list[int]
    # Нити (у одной нити — пусто)
    layers: list[LayerFile] = Field(default_factory=list, max_length=palette.MAX_COLORS)

    # Проверка последовательности
    @field_validator("sequence")
    # Метод класса
    @classmethod
    # Номера гвоздей и длина схемы
    def _sequence(cls, v: list[int]) -> list[int]:
        # Общая проверка
        return _check_sequence(v)

    # Проверка доски
    @field_validator("board")
    # Метод класса
    @classmethod
    # Доска из каталога
    def _known_board(cls, v: str) -> str:
        # Неизвестная — ошибка
        if v not in palette.BOARD_BY_KEY:
            # Понятный текст
            raise ValueError(f"Неизвестный цвет доски: {v}")
        # Ок
        return v

    # Проверка журнала: даты ISO и пары чисел
    @field_validator("activity")
    # Метод класса
    @classmethod
    # Журнал времени
    def _activity(cls, v: dict[str, list[float]]) -> dict[str, list[float]]:
        # Каждая запись
        for day, pair in v.items():
            # Дата в формате ГГГГ-ММ-ДД и ровно два неотрицательных числа
            if len(day) != 10 or day[4] != "-" or day[7] != "-" or len(pair) != 2 or min(pair) < 0:
                # Ошибка
                raise ValueError("Учёт времени испорчен")
        # Ок
        return v

    # Согласованность: режим ↔ слои, первая нить ↔ основные поля, шаг ↔ линии
    @model_validator(mode="after")
    # После проверки полей
    def _consistent(self) -> "ProjectFile":
        # Одна нить — слоёв нет, и наоборот
        if (self.mode == "mono") != (not self.layers):
            # Ошибка
            raise ValueError("Режим не совпадает с числом нитей")
        # Несколько нитей — не меньше двух
        if self.layers and len(self.layers) < 2:
            # Ошибка
            raise ValueError("Цветной портрет должен содержать хотя бы две нити")
        # Первая нить повторяет основные поля
        if self.layers and self.layers[0].sequence != self.sequence:
            # Ошибка
            raise ValueError("Первая нить не совпадает со схемой")
        # Текущая нить существует
        if self.current_layer >= max(1, len(self.layers)):
            # Прижимаем к первой
            self.current_layer = 0
        # Линий не больше, чем в схеме
        if self.line_count > len(self.sequence) - 1:
            # Ошибка
            raise ValueError("Линий больше, чем в схеме")
        # У одной нити — не меньше 1000 линий, как и в программе
        if not self.layers and self.line_count < config.MIN_LINES:
            # Ошибка
            raise ValueError(f"Число линий — от {config.MIN_LINES}")
        # Шаг — не дальше конца
        self.current_step = min(self.current_step, self.line_count)
        # Ок
        return self


# Исходное фото в файле (необязательно)
class ImageFile(BaseModel):
    # Лишние поля не принимаем
    model_config = ConfigDict(extra="forbid")

    # Ширина
    width: int = Field(ge=1, le=10_000)
    # Высота
    height: int = Field(ge=1, le=10_000)
    # Найденные лица
    faces: list[dict[str, float]] = Field(default_factory=list, max_length=20)
    # Оригинал JPEG в base64
    original_jpeg: str
    # Маска фона PNG в base64
    mask_png: str | None = None
    # Откуда маска: auto — нейросеть, edited — поправлена кистью
    mask_source: Literal["auto", "edited"] | None = None


# Весь файл
class TransferFile(BaseModel):
    # Лишние поля не принимаем
    model_config = ConfigDict(extra="forbid")

    # Название формата
    format: Literal["nitegraf"]
    # Версия формата
    version: int = Field(ge=1)
    # Когда сохранён
    exported_at: str | None = None
    # Какой версией программы
    app: str | None = None
    # Портрет
    project: ProjectFile
    # Подготовленное фото PNG в base64 (эталон сходства и картинка «до»)
    source_png: str
    # Исходное фото
    image: ImageFile | None = None

    # Новее, чем умеет программа, — читать нельзя
    @field_validator("version")
    # Метод класса
    @classmethod
    # Проверка версии
    def _supported(cls, v: int) -> int:
        # Версия из будущего
        if v > VERSION:
            # Понятный текст
            raise ValueError("Файл сохранён новой версией программы — обновите «Нитеграф»")
        # Ок
        return v


# Байты → base64-текст
def _b64(data: bytes | None) -> str | None:
    # None остаётся None
    return base64.b64encode(data).decode("ascii") if data else None


# base64-текст → байты (ошибка — понятный ValueError)
def _unb64(text: str, what: str) -> bytes:
    # Пробуем
    try:
        # Строгий разбор
        return base64.b64decode(text, validate=True)
    # Не base64
    except (binascii.Error, ValueError) as exc:
        # Понятный текст
        raise ValueError(f"{what}: испорченные данные") from exc


# Портрет из базы → содержимое файла
def export_project(project: dict[str, Any]) -> dict[str, Any]:
    # Подготовленное фото
    source = storage.get_source_png(project["id"])
    # Исходное фото с маской (если сохранилось)
    image = storage.get_image(project["image_id"], with_blobs=True) if project.get("image_id") else None
    # Содержимое файла
    return {
        # Название формата
        "format": FORMAT,
        # Версия формата
        "version": VERSION,
        # Когда сохранён
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # Какой версией программы
        "app": config.app_version(),
        # Портрет
        "project": {
            # Поля портрета, которые переносятся как есть
            **{k: project[k] for k in ("name", "diameter_cm", "line_count", "current_step", "speed_sec", "prep", "own_spool_m", "sequence")},
            # Учёт времени (как в базе)
            "activity": project.get("activity") or {},
            # Режим
            "mode": project.get("mode") or "mono",
            # Доска
            "board": project.get("board") or "white",
            # Текущая нить
            "current_layer": project.get("current_layer") or 0,
            # Нити
            "layers": project.get("layers") or [],
        },
        # Подготовленное фото
        "source_png": _b64(source),
        # Исходное фото
        "image": None
        # Нет фото — пусто
        if image is None
        # Иначе — фото, лица и маска
        else {
            # Размер
            "width": image["width"],
            # Высота
            "height": image["height"],
            # Лица
            "faces": image["faces"],
            # Оригинал
            "original_jpeg": _b64(image["original"]),
            # Маска (если посчитана)
            "mask_png": _b64(image.get("mask")),
            # Откуда маска
            "mask_source": image.get("mask_source") if image.get("mask") else None,
        },
    }


# Содержимое файла → новый портрет в базе (возвращает его)
def import_project(data: TransferFile) -> dict[str, Any]:
    # Подготовленное фото
    source = _unb64(data.source_png, "Подготовленное фото")
    # Это должна быть картинка
    try:
        # Проверка
        load_image(source)
    # Не картинка
    except ImageError as exc:
        # Понятный текст
        raise ValueError("Подготовленное фото испорчено") from exc
    # Ссылка на исходное фото (если есть в файле)
    image_id = None
    # Фото есть
    if data.image is not None:
        # Оригинал
        original = _unb64(data.image.original_jpeg, "Исходное фото")
        # Это должна быть картинка
        try:
            # Проверка
            load_image(original)
        # Не картинка
        except ImageError as exc:
            # Понятный текст
            raise ValueError("Исходное фото испорчено") from exc
        # Сохраняем фото
        image_id = storage.create_image(width=data.image.width, height=data.image.height, original=original, faces=data.image.faces)["id"]
        # Маска есть —
        if data.image.mask_png:
            # — сохраняем (поправленная кистью остаётся поправленной)
            storage.save_mask(image_id, _unb64(data.image.mask_png, "Маска фона"), edited=data.image.mask_source == "edited")
    # Портрет
    p = data.project
    # Создаём портрет со всем прогрессом
    return storage.create_project(
        # Название
        name=p.name.strip() or "Портрет",
        # Диаметр
        diameter_cm=round(p.diameter_cm, 1),
        # Число линий
        line_count=p.line_count,
        # Скорость
        speed_sec=round(p.speed_sec, 1),
        # Гвозди
        sequence=p.sequence,
        # Подготовленное фото
        source_png=source,
        # Исходное фото
        image_id=image_id,
        # Настройки кадра
        prep=p.prep,
        # Режим
        mode=p.mode,
        # Доска
        board=p.board,
        # Нити
        layers=[layer.model_dump() for layer in p.layers],
        # Шаг
        current_step=p.current_step,
        # Текущая нить
        current_layer=p.current_layer,
        # Своя катушка
        own_spool_m=p.own_spool_m,
        # Учёт времени
        activity=p.activity,
    )
