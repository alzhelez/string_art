"""Шаблон разметки гвоздей в натуральную величину — PDF на листах A4 (или A3).

Круг нужного диаметра режется на листы с перекрытием 10 мм. На каждом листе — часть круга,
крестики гвоздей с точкой в центре (сюда бить гвоздь или прокалывать шилом), подписи A1…D60,
оси секторов, метки склейки и линейка 5 см для проверки масштаба. Первая страница — схема
раскладки листов и короткая инструкция.

Координаты внутри — миллиметры от центра круга, ось Y вниз (как в geometry.nail_xy).
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

from reportlab.lib.colors import Color, black, white
from reportlab.lib.pagesizes import A3, A4
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas

from .config import NAILS_PER_SECTOR, SECTORS, TOTAL_NAILS
from .geometry import arc_spacing, nail_label, nail_xy, sector_center_angle
from .pdf import FONT, FONT_BOLD, _fmt, _register_fonts

PAPERS = {"A4": A4, "A3": A3}
PRINT_MARGIN_MM = 8.0  # почти любой принтер печатает до края 4–5 мм; берём с запасом
OVERLAP_MM = 10.0  # полоса, где соседние листы накладываются друг на друга
LABEL_GAP_MM = 6.0  # подпись гвоздя — снаружи круга
CONTENT_PAD_MM = 14.0  # сколько места нужно снаружи круга под подписи

GREY = Color(0.42, 0.45, 0.5)
LIGHT = Color(0.86, 0.88, 0.91)
BAND = Color(0.93, 0.95, 1.0)
ACCENT = Color(0.21, 0.31, 0.94)


@dataclass(frozen=True)
class Layout:
    paper: str
    page_w_mm: float
    page_h_mm: float
    cols: int
    rows: int
    step_x: float  # шаг листов по X, мм (печатная область минус перекрытие)
    step_y: float
    origin_x: float  # левый верхний угол сетки листов относительно центра круга, мм
    origin_y: float

    @property
    def sheets(self) -> int:
        return self.cols * self.rows

    def tile_box(self, row: int, col: int) -> tuple[float, float, float, float]:
        """Печатная область листа в мм от центра круга: x0, y0, ширина, высота."""
        w = self.page_w_mm - 2 * PRINT_MARGIN_MM
        h = self.page_h_mm - 2 * PRINT_MARGIN_MM
        return self.origin_x + col * self.step_x, self.origin_y + row * self.step_y, w, h


def layout(diameter_cm: float, paper: str = "A4") -> Layout:
    """Сколько листов нужно и как они лежат. Ориентация выбирается та, где листов меньше."""
    best: Layout | None = None
    pw, ph = (v / mm for v in PAPERS[paper])
    for w, h in ((pw, ph), (ph, pw)):
        sx = w - 2 * PRINT_MARGIN_MM - OVERLAP_MM
        sy = h - 2 * PRINT_MARGIN_MM - OVERLAP_MM
        extent = diameter_cm * 10 + 2 * CONTENT_PAD_MM
        cols = max(1, math.ceil((extent - OVERLAP_MM) / sx))
        rows = max(1, math.ceil((extent - OVERLAP_MM) / sy))
        total_w, total_h = cols * sx + OVERLAP_MM, rows * sy + OVERLAP_MM
        cand = Layout(paper, w, h, cols, rows, sx, sy, -total_w / 2, -total_h / 2)
        if best is None or cand.sheets < best.sheets:
            best = cand
    assert best is not None
    return best


def _sheet_map(c: Canvas, lay: Layout, x: float, y: float, width: float, current: int | None) -> float:
    """Маленькая схема раскладки листов; current — номер текущего листа (с 1). Возвращает высоту."""
    cell_w = width / lay.cols
    cell_h = cell_w * lay.step_y / lay.step_x
    height = cell_h * lay.rows
    for row in range(lay.rows):
        for col in range(lay.cols):
            n = row * lay.cols + col + 1
            bx, by = x + col * cell_w, y - (row + 1) * cell_h
            c.setFillColor(ACCENT if n == current else white)
            c.setStrokeColor(GREY)
            c.setLineWidth(0.6)
            c.rect(bx, by, cell_w, cell_h, fill=1, stroke=1)
            c.setFillColor(white if n == current else black)
            c.setFont(FONT_BOLD, max(6, min(14, cell_h * 0.35)))
            c.drawCentredString(bx + cell_w / 2, by + cell_h / 2 - 4, str(n))
    return height


def _draw_tile(c: Canvas, lay: Layout, row: int, col: int, diameter_cm: float, title: str) -> None:
    x0, y0, w, h = lay.tile_box(row, col)
    R = diameter_cm * 10 / 2
    page_h = lay.page_h_mm
    m = PRINT_MARGIN_MM

    def P(xm: float, ym: float) -> tuple[float, float]:
        """мм от центра круга → точки PDF на этом листе."""
        return (m + (xm - x0)) * mm, (page_h - m - (ym - y0)) * mm

    # Всё рисуем внутри печатной области листа
    c.saveState()
    clip = c.beginPath()
    clip.rect(m * mm, m * mm, w * mm, h * mm)
    c.clipPath(clip, stroke=0, fill=0)

    # Полосы перекрытия: на этот лист сверху/слева ляжет соседний — сюда мазать клей
    c.setFillColor(BAND)
    if col < lay.cols - 1:
        c.rect((m + w - OVERLAP_MM) * mm, m * mm, OVERLAP_MM * mm, h * mm, fill=1, stroke=0)
    if row < lay.rows - 1:
        c.rect(m * mm, m * mm, w * mm, OVERLAP_MM * mm, fill=1, stroke=0)

    # Оси секторов и круг
    c.setStrokeColor(LIGHT)
    c.setLineWidth(0.5)
    c.setDash(4, 3)
    c.line(*P(-R, 0), *P(R, 0))
    c.line(*P(0, -R), *P(0, R))
    c.setDash()
    c.setStrokeColor(GREY)
    c.setLineWidth(0.35)
    cx, cy = P(0, 0)
    c.circle(cx, cy, R * mm, stroke=1, fill=0)

    # Центр круга
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.line(cx - 6 * mm, cy, cx + 6 * mm, cy)
    c.line(cx, cy - 6 * mm, cx, cy + 6 * mm)
    c.setFont(FONT, 7)
    c.setFillColor(GREY)
    c.drawString(cx + 1.5 * mm, cy + 1.5 * mm, "центр")

    # Буквы секторов
    c.setFont(FONT_BOLD, 40)
    c.setFillColor(LIGHT)
    for s, letter in enumerate(SECTORS):
        a = sector_center_angle(s)
        lx, ly = P(R * 0.6 * math.sin(a), -R * 0.6 * math.cos(a))
        c.drawCentredString(lx, ly - 14, letter)

    # Гвозди: крестик, кружок, точка + подпись снаружи
    for i in range(TOTAL_NAILS):
        nx, ny = nail_xy(i, R)
        px, py = P(nx, ny)
        first = i % NAILS_PER_SECTOR == 0
        c.setStrokeColor(ACCENT if first else black)
        c.setLineWidth(0.3)
        c.line(px - 2 * mm, py, px + 2 * mm, py)
        c.line(px, py - 2 * mm, px, py + 2 * mm)
        c.circle(px, py, 1.1 * mm, stroke=1, fill=0)
        c.setFillColor(black)
        c.circle(px, py, 0.25 * mm, stroke=0, fill=1)
        lx, ly = P(*nail_xy(i, R + LABEL_GAP_MM))
        c.setFont(FONT_BOLD if first else FONT, 7 if first else 5.5)
        c.setFillColor(ACCENT if first else black)
        c.drawCentredString(lx, ly - 2, nail_label(i))
    c.restoreState()

    # Рамка печатной области: линия реза для листов, которые ложатся сверху
    c.setStrokeColor(GREY)
    c.setLineWidth(0.4)
    c.setDash(3, 2)
    if col > 0:
        c.line(m * mm, m * mm, m * mm, (m + h) * mm)
    if row > 0:
        c.line(m * mm, (m + h) * mm, (m + w) * mm, (m + h) * mm)
    c.setDash()

    # Метки совмещения в углах полос перекрытия
    c.setStrokeColor(black)
    c.setLineWidth(0.4)
    for ux in ([m + w - OVERLAP_MM / 2] if col < lay.cols - 1 else []) + ([m + OVERLAP_MM / 2] if col > 0 else []):
        for uy in (m + h * 0.25, m + h * 0.75):
            c.line((ux - 3) * mm, uy * mm, (ux + 3) * mm, uy * mm)
            c.line(ux * mm, (uy - 3) * mm, ux * mm, (uy + 3) * mm)
    for uy in ([m + OVERLAP_MM / 2] if row < lay.rows - 1 else []) + ([m + h - OVERLAP_MM / 2] if row > 0 else []):
        for ux in (m + w * 0.25, m + w * 0.75):
            c.line((ux - 3) * mm, uy * mm, (ux + 3) * mm, uy * mm)
            c.line(ux * mm, (uy - 3) * mm, ux * mm, (uy + 3) * mm)

    # Подпись листа, мини-схема и линейка 5 см — на белой плашке в том углу листа,
    # где она не закрывает ни одного гвоздя
    n = row * lay.cols + col + 1
    box_w, box_h = 62.0, 26.0
    inner_l = m + (OVERLAP_MM if col > 0 else 0) + 2
    inner_r = m + w - (OVERLAP_MM if col < lay.cols - 1 else 0) - 2 - box_w
    inner_t = m + h - (OVERLAP_MM if row > 0 else 0) - 2  # верх плашки (точки PDF / mm)
    inner_b = m + (OVERLAP_MM if row < lay.rows - 1 else 0) + 2 + box_h

    def clearance(left_mm: float, top_mm: float) -> float:
        """Насколько плашка далеко от кольца гвоздей с подписями (мм, больше — лучше)."""
        worst = math.inf
        for i in range(7):
            for j in range(5):
                xm = x0 + (left_mm - m) + box_w * i / 6
                ym = y0 + (m + h - top_mm) + box_h * j / 4
                d = math.hypot(xm, ym)
                worst = min(worst, d - (R + CONTENT_PAD_MM) if d > R else (R - 6) - d)
        return worst

    corners = [(inner_l, inner_t), (inner_r, inner_t), (inner_l, inner_b), (inner_r, inner_b)]
    left_mm, top_mm = max(corners, key=lambda xy: clearance(*xy))
    bx, by = left_mm * mm, top_mm * mm
    map_w = min(24 * mm, 6 * mm * lay.cols)
    box_h = box_h * mm
    c.setFillColor(white)
    c.setStrokeColor(LIGHT)
    c.roundRect(bx, by - box_h, box_w * mm, box_h, 2 * mm, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(FONT_BOLD, 10)
    c.drawString(bx + 3 * mm, by - 6 * mm, f"Лист {n} из {lay.sheets}")
    c.setFont(FONT, 6.5)
    c.setFillColor(GREY)
    c.drawString(bx + 3 * mm, by - 10 * mm, f"ряд {row + 1}, место {col + 1} · Ø {_fmt(diameter_cm)} см")
    c.drawString(bx + 3 * mm, by - 13.5 * mm, title[:34])
    # линейка 5 см
    rx, ry = bx + 3 * mm, by - 21 * mm
    c.setStrokeColor(black)
    c.setLineWidth(0.5)
    c.line(rx, ry, rx + 50 * mm, ry)
    for k in range(6):
        c.line(rx + k * 10 * mm, ry, rx + k * 10 * mm, ry + (2.5 if k % 5 else 3.5) * mm)
    c.setFont(FONT, 6)
    c.setFillColor(black)
    c.drawString(rx, ry - 3 * mm, "ровно 5 см — масштаб верный")
    _sheet_map(c, lay, bx + box_w * mm - map_w - 2 * mm, by - 2 * mm, map_w, n)


def _cover(c: Canvas, lay: Layout, diameter_cm: float, title: str) -> None:
    pw, ph = A4
    left, top = 18 * mm, ph - 20 * mm
    c.setFont(FONT_BOLD, 20)
    c.drawString(left, top, "Шаблон разметки гвоздей")
    c.setFont(FONT, 11)
    c.setFillColor(GREY)
    c.drawString(left, top - 8 * mm, f"{title} · круг Ø {_fmt(diameter_cm)} см · {TOTAL_NAILS} гвоздей · "
                 f"шаг {_fmt(arc_spacing(diameter_cm * 10), 2)} мм")
    c.setFillColor(black)

    # Контрольная линейка 10 см
    y = top - 22 * mm
    c.setFont(FONT_BOLD, 11)
    c.drawString(left, y, "1. Проверьте масштаб печати")
    c.setFont(FONT, 9.5)
    c.drawString(left, y - 5.5 * mm, "Печатайте в масштабе 100 % («Фактический размер»), а не «По размеру страницы».")
    c.drawString(left, y - 10.5 * mm, "Эта линия должна быть ровно 10 см — приложите линейку:")
    c.setLineWidth(1)
    ry = y - 18 * mm
    c.line(left, ry, left + 100 * mm, ry)
    for k in range(11):
        c.line(left + k * 10 * mm, ry, left + k * 10 * mm, ry + (4 if k % 5 == 0 else 2.5) * mm)
    c.setFont(FONT, 8)
    c.drawString(left, ry - 4 * mm, "0")
    c.drawRightString(left + 100 * mm, ry - 4 * mm, "10 см")

    steps = [
        ("2. Разложите листы", f"Всего листов: {lay.sheets} ({lay.rows} ряд(а) × {lay.cols}). Номера — по схеме ниже."),
        ("3. Склейте", "Обрежьте лист по пунктиру слева и сверху и положите на голубую полосу соседа так,"),
        ("", "чтобы совпали линия круга и крестики совмещения. Закрепите скотчем."),
        ("4. Перенесите на доску", "Совместите центр шаблона с центром доски; сектор A — слева сверху,"),
        ("", "горизонтальная ось — строго по уровню. Закрепите малярным скотчем по краям."),
        ("5. Вбейте гвозди", "В точку в центре каждого крестика. Синие крестики — A1, B1, C1, D1."),
        ("", "Проще сначала наколоть все точки шилом, потом снять бумагу и бить по наколам."),
        ("6. Снимите бумагу", "Аккуратно порвите её между гвоздями. Начинайте плести с гвоздя A1."),
    ]
    y = ry - 14 * mm
    for head, text in steps:
        if head:
            c.setFont(FONT_BOLD, 11)
            c.drawString(left, y, head)
            y -= 5.5 * mm
        c.setFont(FONT, 9.5)
        c.drawString(left, y, text)
        y -= 6 * mm if head == "" or text.endswith(".") else 5 * mm

    map_w = min(pw - 36 * mm, lay.cols * 24 * mm)
    c.setFont(FONT_BOLD, 11)
    c.drawString(left, y - 4 * mm, "Раскладка листов (вид спереди, как на доске)")
    _sheet_map(c, lay, left, y - 8 * mm, map_w, None)
    c.setFont(FONT, 8)
    c.setFillColor(GREY)
    c.drawString(left, 12 * mm, f"Бумага {lay.paper}, перекрытие {int(OVERLAP_MM)} мм. Сделано в «Нитеграфе».")


def build_template_pdf(diameter_cm: float, title: str = "Портрет из нитей", paper: str = "A4") -> bytes:
    _register_fonts()
    lay = layout(diameter_cm, paper)
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=A4, pageCompression=1)
    c.setTitle(f"Шаблон разметки — {title}")
    c.setAuthor("Нитеграф")
    _cover(c, lay, diameter_cm, title)
    c.showPage()
    for row in range(lay.rows):
        for col in range(lay.cols):
            c.setPageSize((lay.page_w_mm * mm, lay.page_h_mm * mm))
            _draw_tile(c, lay, row, col, diameter_cm, title)
            c.showPage()
    c.save()
    return buf.getvalue()
