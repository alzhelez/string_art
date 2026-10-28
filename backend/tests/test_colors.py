"""Цветные портреты (TC-API-32): палитра, доли нитей, слои, API, PDF."""

# Буферы в памяти для PNG и PDF
import io

# Массивы
import numpy as np
# Проверки исключений, approx и фикстуры
import pytest
# Картинки
from PIL import Image
# Чтение PDF
from pypdf import PdfReader

# Модули цвета, фото и отрисовки
from app import layers, palette, photo, render
# Число страниц шагов в PDF
from app.pdf import STEPS_PER_PAGE

# Путь к фикстурам
from .conftest import FIXTURES


# --- палитра и доли нитей ---------------------------------------------------
# Цвет одной нити без примесей должен получить долю 1 этой нити, а цвет доски — ноль нитей
def test_coverage_pure_colors():
    # Белая доска
    board = palette.BOARD_BY_KEY["white"].rgb
    # Красная и чёрная нити
    threads = [palette.THREAD_BY_KEY["red"].rgb, palette.THREAD_BY_KEY["black"].rgb]
    # Картинка 2×2: красный, чёрный, белый (доска), смесь красного с доской пополам
    target = np.array(
        # Пиксели
        [[threads[0], threads[1]], [board, (threads[0] + board) / 2]],
        # Тип
        dtype=np.float32,
    )
    # Доли нитей: K×H×W
    cov = palette.coverage(target, board, threads, iters=400)
    # Красный пиксель — красная нить целиком, чёрной нет
    assert cov[0, 0, 0] == pytest.approx(1, abs=0.02) and cov[1, 0, 0] == pytest.approx(0, abs=0.02)
    # Чёрный — наоборот
    assert cov[1, 0, 1] == pytest.approx(1, abs=0.02) and cov[0, 0, 1] == pytest.approx(0, abs=0.02)
    # Белая доска — нитей не нужно
    assert cov[:, 1, 0] == pytest.approx([0, 0], abs=0.02)
    # Смесь — половина красной
    assert cov[0, 1, 1] == pytest.approx(0.5, abs=0.03)


# Доли нитей не бывают отрицательными, а в сумме не превышают 100 %
def test_coverage_stays_in_bounds():
    # Случайное фото с фиксированным зерном
    rng = np.random.default_rng(3)
    # 20×20 цветных пикселей
    target = rng.random((20, 20, 3), dtype=np.float32)
    # Серая доска и три нити
    cov = palette.coverage(target, palette.BOARD_BY_KEY["gray"].rgb, [palette.THREAD_BY_KEY[k].rgb for k in ("white", "black", "red")])
    # Нет отрицательных долей
    assert cov.min() >= 0
    # Сумма долей в каждой точке не больше единицы (с допуском на округление)
    assert cov.sum(axis=0).max() <= 1 + 1e-5


# Проекция на {a ≥ 0, Σa ≤ 1}: внутри области точка не меняется, снаружи — попадает на границу
def test_projection():
    # Точки: внутри, с отрицательным числом, с суммой больше 1
    a = np.array([[0.2, 0.3], [-0.5, 0.4], [0.9, 0.9]], dtype=np.float32)
    # Проецируем
    out = palette._project(a.copy())
    # Внутренняя — без изменений
    assert out[0] == pytest.approx([0.2, 0.3])
    # Отрицательное обрезано до нуля
    assert out[1] == pytest.approx([0.0, 0.4])
    # Сумма стала ровно 1, поровну
    assert out[2] == pytest.approx([0.5, 0.5])


# Режимы и выбор цветов
def test_resolve_palette_modes():
    # Одна нить — всегда чёрная на белой доске
    assert palette.resolve_palette("mono", None, None, None, 3) == (["black"], "white")
    # Чёрная + белая — серая доска по умолчанию
    assert palette.resolve_palette("bw", None, None, None, 3) == (["white", "black"], "gray")
    # Доску можно выбрать
    assert palette.resolve_palette("bw", None, "navy", None, 3)[1] == "navy"
    # Цвета вручную — в порядке плетения (светлые раньше), повторы убираются
    assert palette.resolve_palette("color", ["black", "yellow", "black"], None, None, 3) == (["yellow", "black"], "white")


# Ошибки выбора палитры
@pytest.mark.parametrize(
    # Аргументы и часть текста ошибки
    "args, message",
    # Случаи
    [
        # Неизвестный режим
        (("rainbow", None, None), "Неизвестный режим"),
        # Неизвестная доска
        (("bw", None, "pink"), "доски"),
        # Неизвестный цвет нити
        (("color", ["black", "teal"], None), "Неизвестные цвета"),
        # Один цвет — мало
        (("color", ["black"], None), "от 2 до 4"),
        # Пять — много
        (("color", ["black", "red", "blue", "green", "yellow"], None), "от 2 до 4"),
        # Автоподбор без фото
        (("color", None, None), "нужно фото"),
    ],
)
# Каждая ошибка — ValueError с понятным текстом
def test_resolve_palette_errors(args, message):
    # Ждём ошибку
    with pytest.raises(ValueError, match=message):
        # Вызываем
        palette.resolve_palette(*args, None, 3)


# Автоподбор: нужное число цветов, чёрная всегда есть, красное фото получает красную нить
def test_choose_palette_finds_dominant_color():
    # Картинка: левая половина красная, правая — тёмная
    target = np.ones((40, 40, 3), dtype=np.float32)
    # Красная половина
    target[:, :20] = palette.THREAD_BY_KEY["red"].rgb
    # Тёмная половина
    target[:, 20:] = 0.1
    # Подбираем три цвета
    keys = palette.choose_palette(target, palette.BOARD_BY_KEY["white"].rgb, 3)
    # Три разных
    assert len(keys) == len(set(keys)) == 3
    # Есть чёрная и красная
    assert {"black", "red"} <= set(keys)
    # Чёрная последней — самая тёмная плетётся поверх
    assert keys[-1] == "black"


# Порядок плетения — по убыванию яркости нити
def test_weave_order():
    # Чёрная, белая, красная
    assert palette.weave_order(["black", "white", "red"]) == ["white", "red", "black"]


# Каталог для фронтенда
def test_catalog(client):
    # Палитра в настройках
    cat = client.get("/api/config").json()["palette"]
    # Три режима
    assert cat["modes"] == ["mono", "bw", "color"]
    # В каталоге есть чёрная и белая нить с HEX
    assert {"black", "white"} <= {t["key"] for t in cat["threads"]}
    # Все цвета — формата #rrggbb
    assert all(len(t["hex"]) == 7 and t["hex"].startswith("#") for t in cat["threads"] + cat["boards"])
    # Ограничения числа цветов
    assert cat["colors"] == {"min": 2, "max": 4, "default": 3}


# --- цветной конвейер и отрисовка -------------------------------------------
# Цветной кадр: размер, диапазон и фон цвета доски при удалении фона
def test_prepare_color_and_background():
    # Фото с лицом
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    # Маска: «человек» — полоса посередине
    mask = Image.new("L", img.size, 0)
    # Полоса
    mask.paste(255, (150, 0, 370, 512))
    # Серая доска
    board = palette.BOARD_BY_KEY["gray"].rgb
    # Цветной кадр с удалением фона
    rgb = photo.prepare_color(img, photo.Prep(remove_background=True), mask, board=board)
    # Размер и диапазон
    assert rgb.shape == (400, 400, 3) and 0 <= rgb.min() and rgb.max() <= 1
    # Левый край — фон, он стал цветом доски
    assert rgb[200, 5] == pytest.approx(board, abs=0.01)
    # Без удаления фона яркость совпадает с серым конвейером (± округление)
    gray = np.asarray(photo.prepare_gray(img, photo.Prep()), np.float32) / 255
    # Цветной кадр без маски
    color = photo.prepare_color(img, photo.Prep())
    # Средняя разница яркостей меньше 1 %
    assert abs(layers.luminance(color) - gray).mean() < 0.01


# Отрисовка слоёв: без линий — доска, с линиями — цвет нити проступает
def test_render_color_array():
    # Короткая «звезда» через центр
    seq = [0, 120, 0, 120, 0, 120, 0]
    # Доска серая
    board = palette.BOARD_BY_KEY["gray"].rgb
    # Красная нить
    red = palette.THREAD_BY_KEY["red"].rgb
    # Без шагов — сплошь цвет доски
    empty = render.render_color_array([(seq, 0, red)], 100, 50, board)
    # Все пиксели = доска
    assert np.abs(empty.astype(float) / 255 - board).max() < 0.01
    # 6 линий через центр
    art = render.render_color_array([(seq, 6, red)], 100, 50, board)
    # В центре красный канал выше остальных
    r, g, b = art[50, 50].astype(int)
    # Проверка
    assert r > g + 30 and r > b + 30


# Расчёт слоёв: порядок, числа линий в пределах, все нити начинаются с A1
def test_build_layers_bw():
    # Фото с лицом
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    # Серая доска
    board = palette.BOARD_BY_KEY["gray"].rgb
    # Цветной кадр
    target = photo.prepare_color(img, photo.Prep(zoom=2, center_x=0.45, center_y=0.3), board=board)
    # Слои чёрной и белой нити
    built = layers.build_layers(target, "gray", ["white", "black"], None, 50)
    # Два слоя, обе нити
    assert sorted(l["color"] for l in built) == ["black", "white"]
    # Каждый слой —
    for layer in built:
        # — последовательность на 5000 линий с A1
        assert len(layer["sequence"]) == 5001 and layer["sequence"][0] == 0
        # — число линий в пределах
        assert palette.LAYER_MIN_LINES <= layer["line_count"] <= 5000
    # Кривая для слоя: 25 точек с шагом 200, лучшая — не хуже начальной
    curve = layers.layer_curve(target, "gray", built, 1, 50)
    # Точки
    assert [n for n, _ in curve][:3] == [100, 300, 500]
    # Кривая доходит почти до 5000
    assert curve[-1][0] >= 4900


# --- API ------------------------------------------------------------------
# Один портрет «чёрная + белая» на весь модуль — расчёт занимает ~10 с
@pytest.fixture(scope="module")
# Фикстура получает тестовый клиент
def bw(client):
    # Фото с лицом
    data = (FIXTURES / "face.jpg").read_bytes()
    # Загружаем в редактор
    img = client.post("/api/images", files={"file": ("face.jpg", data, "image/jpeg")}).json()
    # Создаём портрет из двух нитей на тёмно-синей доске
    r = client.post("/api/projects/from-image", json={"image_id": img["id"], "name": "Ч/б", "mode": "bw", "board": "navy", "prep": {"zoom": 2}})
    # Создан
    assert r.status_code == 201, r.text
    # Отдаём проект
    yield r.json()
    # После модуля — удаляем
    client.delete(f"/api/projects/{r.json()['id']}")


# Портрет из двух нитей: режим, доска, слои, первый слой повторяет основные поля
def test_create_bw(bw):
    # Режим и доска
    assert bw["mode"] == "bw" and bw["board"]["key"] == "navy" and bw["board"]["hex"] == "#2b3a55"
    # Два слоя с названиями и HEX
    assert {l["color"] for l in bw["layers"]} == {"white", "black"}
    # Номера по порядку
    assert [l["index"] for l in bw["layers"]] == [0, 1]
    # Первый слой — это основные поля проекта
    assert bw["sequence"] == bw["layers"][0]["sequence"] and bw["line_count"] == bw["layers"][0]["line_count"]
    # Расчёт лески у каждого цвета свой
    assert all(l["stats"]["steps"] == l["line_count"] for l in bw["layers"])
    # Плетение с первого слоя и первого шага
    assert bw["current_layer"] == 0 and all(l["current_step"] == 1 for l in bw["layers"])


# Портрет из одной нити тоже отдаёт слой — один, чёрный
def test_mono_has_single_layer(project):
    # Один слой
    assert project["mode"] == "mono" and len(project["layers"]) == 1
    # Чёрный, с теми же числами, что у проекта
    layer = project["layers"][0]
    # Проверка
    assert layer["color"] == "black" and layer["line_count"] == project["line_count"] and layer["sequence"] == project["sequence"]


# Прогресс и число линий второго слоя, переключение слоя
def test_patch_layer(client, bw):
    # id
    pid = bw["id"]
    # Второй слой: 800 линий, шаг 40
    body = client.patch(f"/api/projects/{pid}", json={"layer": 1, "line_count": 800, "current_step": 40}).json()
    # Сохранилось
    assert (body["layers"][1]["line_count"], body["layers"][1]["current_step"]) == (800, 40)
    # Первый слой не тронут
    assert body["layers"][0]["line_count"] == bw["layers"][0]["line_count"]
    # Дошли до шага 700
    client.patch(f"/api/projects/{pid}", json={"layer": 1, "current_step": 700})
    # Линий стало меньше текущего шага — шаг прижимается к концу
    body = client.patch(f"/api/projects/{pid}", json={"layer": 1, "line_count": 300}).json()
    # Шаг 300
    assert body["layers"][1]["current_step"] == 300
    # Первый слой через основные поля — тоже работает
    body = client.patch(f"/api/projects/{pid}", json={"current_step": 7, "current_layer": 1}).json()
    # Шаг первого слоя и текущий слой
    assert body["current_step"] == 7 and body["layers"][0]["current_step"] == 7 and body["current_layer"] == 1


# Ошибки изменения слоёв
@pytest.mark.parametrize(
    # Тело запроса
    "body",
    # Случаи
    [
        # Слоя 2 нет
        {"layer": 2, "line_count": 500},
        # Слой вне допустимого диапазона
        {"layer": 7},
        # Текущий слой вне списка
        {"current_layer": 3},
        # Шаг больше числа линий слоя
        {"layer": 1, "current_step": 5001},
        # Линий меньше минимума слоя
        {"layer": 1, "line_count": 50},
    ],
)
# Каждое → 422
def test_patch_layer_errors(client, bw, body):
    # Отправляем
    assert client.patch(f"/api/projects/{bw['id']}", json=body).status_code == 422


# У одной нити по-прежнему не меньше 1000 линий
def test_mono_still_needs_1000_lines(client, project):
    # 999 → 422
    assert client.patch(f"/api/projects/{project['id']}", json={"line_count": 999}).status_code == 422


# Шаги, сходство, превью и PDF для слоя
def test_layer_endpoints(client, bw):
    # id
    pid = bw["id"]
    # Шаги второго слоя начинаются с A1 и идут по его последовательности
    steps = client.get(f"/api/projects/{pid}/steps", params={"layer": 1, "limit": 3}).json()
    # Первый шаг
    assert steps["items"][0]["from_label"] == "A1" and steps["items"][0]["to_nail"] == bw["layers"][1]["sequence"][1]
    # Слоя 3 нет
    assert client.get(f"/api/projects/{pid}/steps", params={"layer": 3}).status_code == 422
    # Кривая сходства для слоя
    sim = client.get(f"/api/projects/{pid}/similarity", params={"layer": 1}).json()
    # 25 точек, лучшее — среди них
    assert len(sim["curve"]) == 25 and sim["best_lines"] in [p["lines"] for p in sim["curve"]]
    # Повторный запрос — из кэша, тот же ответ
    assert client.get(f"/api/projects/{pid}/similarity", params={"layer": 1}).json() == sim
    # Превью — цветной PNG
    png = Image.open(io.BytesIO(client.get(f"/api/projects/{pid}/preview.png", params={"size": 200}).content))
    # Размер и режим RGB
    assert png.size == (200, 200) and png.mode == "RGB"
    # Центр превью не белый и не серый: доска тёмно-синяя
    r, g, b = png.getpixel((100, 160))
    # Синий канал заметен (доска) или нить светлая — но не чисто белый лист
    assert (r, g, b) != (255, 255, 255)
    # Исходник — цветной PNG
    assert Image.open(io.BytesIO(client.get(f"/api/projects/{pid}/source.png").content)).mode == "RGB"


# PDF цветного портрета: обложка, схема и страницы шагов каждой нити
def test_layers_pdf(client, bw):
    # Свежее состояние проекта
    p = client.get(f"/api/projects/{bw['id']}").json()
    # Скачиваем
    r = client.get(f"/api/projects/{bw['id']}/instructions.pdf")
    # PDF
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    # Читаем
    reader = PdfReader(io.BytesIO(r.content))
    # Ожидаемое число страниц: 2 + страницы каждой нити
    expected = 2 + sum(-(-l["line_count"] // STEPS_PER_PAGE) for l in p["layers"])
    # Совпадает
    assert len(reader.pages) == expected
    # На обложке — обе нити и доска
    cover = reader.pages[0].extract_text()
    # Проверка текста
    assert "Нить 1" in cover and "Нить 2" in cover and "тёмно-синяя" in cover
    # Третья страница — шаги первой нити
    assert "Нить 1 из 2" in reader.pages[2].extract_text()


# Неверные цвета и доска при создании → 422
@pytest.mark.parametrize(
    # Тело запроса (без image_id)
    "extra, status",
    # Случаи
    [
        # Неизвестный цвет
        ({"mode": "color", "colors": ["black", "teal"]}, 422),
        # Один цвет
        ({"mode": "color", "colors": ["black"]}, 422),
        # Неизвестная доска
        ({"mode": "bw", "board": "pink"}, 422),
        # Неизвестный режим
        ({"mode": "rainbow"}, 422),
        # Слишком много цветов для подбора
        ({"mode": "color", "color_count": 5}, 422),
    ],
)
# Проверка
def test_create_color_validation(client, extra, status):
    # Загружаем фото
    img = client.post("/api/images", files={"file": ("face.jpg", (FIXTURES / "face.jpg").read_bytes(), "image/jpeg")}).json()
    # Пытаемся создать
    assert client.post("/api/projects/from-image", json={"image_id": img["id"], **extra}).status_code == status


# Правка фото может сменить режим: цветной портрет → одна нить и обратно цвета вручную
def test_switch_mode_on_photo_update(client):
    # Загружаем фото
    img = client.post("/api/images", files={"file": ("face.jpg", (FIXTURES / "face.jpg").read_bytes(), "image/jpeg")}).json()
    # Цветной портрет из красной и чёрной нити
    p = client.post("/api/projects/from-image", json={"image_id": img["id"], "mode": "color", "colors": ["red", "black"]}).json()
    # Блок с уборкой
    try:
        # Два слоя на белой доске
        assert p["mode"] == "color" and {l["color"] for l in p["layers"]} == {"red", "black"} and p["board"]["key"] == "white"
        # Новый кадр без смены режима — цвета сохраняются
        same = client.put(f"/api/projects/{p['id']}/photo", json={"zoom": 1.5}).json()
        # Те же цвета
        assert {l["color"] for l in same["layers"]} == {"red", "black"}
        # Переход на одну нить
        mono = client.put(f"/api/projects/{p['id']}/photo", json={"mode": "mono"}).json()
        # Один чёрный слой на белой доске, PDF как раньше
        assert mono["mode"] == "mono" and len(mono["layers"]) == 1 and mono["board"]["key"] == "white"
        # Превью одной нити — оттенки серого
        assert client.get(f"/api/projects/{p['id']}/preview.png").status_code == 200
    # В любом случае —
    finally:
        # — удаляем
        client.delete(f"/api/projects/{p['id']}")
