"""SQLite-хранилище: проекты и загруженные фото (stdlib sqlite3, без ORM)."""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# JSON — храним настройки кадра и журнал времени текстом
import json
# Встроенная в Python база данных SQLite (один файл, сервер не нужен)
import sqlite3
# Генератор уникальных идентификаторов
import uuid
# Декоратор, превращающий функцию с yield в «with ...:» (открыть/закрыть соединение)
from contextlib import contextmanager
# Дата и время в UTC — для created_at/updated_at и чистки старых фото
from datetime import datetime, timedelta, timezone
# Путь к файлу базы
from pathlib import Path
# Типы: Any — любое значение, Iterator — то, что отдаёт генератор
from typing import Any, Iterator

# Где лежит файл базы (можно переопределить переменной окружения)
from .config import db_path

# Схема базы: две таблицы. IF NOT EXISTS — создаются только при первом запуске
_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    diameter_cm   REAL NOT NULL,
    line_count    INTEGER NOT NULL,
    current_step  INTEGER NOT NULL DEFAULT 1,
    speed_sec     REAL NOT NULL,
    sequence      BLOB NOT NULL,
    source_png    BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
    id          TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    original    BLOB NOT NULL,
    faces       TEXT NOT NULL DEFAULT '[]',
    mask        BLOB
);
"""

# Колонки, добавленные после первой версии: старые базы дополняются при подключении.
# Словарь «таблица → {колонка: её описание в SQL}»
_MIGRATIONS = {
    # Новые колонки таблицы проектов
    "projects": {
        # Ссылка на исходное фото в таблице images (для правки фото)
        "image_id": "TEXT",
        # Настройки кадра (масштаб, сдвиг, яркость…) в JSON
        "prep": "TEXT NOT NULL DEFAULT '{}'",
        # Длина своей катушки
        "own_spool_m": "REAL",  # длина катушки, которая есть у человека (для плана смены катушек)
        # Журнал времени плетения
        "activity": "TEXT NOT NULL DEFAULT '{}'",  # время плетения по дням: {"2026-10-27": [сек, шагов]}
    },
    # mask_source: 'auto' — маска нейросети после чистки, 'edited' — поправлена кистью.
    # NULL у старых масок (до чистки) — такие считаются заново при первом запросе.
    # Новые колонки таблицы фото: исходная автоматическая маска и откуда взялась текущая
    "images": {"mask_auto": "BLOB", "mask_source": "TEXT"},
}

# Какие поля проекта можно менять через PATCH (защита от подмены id, sequence и т. п.)
EDITABLE_FIELDS = ("name", "diameter_cm", "line_count", "current_step", "speed_sec", "own_spool_m")
# Колонки для списка проектов (без тяжёлого PNG)
_SUMMARY_COLUMNS = (
    # Основные поля проекта
    "id, name, created_at, updated_at, diameter_cm, line_count, current_step, speed_sec, image_id, prep,"
    # Поля, добавленные позже
    " own_spool_m, activity"
)


# Текущее время в UTC в формате ISO (2026-10-27T21:00:00+00:00)
def _now() -> str:
    # Секунды без долей — короче и достаточно для сортировки
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Новый короткий идентификатор: 12 шестнадцатеричных символов
def _new_id() -> str:
    # Случайный UUID, обрезанный до 12 символов (вероятность совпадения ничтожна)
    return uuid.uuid4().hex[:12]


# Превращаем генератор в менеджер контекста: with _connect() as conn: ...
@contextmanager
# Открыть соединение с базой, подготовить схему, а в конце сохранить и закрыть
def _connect() -> Iterator[sqlite3.Connection]:
    # Путь к файлу базы
    path = Path(db_path())
    # Создаём папку для базы, если её ещё нет
    path.parent.mkdir(parents=True, exist_ok=True)
    # Открываем (или создаём) файл базы
    conn = sqlite3.connect(path)
    # Строки результата будут доступны по имени колонки: row["name"]
    conn.row_factory = sqlite3.Row
    # finally гарантирует закрытие соединения даже при ошибке
    try:
        # Создаём таблицы, если их нет
        conn.executescript(_SCHEMA)
        # Для каждой таблицы проверяем новые колонки
        for table, columns in _MIGRATIONS.items():
            # Какие колонки уже есть в таблице
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            # Перебираем колонки, которые должны быть
            for column, ddl in columns.items():
                # Колонки нет — старая база
                if column not in existing:
                    # Добавляем её (данные в старых строках получат значение по умолчанию)
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        # Отдаём соединение в блок with
        yield conn
        # Блок with завершился без ошибок — сохраняем изменения
        conn.commit()
    # В любом случае
    finally:
        # Закрываем соединение (при ошибке несохранённые изменения откатятся)
        conn.close()


# Строку базы → обычный словарь с удобными типами
def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    # Копия строки как словарь
    data = dict(row)
    # Последовательность гвоздей хранится байтами (по байту на гвоздь)
    if "sequence" in data:
        # Байты → список чисел
        data["sequence"] = list(data["sequence"])  # bytes → list[int]
    # Настройки кадра хранятся JSON-текстом
    if "prep" in data:
        # Текст → словарь (пустой текст → пустой словарь)
        data["prep"] = json.loads(data["prep"] or "{}")
    # Журнал времени тоже JSON
    if "activity" in data:
        # Текст → словарь
        data["activity"] = json.loads(data["activity"] or "{}")
    # Готовый словарь
    return data


# --- проекты ----------------------------------------------------------------
# Создать проект; * — все аргументы только по имени, чтобы не перепутать порядок
def create_project(
    # Дальше — только именованные аргументы
    *,
    # Название портрета
    name: str,
    # Диаметр доски
    diameter_cm: float,
    # Выбранное число линий
    line_count: int,
    # Скорость автоперелистывания
    speed_sec: float,
    # Последовательность гвоздей (5001 номер)
    sequence: list[int],
    # Подготовленное фото в PNG — эталон для сходства и картинка «до»
    source_png: bytes,
    # Ссылка на исходное фото (если проект создан из редактора)
    image_id: str | None = None,
    # Настройки кадра
    prep: dict | None = None,
# Возвращает созданный проект как словарь
) -> dict[str, Any]:
    # Номера гвоздей хранятся по байту — каждый должен быть 0..255
    if any(not 0 <= n <= 255 for n in sequence):
        # Иначе bytes() упадёт — сообщаем понятнее
        raise ValueError("Номер гвоздя не помещается в байт")
    # Новый id
    project_id = _new_id()
    # Время создания (оно же время изменения)
    now = _now()
    # Открываем базу
    with _connect() as conn:
        # Вставляем строку; знаки ? — параметры (защита от SQL-инъекций)
        conn.execute(
            # Список колонок; current_step сразу 1 — плетение начинается с первого шага
            "INSERT INTO projects (id, name, created_at, updated_at, diameter_cm, line_count, current_step,"
            # Продолжение списка колонок и значения
            " speed_sec, sequence, source_png, image_id, prep) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
            # Значения параметров по порядку
            (
                # id, имя, даты, диаметр, линии, скорость
                project_id, name, now, now, diameter_cm, line_count, speed_sec,
                # последовательность байтами, PNG, ссылка на фото, настройки кадра JSON-текстом
                bytes(sequence), source_png, image_id, json.dumps(prep or {}),
            ),
        )
    # Читаем только что созданный проект обратно (с вычисленными полями)
    project = get_project(project_id)
    # Он обязательно есть — мы его только что вставили
    assert project is not None
    # Отдаём проект
    return project


# Список всех проектов, свежие сверху
def list_projects() -> list[dict[str, Any]]:
    # Открываем базу
    with _connect() as conn:
        # Выбираем все строки
        rows = conn.execute(
            # Сортировка: недавно изменённые первыми, при равенстве — недавно созданные
            f"SELECT {_SUMMARY_COLUMNS}, sequence FROM projects ORDER BY updated_at DESC, created_at DESC"
        # fetchall — забрать сразу все строки результата
        ).fetchall()
    # Каждую строку — в словарь
    return [_row_to_dict(r) for r in rows]


# Один проект по id (или None, если нет)
def get_project(project_id: str) -> dict[str, Any] | None:
    # Открываем базу
    with _connect() as conn:
        # Ищем строку по id
        row = conn.execute(
            # Все поля, кроме PNG, плюс последовательность
            f"SELECT {_SUMMARY_COLUMNS}, sequence FROM projects WHERE id = ?", (project_id,)
        # fetchone — одна строка или None
        ).fetchone()
    # Нашли — словарь, не нашли — None
    return _row_to_dict(row) if row else None


# Подготовленное фото проекта (PNG) — отдельно, потому что оно большое
def get_source_png(project_id: str) -> bytes | None:
    # Открываем базу
    with _connect() as conn:
        # Берём только PNG
        row = conn.execute("SELECT source_png FROM projects WHERE id = ?", (project_id,)).fetchone()
    # Байты PNG или None
    return bytes(row["source_png"]) if row else None


# Изменить разрешённые поля проекта
def update_project(project_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    # Поля, которые менять нельзя
    unknown = set(fields) - set(EDITABLE_FIELDS)
    # Если такие есть
    if unknown:
        # Ошибка со списком лишних полей
        raise ValueError(f"Нельзя менять поля: {sorted(unknown)}")
    # Есть что менять
    if fields:
        # Часть SQL вида «name = ?, speed_sec = ?» (имена полей проверены выше — инъекции нет)
        assignments = ", ".join(f"{k} = ?" for k in fields)
        # Открываем базу
        with _connect() as conn:
            # Обновляем строку и время изменения
            cur = conn.execute(
                # SQL-запрос обновления
                f"UPDATE projects SET {assignments}, updated_at = ? WHERE id = ?",
                # Значения полей, затем время и id
                (*fields.values(), _now(), project_id),
            )
            # Ни одна строка не изменилась — проекта нет
            if cur.rowcount == 0:
                # Сообщаем «не найдено»
                return None
    # Отдаём проект после изменения
    return get_project(project_id)


# Записать время плетения за день
def add_activity(project_id: str, day: str, seconds: float, steps: int) -> dict[str, Any] | None:
    """Прибавить время плетения за день. Атомарно: два окна с одним проектом не теряют данные."""
    # Открываем базу
    with _connect() as conn:
        # Сразу берём блокировку на запись — второй запрос подождёт, и суммы не потеряются
        conn.execute("BEGIN IMMEDIATE")
        # Текущий журнал проекта
        row = conn.execute("SELECT activity FROM projects WHERE id = ?", (project_id,)).fetchone()
        # Проекта нет
        if row is None:
            # «не найдено»
            return None
        # Журнал: {"ГГГГ-ММ-ДД": [секунды, шаги]}
        log = json.loads(row["activity"] or "{}")
        # Что уже записано за этот день (или нули)
        sec, done = log.get(day, [0, 0])
        # Прибавляем новое время (с округлением до 0,1 с) и шаги
        log[day] = [round(sec + seconds, 1), done + steps]
        # Сохраняем журнал; sort_keys — дни по порядку
        conn.execute("UPDATE projects SET activity = ? WHERE id = ?", (json.dumps(log, sort_keys=True), project_id))
    # Проект с обновлённым журналом
    return get_project(project_id)


# Новый расчёт после правки фото
def replace_photo(
    # id проекта, затем только именованные: новая последовательность, PNG, настройки кадра, число линий
    project_id: str, *, sequence: list[int], source_png: bytes, prep: dict, line_count: int
# Возвращает проект или None
) -> dict[str, Any] | None:
    """Новый расчёт после правки фото: схема другая, поэтому прогресс начинается заново."""
    # Открываем базу
    with _connect() as conn:
        # Обновляем всё, что зависит от фото
        cur = conn.execute(
            # Прогресс сбрасываем на шаг 1 — старая последовательность больше не действует
            "UPDATE projects SET sequence = ?, source_png = ?, prep = ?, line_count = ?, current_step = 1,"
            # Время изменения и условие по id
            " updated_at = ? WHERE id = ?",
            # Значения параметров
            (bytes(sequence), source_png, json.dumps(prep), line_count, _now(), project_id),
        )
        # Проекта нет
        if cur.rowcount == 0:
            # «не найдено»
            return None
    # Обновлённый проект
    return get_project(project_id)


# Удалить проект (и его фото, если оно больше никому не нужно)
def delete_project(project_id: str) -> bool:
    # Открываем базу
    with _connect() as conn:
        # Запоминаем, какое фото было у проекта
        row = conn.execute("SELECT image_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        # Удаляем проект
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        # У проекта было фото
        if row and row["image_id"]:
            # Удаляем фото, если на него не ссылается ни один другой проект
            conn.execute(
                # Условие NOT EXISTS — защита общих фото
                "DELETE FROM images WHERE id = ? AND NOT EXISTS (SELECT 1 FROM projects WHERE image_id = ?)",
                # id фото дважды: для удаления и для проверки
                (row["image_id"], row["image_id"]),
            )
    # True — проект был и удалён, False — его не было
    return cur.rowcount > 0


# --- фото -------------------------------------------------------------------
# Сохранить загруженное в редактор фото
def create_image(*, width: int, height: int, original: bytes, faces: list[dict]) -> dict[str, Any]:
    # Новый id фото
    image_id = _new_id()
    # Открываем базу
    with _connect() as conn:
        # Вставляем строку
        conn.execute(
            # Колонки и параметры
            "INSERT INTO images (id, created_at, width, height, original, faces) VALUES (?, ?, ?, ?, ?, ?)",
            # Значения; найденные лица — JSON-текстом
            (image_id, _now(), width, height, original, json.dumps(faces)),
        )
    # Краткая информация о фото для ответа API
    return {"id": image_id, "width": width, "height": height, "faces": faces}


# Получить фото; with_blobs=True — вместе с байтами оригинала и маски
def get_image(image_id: str, *, with_blobs: bool = False) -> dict[str, Any] | None:
    # Базовые колонки всегда
    columns = "id, created_at, width, height, faces, mask_source" + (
        # С байтами — оригинал и маска; без них — только признак «маска есть и она актуальной версии»
        ", original, mask" if with_blobs else ", (mask IS NOT NULL AND mask_source IS NOT NULL) AS has_mask"
    )
    # Открываем базу
    with _connect() as conn:
        # Ищем фото по id
        row = conn.execute(f"SELECT {columns} FROM images WHERE id = ?", (image_id,)).fetchone()
    # Не нашли
    if not row:
        # «не найдено»
        return None
    # Строка → словарь
    data = dict(row)
    # Лица: JSON-текст → список
    data["faces"] = json.loads(data["faces"])
    # Маска сохранена старой версией программы (без чистки) — делаем вид, что её нет
    if with_blobs and data["mask_source"] is None:
        # Тогда маска будет посчитана заново
        data["mask"] = None  # маска старой версии — пересчитаем
    # Готовый словарь
    return data


# Сохранить маску фона
def save_mask(image_id: str, mask_png: bytes, *, edited: bool = False) -> None:
    """Автоматическая маска запоминается отдельно — к ней можно вернуться после правок кистью."""
    # Открываем базу
    with _connect() as conn:
        # Маска поправлена кистью
        if edited:
            # Меняем только текущую маску, автоматическую сохраняем для сброса
            conn.execute("UPDATE images SET mask = ?, mask_source = 'edited' WHERE id = ?", (mask_png, image_id))
        # Маска посчитана нейросетью
        else:
            # Пишем и как текущую, и как автоматическую
            conn.execute(
                # SQL-запрос
                "UPDATE images SET mask = ?, mask_auto = ?, mask_source = 'auto' WHERE id = ?",
                # Одна и та же маска в обе колонки
                (mask_png, mask_png, image_id),
            )


# Сбросить правки кистью
def reset_mask(image_id: str) -> None:
    """Отменить правки кистью: вернуть автоматическую маску (или считать заново, если её нет)."""
    # Открываем базу
    with _connect() as conn:
        # Копируем автоматическую маску в текущую
        conn.execute(
            # Текущая маска = автоматическая
            "UPDATE images SET mask = mask_auto,"
            # Если автоматической нет — помечаем NULL, и маска посчитается заново
            " mask_source = CASE WHEN mask_auto IS NULL THEN NULL ELSE 'auto' END WHERE id = ?",
            # id фото
            (image_id,),
        )


# Уборка: удалить фото, которые загрузили в редактор, но так и не создали проект
def delete_orphan_images(older_than: timedelta = timedelta(days=1)) -> int:
    """Фото, загруженные в редактор, но так и не ставшие проектом."""
    # Граница по времени: всё, что старше суток
    border = (datetime.now(timezone.utc) - older_than).isoformat(timespec="seconds")
    # Открываем базу
    with _connect() as conn:
        # Удаляем старые фото без проектов
        cur = conn.execute(
            # Фото старше границы
            "DELETE FROM images WHERE created_at < ? AND id NOT IN"
            # И не используемые ни одним проектом
            " (SELECT image_id FROM projects WHERE image_id IS NOT NULL)",
            # Граница времени
            (border,),
        )
    # Сколько фото удалено
    return cur.rowcount
