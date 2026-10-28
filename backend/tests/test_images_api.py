"""API редактора фото: TC-API-19…24."""

# io.BytesIO — картинки в памяти
import io

# numpy — читаем пиксели ответов
import numpy as np
# pytest — фикстуры, пропуски и monkeypatch
import pytest
# Pillow — открываем и рисуем PNG
from PIL import Image

# Модуль фото: подменяем в нём тяжёлые функции и проверяем наличие OpenCV/onnxruntime
from app import photo


# Фикстура: байты фото астронавта, новые для каждого теста
@pytest.fixture()
# Возвращает содержимое face.jpg
def face_bytes():
    # Путь к общим фикстурам
    from .conftest import FIXTURES

    # Читаем файл целиком
    return (FIXTURES / "face.jpg").read_bytes()


# Фикстура: фото, уже загруженное через API
@pytest.fixture()
# Использует тестовый клиент и байты из фикстуры выше
def image(client, face_bytes):
    # Загружаем фото как форму с файлом
    r = client.post("/api/images", files={"file": ("face.jpg", face_bytes, "image/jpeg")})
    # Загрузка прошла; при ошибке в отчёте будет текст ответа
    assert r.status_code == 201, r.text
    # Отдаём описание картинки
    return r.json()


# Помощник: создать проект из загруженного фото с любыми полями
def _create(client, image_id, **kw):
    # POST с id картинки и дополнительными параметрами
    r = client.post("/api/projects/from-image", json={"image_id": image_id, **kw})
    # Проект создан
    assert r.status_code == 201, r.text
    # Возвращаем проект
    return r.json()


# Кейс из TEST_CASES.md
# TC-API-19
# Загрузка фото: id, размер, маски ещё нет, лицо найдено
def test_upload_image_finds_face(client, image):
    # id — 12 символов
    assert len(image["id"]) == 12
    # Размер фикстуры сохранился
    assert (image["width"], image["height"]) == (512, 512)
    # Маску фона ещё не считали
    assert image["has_mask"] is False
    # Проверки лица — только если установлен OpenCV
    if photo.face_detection_available():
        # Нашлось хотя бы одно лицо
        assert len(image["faces"]) >= 1
        # Готовые параметры кадра «Выделить лицо»
        fp = image["face_prep"]
        # Флажок включён и кадр приближен к лицу
        assert fp["face_focus"] is True and fp["zoom"] > 1.5
    # Описание картинки можно получить повторно по id
    assert client.get(f"/api/images/{image['id']}").json()["id"] == image["id"]


# Неверные загрузки и запросы картинок
def test_upload_image_validation(client, not_an_image):
    # Текстовый файл вместо фото → 400
    assert client.post("/api/images", files={"file": ("x.txt", not_an_image, "text/plain")}).status_code == 400
    # Несуществующий id → 404
    assert client.get("/api/images/000000000000").status_code == 404
    # Неправильный формат id → 404, а не ошибка сервера
    assert client.get("/api/images/bad/original.jpg").status_code == 404


# Кейс из TEST_CASES.md
# TC-API-20
# Исходник отдаётся как JPEG, а подготовленный кадр меняется от параметров
def test_original_and_prepared(client, image):
    # Запрашиваем исходное фото
    r = client.get(f"/api/images/{image['id']}/original.jpg")
    # Ответ 200 и тип image/jpeg
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    # Кадр без правок
    base = client.get(f"/api/images/{image['id']}/prepared.png")
    # Кадр с яркостью +0,3
    bright = client.get(f"/api/images/{image['id']}/prepared.png", params={"brightness": 0.3})
    # Кадр с зумом 3 и сдвигом к лицу
    zoomed = client.get(f"/api/images/{image['id']}/prepared.png", params={"zoom": 3, "center_x": 0.43})
    # Для каждого из трёх ответов —
    for res in (base, bright, zoomed):
        # — статус 200
        assert res.status_code == 200
        # — и размер 400×400
        assert Image.open(io.BytesIO(res.content)).size == (400, 400)
    # Средняя яркость PNG из ответа
    mean = lambda res: np.asarray(Image.open(io.BytesIO(res.content))).mean()  # noqa: E731
    # Яркость действительно осветлила кадр
    assert mean(bright) > mean(base) + 20
    # Зум изменил содержимое кадра
    assert mean(zoomed) != pytest.approx(mean(base), abs=1)
    # Зум 5 больше допустимого → 422
    assert client.get(f"/api/images/{image['id']}/prepared.png", params={"zoom": 5}).status_code == 422


# Кейс из TEST_CASES.md
# TC-API-21
# Создание проекта из фото с параметрами кадра и тона
def test_create_from_image_with_prep(client, image):
    # Параметры подготовки
    prep = {"center_x": 0.45, "center_y": 0.3, "zoom": 2, "brightness": 0.1, "contrast": 0.2}
    # Создаём проект с названием, диаметром и параметрами
    p = _create(client, image["id"], name="Кадр", diameter_cm=60, prep=prep)
    # Название и диаметр сохранились
    assert p["name"] == "Кадр" and p["diameter_cm"] == 60
    # Число нитей выбрано по лучшему сходству
    assert p["line_count"] == client.get(f"/api/projects/{p['id']}/similarity").json()["best_lines"]
    # Проект помнит, из какой картинки сделан
    assert p["image_id"] == image["id"]
    # Параметры сохранились, а неуказанные флажки выключены
    assert p["prep"] == {**prep, "remove_background": False, "face_focus": False}
    # Второй проект из того же фото без правок
    plain = _create(client, image["id"], name="Без правок")
    # Схемы разные — значит параметры влияют на результат
    assert plain["sequence"] != p["sequence"]
    # Удаляем оба проекта, чтобы не мусорить в базе
    for pid in (p["id"], plain["id"]):
        # Удаление по id
        client.delete(f"/api/projects/{pid}")


# Неверные запросы создания проекта из фото
def test_create_from_image_validation(client, image):
    # Набор неправильных тел запроса
    bad = [
        # Несуществующая картинка
        {"image_id": "000000000000"},
        # Зум меньше 1
        {"image_id": image["id"], "prep": {"zoom": 0.5}},
        # Яркость больше допустимой
        {"image_id": image["id"], "prep": {"brightness": 0.9}},
        # Неизвестное поле
        {"image_id": image["id"], "prep": {"rotate": 90}},
        # Диаметр меньше 20 см
        {"image_id": image["id"], "diameter_cm": 5},
    ]
    # Ожидаемый статус для каждого тела
    expected = [404, 422, 422, 422, 422]
    # Перебираем пары «тело — статус»
    for body, status in zip(bad, expected):
        # Статус совпадает; при ошибке в отчёте видно тело запроса
        assert client.post("/api/projects/from-image", json=body).status_code == status, body


# Кейс из TEST_CASES.md
# TC-API-22
# Без OpenCV лицо не найти — тест пропускается
@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
# «Выделить лицо» сохраняется в проекте
def test_face_focus(client, image):
    # Создаём проект с готовыми параметрами лица
    p = _create(client, image["id"], prep=image["face_prep"])
    # Флажок сохранился
    assert p["prep"]["face_focus"] is True
    # Убираем проект
    client.delete(f"/api/projects/{p['id']}")


# «Выделить лицо» на фото без лица — понятная ошибка
def test_face_focus_without_face_is_422(client):
    # Буфер для PNG
    buf = io.BytesIO()
    # Белая картинка 300×300 — лица на ней нет
    Image.new("RGB", (300, 300), "white").save(buf, "PNG")
    # Загружаем её
    img = client.post("/api/images", files={"file": ("blank.png", buf.getvalue(), "image/png")}).json()
    # Лиц нет, готовых параметров лица тоже
    assert img["faces"] == [] and img["face_prep"] is None
    # Пытаемся создать проект с флажком «Выделить лицо»
    r = client.post("/api/projects/from-image", json={"image_id": img["id"], "prep": {"face_focus": True}})
    # Ответ 422
    assert r.status_code == 422
    # Текст ошибки говорит про лицо
    assert "лицо" in r.json()["detail"]


# Кейс из TEST_CASES.md
# TC-API-23
# Новый кадр пересчитывает схему и сбрасывает прогресс на шаг 1
def test_update_photo_resets_progress(client, image):
    # Создаём проект
    p = _create(client, image["id"])
    # Отмечаем, что пройдено 500 шагов
    client.patch(f"/api/projects/{p['id']}", json={"current_step": 500})
    # Меняем кадр фото
    r = client.put(f"/api/projects/{p['id']}/photo", json={"zoom": 2.5, "center_x": 0.43, "center_y": 0.3})
    # Запрос прошёл
    assert r.status_code == 200
    # Обновлённый проект
    body = r.json()
    # Прогресс сброшен на первый шаг
    assert body["current_step"] == 1
    # Новый зум сохранился
    assert body["prep"]["zoom"] == 2.5
    # Схема пересчитана
    assert body["sequence"] != p["sequence"]
    # Зум 9 → 422
    assert client.put(f"/api/projects/{p['id']}/photo", json={"zoom": 9}).status_code == 422
    # Несуществующий проект → 404
    assert client.put("/api/projects/000000000000/photo", json={}).status_code == 404
    # Убираем проект
    client.delete(f"/api/projects/{p['id']}")


# Старый способ загрузки тоже сохраняет фото и параметры кадра
def test_legacy_upload_also_keeps_photo(client, project):
    # У проекта есть ссылка на картинку
    assert project["image_id"]
    # Зум по умолчанию — 1
    assert project["prep"]["zoom"] == 1.0


# Кейс из TEST_CASES.md; помощник ждёт окончания расчёта маски
# TC-API-24
# Опрашиваем статус маски, пока не готова или не упала
def _wait_mask(client, image_id, timeout=300):
    # time — для таймаута и пауз
    import time

    # Крайний срок ожидания
    deadline = time.time() + timeout
    # Пока не вышло время —
    while time.time() < deadline:
        # — спрашиваем статус
        st = client.get(f"/api/images/{image_id}/mask").json()
        # Готово или ошибка — выходим
        if st["status"] in ("ready", "error"):
            # Возвращаем последний статус
            return st
        # Ждём 0,3 с перед следующим запросом
        time.sleep(0.3)
    # Время вышло — тест падает с понятным текстом
    raise AssertionError("маска не посчиталась")


# Без onnxruntime удаление фона не работает — тест пропускается
@pytest.mark.skipif(not photo.background_removal_available(), reason="onnxruntime не установлен")
# Настоящее удаление фона моделью: человек остаётся, фон уходит
def test_background_removal(client, image):
    # До расчёта маски нет — 409
    assert client.get(f"/api/images/{image['id']}/mask.png").status_code == 409  # ещё не считали
    # Запускаем расчёт
    r = client.post(f"/api/images/{image['id']}/mask")
    # Сразу готово (200) или считается (202)
    assert r.status_code in (200, 202)
    # Дожидаемся готовности
    assert _wait_mask(client, image["id"])["status"] == "ready"
    # Скачиваем маску
    r = client.get(f"/api/images/{image['id']}/mask.png")
    # Она есть
    assert r.status_code == 200
    # Маска как массив
    mask = np.asarray(Image.open(io.BytesIO(r.content)))
    # Размер как у фото
    assert mask.shape == (512, 512)
    # Центр — человек
    assert mask[250, 256] > 200  # человек в центре
    # Левый верхний угол — фон
    assert mask[30, 20] < 50  # флаг слева сверху — фон
    # В описании картинки маска отмечена
    assert client.get(f"/api/images/{image['id']}").json()["has_mask"] is True
    # Проект с удалением фона создаётся
    p = _create(client, image["id"], prep={"remove_background": True})
    # Флажок сохранился
    assert p["prep"]["remove_background"] is True
    # Убираем проект
    client.delete(f"/api/projects/{p['id']}")


# Запрос маски отвечает сразу, даже если модель долгая
def test_mask_request_never_blocks(client, image, monkeypatch):
    """Регрессия: долгая модель не должна держать HTTP-запрос (прокси Next.js рвёт его через 30 с)."""
    # Время замеряем через time
    import time

    # Делаем вид, что onnxruntime установлен
    monkeypatch.setattr(photo, "background_removal_available", lambda: True)
    # Подменяем модель на «долгую» — 1 секунда
    monkeypatch.setattr(photo, "background_mask", lambda img, faces=None: (time.sleep(1.0), Image.new("L", img.size, 255))[1])
    # Засекаем время
    t = time.time()
    # Запускаем расчёт
    r = client.post(f"/api/images/{image['id']}/mask")
    # Ответ пришёл быстрее 0,5 с — расчёт идёт в фоне
    assert time.time() - t < 0.5
    # Статус 202 и «считается»
    assert r.status_code == 202 and r.json()["status"] == "processing"
    # Повторный запрос тоже видит «считается»
    assert client.get(f"/api/images/{image['id']}/mask").json()["status"] == "processing"
    # Через секунду маска готова
    assert _wait_mask(client, image["id"], timeout=10)["status"] == "ready"


# Ошибка модели доходит до пользователя текстом
def test_mask_error_is_reported(client, image, monkeypatch):
    # Делаем вид, что onnxruntime установлен
    monkeypatch.setattr(photo, "background_removal_available", lambda: True)

    # Подменная модель, которая всегда падает
    def boom(img, faces=None):
        # Как будто модель не скачалась
        raise RuntimeError("нет сети")

    # Ставим её вместо настоящей
    monkeypatch.setattr(photo, "background_mask", boom)
    # Запускаем расчёт
    client.post(f"/api/images/{image['id']}/mask")
    # Дожидаемся результата
    st = _wait_mask(client, image["id"], timeout=10)
    # Статус «ошибка», а текст объясняет причину
    assert st["status"] == "error" and "нет сети" in st["message"]


# Без onnxruntime — 503 с подсказкой, что установить
def test_background_removal_unavailable(client, image, monkeypatch):
    # Делаем вид, что onnxruntime нет
    monkeypatch.setattr(photo, "background_removal_available", lambda: False)
    # И запуск, и проверка статуса —
    for r in (client.post(f"/api/images/{image['id']}/mask"), client.get(f"/api/images/{image['id']}/mask")):
        # — отвечают 503
        assert r.status_code == 503
        # — и называют файл с зависимостями
        assert "requirements-bg.txt" in r.json()["detail"]
    # Настройки для фронтенда
    cfg = client.get("/api/config").json()
    # Сообщают, что удаление фона недоступно
    assert cfg["features"]["background_removal"] is False


# /api/config не должен загружать тяжёлые библиотеки
def test_config_does_not_import_heavy_onnxruntime():
    """Регрессия: /api/config раньше импортировал тяжёлую библиотеку, и на Windows первый запрос шёл >30 с."""
    # subprocess — запускаем чистый Python, где ещё ничего не импортировано
    import subprocess
    # sys — путь к текущему интерпретатору
    import sys

    # Код для отдельного процесса:
    code = (
        # создаём клиент приложения,
        "import sys; from fastapi.testclient import TestClient; from app.main import app; "
        # запрашиваем настройки,
        "c = TestClient(app); assert c.get('/api/config').status_code == 200; "
        # и печатаем, загрузились ли onnxruntime или rembg
        "print('onnxruntime' in sys.modules or 'rembg' in sys.modules)"
    )
    # Запускаем этот код с таймаутом 60 с
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    # Процесс завершился без ошибок
    assert out.returncode == 0, out.stderr
    # Тяжёлые библиотеки не загружены
    assert out.stdout.strip() == "False"


# Удаление проекта убирает и ненужное больше фото
def test_delete_project_removes_unused_image(client, image):
    # Создаём проект из фото
    p = _create(client, image["id"])
    # Удаляем проект
    client.delete(f"/api/projects/{p['id']}")
    # Фото тоже удалено
    assert client.get(f"/api/images/{image['id']}").status_code == 404


# Кейс из TEST_CASES.md
# TC-API-27
# «Автонастройка» подбирает яркость и контраст
def test_auto_tone(client, image):
    # Запускаем подбор для круга 50 см
    r = client.post(f"/api/images/{image['id']}/auto-tone", json={"diameter_cm": 50})
    # Ответ 200
    assert r.status_code == 200, r.text
    # Результат подбора
    t = r.json()
    # Яркость и контраст в допустимых пределах
    assert -0.5 <= t["brightness"] <= 0.5 and -0.5 <= t["contrast"] <= 1.0
    # Сходство после подбора не хуже исходного
    assert t["score_after"] >= t["score_before"]  # хуже, чем без коррекций, не бывает
    # Перебрано 6 вариантов
    assert t["candidates"] == 6
    # Лучшее число нитей — в рабочем диапазоне
    assert 1000 <= t["best_lines"] <= 5000
    # Диаметр 5 см
    bad = client.post(f"/api/images/{image['id']}/auto-tone", json={"diameter_cm": 5})
    # → 422
    assert bad.status_code == 422
    # Несуществующая картинка → 404
    assert client.post("/api/images/000000000000/auto-tone", json={}).status_code == 404


# Кейс из TEST_CASES.md
# TC-API-28
# Маска, исправленная кистью
def test_mask_brush_edit_and_reset(client, image, monkeypatch):
    """Маска, поправленная кистью, сохраняется и идёт в расчёт; правки можно отменить."""
    # Делаем вид, что onnxruntime установлен
    monkeypatch.setattr(photo, "background_removal_available", lambda: True)
    # Своя «авто-маска»: всё фон —
    auto = Image.new("L", (512, 512), 0)
    # — кроме прямоугольника по центру
    auto.paste(255, (156, 100, 356, 512))  # «человек» — прямоугольник по центру
    # Подменяем модель: она возвращает эту маску
    monkeypatch.setattr(photo, "background_mask", lambda img, faces=None: auto)
    # id картинки
    iid = image["id"]
    # Пустое тело → 400
    assert client.put(f"/api/images/{iid}/mask.png", content=b"").status_code == 400
    # Не PNG → 400
    assert client.put(f"/api/images/{iid}/mask.png", content=b"not png").status_code == 400
    # Считаем авто-маску
    client.post(f"/api/images/{iid}/mask")
    # Дожидаемся
    st = _wait_mask(client, iid, timeout=10)
    # Готово, правок ещё нет
    assert st["status"] == "ready" and st["edited"] is False

    # Копия авто-маски
    edited = auto.copy()
    # Стираем верх «человека»
    edited.paste(0, (156, 100, 356, 250))  # стёрли верх кистью
    # Буфер для PNG
    buf = io.BytesIO()
    # Отправляем в другом размере и RGBA — так может прислать canvas браузера
    edited.convert("RGBA").resize((256, 256)).save(buf, "PNG")  # canvas может прислать другой размер и RGBA
    # Сохраняем исправленную маску
    r = client.put(f"/api/images/{iid}/mask.png", content=buf.getvalue(), headers={"Content-Type": "image/png"})
    # Ответ 200 и отметка «есть правки»
    assert r.status_code == 200 and r.json()["edited"] is True
    # Скачиваем сохранённую маску
    got = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/mask.png").content)))
    # Размер приведён к фото; стёртое — фон; низ остался человеком
    assert got.shape == (512, 512) and got[180, 256] < 50 and got[400, 256] > 200
    # Маску не кешируют — после правки браузер увидит новую
    assert client.get(f"/api/images/{iid}/mask.png").headers["cache-control"] == "no-cache"

    # правка влияет на то, что считает алгоритм: стёртая область стала белой
    # Параметры кадра с удалением фона
    prep = {"remove_background": True}
    # Подготовленный кадр как массив
    px = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/prepared.png", params=prep).content)))
    # Место, стёртое кистью, стало белым
    assert px[int(180 / 512 * 400), 200] == 255

    # Отменяем правки
    r = client.delete(f"/api/images/{iid}/mask/edits")
    # Ответ 200, правок больше нет
    assert r.status_code == 200 and r.json()["edited"] is False
    # Снова скачиваем маску
    got = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/mask.png").content)))
    # Вернулась авто-маска — верх снова человек
    assert got[180, 256] > 200
    # Несуществующая картинка → 404
    assert client.put("/api/images/000000000000/mask.png", content=buf.getvalue()).status_code == 404


# Старые маски без чистки считаются заново
def test_legacy_mask_is_recomputed(client, image, monkeypatch):
    """Маски старой версии (без чистки) не используются — считаются заново."""
    # Модуль хранилища
    from app import storage

    # Сохраняем маску
    storage.save_mask(image["id"], photo.png_bytes(Image.new("L", (512, 512), 255)))
    # Открываем базу напрямую
    with storage._connect() as conn:
        # Стираем отметку, какой версией посчитана маска — как в старой базе
        conn.execute("UPDATE images SET mask_source = NULL WHERE id = ?", (image["id"],))
    # Маска считается отсутствующей
    assert client.get(f"/api/images/{image['id']}").json()["has_mask"] is False
    # И не отдаётся — 409
    assert client.get(f"/api/images/{image['id']}/mask.png").status_code == 409
