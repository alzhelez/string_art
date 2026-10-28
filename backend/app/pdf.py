"""PDF-инструкция: обложка с картиной и параметрами, схема секторов, таблица шагов."""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Буфер в памяти — PDF собирается без временных файлов
import io
# Синусы/косинусы для схемы и округление вверх для числа страниц
import math
# Тип «последовательность номеров гвоздей»
from typing import Sequence

# ReportLab — библиотека для создания PDF. Цвета: свой, чёрный, белый
from reportlab.lib.colors import Color, black, white
# Размер листа A4 в пунктах
from reportlab.lib.pagesizes import A4
# Миллиметр в пунктах PDF — пишем размеры в мм
from reportlab.lib.units import mm
# Обёртка, чтобы вставить картинку Pillow в PDF
from reportlab.lib.utils import ImageReader
# Регистрация шрифтов
from reportlab.pdfbase import pdfmetrics
# Подключение TrueType-шрифта (нужен шрифт с кириллицей)
from reportlab.pdfbase.ttfonts import TTFont
# «Холст» страницы PDF, на котором рисуем
from reportlab.pdfgen.canvas import Canvas

# Константы: папка шрифтов, число гвоздей, названия секторов, толщина лески
from .config import FONTS_DIR, NAILS_PER_SECTOR, SECTORS, THREAD_DIAMETER_MM, TOTAL_NAILS
# Углы и метки гвоздей
from .geometry import nail_angle, nail_label, sector_center_angle
# Картинка готовой работы для обложки
from .render import render_image
# Расчёт лески и катушки
from .thread import thread_stats

# Обычный шрифт (DejaVu поддерживает русский)
FONT = "DejaVuSans"
# Жирный шрифт
FONT_BOLD = "DejaVuSans-Bold"
# Серый — для второстепенного текста
GREY = Color(0.45, 0.45, 0.45)
# Светло-серый — для линий схемы
LIGHT = Color(0.85, 0.85, 0.85)
# Акцентный терракотовый — для важного (буквы секторов, катушка)
ACCENT = Color(0.72, 0.25, 0.16)

# Ширина и высота листа A4
PAGE_W, PAGE_H = A4
# Поля страницы 15 мм
MARGIN = 15 * mm
# Таблица шагов: 4 колонки
STEP_COLUMNS = 4
# по 50 строк
STEP_ROWS = 50
# Итого 200 шагов на страницу
STEPS_PER_PAGE = STEP_COLUMNS * STEP_ROWS

# Флаг «шрифты уже зарегистрированы» — регистрируем один раз за запуск
_fonts_registered = False


# Подключаем шрифты DejaVu к ReportLab
def _register_fonts() -> None:
    # Будем менять глобальную переменную модуля
    global _fonts_registered
    # Ещё не регистрировали
    if not _fonts_registered:
        # Обычное начертание
        pdfmetrics.registerFont(TTFont(FONT, str(FONTS_DIR / "DejaVuSans.ttf")))
        # Жирное начертание
        pdfmetrics.registerFont(TTFont(FONT_BOLD, str(FONTS_DIR / "DejaVuSans-Bold.ttf")))
        # Запоминаем, что сделали
        _fonts_registered = True


# Число по-русски: пробел между тысячами и запятая вместо точки (1 234,5)
def _fmt(value: float, digits: int = 1) -> str:
    # Сначала формат «1,234.5», затем меняем разделители
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


# Нижний колонтитул: название и номер страницы
def _footer(c: Canvas, name: str) -> None:
    # Мелкий шрифт
    c.setFont(FONT, 8)
    # Серый цвет
    c.setFillColor(GREY)
    # Слева — название портрета
    c.drawString(MARGIN, 8 * mm, f"Портрет из нитей · {name}")
    # Справа — номер страницы
    c.drawRightString(PAGE_W - MARGIN, 8 * mm, f"стр. {c.getPageNumber()}")
    # Возвращаем чёрный цвет для следующего текста
    c.setFillColor(black)


# Страница 1: обложка с картинкой и таблицей параметров
def _cover(c: Canvas, name: str, sequence: Sequence[int], steps: int, diameter_cm: float) -> None:
    # Расчёт лески для таблицы
    stats = thread_stats(sequence, steps, diameter_cm)
    # Верхняя граница содержимого (в PDF ось Y идёт снизу вверх)
    y = PAGE_H - MARGIN
    # Крупный жирный заголовок
    c.setFont(FONT_BOLD, 22)
    # Текст заголовка
    c.drawString(MARGIN, y - 8 * mm, "Портрет из нитей")
    # Подзаголовок обычным шрифтом
    c.setFont(FONT, 12)
    # Серым цветом
    c.setFillColor(GREY)
    # Название портрета
    c.drawString(MARGIN, y - 15 * mm, name)
    # Снова чёрный
    c.setFillColor(black)

    # Картинка 12 × 12 см
    img_size = 120 * mm
    # Рисуем готовую работу в высоком разрешении
    img = render_image(sequence, steps, diameter_cm, size=1100)
    # Вставляем картинку по центру листа под заголовком
    c.drawImage(ImageReader(img), (PAGE_W - img_size) / 2, y - 22 * mm - img_size, img_size, img_size)

    # Катушка: «500 м» или «3 × 1000 м»
    spool = f"{stats.spool_m} м" if stats.spool_count == 1 else f"{stats.spool_count} × {stats.spool_m} м"
    # Строки таблицы параметров: (подпись, значение)
    rows = [
        # Диаметр доски
        ("Диаметр круга", f"{_fmt(diameter_cm)} см"),
        # Сколько гвоздей
        ("Гвоздей", f"{TOTAL_NAILS} (4 сектора × {NAILS_PER_SECTOR})"),
        # Расстояние между гвоздями — для разметки
        ("Шаг между гвоздями по дуге", f"{_fmt(stats.nail_spacing_mm, 2)} мм"),
        # Число линий
        ("Количество шагов (линий)", _fmt(steps, 0)),
        # Какая леска имелась в виду при расчёте
        ("Леска (эталон)", f"чёрная, ~{_fmt(THREAD_DIAMETER_MM, 1)} мм"),
        # Длина без запаса
        ("Длина лески без запаса", f"{_fmt(stats.raw_length_m)} м"),
        # Длина с запасом
        ("Длина лески с запасом +15 %", f"{_fmt(stats.total_length_m)} м"),
        # Какую катушку покупать
        ("Минимальная катушка", spool),
        # С какого гвоздя начинать
        ("Старт", "гвоздь A1"),
    ]
    # Верх таблицы — под картинкой
    top = y - 30 * mm - img_size
    # Высота строки таблицы
    row_h = 7.2 * mm
    # Колонки: подписи слева, значения от середины листа
    x_label, x_value = MARGIN + 10 * mm, PAGE_W / 2 + 5 * mm
    # Рисуем строки по очереди
    for i, (label, value) in enumerate(rows):
        # Высота текущей строки
        ry = top - i * row_h
        # Каждая вторая строка — с бежевой подложкой («зебра» для удобства чтения)
        if i % 2 == 0:
            # Цвет подложки
            c.setFillColor(Color(0.96, 0.95, 0.93))
            # Прямоугольник подложки без обводки
            c.rect(MARGIN, ry - 2.3 * mm, PAGE_W - 2 * MARGIN, row_h, stroke=0, fill=1)
            # Текст снова чёрный
            c.setFillColor(black)
        # Подпись обычным шрифтом
        c.setFont(FONT, 10.5)
        # Пишем подпись
        c.drawString(x_label, ry, label)
        # Значение жирным
        c.setFont(FONT_BOLD, 10.5)
        # Катушку выделяем акцентным цветом — это главное, что нужно купить
        if label == "Минимальная катушка":
            # Акцентный цвет
            c.setFillColor(ACCENT)
        # Пишем значение
        c.drawString(x_value, ry, value)
        # Возвращаем чёрный
        c.setFillColor(black)
    # Колонтитул
    _footer(c, name)


# Страница 2: схема гвоздей и памятка по разметке и плетению
def _scheme(c: Canvas, name: str, diameter_cm: float, steps: int, spacing_mm: float) -> None:
    # Заголовок страницы
    c.setFont(FONT_BOLD, 16)
    # Текст заголовка
    c.drawString(MARGIN, PAGE_H - MARGIN - 6 * mm, "Схема гвоздей и как читать шаги")

    # Радиус круга на схеме (5,5 см)
    r = 55 * mm
    # Центр круга: по центру листа, под заголовком
    cx, cy = PAGE_W / 2, PAGE_H - MARGIN - 34 * mm - r
    # Светлые линии
    c.setStrokeColor(LIGHT)
    # Тонкая обводка
    c.setLineWidth(0.6)
    # Окружность
    c.circle(cx, cy, r)
    # Пунктир для осей
    c.setDash(3, 3)
    # Горизонтальная ось X (чуть длиннее круга)
    c.line(cx - r - 6 * mm, cy, cx + r + 6 * mm, cy)
    # Вертикальная ось Y
    c.line(cx, cy - r - 6 * mm, cx, cy + r + 6 * mm)
    # Сплошные линии дальше
    c.setDash()
    # Мелкие подписи осей
    c.setFont(FONT, 7)
    # Серым
    c.setFillColor(GREY)
    # Подпись «x» у правого конца оси
    c.drawString(cx + r + 7 * mm, cy - 1 * mm, "x")
    # Подпись «y» у верхнего конца оси
    c.drawString(cx + 1.5 * mm, cy + r + 7 * mm, "y")

    # Рисуем все 240 гвоздей точками
    for i in range(TOTAL_NAILS):
        # Угол гвоздя
        a = nail_angle(i)
        # Координаты на листе (в PDF Y растёт вверх, поэтому +cos)
        x, y = cx + r * math.sin(a), cy + r * math.cos(a)  # в PDF ось Y вверх
        # Номер внутри сектора 1..60
        number = i % NAILS_PER_SECTOR + 1
        # «Круглые» номера выделяем крупной точкой — по ним легче считать
        big = number in (1, 10, 20, 30, 40, 50, 60)
        # Крупные — чёрные, остальные — серые
        c.setFillColor(black if big else GREY)
        # Точка гвоздя
        c.circle(x, y, 0.9 if big else 0.45, stroke=0, fill=1)
        # Подписываем первый, средний и последний гвоздь каждого сектора
        if number in (1, 30, 60):
            # 1 и 60 стоят у осей — сдвигаем подписи вдоль окружности в «свой» сектор
            # Величина сдвига вдоль окружности (в мм), у среднего гвоздя сдвига нет
            shift = {1: 4 * mm, 30: 0.0, 60: -4 * mm}[number]
            # X подписи: снаружи круга на 5 мм плюс сдвиг по касательной
            lx = cx + (r + 5 * mm) * math.sin(a) + shift * math.cos(a)
            # Y подписи
            ly = cy + (r + 5 * mm) * math.cos(a) - shift * math.sin(a)
            # Мелкий шрифт подписи
            c.setFont(FONT, 6.5)
            # Метка гвоздя по центру точки
            c.drawCentredString(lx, ly - 1.2 * mm, nail_label(i))

    # Буквы секторов — акцентным цветом
    c.setFillColor(ACCENT)
    # Крупно и жирно
    c.setFont(FONT_BOLD, 26)
    # Для каждого сектора
    for s, letter in enumerate(SECTORS):
        # Угол середины сектора
        a = sector_center_angle(s)
        # Букву ставим на полпути от центра к краю
        c.drawCentredString(cx + 0.55 * r * math.sin(a), cy + 0.55 * r * math.cos(a) - 4 * mm, letter)
    # Снова чёрный
    c.setFillColor(black)

    # Стрелка «по часовой» над верхней точкой
    # Цвет стрелки
    c.setStrokeColor(ACCENT)
    # Толщина линии стрелки
    c.setLineWidth(1.2)
    # Радиус дуги стрелки — чуть больше круга
    arc_r = r + 11 * mm
    # Дуга от 80° на 25° по часовой
    c.arc(cx - arc_r, cy - arc_r, cx + arc_r, cy + arc_r, startAng=80, extent=-25)
    # Угол острия стрелки
    tip_a = math.radians(80 - 25)  # дуга идёт от 80° к 55° (по часовой)
    # Координаты острия
    tx, ty = cx + arc_r * math.cos(tip_a), cy + arc_r * math.sin(tip_a)
    # Направление «назад» вдоль дуги — от него рисуются «крылья» стрелки
    back = math.atan2(math.cos(tip_a), -math.sin(tip_a))  # направление «назад» вдоль дуги
    # Два крыла: под углом ±0,5 радиана
    for wing in (-0.5, 0.5):
        # Короткая линия от острия
        c.line(tx, ty, tx + 2.6 * mm * math.cos(back + wing), ty + 2.6 * mm * math.sin(back + wing))
    # Подпись к стрелке
    c.setFont(FONT, 8)
    # Акцентным цветом
    c.setFillColor(ACCENT)
    # Текст подписи
    c.drawString(tx + 3 * mm, ty - 1 * mm, "нумерация по часовой стрелке")
    # Снова чёрный
    c.setFillColor(black)

    # Памятка: строки текста под схемой
    text = [
        # Заголовок раздела
        "Подготовка",
        # Разметка круга
        f"1. Начертите круг диаметром {_fmt(diameter_cm)} см и проведите оси X и Y через центр.",
        # Расположение секторов
        "2. Оси делят круг на 4 сектора: A — слева сверху, B — справа сверху, C — справа снизу, D — слева снизу.",
        # Шаг гвоздей
        f"3. В каждом секторе вбейте 60 гвоздей с шагом {_fmt(spacing_mm, 2)} мм по дуге. Первый и последний гвоздь",
        # Продолжение пункта 3
        "    сектора стоят на расстоянии половины шага от оси, ни один гвоздь не попадает точно на ось.",
        # Нумерация
        "4. Гвозди в секторе нумеруются 1…60 по часовой стрелке: A1 — первый над левой точкой оси X.",
        # Пустая строка между разделами
        "",
        # Заголовок раздела
        "Плетение",
        # Старт
        "5. Привяжите леску к гвоздю A1 — это старт.",
        # Как читать шаг
        "6. Шаг «A12 → C37» означает: натяните леску от гвоздя A12 к гвоздю C37 и обведите его.",
        # Продолжение пункта 6
        "    Следующий шаг всегда начинается с гвоздя, на котором закончился предыдущий.",
        # Направление обмотки
        "7. Обводите гвозди всегда в одну сторону — так леска лежит ровнее.",
        # Отметки и натяжение
        "8. Отмечайте выполненные шаги галочкой в квадрате. Держите леску натянутой, но без рывков.",
        # Финал
        f"9. Всего шагов: {_fmt(steps, 0)}. В конце закрепите леску узлом и каплей клея.",
    ]
    # Начало текста — под схемой
    ty = cy - r - 18 * mm
    # Печатаем строки по очереди
    for line in text:
        # Заголовки разделов
        if line in ("Подготовка", "Плетение"):
            # Жирным
            c.setFont(FONT_BOLD, 11)
            # И с небольшим отступом сверху
            ty -= 2 * mm
        # Обычные строки
        else:
            # Обычным шрифтом
            c.setFont(FONT, 9.5)
        # Пишем строку
        c.drawString(MARGIN, ty, line)
        # Переходим на следующую строку
        ty -= 5.6 * mm
    # Колонтитул
    _footer(c, name)


# Страницы 3+: таблица шагов с квадратиками для отметок
def _steps_pages(c: Canvas, name: str, sequence: Sequence[int], steps: int) -> None:
    # Ширина колонки
    col_w = (PAGE_W - 2 * MARGIN) / STEP_COLUMNS
    # Верх таблицы (под заголовком)
    top = PAGE_H - MARGIN - 14 * mm
    # Высота строки: доступная высота / 50 строк
    row_h = (top - 16 * mm) / STEP_ROWS
    # Страница за страницей, по 200 шагов
    for page_start in range(0, steps, STEPS_PER_PAGE):
        # Последний шаг на странице
        page_end = min(steps, page_start + STEPS_PER_PAGE)
        # Заголовок страницы
        c.setFont(FONT_BOLD, 12)
        # Текст заголовка
        c.drawString(MARGIN, PAGE_H - MARGIN - 4 * mm, "Шаги плетения")
        # Справа — диапазон шагов
        c.setFont(FONT, 9)
        # Серым
        c.setFillColor(GREY)
        # «шаги 1–200 из 3000»
        c.drawRightString(
            # Координаты и текст диапазона
            PAGE_W - MARGIN, PAGE_H - MARGIN - 4 * mm, f"шаги {page_start + 1}–{page_end} из {steps}"
        )
        # Снова чёрный
        c.setFillColor(black)
        # Строки таблицы
        for k in range(page_start, page_end):
            # Номер строки на этой странице
            local = k - page_start
            # Колонка и строка: сначала заполняем первую колонку сверху вниз
            col, row = divmod(local, STEP_ROWS)
            # X ячейки
            x = MARGIN + col * col_w
            # Y ячейки
            y = top - row * row_h
            # Подложка «зеброй»
            if row % 2 == 0:
                # Цвет подложки
                c.setFillColor(Color(0.965, 0.96, 0.95))
                # Прямоугольник подложки
                c.rect(x, y - 1.3 * mm, col_w - 2 * mm, row_h, stroke=0, fill=1)
                # Снова чёрный
                c.setFillColor(black)
            # Обводка квадратика — серая
            c.setStrokeColor(GREY)
            # Тонкая
            c.setLineWidth(0.5)
            # Внутри белый
            c.setFillColor(white)
            # Квадратик для галочки
            c.rect(x + 1 * mm, y - 0.6 * mm, 2.8 * mm, 2.8 * mm, stroke=1, fill=1)
            # Номер шага серым
            c.setFillColor(GREY)
            # Мелким шрифтом
            c.setFont(FONT, 7.5)
            # Номер шага, выровненный по правому краю
            c.drawRightString(x + 14 * mm, y, str(k + 1))
            # Шаг — чёрным
            c.setFillColor(black)
            # Жирным
            c.setFont(FONT_BOLD, 8.5)
            # «A12 → C37»
            c.drawString(
                # Откуда и куда тянуть нить
                x + 16 * mm, y, f"{nail_label(sequence[k])}  →  {nail_label(sequence[k + 1])}"
            )
        # Колонтитул
        _footer(c, name)
        # Закончить страницу
        c.showPage()


# Собрать весь PDF и вернуть его байты
def build_instructions_pdf(name: str, sequence: Sequence[int], steps: int, diameter_cm: float) -> bytes:
    # Число шагов должно быть в допустимых пределах
    if not 1 <= steps <= len(sequence) - 1:
        # Иначе ошибка
        raise ValueError("Некорректное количество шагов")
    # Подключаем шрифты
    _register_fonts()
    # Буфер для PDF
    buf = io.BytesIO()
    # Новый документ формата A4
    c = Canvas(buf, pagesize=A4)
    # Заголовок документа (виден в свойствах PDF)
    c.setTitle(f"Портрет из нитей — {name}")
    # Автор документа
    c.setAuthor("String Art Studio")
    # Страница 1 — обложка
    _cover(c, name, sequence, steps, diameter_cm)
    # Закончить страницу
    c.showPage()
    # Шаг гвоздей для памятки
    spacing = thread_stats(sequence, steps, diameter_cm).nail_spacing_mm
    # Страница 2 — схема
    _scheme(c, name, diameter_cm, steps, spacing)
    # Закончить страницу
    c.showPage()
    # Страницы с шагами
    _steps_pages(c, name, sequence, steps)
    # Сохранить документ в буфер
    c.save()
    # Байты PDF
    return buf.getvalue()


# Сколько страниц должно получиться (для тестов): обложка + схема + страницы шагов
def expected_page_count(steps: int) -> int:
    # 2 + округлённое вверх число страниц по 200 шагов
    return 2 + math.ceil(steps / STEPS_PER_PAGE)
