# json — читаем общий с фронтендом эталон и строим из него названия кейсов
import json

# numpy — массивы пикселей и сравнение результатов
import numpy as np
# pytest — параметризация, approx, пропуски и monkeypatch
import pytest
# Pillow — открываем фикстуры и рисуем тестовые картинки
from PIL import Image

# Модуль подготовки фото: кадр, тон, маска, лица, модель
from app import photo
# Рабочий размер квадрата
from app.config import PROCESSING_SIZE
# Алгоритм подбора нитей — нужен для проверки «важности» области
from app.algorithm import generate_sequence

# Путь к папке с общими тестовыми файлами
from .conftest import FIXTURES

# Эталонные кейсы: одни и те же входы и ответы проверяются и тут, и в frontend/lib/prep.ts
GOLDEN = json.loads((FIXTURES / "prep-golden.json").read_text(encoding="utf-8"))


# Раздел: сверка с эталоном, чтобы превью в браузере совпадало с сервером
# --- эталон, общий с frontend/lib/prep.ts --------------------------------------
# Каждый кейс тона — отдельный тест; имя — начало JSON с параметрами
@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: json.dumps(c["prep"], sort_keys=True)[:60])
# Тональный конвейер даёт тот же результат, что записан в эталоне
def test_golden_tone_pipeline(case):
    # Размер эталонной картинки
    h, w = GOLDEN["height"], GOLDEN["width"]
    # Цветные пиксели эталона превращаем в массив высота × ширина × 3
    rgb = np.array(GOLDEN["rgb"], dtype=np.uint8).reshape(h, w, 3)
    # Маска «человек/фон» в том же размере
    mask = np.array(GOLDEN["mask"], dtype=np.uint8).reshape(h, w)
    # Параметры подготовки этого кейса
    p = photo.Prep(**case["prep"])
    # Переводим в серый тем же способом, что и сервер
    g = photo.to_gray(rgb)
    # Если включено удаление фона —
    if p.remove_background:
        # — фон под маской становится белым
        g = photo.apply_mask(g, mask)
    # Автоуровни, затем яркость и контраст — в том же порядке, что на сервере и в браузере
    g = photo.brightness_contrast(photo.auto_levels(g), p.brightness, p.contrast)
    # Округляем до целых 0…255 и вытягиваем в один ряд
    out = np.clip(np.rint(g), 0, 255).astype(int).ravel()
    # Расхождение с эталоном — не больше 1 уровня яркости
    assert np.abs(out - np.array(case["expected"])).max() <= 1


# Кейсы кадрирования из того же эталона
@pytest.mark.parametrize("case", GOLDEN["crop_cases"], ids=lambda c: f"{c['width']}x{c['height']}")
# Квадрат кадра совпадает с эталоном для разных размеров фото
def test_golden_crop_box(case):
    # Считаем кадр по ширине, высоте и параметрам
    got = photo.crop_box(case["width"], case["height"], photo.Prep(**case["prep"]))
    # Сравниваем с точностью до 0,0001 пикселя
    assert got == pytest.approx(case["expected"], abs=1e-4)


# Раздел: кадрирование
# --- кадр ---------------------------------------------------------------------
# По умолчанию берётся квадрат по центру со стороной по короткой стороне
def test_crop_default_is_centered_square():
    # Фото 1600×1200 → квадрат 1200, отступ слева 200
    assert photo.crop_box(1600, 1200, photo.Prep()) == (200, 0, 1200)


# Зум уменьшает кадр, а сдвиг к краю не выводит его за фото
def test_crop_zoom_and_clamp_to_edges():
    # Центр в правом верхнем углу, зум 4 на квадратном фото 800
    x0, y0, side = photo.crop_box(800, 800, photo.Prep(center_x=1.0, center_y=0.0, zoom=4))
    # Сторона кадра 800 / 4 = 200
    assert side == 200
    # Кадр прижат к правому верхнему углу
    assert (x0, y0) == (600, 0)  # уткнулись в правый верхний угол, но не вышли за фото


# Слишком большие и слишком маленькие значения обрезаются до допустимых
def test_clamp_prep_bounds():
    # Передаём заведомо неверные параметры
    p = photo.clamp_prep(photo.Prep(center_x=2, center_y=-1, zoom=10, brightness=3, contrast=-3))
    # Получаем границы: центр 0…1, зум до 4, яркость и контраст ±0,5
    assert (p.center_x, p.center_y, p.zoom, p.brightness, p.contrast) == (1, 0, 4, 0.5, -0.5)


# Раздел: тональные операции
# --- тональные операции ----------------------------------------------------------
# Автоуровни растягивают узкий диапазон на всю шкалу
def test_auto_levels_stretches_range():
    # Плавный переход от 100 до 150
    g = np.linspace(100, 150, 10000, dtype=np.float32)
    # Применяем автоуровни
    out = photo.auto_levels(g)
    # Теперь самый тёмный — 0, самый светлый — 255
    assert out.min() == 0 and out.max() == 255


# Однотонную картинку автоуровни не трогают (делить на ноль нельзя)
def test_auto_levels_flat_image_unchanged():
    # 100 пикселей одного цвета
    g = np.full(100, 77, dtype=np.float32)
    # Все значения остались 77
    assert np.all(photo.auto_levels(g) == 77)


# Яркость сдвигает тона, контраст растягивает или сжимает их около середины
def test_brightness_and_contrast():
    # Три опорных тона: чёрный, средний, белый
    g = np.array([0, 128, 255], dtype=np.float32)
    # Яркость +0,1 добавляет 25,5 уровня, белый упирается в 255
    assert photo.brightness_contrast(g, 0.1, 0).tolist() == pytest.approx([25.5, 153.5, 255])
    # Контраст +1 на крайних и среднем тоне ничего не меняет
    assert photo.brightness_contrast(g, 0, 1.0).tolist() == pytest.approx([0, 128, 255])
    # Контраст −0,5 сжимает к середине
    assert photo.brightness_contrast(g, 0, -0.5).tolist() == pytest.approx([64, 128, 191.5])


# Маска делает фон белым
def test_mask_makes_background_white():
    # Два тёмных пикселя
    g = np.array([10, 10], dtype=np.float32)
    # Первый — человек (255), остаётся; второй — фон (0), становится белым
    assert photo.apply_mask(g, np.array([255, 0])).tolist() == [10, 255]


# С удалённым фоном портрет светлее и фон по краям белый
def test_prepare_gray_with_background_removed_is_lighter():
    # Открываем фото астронавта в RGB
    img = Image.open(FIXTURES / "face.jpg").convert("RGB")
    # Пустая маска: всё — фон
    mask = Image.new("L", img.size, 0)
    # Белая полоса посередине изображает человека
    mask.paste(255, (150, 0, 370, 512))  # «человек» — полоса посередине
    # Подготовка без удаления фона
    plain = np.asarray(photo.prepare_gray(img, photo.Prep()))
    # Подготовка с удалением фона по нашей маске
    no_bg = np.asarray(photo.prepare_gray(img, photo.Prep(remove_background=True), mask))
    # Оба результата — рабочего размера
    assert plain.shape == no_bg.shape == (PROCESSING_SIZE, PROCESSING_SIZE)
    # Левый край, где был фон, стал почти белым
    assert no_bg[:, :60].mean() > 250  # фон слева стал белым
    # В целом картинка стала светлее
    assert no_bg.mean() > plain.mean()


# Исходник уменьшается до 1600 по длинной стороне и теряет прозрачность
def test_normalize_original_limits_size_and_flattens_alpha():
    # Огромная прозрачная картинка 4000×1000
    big = Image.new("RGBA", (4000, 1000), (0, 0, 0, 0))
    # Нормализуем, как при загрузке
    out = photo.normalize_original(big)
    # Стала RGB, пропорции сохранились
    assert out.mode == "RGB" and out.size == (1600, 400)
    # Прозрачный пиксель стал белым
    assert out.getpixel((10, 10)) == (255, 255, 255)


# Раздел: поиск лица
# --- лицо ---------------------------------------------------------------------
# Без OpenCV поиск лица не работает — тест пропускается
@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
# На портрете астронавта лицо находится
def test_face_found_on_portrait():
    # Ищем лица на фикстуре
    faces = photo.detect_faces(Image.open(FIXTURES / "face.jpg"))
    # Должно найтись хотя бы одно
    assert faces, "лицо астронавта должно находиться"
    # Берём первое (самое крупное)
    f = faces[0]
    # Центр лица — в верхней середине кадра
    assert 0.3 < f.x + f.w / 2 < 0.55 and 0.1 < f.y + f.h / 2 < 0.4


# Тоже нужен OpenCV
@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
# На белой картинке лиц нет
def test_no_face_on_blank():
    # Пустой список, без ложных срабатываний
    assert photo.detect_faces(Image.new("RGB", (400, 400), "white")) == []


# «Выделить лицо» подбирает кадр с головой и плечами
def test_face_prep_frames_head():
    # Лицо 20 % кадра, слева 40 %, сверху 20 %
    face = photo.Box(x=0.4, y=0.2, w=0.2, h=0.2)
    # Подбираем параметры кадра для фото 1000×1000
    p = photo.face_prep(1000, 1000, face)
    # Флажок «Выделить лицо» включён
    assert p.face_focus
    # По горизонтали центр совпадает с центром лица
    assert p.center_x == pytest.approx(0.5)
    # По вертикали центр чуть ниже лица
    assert p.center_y == pytest.approx(0.32)  # чуть ниже центра лица — влезают плечи
    # Зум такой, чтобы лицо заняло половину кадра
    assert p.zoom == pytest.approx(1000 / (200 * 2.0), rel=1e-3)


# Карта важности: в центре лица вес 2, вдали — 1
def test_face_importance_peaks_on_face():
    # Лицо в центре фото
    face = photo.Box(x=0.4, y=0.4, w=0.2, h=0.2)
    # Строим карту важности для стандартного кадра
    imp = photo.face_importance(1000, 1000, photo.Prep(), face)
    # Центр рабочего квадрата
    c = PROCESSING_SIZE // 2
    # В центре лица — максимальный вес
    assert imp[c, c] == pytest.approx(2.0)
    # В углу — обычный вес 1
    assert imp[5, 5] == pytest.approx(1.0, abs=1e-3)


# Важная область действительно притягивает нити
def test_importance_pulls_lines_to_region():
    # Рабочий размер
    size = PROCESSING_SIZE
    # Равномерная серая картинка — сама по себе нити никуда не тянет
    dark = np.full((size, size), 0.5, dtype=np.float32)
    # Карта важности по умолчанию — единицы
    imp = np.ones_like(dark)
    # Левую половину делаем втрое важнее
    imp[:, : size // 2] = 3.0  # левая половина важнее
    # Подбираем 300 нитей с учётом важности
    seq = generate_sequence(dark, max_lines=300, importance=imp)
    # Координаты гвоздя на круге
    from app.geometry import nail_xy

    # Считаем нити, середина которых в левой половине
    left = sum((nail_xy(a, 1)[0] + nail_xy(b, 1)[0]) / 2 < 0 for a, b in zip(seq, seq[1:]))
    # Таких больше 60 % — важность работает
    assert left / 300 > 0.6


# Карта важности другого размера — понятная ошибка
def test_importance_shape_mismatch():
    # Ожидаем ValueError
    with pytest.raises(ValueError):
        # Картинка 10×10, а карта 5×5
        generate_sequence(np.zeros((10, 10)), max_lines=1, importance=np.ones((5, 5)))



# Раздел: чистка маски
# --- чистка маски -------------------------------------------------------------
# Тестовая цветная картинка — плавный градиент слева направо
def _rgb(size=200):
    # Сетка координат
    yy, xx = np.mgrid[0:size, 0:size]
    # Три одинаковых канала — серый градиент
    return np.dstack([(xx * 255 // size).astype(np.uint8)] * 3)


# Чистка убирает островки и дымку и заполняет дырки
def test_refine_mask_removes_islands_and_fills_holes():
    # Пустая маска 200×200
    m = np.zeros((200, 200), np.uint8)
    # Прямоугольник — человек
    m[40:200, 60:140] = 255  # человек
    # Маленькая дырка внутри — как блик на одежде
    m[100:104, 100:104] = 0  # дырка-блик внутри
    # Отдельный островок — мусор на фоне
    m[10:16, 170:176] = 255  # островок фона
    # Полупрозрачная дымка в углу
    m[0:30, 0:30] = 90  # полупрозрачная дымка
    # Чистим маску
    out = photo.refine_mask(_rgb(), m)
    # Дырка заполнена
    assert out[102, 102] > 200  # дырка заполнена
    # Островок убран
    assert out[12, 172] < 30  # островок убран
    # Дымка убрана
    assert out[15, 15] < 30  # дымка убрана
    # Человек остался, фон остался фоном
    assert out[150, 100] > 240 and out[150, 20] < 15
    # Размер и тип не изменились
    assert out.shape == m.shape and out.dtype == np.uint8


# Маленький кусок маски с лицом не выбрасывается
def test_refine_mask_keeps_small_part_with_face():
    # Пустая маска
    m = np.zeros((200, 200), np.uint8)
    # Крупный объект слева
    m[60:200, 0:120] = 255  # крупный объект
    # Маленький кусок справа сверху
    m[10:30, 160:180] = 255  # маленький кусок — но на нём лицо
    # Лицо в этом маленьком куске
    face = photo.Box(0.8, 0.05, 0.1, 0.1)
    # С лицом кусок остаётся
    assert photo.refine_mask(_rgb(), m, [face])[20, 170] > 200
    # Без лица — удаляется как островок
    assert photo.refine_mask(_rgb(), m, [])[20, 170] < 30


# Основной детектор YuNet находит одно лицо в нужном месте
def test_detect_faces_yunet():
    # Без OpenCV —
    if not photo.face_detection_available():
        # — тест пропускается
        pytest.skip("нет OpenCV")
    # Путь к фикстурам
    from .conftest import FIXTURES

    # Нормализуем фото, как при загрузке
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    # Ищем лица
    faces = photo.detect_faces(img)
    # Ровно одно лицо
    assert len(faces) == 1
    # Берём его
    f = faces[0]
    # лицо астронавта: по центру сверху, высота ~20 % кадра
    # Центр и высота лица в ожидаемых пределах
    assert 0.3 < f.x + f.w / 2 < 0.55 and 0.15 < f.y + f.h / 2 < 0.35 and 0.15 < f.h < 0.3
    # Файл модели YuNet лежит в проекте
    assert photo.YUNET_MODEL.exists()
    # на однотонной картинке лиц нет
    # Однотонная картинка — без лиц
    assert photo.detect_faces(Image.new("RGB", (400, 300), "white")) == []


# Где ищется и куда качается модель удаления фона
def test_model_search_and_download_dir(tmp_path, monkeypatch):
    """Модель ищется там, куда её мог скачать rembg, и в своей папке; качается в STRINGART_MODELS_DIR."""
    # Подменяем домашнюю папку на временную
    monkeypatch.setenv("HOME", str(tmp_path))
    # Убираем переменные rembg, чтобы не мешали
    monkeypatch.delenv("U2NET_HOME", raising=False)
    # И вторую тоже
    monkeypatch.delenv("REMBG_HOME", raising=False)
    # Минимальный размер «настоящей» модели — 10 байт для теста
    monkeypatch.setattr(photo, "MODEL_MIN_BYTES", 10)
    # Своя папка для моделей
    monkeypatch.setenv("STRINGART_MODELS_DIR", str(tmp_path / "ours"))
    # Пока модели нигде нет
    assert photo.find_model() is None
    # Путь, куда модель кладёт rembg
    old = tmp_path / ".u2net" / photo.MODEL_FILE
    # Создаём папку
    old.parent.mkdir()
    # Кладём «модель» нормального размера
    old.write_bytes(b"x" * 20)
    # Нашлась модель rembg
    assert photo.find_model() == old
    # Путь в нашей папке
    ours = tmp_path / "ours" / photo.MODEL_FILE
    # Создаём папку
    ours.parent.mkdir()
    # Кладём недокачанный файл
    ours.write_bytes(b"x" * 5)  # недокачанный файл не считается
    # Он не считается — по-прежнему берётся модель rembg
    assert photo.find_model() == old
    # Докачиваем до нормального размера
    ours.write_bytes(b"x" * 20)
    # Теперь наша папка в приоритете
    assert photo.find_model() == ours
    # Папка для скачивания — из переменной окружения
    assert photo.model_dir() == tmp_path / "ours"
