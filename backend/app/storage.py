"""SQLite-хранилище: проекты и загруженные фото (stdlib sqlite3, без ORM)."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import db_path

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
_MIGRATIONS = {
    "projects": {
        "image_id": "TEXT",
        "prep": "TEXT NOT NULL DEFAULT '{}'",
        "own_spool_m": "REAL",  # длина катушки, которая есть у человека (для плана смены катушек)
        "activity": "TEXT NOT NULL DEFAULT '{}'",  # время плетения по дням: {"2026-10-27": [сек, шагов]}
    },
    # mask_source: 'auto' — маска нейросети после чистки, 'edited' — поправлена кистью.
    # NULL у старых масок (до чистки) — такие считаются заново при первом запросе.
    "images": {"mask_auto": "BLOB", "mask_source": "TEXT"},
}

EDITABLE_FIELDS = ("name", "diameter_cm", "line_count", "current_step", "speed_sec", "own_spool_m")
_SUMMARY_COLUMNS = (
    "id, name, created_at, updated_at, diameter_cm, line_count, current_step, speed_sec, image_id, prep,"
    " own_spool_m, activity"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = Path(db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
        for table, columns in _MIGRATIONS.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for column, ddl in columns.items():
                if column not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        yield conn
        conn.commit()
    finally:
        conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    if "sequence" in data:
        data["sequence"] = list(data["sequence"])  # bytes → list[int]
    if "prep" in data:
        data["prep"] = json.loads(data["prep"] or "{}")
    if "activity" in data:
        data["activity"] = json.loads(data["activity"] or "{}")
    return data


# --- проекты ----------------------------------------------------------------
def create_project(
    *,
    name: str,
    diameter_cm: float,
    line_count: int,
    speed_sec: float,
    sequence: list[int],
    source_png: bytes,
    image_id: str | None = None,
    prep: dict | None = None,
) -> dict[str, Any]:
    if any(not 0 <= n <= 255 for n in sequence):
        raise ValueError("Номер гвоздя не помещается в байт")
    project_id = _new_id()
    now = _now()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at, diameter_cm, line_count, current_step,"
            " speed_sec, sequence, source_png, image_id, prep) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
            (
                project_id, name, now, now, diameter_cm, line_count, speed_sec,
                bytes(sequence), source_png, image_id, json.dumps(prep or {}),
            ),
        )
    project = get_project(project_id)
    assert project is not None
    return project


def list_projects() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT {_SUMMARY_COLUMNS}, sequence FROM projects ORDER BY updated_at DESC, created_at DESC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_project(project_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            f"SELECT {_SUMMARY_COLUMNS}, sequence FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def get_source_png(project_id: str) -> bytes | None:
    with _connect() as conn:
        row = conn.execute("SELECT source_png FROM projects WHERE id = ?", (project_id,)).fetchone()
    return bytes(row["source_png"]) if row else None


def update_project(project_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    unknown = set(fields) - set(EDITABLE_FIELDS)
    if unknown:
        raise ValueError(f"Нельзя менять поля: {sorted(unknown)}")
    if fields:
        assignments = ", ".join(f"{k} = ?" for k in fields)
        with _connect() as conn:
            cur = conn.execute(
                f"UPDATE projects SET {assignments}, updated_at = ? WHERE id = ?",
                (*fields.values(), _now(), project_id),
            )
            if cur.rowcount == 0:
                return None
    return get_project(project_id)


def add_activity(project_id: str, day: str, seconds: float, steps: int) -> dict[str, Any] | None:
    """Прибавить время плетения за день. Атомарно: два окна с одним проектом не теряют данные."""
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT activity FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            return None
        log = json.loads(row["activity"] or "{}")
        sec, done = log.get(day, [0, 0])
        log[day] = [round(sec + seconds, 1), done + steps]
        conn.execute("UPDATE projects SET activity = ? WHERE id = ?", (json.dumps(log, sort_keys=True), project_id))
    return get_project(project_id)


def replace_photo(
    project_id: str, *, sequence: list[int], source_png: bytes, prep: dict, line_count: int
) -> dict[str, Any] | None:
    """Новый расчёт после правки фото: схема другая, поэтому прогресс начинается заново."""
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE projects SET sequence = ?, source_png = ?, prep = ?, line_count = ?, current_step = 1,"
            " updated_at = ? WHERE id = ?",
            (bytes(sequence), source_png, json.dumps(prep), line_count, _now(), project_id),
        )
        if cur.rowcount == 0:
            return None
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT image_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        if row and row["image_id"]:
            conn.execute(
                "DELETE FROM images WHERE id = ? AND NOT EXISTS (SELECT 1 FROM projects WHERE image_id = ?)",
                (row["image_id"], row["image_id"]),
            )
    return cur.rowcount > 0


# --- фото -------------------------------------------------------------------
def create_image(*, width: int, height: int, original: bytes, faces: list[dict]) -> dict[str, Any]:
    image_id = _new_id()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO images (id, created_at, width, height, original, faces) VALUES (?, ?, ?, ?, ?, ?)",
            (image_id, _now(), width, height, original, json.dumps(faces)),
        )
    return {"id": image_id, "width": width, "height": height, "faces": faces}


def get_image(image_id: str, *, with_blobs: bool = False) -> dict[str, Any] | None:
    columns = "id, created_at, width, height, faces, mask_source" + (
        ", original, mask" if with_blobs else ", (mask IS NOT NULL AND mask_source IS NOT NULL) AS has_mask"
    )
    with _connect() as conn:
        row = conn.execute(f"SELECT {columns} FROM images WHERE id = ?", (image_id,)).fetchone()
    if not row:
        return None
    data = dict(row)
    data["faces"] = json.loads(data["faces"])
    if with_blobs and data["mask_source"] is None:
        data["mask"] = None  # маска старой версии — пересчитаем
    return data


def save_mask(image_id: str, mask_png: bytes, *, edited: bool = False) -> None:
    """Автоматическая маска запоминается отдельно — к ней можно вернуться после правок кистью."""
    with _connect() as conn:
        if edited:
            conn.execute("UPDATE images SET mask = ?, mask_source = 'edited' WHERE id = ?", (mask_png, image_id))
        else:
            conn.execute(
                "UPDATE images SET mask = ?, mask_auto = ?, mask_source = 'auto' WHERE id = ?",
                (mask_png, mask_png, image_id),
            )


def reset_mask(image_id: str) -> None:
    """Отменить правки кистью: вернуть автоматическую маску (или считать заново, если её нет)."""
    with _connect() as conn:
        conn.execute(
            "UPDATE images SET mask = mask_auto,"
            " mask_source = CASE WHEN mask_auto IS NULL THEN NULL ELSE 'auto' END WHERE id = ?",
            (image_id,),
        )


def delete_orphan_images(older_than: timedelta = timedelta(days=1)) -> int:
    """Фото, загруженные в редактор, но так и не ставшие проектом."""
    border = (datetime.now(timezone.utc) - older_than).isoformat(timespec="seconds")
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM images WHERE created_at < ? AND id NOT IN"
            " (SELECT image_id FROM projects WHERE image_id IS NOT NULL)",
            (border,),
        )
    return cur.rowcount
