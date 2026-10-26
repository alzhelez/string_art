"""HTTP API (FastAPI). Запуск: uvicorn app.main:app --reload --port 8000"""

from __future__ import annotations

import io
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from . import config, photo, storage
from .algorithm import build_line_cache, generate_sequence
from .geometry import arc_spacing, nail_label
from .image_prep import ImageError, gray_png, load_image, target_map
from .pdf import build_instructions_pdf
from .render import render_png
from .thread import cumulative_lengths_m, recommended_lines, thread_stats


@asynccontextmanager
async def lifespan(_: FastAPI):
    build_line_cache()  # первый проект не будет ждать предрасчёт линий
    storage.delete_orphan_images()
    photo.engine.warm_up()  # модель удаления фона грузится в фоне, сервер стартует сразу
    yield


app = FastAPI(title="String Art Studio API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ID_RE = re.compile(r"[0-9a-f]{12}")


# --- Схемы ------------------------------------------------------------------
class PrepIn(BaseModel):
    """Подготовка фото. Все поля необязательны — по умолчанию центр, без зума и коррекций."""

    model_config = ConfigDict(extra="forbid")

    center_x: float = Field(0.5, ge=0, le=1, description="Центр кадра, доля ширины фото")
    center_y: float = Field(0.5, ge=0, le=1, description="Центр кадра, доля высоты фото")
    zoom: float = Field(1.0, ge=1, le=4, description="1 — кадр по короткой стороне фото, 4 — в 4 раза ближе")
    brightness: float = Field(0.0, ge=-0.5, le=0.5)
    contrast: float = Field(0.0, ge=-0.5, le=1.0)
    remove_background: bool = False
    face_focus: bool = Field(False, description="Детальнее прорабатывать найденное лицо")

    def to_prep(self) -> photo.Prep:
        return photo.Prep(**self.model_dump())


class FaceOut(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ImageOut(BaseModel):
    id: str
    width: int
    height: int
    faces: list[FaceOut] = Field(description="Найденные лица, крупные первыми; координаты в долях фото")
    has_mask: bool = False
    face_prep: PrepIn | None = Field(None, description="Готовый кадр «голова и плечи» по самому крупному лицу")


class ThreadStatsOut(BaseModel):
    steps: int
    diameter_cm: float
    raw_length_m: float
    margin: float
    total_length_m: float
    spool_m: int
    spool_count: int
    nail_spacing_mm: float


class ProjectSummary(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    diameter_cm: float
    line_count: int
    current_step: int
    speed_sec: float
    image_id: str | None = Field(None, description="Фото, из которого сделан портрет (для правки кадра)")
    prep: dict[str, Any] = Field(default_factory=dict, description="Параметры подготовки фото")
    stats: ThreadStatsOut


class ProjectDetail(ProjectSummary):
    sequence: list[int] = Field(description="Гвозди по порядку, длина = max_lines + 1, первый — A1")


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    diameter_cm: float | None = Field(default=None, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    line_count: int | None = Field(default=None, ge=config.MIN_LINES, le=config.MAX_LINES)
    current_step: int | None = Field(default=None, ge=1, le=config.MAX_LINES)
    speed_sec: float | None = Field(default=None, ge=config.MIN_SPEED_SEC, le=config.MAX_SPEED_SEC)


class CreateFromImage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_id: str
    name: str | None = Field(None, max_length=100)
    diameter_cm: float = Field(config.DEFAULT_DIAMETER_CM, ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    prep: PrepIn = Field(default_factory=PrepIn)


class Step(BaseModel):
    number: int
    from_nail: int
    to_nail: int
    from_label: str
    to_label: str
    thread_used_m: float = Field(description="Сколько лески (без запаса) уйдёт к концу этого шага")


class StepsPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[Step]


# --- Хелперы ----------------------------------------------------------------
def _summary(p: dict[str, Any]) -> dict[str, Any]:
    stats = thread_stats(p["sequence"], p["line_count"], p["diameter_cm"]).to_dict()
    out = {k: v for k, v in p.items() if k != "sequence"}
    out["stats"] = stats
    return out


def _detail(p: dict[str, Any]) -> dict[str, Any]:
    out = _summary(p)
    out["sequence"] = p["sequence"]
    return out


def _get_or_404(project_id: str) -> dict[str, Any]:
    if not _ID_RE.fullmatch(project_id):
        raise HTTPException(404, "Проект не найден")
    project = storage.get_project(project_id)
    if project is None:
        raise HTTPException(404, "Проект не найден")
    return project


def _default_name(filename: str | None) -> str:
    stem = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", (filename or "").strip())
    return stem[:100] or f"Портрет от {datetime.now():%d.%m.%Y}"


def _image_or_404(image_id: str, *, with_blobs: bool = False) -> dict[str, Any]:
    image = storage.get_image(image_id, with_blobs=with_blobs) if _ID_RE.fullmatch(image_id) else None
    if image is None:
        raise HTTPException(404, "Фото не найдено")
    return image


def _read_upload(file: UploadFile) -> Image.Image:
    data = file.file.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Файл слишком большой (максимум 15 МБ)")
    try:
        return photo.normalize_original(load_image(data))
    except ImageError as exc:
        raise HTTPException(400, str(exc)) from exc


def _store_image(original: Image.Image) -> dict[str, Any]:
    faces = [f.__dict__ for f in photo.detect_faces(original)]
    return storage.create_image(
        width=original.width, height=original.height, original=photo.jpeg_bytes(original), faces=faces
    )


def _image_out(image: dict[str, Any]) -> dict[str, Any]:
    out = {k: image[k] for k in ("id", "width", "height", "faces")}
    out["has_mask"] = bool(image.get("has_mask") or image.get("mask"))
    if image["faces"]:
        face = photo.Box(**image["faces"][0])
        out["face_prep"] = photo.face_prep(image["width"], image["height"], face).to_dict()
    return out


_NOT_INSTALLED = (
    "Удаление фона не установлено. В папке backend выполните: pip install -r requirements-bg.txt "
    "и перезапустите бэкенд (scripts\\start.bat делает это сам)."
)


def _compute_mask(image_id: str) -> None:
    """Задача для очереди: посчитать маску и сохранить в БД."""
    image = storage.get_image(image_id, with_blobs=True)
    if image is None or image.get("mask"):
        return
    mask = photo.background_mask(Image.open(io.BytesIO(image["original"])))
    storage.save_mask(image_id, photo.png_bytes(mask))


def _mask_status(image: dict[str, Any]) -> dict[str, Any]:
    if image.get("mask") or image.get("has_mask"):
        return {"status": "ready", "model": photo.engine.state, "message": None}
    if not photo.background_removal_available():
        raise HTTPException(503, _NOT_INSTALLED)
    job = photo.engine.job(image["id"])
    if job is None:
        return {"status": "idle", "model": photo.engine.state, "message": None}
    if not job.done():
        return {"status": "processing", "model": photo.engine.state, "message": None}
    exc = job.exception()
    if exc is not None:
        return {"status": "error", "model": photo.engine.state, "message": str(exc)}
    return {"status": "ready", "model": photo.engine.state, "message": None}


def _mask_for(image: dict[str, Any]) -> Image.Image:
    """Маска фона для расчёта портрета: из БД или считаем (ждём очередь)."""
    if not image.get("mask"):
        if not photo.background_removal_available():
            raise HTTPException(503, _NOT_INSTALLED)
        try:
            photo.engine.submit(image["id"], lambda: _compute_mask(image["id"])).result()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"Не удалось убрать фон: {exc}") from exc
        fresh = storage.get_image(image["id"], with_blobs=True)
        assert fresh is not None
        image["mask"] = fresh["mask"]
    return Image.open(io.BytesIO(image["mask"]))


def _prepare(image: dict[str, Any], prep: photo.Prep) -> Image.Image:
    original = Image.open(io.BytesIO(image["original"]))
    mask = _mask_for(image) if prep.remove_background else None
    return photo.prepare_gray(original, prep, mask)


def _generate(image: dict[str, Any], prep: photo.Prep) -> tuple[list[int], Image.Image]:
    """Подготовка фото + расчёт последовательности гвоздей."""
    if prep.face_focus and not image["faces"]:
        raise HTTPException(422, "На фото не найдено лицо — снимите галочку «Выделить лицо»")
    gray = _prepare(image, prep)
    importance = None
    if prep.face_focus:
        face = photo.Box(**image["faces"][0])
        importance = photo.face_importance(image["width"], image["height"], prep, face)
    return generate_sequence(target_map(gray), importance=importance), gray


# --- Маршруты ---------------------------------------------------------------
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")


@app.get("/", include_in_schema=False)
def root() -> Response:
    """Это API, а не сайт: открывший http://localhost:8000 в браузере попадёт на приложение."""
    return RedirectResponse(FRONTEND_URL, status_code=307)


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/api", include_in_schema=False)
def api_index() -> HTMLResponse:
    return HTMLResponse(
        "<meta charset=utf-8><p>Это API «Нитеграфа». Приложение открывается по адресу "
        f'<a href="{FRONTEND_URL}">{FRONTEND_URL}</a>, документация API — <a href="/docs">/docs</a>.</p>'
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {
        "sectors": list(config.SECTORS),
        "nails_per_sector": config.NAILS_PER_SECTOR,
        "total_nails": config.TOTAL_NAILS,
        "start_nail": config.START_NAIL,
        "lines": {"min": config.MIN_LINES, "max": config.MAX_LINES, "per_cm": config.LINES_PER_CM},
        "diameter": {
            "presets_cm": list(config.DIAMETER_PRESETS_CM),
            "default_cm": config.DEFAULT_DIAMETER_CM,
            "min_cm": config.MIN_DIAMETER_CM,
            "max_cm": config.MAX_DIAMETER_CM,
        },
        "thread": {
            "diameter_mm": config.THREAD_DIAMETER_MM,
            "margin": config.THREAD_MARGIN,
            "spools_m": list(config.STANDARD_SPOOLS_M),
            "big_spool_m": config.BIG_SPOOL_M,
        },
        "speed": {
            "default_sec": config.DEFAULT_SPEED_SEC,
            "step_sec": config.SPEED_STEP_SEC,
            "min_sec": config.MIN_SPEED_SEC,
            "max_sec": config.MAX_SPEED_SEC,
        },
        "max_upload_bytes": config.MAX_UPLOAD_BYTES,
        "features": {
            "face_detection": photo.face_detection_available(),
            "background_removal": photo.background_removal_available(),
        },
        "background": photo.engine.status(),
    }


@app.get("/api/projects", response_model=list[ProjectSummary])
def list_projects() -> list[dict[str, Any]]:
    return [_summary(p) for p in storage.list_projects()]


@app.post("/api/projects", response_model=ProjectDetail, status_code=201)
def create_project(
    file: Annotated[UploadFile, File(description="Фото: JPEG/PNG/WEBP/…")],
    name: Annotated[str | None, Form(max_length=100)] = None,
    diameter_cm: Annotated[
        float, Form(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)
    ] = config.DEFAULT_DIAMETER_CM,
) -> dict[str, Any]:
    """Быстрый путь: фото → портрет с настройками по умолчанию (кадр по центру)."""
    image = _store_image(_read_upload(file))
    full = storage.get_image(image["id"], with_blobs=True)
    assert full is not None
    return _create_from(full, (name or "").strip() or _default_name(file.filename), diameter_cm, photo.Prep())


@app.post("/api/projects/from-image", response_model=ProjectDetail, status_code=201)
def create_project_from_image(body: CreateFromImage) -> dict[str, Any]:
    """Портрет из фото, загруженного в редактор, с выбранным кадром и коррекциями."""
    image = _image_or_404(body.image_id, with_blobs=True)
    name = (body.name or "").strip() or f"Портрет от {datetime.now():%d.%m.%Y}"
    return _create_from(image, name, body.diameter_cm, photo.clamp_prep(body.prep.to_prep()))


def _create_from(image: dict[str, Any], name: str, diameter_cm: float, prep: photo.Prep) -> dict[str, Any]:
    sequence, gray = _generate(image, prep)
    project = storage.create_project(
        name=name,
        diameter_cm=round(diameter_cm, 1),
        line_count=recommended_lines(diameter_cm),
        speed_sec=config.DEFAULT_SPEED_SEC,
        sequence=sequence,
        source_png=gray_png(gray),
        image_id=image["id"],
        prep=prep.to_dict(),
    )
    return _detail(project)


@app.put("/api/projects/{project_id}/photo", response_model=ProjectDetail)
def update_photo(project_id: str, body: PrepIn) -> dict[str, Any]:
    """Новый кадр/коррекции → схема пересчитывается, прогресс плетения начинается с шага 1."""
    project = _get_or_404(project_id)
    if not project.get("image_id"):
        raise HTTPException(409, "У этого проекта не сохранилось исходное фото")
    image = _image_or_404(project["image_id"], with_blobs=True)
    prep = photo.clamp_prep(body.to_prep())
    sequence, gray = _generate(image, prep)
    updated = storage.replace_photo(project_id, sequence=sequence, source_png=gray_png(gray), prep=prep.to_dict())
    assert updated is not None
    return _detail(updated)


# --- Фото для редактора -----------------------------------------------------
@app.post("/api/images", response_model=ImageOut, status_code=201)
def upload_image(file: Annotated[UploadFile, File(description="Фото: JPEG/PNG/WEBP/…")]) -> dict[str, Any]:
    """Загружает фото в редактор: уменьшает до 1600 px, поворачивает по EXIF, ищет лица."""
    return _image_out(_store_image(_read_upload(file)))


@app.get("/api/images/{image_id}", response_model=ImageOut)
def get_image(image_id: str) -> dict[str, Any]:
    return _image_out(_image_or_404(image_id))


@app.get("/api/images/{image_id}/original.jpg")
def image_original(image_id: str) -> Response:
    image = _image_or_404(image_id, with_blobs=True)
    return Response(image["original"], media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


class MaskStatus(BaseModel):
    status: str = Field(description="idle — не запрашивали, processing — считается, ready — готова, error — ошибка")
    model: str = Field(description="Состояние модели: idle, loading (скачивается/грузится), ready, error")
    message: str | None = None


@app.post("/api/images/{image_id}/mask", response_model=MaskStatus)
def start_mask(image_id: str, response: Response) -> dict[str, Any]:
    """Запускает удаление фона в фоне и сразу отвечает. Статус — GET того же адреса."""
    image = _image_or_404(image_id)
    status = _mask_status(image)
    if status["status"] in ("idle", "error"):
        photo.engine.submit(image_id, lambda: _compute_mask(image_id))
        status = _mask_status(_image_or_404(image_id))
    if status["status"] != "ready":
        response.status_code = 202
    return status


@app.get("/api/images/{image_id}/mask", response_model=MaskStatus)
def mask_status(image_id: str) -> dict[str, Any]:
    return _mask_status(_image_or_404(image_id))


@app.get("/api/images/{image_id}/mask.png")
def image_mask(image_id: str) -> Response:
    """Готовая маска «человек/фон» в размере оригинала: белое — человек, чёрное — фон."""
    image = _image_or_404(image_id, with_blobs=True)
    if not image.get("mask"):
        raise HTTPException(409, "Маска ещё не готова: сначала POST /api/images/{id}/mask и дождитесь status=ready")
    return Response(image["mask"], media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/images/{image_id}/prepared.png")
def image_prepared(image_id: str, prep: Annotated[PrepIn, Query()]) -> Response:
    """Ровно то, что получит алгоритм (400×400, оттенки серого)."""
    image = _image_or_404(image_id, with_blobs=True)
    gray = _prepare(image, photo.clamp_prep(prep.to_prep()))
    return Response(gray_png(gray), media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/api/projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str) -> dict[str, Any]:
    return _detail(_get_or_404(project_id))


@app.patch("/api/projects/{project_id}", response_model=ProjectDetail)
def update_project(project_id: str, body: ProjectUpdate) -> dict[str, Any]:
    project = _get_or_404(project_id)
    fields = body.model_dump(exclude_none=True)
    if "name" in fields:
        fields["name"] = fields["name"].strip()
        if not fields["name"]:
            raise HTTPException(422, "Название не может быть пустым")
    if "diameter_cm" in fields:
        fields["diameter_cm"] = round(fields["diameter_cm"], 1)
    if "speed_sec" in fields:
        fields["speed_sec"] = round(fields["speed_sec"], 1)
    line_count = fields.get("line_count", project["line_count"])
    if "current_step" in fields and fields["current_step"] > line_count:
        raise HTTPException(422, f"Шаг должен быть в пределах 1..{line_count}")
    if "line_count" in fields and "current_step" not in fields and project["current_step"] > line_count:
        fields["current_step"] = line_count  # линий стало меньше — не выходим за конец
    updated = storage.update_project(project_id, fields)
    assert updated is not None
    return _detail(updated)


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    _get_or_404(project_id)
    storage.delete_project(project_id)
    return Response(status_code=204)


@app.get("/api/projects/{project_id}/steps", response_model=StepsPage)
def get_steps(
    project_id: str,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> dict[str, Any]:
    p = _get_or_404(project_id)
    seq, total = p["sequence"], p["line_count"]
    used = cumulative_lengths_m(seq[: total + 1], p["diameter_cm"])
    items = [
        {
            "number": k + 1,
            "from_nail": seq[k],
            "to_nail": seq[k + 1],
            "from_label": nail_label(seq[k]),
            "to_label": nail_label(seq[k + 1]),
            "thread_used_m": round(used[k + 1], 2),
        }
        for k in range(offset, min(total, offset + limit))
    ]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@app.get("/api/projects/{project_id}/preview.png")
def preview_png(
    project_id: str,
    size: Annotated[int, Query(ge=100, le=1600)] = 600,
    lines: Annotated[int | None, Query(ge=1, le=config.MAX_LINES)] = None,
) -> Response:
    p = _get_or_404(project_id)
    png = render_png(p["sequence"], lines or p["line_count"], p["diameter_cm"], size)
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/api/projects/{project_id}/source.png")
def source_png(project_id: str) -> Response:
    _get_or_404(project_id)
    return Response(storage.get_source_png(project_id), media_type="image/png")


@app.get("/api/projects/{project_id}/instructions.pdf")
def instructions_pdf(project_id: str) -> Response:
    p = _get_or_404(project_id)
    pdf = build_instructions_pdf(p["name"], p["sequence"], p["line_count"], p["diameter_cm"])
    ascii_name = f"string-art-{p['id']}.pdf"
    utf_name = quote(f"Инструкция — {p['name']}.pdf")
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf_name}"
        },
    )


@app.get("/api/geometry")
def geometry(diameter_cm: Annotated[float, Query(ge=config.MIN_DIAMETER_CM, le=config.MAX_DIAMETER_CM)]) -> dict:
    """Справка для разметки: шаг между гвоздями для выбранного диаметра."""
    return {
        "diameter_cm": diameter_cm,
        "nail_spacing_mm": round(arc_spacing(diameter_cm * 10), 2),
        "recommended_lines": recommended_lines(diameter_cm),
    }
