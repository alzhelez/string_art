"""PDF-инструкция: обложка с картиной и параметрами, схема секторов, таблица шагов."""

from __future__ import annotations

import io
import math
from typing import Sequence

from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from .config import FONTS_DIR, NAILS_PER_SECTOR, SECTORS, THREAD_DIAMETER_MM, TOTAL_NAILS
from .geometry import nail_angle, nail_label, sector_center_angle
from .render import render_image
from .thread import thread_stats

FONT = "DejaVuSans"
FONT_BOLD = "DejaVuSans-Bold"
GREY = Color(0.45, 0.45, 0.45)
LIGHT = Color(0.85, 0.85, 0.85)
ACCENT = Color(0.72, 0.25, 0.16)

PAGE_W, PAGE_H = A4
MARGIN = 15 * mm
STEP_COLUMNS = 4
STEP_ROWS = 50
STEPS_PER_PAGE = STEP_COLUMNS * STEP_ROWS

_fonts_registered = False


def _register_fonts() -> None:
    global _fonts_registered
    if not _fonts_registered:
        pdfmetrics.registerFont(TTFont(FONT, str(FONTS_DIR / "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(FONTS_DIR / "DejaVuSans-Bold.ttf")))
        _fonts_registered = True


def _fmt(value: float, digits: int = 1) -> str:
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _footer(c: Canvas, name: str) -> None:
    c.setFont(FONT, 8)
    c.setFillColor(GREY)
    c.drawString(MARGIN, 8 * mm, f"Портрет из нитей · {name}")
    c.drawRightString(PAGE_W - MARGIN, 8 * mm, f"стр. {c.getPageNumber()}")
    c.setFillColor(black)


def _cover(c: Canvas, name: str, sequence: Sequence[int], steps: int, diameter_cm: float) -> None:
    stats = thread_stats(sequence, steps, diameter_cm)
    y = PAGE_H - MARGIN
    c.setFont(FONT_BOLD, 22)
    c.drawString(MARGIN, y - 8 * mm, "Портрет из нитей")
    c.setFont(FONT, 12)
    c.setFillColor(GREY)
    c.drawString(MARGIN, y - 15 * mm, name)
    c.setFillColor(black)

    img_size = 120 * mm
    img = render_image(sequence, steps, diameter_cm, size=1100)
    c.drawImage(ImageReader(img), (PAGE_W - img_size) / 2, y - 22 * mm - img_size, img_size, img_size)

    spool = f"{stats.spool_m} м" if stats.spool_count == 1 else f"{stats.spool_count} × {stats.spool_m} м"
    rows = [
        ("Диаметр круга", f"{_fmt(diameter_cm)} см"),
        ("Гвоздей", f"{TOTAL_NAILS} (4 сектора × {NAILS_PER_SECTOR})"),
        ("Шаг между гвоздями по дуге", f"{_fmt(stats.nail_spacing_mm, 2)} мм"),
        ("Количество шагов (линий)", _fmt(steps, 0)),
        ("Леска (эталон)", f"чёрная, ~{_fmt(THREAD_DIAMETER_MM, 1)} мм"),
        ("Длина лески без запаса", f"{_fmt(stats.raw_length_m)} м"),
        ("Длина лески с запасом +15 %", f"{_fmt(stats.total_length_m)} м"),
        ("Минимальная катушка", spool),
        ("Старт", "гвоздь A1"),
    ]
    top = y - 30 * mm - img_size
    row_h = 7.2 * mm
    x_label, x_value = MARGIN + 10 * mm, PAGE_W / 2 + 5 * mm
    for i, (label, value) in enumerate(rows):
        ry = top - i * row_h
        if i % 2 == 0:
            c.setFillColor(Color(0.96, 0.95, 0.93))
            c.rect(MARGIN, ry - 2.3 * mm, PAGE_W - 2 * MARGIN, row_h, stroke=0, fill=1)
            c.setFillColor(black)
        c.setFont(FONT, 10.5)
        c.drawString(x_label, ry, label)
        c.setFont(FONT_BOLD, 10.5)
        if label == "Минимальная катушка":
            c.setFillColor(ACCENT)
        c.drawString(x_value, ry, value)
        c.setFillColor(black)
    _footer(c, name)


def _scheme(c: Canvas, name: str, diameter_cm: float, steps: int, spacing_mm: float) -> None:
    c.setFont(FONT_BOLD, 16)
    c.drawString(MARGIN, PAGE_H - MARGIN - 6 * mm, "Схема гвоздей и как читать шаги")

    r = 55 * mm
    cx, cy = PAGE_W / 2, PAGE_H - MARGIN - 34 * mm - r
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.6)
    c.circle(cx, cy, r)
    c.setDash(3, 3)
    c.line(cx - r - 6 * mm, cy, cx + r + 6 * mm, cy)
    c.line(cx, cy - r - 6 * mm, cx, cy + r + 6 * mm)
    c.setDash()
    c.setFont(FONT, 7)
    c.setFillColor(GREY)
    c.drawString(cx + r + 7 * mm, cy - 1 * mm, "x")
    c.drawString(cx + 1.5 * mm, cy + r + 7 * mm, "y")

    for i in range(TOTAL_NAILS):
        a = nail_angle(i)
        x, y = cx + r * math.sin(a), cy + r * math.cos(a)  # в PDF ось Y вверх
        number = i % NAILS_PER_SECTOR + 1
        big = number in (1, 10, 20, 30, 40, 50, 60)
        c.setFillColor(black if big else GREY)
        c.circle(x, y, 0.9 if big else 0.45, stroke=0, fill=1)
        if number in (1, 30, 60):
            # 1 и 60 стоят у осей — сдвигаем подписи вдоль окружности в «свой» сектор
            shift = {1: 4 * mm, 30: 0.0, 60: -4 * mm}[number]
            lx = cx + (r + 5 * mm) * math.sin(a) + shift * math.cos(a)
            ly = cy + (r + 5 * mm) * math.cos(a) - shift * math.sin(a)
            c.setFont(FONT, 6.5)
            c.drawCentredString(lx, ly - 1.2 * mm, nail_label(i))

    c.setFillColor(ACCENT)
    c.setFont(FONT_BOLD, 26)
    for s, letter in enumerate(SECTORS):
        a = sector_center_angle(s)
        c.drawCentredString(cx + 0.55 * r * math.sin(a), cy + 0.55 * r * math.cos(a) - 4 * mm, letter)
    c.setFillColor(black)

    # Стрелка «по часовой» над верхней точкой
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.2)
    arc_r = r + 11 * mm
    c.arc(cx - arc_r, cy - arc_r, cx + arc_r, cy + arc_r, startAng=80, extent=-25)
    tip_a = math.radians(80 - 25)  # дуга идёт от 80° к 55° (по часовой)
    tx, ty = cx + arc_r * math.cos(tip_a), cy + arc_r * math.sin(tip_a)
    back = math.atan2(math.cos(tip_a), -math.sin(tip_a))  # направление «назад» вдоль дуги
    for wing in (-0.5, 0.5):
        c.line(tx, ty, tx + 2.6 * mm * math.cos(back + wing), ty + 2.6 * mm * math.sin(back + wing))
    c.setFont(FONT, 8)
    c.setFillColor(ACCENT)
    c.drawString(tx + 3 * mm, ty - 1 * mm, "нумерация по часовой стрелке")
    c.setFillColor(black)

    text = [
        "Подготовка",
        f"1. Начертите круг диаметром {_fmt(diameter_cm)} см и проведите оси X и Y через центр.",
        "2. Оси делят круг на 4 сектора: A — слева сверху, B — справа сверху, C — справа снизу, D — слева снизу.",
        f"3. В каждом секторе вбейте 60 гвоздей с шагом {_fmt(spacing_mm, 2)} мм по дуге. Первый и последний гвоздь",
        "    сектора стоят на расстоянии половины шага от оси, ни один гвоздь не попадает точно на ось.",
        "4. Гвозди в секторе нумеруются 1…60 по часовой стрелке: A1 — первый над левой точкой оси X.",
        "",
        "Плетение",
        "5. Привяжите леску к гвоздю A1 — это старт.",
        "6. Шаг «A12 → C37» означает: натяните леску от гвоздя A12 к гвоздю C37 и обведите его.",
        "    Следующий шаг всегда начинается с гвоздя, на котором закончился предыдущий.",
        "7. Обводите гвозди всегда в одну сторону — так леска лежит ровнее.",
        "8. Отмечайте выполненные шаги галочкой в квадрате. Держите леску натянутой, но без рывков.",
        f"9. Всего шагов: {_fmt(steps, 0)}. В конце закрепите леску узлом и каплей клея.",
    ]
    ty = cy - r - 18 * mm
    for line in text:
        if line in ("Подготовка", "Плетение"):
            c.setFont(FONT_BOLD, 11)
            ty -= 2 * mm
        else:
            c.setFont(FONT, 9.5)
        c.drawString(MARGIN, ty, line)
        ty -= 5.6 * mm
    _footer(c, name)


def _steps_pages(c: Canvas, name: str, sequence: Sequence[int], steps: int) -> None:
    col_w = (PAGE_W - 2 * MARGIN) / STEP_COLUMNS
    top = PAGE_H - MARGIN - 14 * mm
    row_h = (top - 16 * mm) / STEP_ROWS
    for page_start in range(0, steps, STEPS_PER_PAGE):
        page_end = min(steps, page_start + STEPS_PER_PAGE)
        c.setFont(FONT_BOLD, 12)
        c.drawString(MARGIN, PAGE_H - MARGIN - 4 * mm, "Шаги плетения")
        c.setFont(FONT, 9)
        c.setFillColor(GREY)
        c.drawRightString(
            PAGE_W - MARGIN, PAGE_H - MARGIN - 4 * mm, f"шаги {page_start + 1}–{page_end} из {steps}"
        )
        c.setFillColor(black)
        for k in range(page_start, page_end):
            local = k - page_start
            col, row = divmod(local, STEP_ROWS)
            x = MARGIN + col * col_w
            y = top - row * row_h
            if row % 2 == 0:
                c.setFillColor(Color(0.965, 0.96, 0.95))
                c.rect(x, y - 1.3 * mm, col_w - 2 * mm, row_h, stroke=0, fill=1)
                c.setFillColor(black)
            c.setStrokeColor(GREY)
            c.setLineWidth(0.5)
            c.setFillColor(white)
            c.rect(x + 1 * mm, y - 0.6 * mm, 2.8 * mm, 2.8 * mm, stroke=1, fill=1)
            c.setFillColor(GREY)
            c.setFont(FONT, 7.5)
            c.drawRightString(x + 14 * mm, y, str(k + 1))
            c.setFillColor(black)
            c.setFont(FONT_BOLD, 8.5)
            c.drawString(
                x + 16 * mm, y, f"{nail_label(sequence[k])}  →  {nail_label(sequence[k + 1])}"
            )
        _footer(c, name)
        c.showPage()


def build_instructions_pdf(name: str, sequence: Sequence[int], steps: int, diameter_cm: float) -> bytes:
    if not 1 <= steps <= len(sequence) - 1:
        raise ValueError("Некорректное количество шагов")
    _register_fonts()
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=A4)
    c.setTitle(f"Портрет из нитей — {name}")
    c.setAuthor("String Art Studio")
    _cover(c, name, sequence, steps, diameter_cm)
    c.showPage()
    spacing = thread_stats(sequence, steps, diameter_cm).nail_spacing_mm
    _scheme(c, name, diameter_cm, steps, spacing)
    c.showPage()
    _steps_pages(c, name, sequence, steps)
    c.save()
    return buf.getvalue()


def expected_page_count(steps: int) -> int:
    return 2 + math.ceil(steps / STEPS_PER_PAGE)
