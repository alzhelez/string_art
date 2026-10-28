"""API-тесты. Те же сценарии (TC-API-xx) реализованы на других языках в /autotests."""

# io.BytesIO — открываем PDF из ответа в памяти
import io

# pytest — параметризация и approx
import pytest
# pypdf — считаем страницы PDF-инструкции
from pypdf import PdfReader


# Помощник: старый способ создания проекта — форма с файлом и полями
def _upload(client, content, filename="portrait.jpg", mime="image/jpeg", **data):
    # POST /api/projects с файлом и любыми полями формы
    return client.post("/api/projects", files={"file": (filename, content, mime)}, data=data)


# Номер кейса из TEST_CASES.md
# TC-API-01
# Сервер жив
def test_health(client):
    # Запрашиваем проверку здоровья
    r = client.get("/api/health")
    # Ответ 200
    assert r.status_code == 200
    # Тело ровно {"status": "ok"}
    assert r.json() == {"status": "ok"}


# Номер кейса
# TC-API-02
# Настройки, которые фронтенд берёт с сервера
def test_config(client):
    # Получаем настройки
    cfg = client.get("/api/config").json()
    # Четыре сектора A–D
    assert cfg["sectors"] == ["A", "B", "C", "D"]
    # По 60 гвоздей, всего 240
    assert cfg["nails_per_sector"] == 60 and cfg["total_nails"] == 240
    # Готовые диаметры
    assert cfg["diameter"]["presets_cm"] == [30, 40, 50, 60, 70]
    # Скорость показа шагов: по умолчанию, шаг, минимум, максимум
    assert cfg["speed"] == {"default_sec": 2.0, "step_sec": 0.1, "min_sec": 0.5, "max_sec": 10.0}
    # Запас лески — 15 %
    assert cfg["thread"]["margin"] == 0.15
    # Число нитей от 1000 до 5000
    assert cfg["lines"]["min"] == 1000 and cfg["lines"]["max"] == 5000


# Номер кейса
# TC-API-03
# Создание проекта: все поля заполнены правильно
def test_create_project(client, project):
    # id из 12 символов
    assert len(project["id"]) == 12
    # Название из формы
    assert project["name"] == "Тестовый портрет"
    # Диаметр из формы
    assert project["diameter_cm"] == 50
    # рекомендация — максимум сходства с фото для этого диаметра
    # Кривая сходства для проекта
    sim = client.get(f"/api/projects/{project['id']}/similarity").json()
    # Число нитей — то, где сходство максимально
    assert project["line_count"] == sim["best_lines"]
    # И в допустимом диапазоне
    assert 1000 <= project["line_count"] <= 5000
    # Прогресс начинается с первого шага
    assert project["current_step"] == 1
    # Скорость по умолчанию
    assert project["speed_sec"] == 2.0
    # Схема рассчитана сразу на максимум: 5000 нитей = 5001 гвоздь
    assert len(project["sequence"]) == 5001
    # Первый гвоздь — A1
    assert project["sequence"][0] == 0  # старт A1
    # Расчёт лески
    stats = project["stats"]
    # Шагов столько, сколько выбрано нитей
    assert stats["steps"] == project["line_count"]
    # Общая длина = чистая длина + 15 % запаса
    assert stats["total_length_m"] == pytest.approx(stats["raw_length_m"] * 1.15, rel=1e-3)
    # Купленных катушек хватает на всю длину
    assert stats["spool_m"] * stats["spool_count"] >= stats["total_length_m"]


# Номер кейса
# TC-API-04
# Без названия берётся имя файла без расширения
def test_create_uses_filename_when_no_name(client, portrait_png):
    # Загружаем PNG «Бабушка.png» на круг 70 см
    r = _upload(client, portrait_png, filename="Бабушка.png", mime="image/png", diameter_cm="70")
    # Создан
    assert r.status_code == 201
    # Тело ответа
    body = r.json()
    # Название — имя файла
    assert body["name"] == "Бабушка"
    # Диаметр 70
    assert body["diameter_cm"] == 70
    # Кривая сходства для 70 см
    sim70 = client.get(f"/api/projects/{body['id']}/similarity").json()
    # Число нитей выбрано для своего диаметра
    assert sim70["diameter_cm"] == 70 and body["line_count"] == sim70["best_lines"]
    # Убираем проект
    client.delete(f"/api/projects/{body['id']}")


# Номер кейса
# TC-API-05
# Таблица неверных загрузок
@pytest.mark.parametrize(
    # Имена параметров теста
    "kwargs, status",
    # Список вариантов
    [
        # Пустой файл → 400
        ({"content": b"", "filename": "empty.jpg"}, 400),
        # Текст вместо картинки → 400
        ({"content": "not-image", "filename": "x.txt", "mime": "text/plain"}, 400),
        # Диаметр чуть меньше 20 → 422
        ({"content": "portrait", "diameter_cm": "19.9"}, 422),
        # Диаметр чуть больше 150 → 422
        ({"content": "portrait", "diameter_cm": "150.1"}, 422),
        # Диаметр не число → 422
        ({"content": "portrait", "diameter_cm": "abc"}, 422),
    ],
    # Понятные имена вариантов в отчёте
    ids=["empty", "not-image", "diameter-too-small", "diameter-too-big", "diameter-nan"],
)
# Каждый неверный вариант отклоняется с нужным статусом
def test_create_validation(client, portrait_jpg, not_an_image, kwargs, status):
    # Подставляем настоящие байты вместо слова-заглушки
    content = {"portrait": portrait_jpg, "not-image": not_an_image}.get(kwargs.pop("content"), b"")
    # Сравниваем статус
    assert _upload(client, content, **kwargs).status_code == status


# Номер кейса
# TC-API-06
# Форма без файла
def test_create_without_file(client):
    # → 422
    assert client.post("/api/projects", data={"name": "x"}).status_code == 422


# Номер кейса
# TC-API-07
# В списке проектов есть наш, но без тяжёлой схемы
def test_list_contains_project_without_sequence(client, project):
    # Получаем список
    items = client.get("/api/projects").json()
    # Находим наш проект
    found = [p for p in items if p["id"] == project["id"]]
    # Он один
    assert len(found) == 1
    # Схему в списке не отдаём — экономим трафик
    assert "sequence" not in found[0]
    # А расчёт лески есть
    assert found[0]["stats"]["steps"] == project["line_count"]


# Номер кейса; три варианта неверных id
# TC-API-08
# Несуществующий, слишком короткий, заглавными буквами
@pytest.mark.parametrize("pid", ["000000000000", "nope", "ABCDEF123456"])
# Все три → 404
def test_get_unknown_project_404(client, pid):
    # Запрос проекта
    assert client.get(f"/api/projects/{pid}").status_code == 404


# Номер кейса
# TC-API-09
# Прогресс сохраняется
def test_save_progress(client, project):
    # id проекта
    pid = project["id"]
    # Сохраняем шаг 137
    r = client.patch(f"/api/projects/{pid}", json={"current_step": 137})
    # Ответ 200
    assert r.status_code == 200
    # При повторном чтении шаг тот же
    assert client.get(f"/api/projects/{pid}").json()["current_step"] == 137


# Номер кейса; пары «отправили — сохранилось»
# TC-API-10
# Скорость округляется до 0,1
@pytest.mark.parametrize("value, saved", [(2.1, 2.1), (1.9, 1.9), (2.04999, 2.0), (0.5, 0.5), (10, 10)])
# Проверяем каждую пару
def test_speed_is_rounded_to_tenth(client, project, value, saved):
    # Отправляем скорость
    r = client.patch(f"/api/projects/{project['id']}", json={"speed_sec": value})
    # Ответ 200
    assert r.status_code == 200
    # Сохранилось округлённое значение
    assert r.json()["speed_sec"] == saved


# Номер кейса
# TC-API-11
# Таблица неверных изменений проекта
@pytest.mark.parametrize(
    # Имя параметра
    "body",
    # Список вариантов
    [
        # Скорость меньше 0,5
        {"speed_sec": 0.4},
        # Скорость больше 10
        {"speed_sec": 10.1},
        # Шаг 0
        {"current_step": 0},
        # Шаг больше числа нитей
        {"current_step": 2001},
        # Нитей меньше 1000
        {"line_count": 999},
        # Нитей больше 5000
        {"line_count": 5001},
        # Диаметр меньше 20
        {"diameter_cm": 10},
        # Пустое название
        {"name": ""},
        # Название из пробелов
        {"name": "   "},
        # Схему менять нельзя
        {"sequence": [1, 2, 3]},
    ],
)
# Каждое неверное изменение → 422
def test_patch_validation(client, project, body):
    # Сначала 2000 нитей, чтобы шаг 2001 был недопустим
    client.patch(f"/api/projects/{project['id']}", json={"line_count": 2000})
    # Отправляем неверное изменение
    assert client.patch(f"/api/projects/{project['id']}", json=body).status_code == 422


# Номер кейса
# TC-API-12
# Меньше нитей — прогресс не выходит за конец
def test_reducing_lines_clamps_progress(client, project):
    # id
    pid = project["id"]
    # 2000 нитей
    client.patch(f"/api/projects/{pid}", json={"line_count": 2000})
    # Пройдено 1900
    client.patch(f"/api/projects/{pid}", json={"current_step": 1900})
    # Уменьшаем до 1500
    body = client.patch(f"/api/projects/{pid}", json={"line_count": 1500}).json()
    # Нитей 1500
    assert body["line_count"] == 1500
    # Прогресс прижат к последнему шагу
    assert body["current_step"] == 1500
    # Расчёт пересчитан
    assert body["stats"]["steps"] == 1500


# Номер кейса
# TC-API-13
# Диаметр меняет длину лески, но не схему
def test_diameter_changes_thread_but_not_sequence(client, project):
    # id
    pid = project["id"]
    # Диаметр вдвое больше
    body = client.patch(f"/api/projects/{pid}", json={"diameter_cm": 100}).json()
    # Схема та же
    assert body["sequence"] == project["sequence"]
    # Длина лески вдвое больше
    assert body["stats"]["raw_length_m"] == pytest.approx(project["stats"]["raw_length_m"] * 2, rel=1e-3)


# Номер кейса
# TC-API-14
# Шаги отдаются частями и идут без разрывов
def test_steps_pagination_and_continuity(client, project):
    # id
    pid = project["id"]
    # 2000 нитей
    client.patch(f"/api/projects/{pid}", json={"line_count": 2000})
    # Первые 50 шагов
    first = client.get(f"/api/projects/{pid}/steps", params={"offset": 0, "limit": 50}).json()
    # Всего 2000, пришло 50
    assert first["total"] == 2000 and len(first["items"]) == 50
    # Список шагов
    items = first["items"]
    # Первый шаг начинается с A1
    assert items[0]["number"] == 1 and items[0]["from_label"] == "A1"
    # Каждая пара соседних шагов —
    for a, b in zip(items, items[1:]):
        # — нить идёт с того гвоздя, где закончилась
        assert a["to_nail"] == b["from_nail"]
        # — расход лески растёт
        assert b["thread_used_m"] > a["thread_used_m"]
    # Запрос за концом списка
    tail = client.get(f"/api/projects/{pid}/steps", params={"offset": 1990, "limit": 50}).json()
    # Пришли только оставшиеся 10 шагов
    assert [s["number"] for s in tail["items"]] == list(range(1991, 2001))


# Номер кейса
# TC-API-15
# Превью и исходник — PNG
def test_preview_and_source_png(client, project):
    # id
    pid = project["id"]
    # Для обоих адресов —
    for url in (f"/api/projects/{pid}/preview.png?size=300", f"/api/projects/{pid}/source.png"):
        # — запрос
        r = client.get(url)
        # — 200
        assert r.status_code == 200
        # — тип image/png
        assert r.headers["content-type"] == "image/png"
        # — сигнатура PNG
        assert r.content[:4] == b"\x89PNG"
    # Размер превью 50 меньше допустимого → 422
    assert client.get(f"/api/projects/{pid}/preview.png?size=50").status_code == 422


# Номер кейса
# TC-API-16
# PDF-инструкция скачивается файлом
def test_pdf_instructions(client, project):
    # id
    pid = project["id"]
    # 1000 нитей
    client.patch(f"/api/projects/{pid}", json={"line_count": 1000})
    # Скачиваем PDF
    r = client.get(f"/api/projects/{pid}/instructions.pdf")
    # 200
    assert r.status_code == 200
    # Тип PDF
    assert r.headers["content-type"] == "application/pdf"
    # Отдаётся как вложение — браузер сохранит файл
    assert "attachment" in r.headers["content-disposition"]
    # Имя файла в UTF-8
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    # Открываем PDF
    reader = PdfReader(io.BytesIO(r.content))
    # Страниц: обложка + схема + 5 страниц шагов по 200
    assert len(reader.pages) == 2 + 5  # обложка + схема + 1000/200 страниц шагов


# Номер кейса
# TC-API-17
# Удаление проекта
def test_delete_project(client, portrait_jpg):
    # Создаём проект
    pid = _upload(client, portrait_jpg).json()["id"]
    # Удаляем — 204
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    # Больше не находится
    assert client.get(f"/api/projects/{pid}").status_code == 404
    # Повторное удаление — 404
    assert client.delete(f"/api/projects/{pid}").status_code == 404


# Номер кейса; диаметр, расстояние между гвоздями, рекомендуемые нити
# TC-API-18
# Три эталонных диаметра
@pytest.mark.parametrize("d, spacing, lines", [(30, 3.93, 1200), (50, 6.54, 2000), (70, 9.16, 2800)])
# Геометрия круга считается правильно
def test_geometry_endpoint(client, d, spacing, lines):
    # Запрашиваем геометрию
    body = client.get("/api/geometry", params={"diameter_cm": d}).json()
    # Расстояние между гвоздями в мм
    assert body["nail_spacing_mm"] == spacing
    # Рекомендуемое число нитей
    assert body["recommended_lines"] == lines


# Номер кейса
# TC-API-25
# Корень бэкенда ведёт на фронтенд
def test_root_redirects_to_app(client):
    # Запрос без перехода по перенаправлению
    r = client.get("/", follow_redirects=False)
    # Статус 307
    assert r.status_code == 307
    # Адрес фронтенда
    assert r.headers["location"] == "http://localhost:3000"
    # Иконка — пустой ответ без ошибки
    assert client.get("/favicon.ico").status_code == 204
    # Страница /api подсказывает адрес приложения
    assert "localhost:3000" in client.get("/api").text


# Номер кейса
# TC-API-26
# Кривая сходства с фото
def test_similarity_curve(client, project):
    # id
    pid = project["id"]
    # Кривая для текущего диаметра
    sim = client.get(f"/api/projects/{pid}/similarity").json()
    # Диаметр 50
    assert sim["diameter_cm"] == 50
    # Число нитей в точках кривой
    lines = [p["lines"] for p in sim["curve"]]
    # От 1000 до 5000 с шагом 100
    assert lines[0] == 1000 and lines[-1] == 5000 and all(b - a == 100 for a, b in zip(lines, lines[1:]))
    # Точка с максимальным сходством
    best = max(sim["curve"], key=lambda p: p["score"])
    # Лучшая точка совпадает с максимумом
    assert sim["best_lines"] == best["lines"] and sim["best_score"] == best["score"]
    # Сходство в разумных пределах
    assert 0.2 < sim["best_score"] <= 1
    # на маленьком круге та же леска темнее → максимум раньше, на большом — позже
    # Кривая для 30 см
    small = client.get(f"/api/projects/{pid}/similarity", params={"diameter_cm": 30}).json()
    # Кривая для 100 см
    big = client.get(f"/api/projects/{pid}/similarity", params={"diameter_cm": 100}).json()
    # Лучшее число нитей растёт с диаметром
    assert small["best_lines"] <= sim["best_lines"] <= big["best_lines"]
    # Диаметр 10 → 422
    assert client.get(f"/api/projects/{pid}/similarity", params={"diameter_cm": 10}).status_code == 422
    # Несуществующий проект → 404
    assert client.get("/api/projects/000000000000/similarity").status_code == 404


# Номер кейса
# TC-API-29
# Десктопная версия раздаёт собранный сайт
def test_desktop_static_files(client, tmp_path, monkeypatch):
    """Десктопная версия: бэкенд сам раздаёт собранный фронтенд, API при этом работает как обычно."""
    # Папка «собранного сайта»
    web = tmp_path / "web"
    # Подпапка project
    (web / "project").mkdir(parents=True)
    # Папка со статикой Next.js
    (web / "_next" / "static").mkdir(parents=True)
    # Главная
    (web / "index.html").write_text("<h1>home</h1>", encoding="utf-8")
    # Студия
    (web / "project.html").write_text("<h1>studio</h1>", encoding="utf-8")
    # Плетение
    (web / "project" / "weave.html").write_text("<h1>weave</h1>", encoding="utf-8")
    # Скрипт
    (web / "_next" / "static" / "app.js").write_text("1", encoding="utf-8")
    # Своя страница 404
    (web / "404.html").write_text("<h1>404</h1>", encoding="utf-8")
    # Файл ВНЕ папки сайта — его нельзя отдавать
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    # Включаем раздачу сайта
    monkeypatch.setenv("STRINGART_STATIC_DIR", str(web))

    # Корень — главная, без перенаправления
    assert client.get("/", follow_redirects=False).text == "<h1>home</h1>"
    # Студия с параметром
    assert client.get("/project?id=abc").text == "<h1>studio</h1>"
    # Плетение
    assert client.get("/project/weave").text == "<h1>weave</h1>"
    # Скрипт
    js = client.get("/_next/static/app.js")
    # Отдаётся и кешируется надолго
    assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
    # Несуществующая страница
    missing = client.get("/no/such/page")
    # 404 со своей страницей
    assert missing.status_code == 404 and missing.text == "<h1>404</h1>"
    # Выход из папки через .. не работает
    assert client.get("/../secret.txt").status_code == 404
    # И закодированный .. тоже
    assert client.get("/%2e%2e/secret.txt").status_code == 404
    # API работает как обычно
    assert client.get("/api/health").json() == {"status": "ok"}
    # Неизвестный адрес API — JSON 404, а не страница
    assert client.get("/api/nope").status_code == 404 and client.get("/api/nope").json()["detail"]

    # Выключаем раздачу сайта
    monkeypatch.delenv("STRINGART_STATIC_DIR")
    # Корень снова перенаправляет
    assert client.get("/", follow_redirects=False).status_code == 307
    # Страницы больше не отдаются
    assert client.get("/project").status_code == 404


# Номер кейса
# TC-API-30
# Учёт времени плетения и своя катушка
def test_activity_log_and_own_spool(client, project):
    # id
    pid = project["id"]
    # У нового проекта учёта ещё нет
    assert project["activity"] == {"total_sec": 0, "total_steps": 0, "days": []}
    # Своя катушка не задана
    assert project["own_spool_m"] is None
    # Записываем 30 секунд и 12 шагов
    r = client.post(f"/api/projects/{pid}/activity", json={"date": "2026-10-27", "seconds": 30, "steps": 12})
    # 200
    assert r.status_code == 200
    # Ещё запись за тот же день
    client.post(f"/api/projects/{pid}/activity", json={"date": "2026-10-27", "seconds": 29.5, "steps": 10})
    # Запись за следующий день
    act = client.post(f"/api/projects/{pid}/activity", json={"date": "2026-10-28", "seconds": 60, "steps": 30}).json()
    # Итог —
    assert act == {
        # — время суммируется
        "total_sec": 119.5,
        # — шаги суммируются
        "total_steps": 52,
        # — по дням отдельно
        "days": [{"date": "2026-10-27", "sec": 59.5, "steps": 22}, {"date": "2026-10-28", "sec": 60.0, "steps": 30}],
    }
    # Учёт виден в самом проекте
    assert client.get(f"/api/projects/{pid}").json()["activity"]["total_steps"] == 52
    # Неверные записи: дата не ISO, больше 600 с, отрицательные шаги,
    for bad in ({"date": "27.10.2026", "seconds": 1, "steps": 1}, {"date": "2026-10-27", "seconds": 601, "steps": 1},
                # лишнее поле
                {"date": "2026-10-27", "seconds": 1, "steps": -1}, {"date": "2026-10-27", "seconds": 1, "steps": 1, "x": 1}):
        # — все → 422
        assert client.post(f"/api/projects/{pid}/activity", json=bad).status_code == 422
    # Несуществующий проект → 404
    assert client.post("/api/projects/000000000000/activity", json={"date": "2026-10-27", "seconds": 1, "steps": 1}).status_code == 404

    # Своя катушка 300 м сохраняется
    assert client.patch(f"/api/projects/{pid}", json={"own_spool_m": 300}).json()["own_spool_m"] == 300
    # Другое изменение её не сбрасывает
    assert client.patch(f"/api/projects/{pid}", json={"speed_sec": 3}).json()["own_spool_m"] == 300  # не сбрасывается
    # null — сбросить
    assert client.patch(f"/api/projects/{pid}", json={"own_spool_m": None}).json()["own_spool_m"] is None
    # 5 м меньше допустимого → 422
    assert client.patch(f"/api/projects/{pid}", json={"own_spool_m": 5}).status_code == 422


# Версия программы видна в настройках
def test_config_reports_app_version(client, monkeypatch, tmp_path):
    # Модуль настроек
    from app import config

    # Настройки
    cfg = client.get("/api/config").json()
    # В разработке версия «dev», не десктоп
    assert cfg["app"] == {"version": "dev", "desktop": False}
    # Подменяем папку программы на временную
    monkeypatch.setattr(config, "BASE_DIR", tmp_path)
    # Кладём файл с версией, как в сборке
    (tmp_path / "_version.txt").write_text("1.4.7\n", encoding="utf-8")
    # Версия берётся из файла
    assert client.get("/api/config").json()["app"]["version"] == "1.4.7"
