"""Шаблон разметки гвоздей в натуральную величину — PDF на листах A4 (или A3).

Круг нужного диаметра режется на листы с перекрытием 10 мм. На каждом листе — часть круга,
крестики гвоздей с точкой в центре (сюда бить гвоздь или прокалывать шилом), подписи A1…D60,
оси секторов, метки склейки и линейка 5 см для проверки масштаба. Первая страница — схема
раскладки листов и короткая инструкция.

Координаты внутри — миллиметры от центра круга, ось Y вниз (как в geometry.nail_xy).
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Буфер в памяти для PDF
import io
# Тригонометрия и округление вверх
import math
# Описание раскладки листов как неизменяемой структуры
from dataclasses import dataclass

# Цвета ReportLab: свой, чёрный, белый
from reportlab.lib.colors import Color, black, white
# Размеры бумаги A3 и A4 в пунктах
from reportlab.lib.pagesizes import A3, A4
# Миллиметр в пунктах
from reportlab.lib.units import mm
# Холст страницы PDF
from reportlab.pdfgen.canvas import Canvas

# Число гвоздей в секторе, буквы секторов, общее число гвоздей
from .config import NAILS_PER_SECTOR, SECTORS, TOTAL_NAILS
# Геометрия: шаг по дуге, метки, координаты гвоздей, середины секторов
from .geometry import arc_spacing, nail_label, nail_xy, sector_center_angle
# Шрифты и формат чисел — общие с PDF-инструкцией
from .pdf import FONT, FONT_BOLD, _fmt, _register_fonts

# Поддерживаемые форматы бумаги
PAPERS = {"A4": A4, "A3": A3}
# Отступ от края листа, куда принтер не печатает
PRINT_MARGIN_MM = 8.0  # почти любой принтер печатает до края 4–5 мм; берём с запасом
# Ширина полосы склейки соседних листов
OVERLAP_MM = 10.0  # полоса, где соседние листы накладываются друг на друга
# Насколько снаружи круга печатается подпись гвоздя
LABEL_GAP_MM = 6.0  # подпись гвоздя — снаружи круга
# Сколько места вокруг круга нужно под подписи (влияет на число листов)
CONTENT_PAD_MM = 14.0  # сколько места нужно снаружи круга под подписи

# Серо-синий для вспомогательных элементов
GREY = Color(0.42, 0.45, 0.5)
# Светлый — для осей и букв секторов
LIGHT = Color(0.86, 0.88, 0.91)
# Бледно-голубой — полосы склейки
BAND = Color(0.93, 0.95, 1.0)
# Синий акцент — первые гвозди секторов и текущий лист на схеме
ACCENT = Color(0.21, 0.31, 0.94)


# Структура неизменяемая — раскладку считаем один раз
@dataclass(frozen=True)
# Как листы бумаги лежат поверх круга
class Layout:
    # Формат бумаги: «A4» или «A3»
    paper: str
    # Ширина листа в мм (с учётом выбранной ориентации)
    page_w_mm: float
    # Высота листа в мм
    page_h_mm: float
    # Сколько листов в ряду
    cols: int
    # Сколько рядов
    rows: int
    # Сдвиг между соседними листами по горизонтали
    step_x: float  # шаг листов по X, мм (печатная область минус перекрытие)
    # Сдвиг между соседними листами по вертикали
    step_y: float
    # Где левый верхний угол всей сетки листов, если центр круга — (0, 0)
    origin_x: float  # левый верхний угол сетки листов относительно центра круга, мм
    # То же по вертикали
    origin_y: float

    # Свойство: вычисляется на лету, но вызывается как поле (lay.sheets)
    @property
    # Общее число листов
    def sheets(self) -> int:
        # Колонки × ряды
        return self.cols * self.rows

    # Где на круге лежит печатная область конкретного листа
    def tile_box(self, row: int, col: int) -> tuple[float, float, float, float]:
        """Печатная область листа в мм от центра круга: x0, y0, ширина, высота."""
        # Ширина печатной области
        w = self.page_w_mm - 2 * PRINT_MARGIN_MM
        # Высота печатной области
        h = self.page_h_mm - 2 * PRINT_MARGIN_MM
        # Левый верхний угол листа + размеры
        return self.origin_x + col * self.step_x, self.origin_y + row * self.step_y, w, h


# Считаем, сколько листов нужно и как их положить
def layout(diameter_cm: float, paper: str = "A4") -> Layout:
    """Сколько листов нужно и как они лежат. Ориентация выбирается та, где листов меньше."""
    # Лучший найденный вариант
    best: Layout | None = None
    # Размер бумаги в мм
    pw, ph = (v / mm for v in PAPERS[paper])
    # Пробуем книжную и альбомную ориентацию
    for w, h in ((pw, ph), (ph, pw)):
        # Сколько листа «полезно» по горизонтали (без полей и перекрытия)
        sx = w - 2 * PRINT_MARGIN_MM - OVERLAP_MM
        # То же по вертикали
        sy = h - 2 * PRINT_MARGIN_MM - OVERLAP_MM
        # Размер области, которую надо покрыть: круг + место под подписи с двух сторон
        extent = diameter_cm * 10 + 2 * CONTENT_PAD_MM
        # Сколько листов в ряду (округляя вверх)
        cols = max(1, math.ceil((extent - OVERLAP_MM) / sx))
        # Сколько рядов
        rows = max(1, math.ceil((extent - OVERLAP_MM) / sy))
        # Общий размер сетки листов
        total_w, total_h = cols * sx + OVERLAP_MM, rows * sy + OVERLAP_MM
        # Вариант раскладки: сетка по центру круга
        cand = Layout(paper, w, h, cols, rows, sx, sy, -total_w / 2, -total_h / 2)
        # Берём вариант с меньшим числом листов
        if best is None or cand.sheets < best.sheets:
            # Новый лучший
            best = cand
    # Хотя бы один вариант был
    assert best is not None
    # Лучшая раскладка
    return best


# Мини-схема «где какой лист» (на обложке и на каждом листе)
def _sheet_map(c: Canvas, lay: Layout, x: float, y: float, width: float, current: int | None) -> float:
    """Маленькая схема раскладки листов; current — номер текущего листа (с 1). Возвращает высоту."""
    # Ширина клетки схемы
    cell_w = width / lay.cols
    # Высота клетки — в пропорциях листа
    cell_h = cell_w * lay.step_y / lay.step_x
    # Общая высота схемы
    height = cell_h * lay.rows
    # По рядам
    for row in range(lay.rows):
        # По колонкам
        for col in range(lay.cols):
            # Номер листа (с единицы, слева направо, сверху вниз)
            n = row * lay.cols + col + 1
            # Левый нижний угол клетки (в PDF Y вверх, поэтому вычитаем)
            bx, by = x + col * cell_w, y - (row + 1) * cell_h
            # Текущий лист закрашиваем синим, остальные — белые
            c.setFillColor(ACCENT if n == current else white)
            # Серая рамка
            c.setStrokeColor(GREY)
            # Толщина рамки
            c.setLineWidth(0.6)
            # Клетка
            c.rect(bx, by, cell_w, cell_h, fill=1, stroke=1)
            # Номер: белый на синем, чёрный на белом
            c.setFillColor(white if n == current else black)
            # Размер шрифта под размер клетки (6…14 пт)
            c.setFont(FONT_BOLD, max(6, min(14, cell_h * 0.35)))
            # Номер листа по центру клетки
            c.drawCentredString(bx + cell_w / 2, by + cell_h / 2 - 4, str(n))
    # Высота нарисованной схемы — чтобы знать, где продолжать
    return height


# Один лист шаблона
def _draw_tile(c: Canvas, lay: Layout, row: int, col: int, diameter_cm: float, title: str) -> None:
    # Где на круге лежит этот лист
    x0, y0, w, h = lay.tile_box(row, col)
    # Радиус круга гвоздей в мм
    R = diameter_cm * 10 / 2
    # Высота листа
    page_h = lay.page_h_mm
    # Короткое имя для поля печати
    m = PRINT_MARGIN_MM

    # Перевод координат «мм от центра круга» → «точки PDF на этом листе»
    def P(xm: float, ym: float) -> tuple[float, float]:
        """мм от центра круга → точки PDF на этом листе."""
        # Сдвиг на начало листа, переворот оси Y (в PDF она вверх) и перевод в пункты
        return (m + (xm - x0)) * mm, (page_h - m - (ym - y0)) * mm

    # Всё рисуем внутри печатной области листа
    # Запоминаем состояние холста (обрезку потом снимем)
    c.saveState()
    # Контур обрезки
    clip = c.beginPath()
    # Прямоугольник печатной области
    clip.rect(m * mm, m * mm, w * mm, h * mm)
    # Всё, что нарисуем дальше, будет обрезано этим прямоугольником
    c.clipPath(clip, stroke=0, fill=0)

    # Полосы перекрытия: на этот лист сверху/слева ляжет соседний — сюда мазать клей
    # Цвет полосы
    c.setFillColor(BAND)
    # Справа есть ещё лист
    if col < lay.cols - 1:
        # Голубая полоса у правого края
        c.rect((m + w - OVERLAP_MM) * mm, m * mm, OVERLAP_MM * mm, h * mm, fill=1, stroke=0)
    # Снизу есть ещё ряд
    if row < lay.rows - 1:
        # Голубая полоса у нижнего края
        c.rect(m * mm, m * mm, w * mm, OVERLAP_MM * mm, fill=1, stroke=0)

    # Оси секторов и круг
    # Светлые линии
    c.setStrokeColor(LIGHT)
    # Тонкие
    c.setLineWidth(0.5)
    # Пунктиром
    c.setDash(4, 3)
    # Горизонтальная ось
    c.line(*P(-R, 0), *P(R, 0))
    # Вертикальная ось
    c.line(*P(0, -R), *P(0, R))
    # Обратно сплошная линия
    c.setDash()
    # Окружность — серым
    c.setStrokeColor(GREY)
    # Тонкой линией
    c.setLineWidth(0.35)
    # Центр круга в координатах листа
    cx, cy = P(0, 0)
    # Окружность круга гвоздей
    c.circle(cx, cy, R * mm, stroke=1, fill=0)

    # Центр круга
    # Чёрный крестик
    c.setStrokeColor(black)
    # Толщина
    c.setLineWidth(0.5)
    # Горизонтальная черта крестика
    c.line(cx - 6 * mm, cy, cx + 6 * mm, cy)
    # Вертикальная черта
    c.line(cx, cy - 6 * mm, cx, cy + 6 * mm)
    # Подпись «центр» мелко
    c.setFont(FONT, 7)
    # Серым
    c.setFillColor(GREY)
    # Текст рядом с крестиком
    c.drawString(cx + 1.5 * mm, cy + 1.5 * mm, "центр")

    # Буквы секторов
    # Крупный жирный шрифт
    c.setFont(FONT_BOLD, 40)
    # Светлым цветом (фон, не отвлекает)
    c.setFillColor(LIGHT)
    # Для каждого сектора
    for s, letter in enumerate(SECTORS):
        # Угол середины сектора
        a = sector_center_angle(s)
        # Точка на 60 % радиуса от центра
        lx, ly = P(R * 0.6 * math.sin(a), -R * 0.6 * math.cos(a))
        # Буква (−14 — чтобы центр буквы был в точке, а не базовая линия)
        c.drawCentredString(lx, ly - 14, letter)

    # Гвозди: крестик, кружок, точка + подпись снаружи
    # Для каждого гвоздя
    for i in range(TOTAL_NAILS):
        # Координаты гвоздя в мм от центра
        nx, ny = nail_xy(i, R)
        # Координаты на листе
        px, py = P(nx, ny)
        # Первый гвоздь сектора (A1, B1, C1, D1)
        first = i % NAILS_PER_SECTOR == 0
        # Первые гвозди — синие, чтобы не ошибиться со стартом сектора
        c.setStrokeColor(ACCENT if first else black)
        # Тонкие линии
        c.setLineWidth(0.3)
        # Горизонталь крестика 4 мм
        c.line(px - 2 * mm, py, px + 2 * mm, py)
        # Вертикаль крестика
        c.line(px, py - 2 * mm, px, py + 2 * mm)
        # Кружок вокруг точки
        c.circle(px, py, 1.1 * mm, stroke=1, fill=0)
        # Точка — чёрная
        c.setFillColor(black)
        # Точка, куда бить гвоздь
        c.circle(px, py, 0.25 * mm, stroke=0, fill=1)
        # Позиция подписи — чуть дальше от центра
        lx, ly = P(*nail_xy(i, R + LABEL_GAP_MM))
        # Первые гвозди подписаны крупнее и жирнее
        c.setFont(FONT_BOLD if first else FONT, 7 if first else 5.5)
        # Цвет подписи как у крестика
        c.setFillColor(ACCENT if first else black)
        # Метка гвоздя («A1»)
        c.drawCentredString(lx, ly - 2, nail_label(i))
    # Снимаем обрезку
    c.restoreState()

    # Рамка печатной области: линия реза для листов, которые ложатся сверху
    # Серая
    c.setStrokeColor(GREY)
    # Тонкая
    c.setLineWidth(0.4)
    # Пунктир — «режь здесь»
    c.setDash(3, 2)
    # Слева есть лист — этот лист обрезаем по левому краю и кладём на соседа
    if col > 0:
        # Левая линия реза
        c.line(m * mm, m * mm, m * mm, (m + h) * mm)
    # Сверху есть ряд — обрезаем по верхнему краю
    if row > 0:
        # Верхняя линия реза
        c.line(m * mm, (m + h) * mm, (m + w) * mm, (m + h) * mm)
    # Обратно сплошная линия
    c.setDash()

    # Метки совмещения в углах полос перекрытия
    # Чёрные
    c.setStrokeColor(black)
    # Тонкие
    c.setLineWidth(0.4)
    # X-позиции крестиков: в середине правой полосы (если есть сосед справа) и левой (если сосед слева)
    for ux in ([m + w - OVERLAP_MM / 2] if col < lay.cols - 1 else []) + ([m + OVERLAP_MM / 2] if col > 0 else []):
        # По два крестика на полосу: на четверти и трёх четвертях высоты
        for uy in (m + h * 0.25, m + h * 0.75):
            # Горизонтальная черта крестика
            c.line((ux - 3) * mm, uy * mm, (ux + 3) * mm, uy * mm)
            # Вертикальная черта
            c.line(ux * mm, (uy - 3) * mm, ux * mm, (uy + 3) * mm)
    # То же для нижней и верхней полос
    for uy in ([m + OVERLAP_MM / 2] if row < lay.rows - 1 else []) + ([m + h - OVERLAP_MM / 2] if row > 0 else []):
        # Два крестика по ширине
        for ux in (m + w * 0.25, m + w * 0.75):
            # Горизонтальная черта
            c.line((ux - 3) * mm, uy * mm, (ux + 3) * mm, uy * mm)
            # Вертикальная черта
            c.line(ux * mm, (uy - 3) * mm, ux * mm, (uy + 3) * mm)

    # Подпись листа, мини-схема и линейка 5 см — на белой плашке в том углу листа,
    # где она не закрывает ни одного гвоздя
    # Номер листа
    n = row * lay.cols + col + 1
    # Размер плашки в мм
    box_w, box_h = 62.0, 26.0
    # Самая левая допустимая позиция (не на полосе склейки)
    inner_l = m + (OVERLAP_MM if col > 0 else 0) + 2
    # Самая правая
    inner_r = m + w - (OVERLAP_MM if col < lay.cols - 1 else 0) - 2 - box_w
    # Самая верхняя
    inner_t = m + h - (OVERLAP_MM if row > 0 else 0) - 2  # верх плашки (точки PDF / mm)
    # Самая нижняя
    inner_b = m + (OVERLAP_MM if row < lay.rows - 1 else 0) + 2 + box_h

    # Оценка угла: насколько плашка далека от кольца гвоздей
    def clearance(left_mm: float, top_mm: float) -> float:
        """Насколько плашка далеко от кольца гвоздей с подписями (мм, больше — лучше)."""
        # Худший (ближайший) случай
        worst = math.inf
        # Проверяем сетку точек плашки 7 × 5
        for i in range(7):
            # По вертикали
            for j in range(5):
                # X точки плашки в мм от центра круга
                xm = x0 + (left_mm - m) + box_w * i / 6
                # Y точки
                ym = y0 + (m + h - top_mm) + box_h * j / 4
                # Расстояние до центра круга
                d = math.hypot(xm, ym)
                # Снаружи круга — запас до подписей; внутри — запас до гвоздей
                worst = min(worst, d - (R + CONTENT_PAD_MM) if d > R else (R - 6) - d)
        # Чем больше — тем лучше угол
        return worst

    # Четыре угла-кандидата
    corners = [(inner_l, inner_t), (inner_r, inner_t), (inner_l, inner_b), (inner_r, inner_b)]
    # Выбираем угол с наибольшим запасом
    left_mm, top_mm = max(corners, key=lambda xy: clearance(*xy))
    # Позиция плашки в точках PDF
    bx, by = left_mm * mm, top_mm * mm
    # Ширина мини-схемы
    map_w = min(24 * mm, 6 * mm * lay.cols)
    # Высота плашки в точках
    box_h = box_h * mm
    # Плашка белая
    c.setFillColor(white)
    # Со светлой рамкой
    c.setStrokeColor(LIGHT)
    # Скруглённый прямоугольник плашки
    c.roundRect(bx, by - box_h, box_w * mm, box_h, 2 * mm, fill=1, stroke=1)
    # Текст чёрный
    c.setFillColor(black)
    # Жирным
    c.setFont(FONT_BOLD, 10)
    # «Лист 3 из 6»
    c.drawString(bx + 3 * mm, by - 6 * mm, f"Лист {n} из {lay.sheets}")
    # Мелкий шрифт
    c.setFont(FONT, 6.5)
    # Серым
    c.setFillColor(GREY)
    # Ряд, место и диаметр
    c.drawString(bx + 3 * mm, by - 10 * mm, f"ряд {row + 1}, место {col + 1} · Ø {_fmt(diameter_cm)} см")
    # Название портрета (обрезанное, чтобы влезло)
    c.drawString(bx + 3 * mm, by - 13.5 * mm, title[:34])
    # линейка 5 см
    # Начало линейки
    rx, ry = bx + 3 * mm, by - 21 * mm
    # Чёрная
    c.setStrokeColor(black)
    # Толщина
    c.setLineWidth(0.5)
    # Линия 5 см
    c.line(rx, ry, rx + 50 * mm, ry)
    # Деления через 1 см
    for k in range(6):
        # Крайние деления длиннее
        c.line(rx + k * 10 * mm, ry, rx + k * 10 * mm, ry + (2.5 if k % 5 else 3.5) * mm)
    # Подпись линейки
    c.setFont(FONT, 6)
    # Чёрным
    c.setFillColor(black)
    # Подсказка
    c.drawString(rx, ry - 3 * mm, "ровно 5 см — масштаб верный")
    # Мини-схема в правой части плашки с подсветкой текущего листа
    _sheet_map(c, lay, bx + box_w * mm - map_w - 2 * mm, by - 2 * mm, map_w, n)


# Первая страница: инструкция и схема раскладки
def _cover(c: Canvas, lay: Layout, diameter_cm: float, title: str) -> None:
    # Обложка всегда A4 книжная
    pw, ph = A4
    # Левый край и верх текста
    left, top = 18 * mm, ph - 20 * mm
    # Крупный заголовок
    c.setFont(FONT_BOLD, 20)
    # Текст заголовка
    c.drawString(left, top, "Шаблон разметки гвоздей")
    # Подзаголовок
    c.setFont(FONT, 11)
    # Серым
    c.setFillColor(GREY)
    # Название, диаметр, число гвоздей и шаг по дуге
    c.drawString(left, top - 8 * mm, f"{title} · круг Ø {_fmt(diameter_cm)} см · {TOTAL_NAILS} гвоздей · "
                 # Продолжение строки (склеивается с предыдущей)
                 f"шаг {_fmt(arc_spacing(diameter_cm * 10), 2)} мм")
    # Снова чёрный
    c.setFillColor(black)

    # Контрольная линейка 10 см
    # Высота пункта 1
    y = top - 22 * mm
    # Заголовок пункта жирным
    c.setFont(FONT_BOLD, 11)
    # Текст заголовка
    c.drawString(left, y, "1. Проверьте масштаб печати")
    # Пояснение обычным шрифтом
    c.setFont(FONT, 9.5)
    # Главное условие — печать 100 %
    c.drawString(left, y - 5.5 * mm, "Печатайте в масштабе 100 % («Фактический размер»), а не «По размеру страницы».")
    # Как проверить
    c.drawString(left, y - 10.5 * mm, "Эта линия должна быть ровно 10 см — приложите линейку:")
    # Толщина линейки
    c.setLineWidth(1)
    # Высота линейки
    ry = y - 18 * mm
    # Линия 10 см
    c.line(left, ry, left + 100 * mm, ry)
    # 11 делений через 1 см
    for k in range(11):
        # Каждое пятое деление длиннее
        c.line(left + k * 10 * mm, ry, left + k * 10 * mm, ry + (4 if k % 5 == 0 else 2.5) * mm)
    # Подписи концов линейки
    c.setFont(FONT, 8)
    # «0» слева
    c.drawString(left, ry - 4 * mm, "0")
    # «10 см» справа
    c.drawRightString(left + 100 * mm, ry - 4 * mm, "10 см")

    # Шаги инструкции: (заголовок, текст); пустой заголовок — продолжение предыдущего пункта
    steps = [
        # Пункт 2 — раскладка
        ("2. Разложите листы", f"Всего листов: {lay.sheets} ({lay.rows} ряд(а) × {lay.cols}). Номера — по схеме ниже."),
        # Пункт 3 — склейка
        ("3. Склейте", "Обрежьте лист по пунктиру слева и сверху и положите на голубую полосу соседа так,"),
        # Продолжение пункта 3
        ("", "чтобы совпали линия круга и крестики совмещения. Закрепите скотчем."),
        # Пункт 4 — перенос на доску
        ("4. Перенесите на доску", "Совместите центр шаблона с центром доски; сектор A — слева сверху,"),
        # Продолжение пункта 4
        ("", "горизонтальная ось — строго по уровню. Закрепите малярным скотчем по краям."),
        # Пункт 5 — гвозди
        ("5. Вбейте гвозди", "В точку в центре каждого крестика. Синие крестики — A1, B1, C1, D1."),
        # Продолжение пункта 5
        ("", "Проще сначала наколоть все точки шилом, потом снять бумагу и бить по наколам."),
        # Пункт 6 — снять бумагу
        ("6. Снимите бумагу", "Аккуратно порвите её между гвоздями. Начинайте плести с гвоздя A1."),
    ]
    # Начало списка — под линейкой
    y = ry - 14 * mm
    # Печатаем пункты
    for head, text in steps:
        # Есть заголовок
        if head:
            # Жирным
            c.setFont(FONT_BOLD, 11)
            # Заголовок пункта
            c.drawString(left, y, head)
            # Строка вниз
            y -= 5.5 * mm
        # Текст обычным шрифтом
        c.setFont(FONT, 9.5)
        # Текст пункта
        c.drawString(left, y, text)
        # После конца пункта отступ чуть больше
        y -= 6 * mm if head == "" or text.endswith(".") else 5 * mm

    # Ширина схемы раскладки
    map_w = min(pw - 36 * mm, lay.cols * 24 * mm)
    # Заголовок схемы
    c.setFont(FONT_BOLD, 11)
    # Текст заголовка
    c.drawString(left, y - 4 * mm, "Раскладка листов (вид спереди, как на доске)")
    # Сама схема без подсветки
    _sheet_map(c, lay, left, y - 8 * mm, map_w, None)
    # Подвал мелко
    c.setFont(FONT, 8)
    # Серым
    c.setFillColor(GREY)
    # Формат бумаги и перекрытие
    c.drawString(left, 12 * mm, f"Бумага {lay.paper}, перекрытие {int(OVERLAP_MM)} мм. Сделано в «Нитеграфе».")


# Собрать шаблон целиком
def build_template_pdf(diameter_cm: float, title: str = "Портрет из нитей", paper: str = "A4") -> bytes:
    # Шрифты с кириллицей
    _register_fonts()
    # Раскладка листов
    lay = layout(diameter_cm, paper)
    # Буфер
    buf = io.BytesIO()
    # Документ со сжатием страниц (меньше размер файла)
    c = Canvas(buf, pagesize=A4, pageCompression=1)
    # Заголовок документа
    c.setTitle(f"Шаблон разметки — {title}")
    # Автор
    c.setAuthor("Нитеграф")
    # Обложка
    _cover(c, lay, diameter_cm, title)
    # Конец страницы
    c.showPage()
    # Листы шаблона по рядам
    for row in range(lay.rows):
        # И по колонкам
        for col in range(lay.cols):
            # Размер страницы под ориентацию раскладки
            c.setPageSize((lay.page_w_mm * mm, lay.page_h_mm * mm))
            # Рисуем лист
            _draw_tile(c, lay, row, col, diameter_cm, title)
            # Конец страницы
            c.showPage()
    # Сохраняем PDF
    c.save()
    # Байты PDF
    return buf.getvalue()
