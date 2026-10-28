# io.BytesIO — держим картинки и PDF в памяти, без временных файлов
import io

# numpy — чтобы читать пиксели и строить случайную последовательность
import numpy as np
# pytest — проверки исключений (raises) и фикстуры
import pytest
# Pillow — создаём и открываем тестовые картинки
from PIL import Image
# pypdf — читаем готовый PDF и достаём из него текст страниц
from pypdf import PdfReader

# Размер рабочего квадрата, к которому приводится любое фото
from app.config import PROCESSING_SIZE
# Функции подготовки фото: загрузка, перевод в серое, карты тёмности и цели
from app.image_prep import ImageError, darkness_map, load_image, target_map, to_grayscale_square
# Сборка PDF-инструкции и формула числа её страниц
from app.pdf import build_instructions_pdf, expected_page_count
# Отрисовка превью: прозрачность одной нити, массив пикселей и PNG
from app.render import line_alpha, render_array, render_png

# Короткая последовательность гвоздей: 8 нитей «звездой» через центр — хватит для проверок отрисовки
SEQ = [0, 120, 30, 150, 60, 180, 90, 210, 0]


# Раздел: подготовка изображения
# --- image_prep ---------------------------------------------------------------
# Текстовый файл вместо картинки должен отклоняться
def test_load_rejects_text(not_an_image):
    # Ждём понятную ошибку ImageError, а не падение Pillow
    with pytest.raises(ImageError):
        # Передаём байты текстового файла из фикстуры
        load_image(not_an_image)


# Пустой файл тоже не картинка
def test_load_rejects_empty():
    # Ожидаем то же ImageError
    with pytest.raises(ImageError):
        # Нулевая длина данных
        load_image(b"")


# PNG с прозрачностью: прозрачные места должны стать белыми, а не чёрными
def test_rgba_png_is_flattened_on_white(portrait_png):
    # Загружаем фикстуру с прозрачными углами и переводим в серый квадрат
    gray = to_grayscale_square(load_image(portrait_png))
    # Результат — одноканальное изображение в оттенках серого
    assert gray.mode == "L"
    # И строго рабочего размера
    assert gray.size == (PROCESSING_SIZE, PROCESSING_SIZE)
    # Углы фикстуры прозрачные, а под прозрачностью — чёрный цвет: должны стать белыми
    assert np.asarray(gray)[0, 0] == 255


# Широкое фото обрезается по центру до квадрата
def test_non_square_is_center_cropped():
    # Белая картинка 900×300 — в три раза шире, чем выше
    wide = Image.new("RGB", (900, 300), "white")
    # Буфер в памяти для PNG
    buf = io.BytesIO()
    # Сохраняем картинку как PNG-байты, как будто её загрузили
    wide.save(buf, "PNG")
    # После подготовки — квадрат рабочего размера
    assert to_grayscale_square(load_image(buf.getvalue())).size == (PROCESSING_SIZE, PROCESSING_SIZE)


# За пределами круга нить не проходит, значит «тёмность» там нулевая
def test_darkness_is_zero_outside_circle(portrait_jpg):
    # Строим карту тёмности по портрету
    dark = darkness_map(to_grayscale_square(load_image(portrait_jpg)))
    # Углы квадрата лежат вне круга — там 0
    assert dark[0, 0] == 0 and dark[-1, -1] == 0
    # Все значения нормированы в диапазон 0…1
    assert 0 <= dark.min() and dark.max() <= 1


# Гамма больше 1 высветляет средние тона цели
def test_target_map_gamma_lightens_midtones(portrait_jpg):
    # Серый квадрат из портрета
    gray = to_grayscale_square(load_image(portrait_jpg))
    # Средняя тёмность при гамме 1,6 меньше, чем без коррекции
    assert target_map(gray, gamma=1.6).mean() < target_map(gray, gamma=1.0).mean()


# Раздел: отрисовка превью
# --- render -------------------------------------------------------------------
# Ноль шагов — пустой белый холст
def test_zero_steps_is_white():
    # Минимальное значение пикселя 255 — ни одной тёмной точки
    assert render_array(SEQ, 0, 100, 50).min() == 255


# Чем больше нитей натянуто, тем темнее превью
def test_more_steps_is_darker():
    # Средняя яркость после 8 шагов ниже, чем после 2
    assert render_array(SEQ, 8, 200, 50).mean() < render_array(SEQ, 2, 200, 50).mean()


# На маленьком круге нити ложатся плотнее, поэтому картинка темнее
def test_smaller_circle_looks_denser():
    # Прозрачность одной нити выше для диаметра 30 см, чем для 70 см
    assert line_alpha(800, 30) > line_alpha(800, 70)
    # И итоговое превью при 30 см темнее, чем при 70 см
    assert render_array(SEQ, 8, 200, 30).mean() < render_array(SEQ, 8, 200, 70).mean()


# render_png отдаёт настоящий PNG нужного размера
def test_render_png_is_png():
    # Отрисовываем 8 шагов на круге 50 см в квадрат 150 пикселей
    png = render_png(SEQ, 8, 50, size=150)
    # Первые 8 байт — сигнатура формата PNG
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    # Открываем результат и проверяем размер
    assert Image.open(io.BytesIO(png)).size == (150, 150)


# Раздел: PDF-инструкция
# --- pdf ----------------------------------------------------------------------
# Длинная последовательность общая для всех тестов модуля — строим один раз
@pytest.fixture(scope="module")
# Фикстура возвращает список номеров гвоздей
def long_seq() -> list[int]:
    # Генератор с фиксированным зерном — результат одинаковый при каждом запуске
    rng = np.random.default_rng(1)
    # Начинаем с гвоздя 0, как в настоящих схемах
    out = [0]
    # Набираем 451 гвоздь — это 450 шагов
    while len(out) < 451:
        # Случайный гвоздь из 240
        n = int(rng.integers(0, 240))
        # Пропускаем слишком близкие гвозди: алгоритм тоже не тянет нить к соседям
        if abs(n - out[-1]) > 20:
            # Добавляем подходящий гвоздь
            out.append(n)
    # Отдаём готовую последовательность
    return out


# Структура PDF: обложка, сетка шагов, правильное число страниц
def test_pdf_structure(long_seq):
    # Собираем инструкцию на 450 шагов для круга 50 см
    pdf = build_instructions_pdf("Тест", long_seq, 450, 50)
    # Файл начинается с сигнатуры PDF
    assert pdf.startswith(b"%PDF")
    # Открываем PDF для чтения
    reader = PdfReader(io.BytesIO(pdf))
    # Страниц ровно столько, сколько обещает формула: обложка + схема + 3 листа шагов
    assert len(reader.pages) == expected_page_count(450) == 5
    # Текст первой страницы — обложка
    cover = reader.pages[0].extract_text()
    # На обложке есть заголовок
    assert "Портрет из нитей" in cover
    # Есть расчёт минимальной длины лески на катушке
    assert "Минимальная катушка" in cover
    # Диаметр записан по-русски, с запятой
    assert "50,0 см" in cover
    # Третья страница — первая страница с шагами
    steps_page = reader.pages[2].extract_text()
    # Гвозди подписаны в формате «сектор + номер»
    assert "A1" in steps_page
    # Заголовок блока показывает диапазон шагов
    assert "шаги 1–200 из 450" in steps_page
    # Последняя страница заканчивается ровно на шаге 450
    assert "шаги 401–450 из 450" in reader.pages[4].extract_text()


# Нельзя собрать PDF на 0 шагов или на шагов больше, чем есть в схеме
def test_pdf_rejects_bad_steps(long_seq):
    # Ноль шагов — ошибка
    with pytest.raises(ValueError):
        # Вызываем сборку с steps=0
        build_instructions_pdf("x", long_seq, 0, 50)
    # 451 шаг при 450 доступных — тоже ошибка
    with pytest.raises(ValueError):
        # Вызываем сборку с лишним шагом
        build_instructions_pdf("x", long_seq, 451, 50)


# Раздел: шаблон разметки гвоздей в натуральную величину
# --- шаблон разметки 1:1 (TC-API-31) ----------------------------------------
# Раскладка листов действительно покрывает весь круг с полями
def test_template_layout_fits_circle():
    # Поля, перекрытие листов и функция раскладки
    from app.template import CONTENT_PAD_MM, OVERLAP_MM, layout

    # Проверяем диаметры от самого маленького до самого большого
    for d in (20, 30, 50, 70, 100, 150):
        # Считаем раскладку для текущего диаметра
        lay = layout(d)
        # Покрытая ширина: колонки × шаг + перекрытие последнего листа
        covered_w = lay.cols * lay.step_x + OVERLAP_MM
        # Покрытая высота считается так же по строкам
        covered_h = lay.rows * lay.step_y + OVERLAP_MM
        # Нужно покрыть диаметр в миллиметрах плюс поля с двух сторон
        need = d * 10 + 2 * CONTENT_PAD_MM
        # Листы закрывают круг целиком по обеим осям
        assert covered_w >= need and covered_h >= need
        # меньше листов, чем «в лоб» по большей стороне — значит ориентация подобрана
        # Верхняя граница: не больше, чем при грубой раскладке листами по 180 мм
        assert lay.sheets <= ((need // 180) + 1) * ((need // 180) + 1)
    # Эталон: круг 50 см помещается на 6 листов A4
    assert layout(50).sheets == 6
    # Круг 30 см — на 4 листа
    assert layout(30).sheets == 4
    # На A3 листов нужно меньше, чем на A4
    assert layout(50, "A3").sheets < layout(50).sheets


# В шаблоне подписан каждый гвоздь, а листы напечатаются без масштабирования
def test_template_pdf_has_every_nail_in_true_scale():
    # Локальный импорт — тест самодостаточный
    import io

    # Читаем PDF
    from pypdf import PdfReader

    # Подпись гвоздя вида «A1»
    from app.geometry import nail_label
    # Сборка шаблона и раскладка листов
    from app.template import build_template_pdf, layout

    # Собираем шаблон для круга 50 см и открываем его
    reader = PdfReader(io.BytesIO(build_template_pdf(50, "Тест")))
    # Раскладка для сравнения числа страниц
    lay = layout(50)
    # Страниц: инструкция + по одной на каждый лист
    assert len(reader.pages) == 1 + lay.sheets
    # Текст первой страницы с инструкцией
    cover = reader.pages[0].extract_text()
    # Там есть название, контрольный отрезок 10 см и напоминание печатать в 100 %
    assert "Шаблон разметки" in cover and "10 см" in cover and "100 %" in cover
    # Склеиваем текст всех листов разметки
    text = " ".join(p.extract_text() for p in reader.pages[1:])
    # Перебираем все 240 гвоздей
    for i in range(240):
        # Подпись каждого гвоздя есть хотя бы на одном листе
        assert nail_label(i) in text
    # листы — настоящий A4 (в точках), без масштабирования
    # Проверяем размер каждой страницы
    for p in reader.pages[1:]:
        # Ширина и высота страницы в пунктах, по возрастанию
        w, h = sorted((float(p.mediabox.width), float(p.mediabox.height)))
        # Это A4: 595,28 × 841,89 пунктов
        assert abs(w - 595.28) < 0.5 and abs(h - 841.89) < 0.5
    # На последнем листе — номер «6 из 6»
    assert "Лист 6 из 6" in reader.pages[-1].extract_text()


# API шаблона: PDF, имя файла, проверки параметров
def test_template_api(client, project):
    # Запрашиваем шаблон для проекта
    r = client.get(f"/api/projects/{project['id']}/template.pdf")
    # Ответ 200 и тип application/pdf
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    # Имя файла передано в кодировке UTF-8 — русские буквы не ломаются
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    # Неизвестный формат бумаги A5 → 422
    assert client.get(f"/api/projects/{project['id']}/template.pdf", params={"paper": "A5"}).status_code == 422
    # Шаблон без проекта по диаметру и бумаге A3 работает
    assert client.get("/api/template.pdf", params={"diameter_cm": 40, "paper": "A3"}).status_code == 200
    # Диаметр 10 см меньше допустимого → 422
    assert client.get("/api/template.pdf", params={"diameter_cm": 10}).status_code == 422
    # Несуществующий проект → 404
    assert client.get("/api/projects/000000000000/template.pdf").status_code == 404
