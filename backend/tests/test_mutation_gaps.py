"""Тесты по итогам мутационного тестирования (mutmut): проверяют то, что раньше «выживало».

Каждый тест закрывает конкретную «дыру»: точные тексты ошибок (а не кусок текста),
промежуточные состояния обновления, граничные значения, заголовки запросов и т. п.
"""

# Контрольная сумма
import hashlib
# Буфер — «ответ сети»
import io
# Ответы «GitHub» в JSON
import json
# Константы числа π
import math

# Фикстуры и проверки исключений
import pytest

# Модули под проверкой
from app import geometry, palette, thread, transfer, updater

# Папка общих фикстур
from .conftest import FIXTURES

# Адрес установщика в «релизе»
SETUP_URL = updater.DOWNLOAD_PREFIX + "desktop-latest/Nitegraf-Setup.exe"
# Адрес файла с суммой
SHA_URL = SETUP_URL + ".sha256"
# Содержимое «установщика»
SETUP = b"MZ" + bytes(range(256)) * 40
# Его сумма
SHA = hashlib.sha256(SETUP).hexdigest()


# «Ответ сети»: байты, заголовки, with-объект
class FakeResponse(io.BytesIO):
    # Создание: данные и (по желанию) заголовок длины
    def __init__(self, data: bytes, length: bool = True):
        # Буфер
        super().__init__(data)
        # Заголовки
        self.headers = {"Content-Length": str(len(data))} if length else {}


# Данные релиза как у GitHub
def release(version="1.4.20", digest=True, sha_file=False, size=True):
    # Установщик
    setup = {"name": updater.SETUP_NAME, "browser_download_url": SETUP_URL}
    # Размер известен
    if size:
        # Размер
        setup["size"] = len(SETUP)
    # Сумма от GitHub
    if digest:
        # «sha256:…»
        setup["digest"] = "sha256:" + SHA
    # Файлы релиза
    assets = [setup]
    # Файл суммы
    if sha_file:
        # Добавляем
        assets.append({"name": updater.SHA_NAME, "browser_download_url": SHA_URL})
    # Релиз
    return {"name": f"Нитеграф для Windows {version}", "assets": assets}


# Подменённая сеть: адрес → ответ; запросы запоминаются
@pytest.fixture()
# Сеть, запуск установщика, выход и журнал состояний
def net(monkeypatch, tmp_path):
    # Ответы
    routes: dict = {}
    # Запросы (адрес, заголовки)
    requests: list = []
    # Состояния, через которые прошло обновление
    states: list = []
    # Записи «скачано»
    progress: list = []
    # Настоящая запись состояния
    real_set = updater._set

    # Подменённое открытие адреса
    def fake_open(req, timeout):
        # Запоминаем адрес и заголовки
        requests.append((req.full_url, dict(req.header_items())))
        # Ответ
        answer = routes.get(req.full_url)
        # Нет — как 404
        if answer is None:
            # Ошибка сети
            raise OSError("404")
        # Кортеж (байты, есть ли длина)
        if isinstance(answer, tuple):
            # Ответ без заголовка длины
            return FakeResponse(*answer)
        # Байты или JSON
        return FakeResponse(answer if isinstance(answer, bytes) else json.dumps(answer).encode())

    # Запись состояния с журналом
    def logging_set(**fields):
        # Новое состояние
        if "state" in fields:
            # В журнал
            states.append(fields["state"])
        # Прогресс
        if "done" in fields:
            # В журнал
            progress.append(fields["done"])
        # Настоящая запись
        real_set(**fields)

    # Ставим подмены
    monkeypatch.setattr(updater, "opener", fake_open)
    # Журнал состояний
    monkeypatch.setattr(updater, "_set", logging_set)
    # Запуск установщика — только запоминаем
    launched: list = []
    # Подмена
    monkeypatch.setattr(updater, "launch", lambda path: launched.append(path))
    # Выход — ничего
    monkeypatch.setattr(updater, "exit_soon", lambda: None)
    # Чистое состояние
    updater.reset()
    # Всё тесту
    yield {"routes": routes, "requests": requests, "states": states, "progress": progress, "launched": launched, "dir": tmp_path}
    # После теста — чисто
    updater.reset()


# --- обновление программы ---------------------------------------------------------------


# Путь обновления: состояния по порядку, прогресс кусками, заголовки запросов
def test_update_states_progress_headers(net, monkeypatch):
    # Куски по 1000 байт
    monkeypatch.setattr(updater, "CHUNK", 1000)
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Папка, которой ещё нет (вложенная)
    folder = net["dir"] / "a" / "b"
    # Обновляемся
    s = updater.start("1.4.10", folder, wait=True)
    # Итог
    assert s["state"] == "installing"
    # Состояния строго по порядку (первое «checking» ставит start)
    assert net["states"] == ["downloading", "verifying", "installing"]
    # Прогресс: 0, затем каждые 1000 байт, в конце — весь файл
    assert net["progress"][0] == 0 and net["progress"][1] == 1000 and net["progress"][-1] == len(SETUP)
    # Установщик лежит во вложенной папке
    assert net["launched"][0].parent == folder
    # Заголовки запроса к API GitHub
    url, headers = net["requests"][0]
    # Адрес и заголовки
    assert url == updater.RELEASE_API and headers["Accept"] == "application/vnd.github+json" and headers["User-agent"] == "Nitegraf-updater"
    # Установщик качается как файл
    assert net["requests"][1][1]["Accept"] == "application/octet-stream"


# Размер из заголовка Content-Length, если релиз его не дал
def test_update_size_from_header(net):
    # Релиз без размера
    net["routes"].update({updater.RELEASE_API: release(size=False), SETUP_URL: SETUP})
    # Обновляемся
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Всего — из заголовка
    assert s["total"] == len(SETUP)


# Ни размера, ни заголовка — «всего 0» (неизвестно), но скачивание идёт
def test_update_size_unknown(net):
    # Ответ без заголовка длины
    net["routes"].update({updater.RELEASE_API: release(size=False), SETUP_URL: (SETUP, False)})
    # Обновляемся
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Размер неизвестен, файл скачан целиком
    assert (s["state"], s["total"], s["done"]) == ("installing", 0, len(SETUP))


# Ровно на пределе — можно; на байт больше — нельзя
def test_update_size_limit_boundary(net, monkeypatch):
    # Предел — ровно размер установщика
    monkeypatch.setattr(updater, "MAX_SETUP_BYTES", len(SETUP))
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Ровно на пределе — установка
    assert updater.start("1.4.10", net["dir"], wait=True)["state"] == "installing"
    # Предел на байт меньше
    monkeypatch.setattr(updater, "MAX_SETUP_BYTES", len(SETUP) - 1)
    # С чистого состояния
    updater.reset()
    # Отказ с точным текстом
    assert updater.start("1.4.10", net["dir"], wait=True)["error"] == "Установщик подозрительно большой — обновление отменено"


# Точные тексты ошибок (их видит человек)
@pytest.mark.parametrize(
    # Что отдаёт сеть и точный текст
    "routes, text",
    # Случаи
    [
        # Нет интернета
        ({}, "Не удалось связаться с GitHub — проверьте интернет"),
        # Нет номера версии (и имени релиза вовсе нет)
        ({updater.RELEASE_API: {"assets": []}}, "В релизе на GitHub нет номера версии"),
        # Нет адреса у установщика
        ({updater.RELEASE_API: {"name": "1.4.20", "assets": [{"name": updater.SETUP_NAME}]}}, "В релизе нет установщика Nitegraf-Setup.exe"),
        # Нет суммы
        ({updater.RELEASE_API: release(digest=False)}, "Не удалось проверить установщик: в релизе нет контрольной суммы"),
        # Файл суммы не скачался
        ({updater.RELEASE_API: release(digest=False, sha_file=True)}, "Не удалось скачать контрольную сумму установщика"),
        # Файл суммы испорчен
        ({updater.RELEASE_API: release(digest=False, sha_file=True), SHA_URL: b"oops"}, "Файл контрольной суммы испорчен"),
        # Сумма не совпала
        ({updater.RELEASE_API: release(), SETUP_URL: b"MZ evil"}, "Контрольная сумма не совпала — файл испорчен, обновление отменено"),
        # Скачивание оборвалось (файл ещё не создан — удалять нечего)
        ({updater.RELEASE_API: release()}, "Скачивание прервалось — попробуйте ещё раз"),
        # Уже последняя
        ({updater.RELEASE_API: release("1.4.10")}, "У вас уже последняя версия 1.4.10"),
        # Не JSON-объект
        ({updater.RELEASE_API: [1]}, "GitHub вернул непонятный ответ"),
    ],
)
# Проверка текста
def test_update_exact_errors(net, routes, text):
    # Ответы
    net["routes"].update(routes)
    # Пробуем
    assert updater.start("1.4.10", net["dir"], wait=True)["error"] == text


# Файл суммы с не-ASCII символами после суммы (например, «✓») — читается
def test_sha_file_with_unicode(net):
    # Файл суммы с хвостом не-ASCII
    net["routes"].update({updater.RELEASE_API: release(digest=False, sha_file=True), SHA_URL: f"{SHA}  Nitegraf-Setup.exe ✓\n".encode(), SETUP_URL: SETUP})
    # Обновление проходит
    assert updater.start("1.4.10", net["dir"], wait=True)["state"] == "installing"


# Пока идёт любой шаг — второе нажатие ничего не начинает
@pytest.mark.parametrize("busy", ["checking", "downloading", "verifying", "installing"])
# Проверка шага
def test_start_while_busy(net, busy):
    # Шаг уже идёт
    updater._set(state=busy)
    # Нажимаем ещё раз
    assert updater.start("1.4.10", net["dir"])["state"] == busy
    # В сеть не ходили
    assert net["requests"] == []


# После ошибки можно начать заново
def test_start_after_error(net):
    # Была ошибка
    updater._set(state="error", error="старая")
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Новая попытка
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Установка, старой ошибки нет
    assert (s["state"], s["error"]) == ("installing", None)


# Флаги отдельного процесса Windows
def test_launch_windows_flags(monkeypatch, tmp_path):
    # Что передали в Popen
    calls = []
    # Флаги как в Windows
    monkeypatch.setattr(updater.subprocess, "DETACHED_PROCESS", 8, raising=False)
    # Своя группа процессов
    monkeypatch.setattr(updater.subprocess, "CREATE_NEW_PROCESS_GROUP", 512, raising=False)
    # Подмена Popen
    monkeypatch.setattr(updater.subprocess, "Popen", lambda args, **kw: calls.append(kw))
    # Запуск
    updater.launch(tmp_path / "setup.exe")
    # Оба флага сразу
    assert calls[0]["creationflags"] == 8 | 512


# Таймер выхода не держит процесс
def test_exit_soon_daemon(monkeypatch):
    # Созданные таймеры
    timers = []

    # Подмена таймера
    class FakeTimer:
        # Создание
        def __init__(self, delay, fn, args):
            # Признак «фоновый»
            self.daemon = False
            # Запоминаем
            timers.append(self)

        # Запуск
        def start(self):
            # Пусто
            pass

    # Ставим подмену
    monkeypatch.setattr(updater.threading, "Timer", FakeTimer)
    # Выход
    updater.exit_soon()
    # Фоновый
    assert timers[0].daemon is True


# Номер версии: нет текста — нет версии
def test_parse_version_empty():
    # None и пустая строка
    assert updater.parse_version(None) is None and updater.parse_version("XXXX") is None


# --- файл проекта ---------------------------------------------------------------------------


# Граничные длины схемы и номера гвоздей
def test_check_sequence_bounds():
    # Одна линия — можно
    assert transfer._check_sequence([0, 120]) == [0, 120]
    # 5000 линий — можно
    assert len(transfer._check_sequence([0, 120] * 2500 + [0])) == 5001
    # Ни одной линии — нельзя
    with pytest.raises(ValueError, match="^Схема должна содержать от 1 до 5000 линий$"):
        # Один гвоздь
        transfer._check_sequence([0])
    # 5001 линия — нельзя
    with pytest.raises(ValueError, match="от 1 до 5000"):
        # 5002 гвоздя
        transfer._check_sequence([0, 120] * 2501)
    # Гвоздь 239 — последний, можно
    assert transfer._check_sequence([0, 239]) == [0, 239]
    # Гвоздь 240 — нельзя, текст точный
    with pytest.raises(ValueError, match="^Номер гвоздя вне 0…239$"):
        # Вне круга
        transfer._check_sequence([0, 240])


# base64: строгая проверка и точный текст
def test_unb64_strict():
    # Пробел внутри — нестрогое чтение бы прошло, строгое — нет
    with pytest.raises(ValueError, match="^Маска: испорченные данные$"):
        # Строка с пробелом
        transfer._unb64("aGVs bG8=", "Маска")
    # Правильная строка
    assert transfer._unb64("aGVsbG8=", "Маска") == b"hello"


# Время сохранения — с часовым поясом UTC
def test_export_time_utc(client):
    # Портрет из фото без лица
    p = client.post("/api/projects", files={"file": ("p.png", (FIXTURES / "portrait.png").read_bytes(), "image/png")}).json()
    # Файл
    data = client.get(f"/api/projects/{p['id']}/export").json()
    # Время со смещением +00:00
    assert data["exported_at"].endswith("+00:00")
    # Подготовленное фото — base64 ASCII
    assert data["source_png"].isascii()
    # Уборка
    client.delete(f"/api/projects/{p['id']}")


# Точные тексты ошибок импорта
@pytest.mark.parametrize(
    # Что испортить и точный текст
    "spoil, text",
    # Случаи
    [
        # Испорченный base64 подготовленного фото
        (lambda d: d.update(source_png="@@@@"), "Подготовленное фото: испорченные данные"),
        # Не картинка
        (lambda d: d.update(source_png="aGVsbG8="), "Подготовленное фото испорчено"),
    ],
)
# Проверка
def test_import_exact_errors(client, spoil, text):
    # Портрет
    p = client.post("/api/projects", files={"file": ("p.png", (FIXTURES / "portrait.png").read_bytes(), "image/png")}).json()
    # Файл
    data = client.get(f"/api/projects/{p['id']}/export").json()
    # Портим
    spoil(data)
    # Импорт
    r = client.post("/api/projects/import", files={"file": ("p.nitegraf", json.dumps(data).encode(), "application/json")})
    # Точный текст
    assert (r.status_code, r.json()["detail"]) == (422, text)
    # Уборка
    client.delete(f"/api/projects/{p['id']}")


# --- геометрия, леска, нити -----------------------------------------------------------------


# Середина сектора: A — −45°, D — 270° − 45°
def test_sector_center_angle_exact():
    # A: между −90° и 0°
    assert geometry.sector_center_angle(0) == pytest.approx(-math.pi / 4)
    # B: между 0° и 90°
    assert geometry.sector_center_angle(1) == pytest.approx(math.pi / 4)
    # D
    assert geometry.sector_center_angle(3) == pytest.approx(5 * math.pi / 4)


# Тексты ошибок разбора метки
def test_parse_label_messages():
    # Мусор
    with pytest.raises(ValueError, match=r"^Некорректная метка гвоздя: 'Z9'$"):
        # Нет сектора Z
        geometry.parse_label("Z9")
    # Номер вне 1..60
    with pytest.raises(ValueError, match=r"^Номер гвоздя должен быть 1\.\.60: 'A61'$"):
        # 61
        geometry.parse_label("A61")


# Накопленная длина: первая хорда — между первым и вторым гвоздём
def test_cumulative_first_chord():
    # Схема: A1 → C1 (диаметр) → C2
    out = thread.cumulative_lengths_m([0, 120, 121], 100)
    # Первая хорда — диаметр 1 м
    assert out[1] == pytest.approx(1.0)


# Рекомендация числа линий округляется по сотне на 40 линий/см
def test_recommended_lines_rounding():
    # 36,3 см × 40 = 1452 → 1500
    assert thread.recommended_lines(36.3) == 1500


# Справочник нитей и досок — точные поля
def test_catalog_fields():
    # Справочник
    c = palette.catalog()
    # Первая нить
    assert c["threads"][0] == {"key": "black", "name": "Чёрная", "hex": "#1b1b1b"}
    # Первая доска
    assert c["boards"][0] == {"key": "white", "name": "Белая", "hex": "#ffffff"}
    # Ограничения
    assert c["colors"] == {"min": 2, "max": 4, "default": 3} and c["layer_min_lines"] == 100 and c["modes"] == ["mono", "bw", "color"]
