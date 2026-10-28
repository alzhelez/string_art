"""Обновление в одну кнопку (TC-API-34): релиз с GitHub, проверка суммы, запуск установщика."""

# Контрольная сумма
import hashlib
# Буфер — «ответ сети»
import io
# Ответ «GitHub» в JSON
import json

# Фикстуры
import pytest

# Модули: обновление, приложение, настройки
from app import config, main, updater

# Адрес установщика в «релизе»
SETUP_URL = updater.DOWNLOAD_PREFIX + "desktop-latest/Nitegraf-Setup.exe"
# Адрес файла с суммой
SHA_URL = SETUP_URL + ".sha256"
# Содержимое «установщика»
SETUP = b"MZ" + b"\x00" * 3_000_000
# Его сумма
SHA = hashlib.sha256(SETUP).hexdigest()


# «Ответ сети»: байты и заголовки, работает как with-объект
class FakeResponse(io.BytesIO):
    # Создание
    def __init__(self, data: bytes):
        # Буфер с данными
        super().__init__(data)
        # Заголовок длины
        self.headers = {"Content-Length": str(len(data))}


# Данные релиза как у GitHub
def release(version="1.4.20", digest=True, sha_file=False, url=SETUP_URL):
    # Установщик
    setup = {"name": updater.SETUP_NAME, "browser_download_url": url, "size": len(SETUP)}
    # GitHub дал свою сумму
    if digest:
        # «sha256:…»
        setup["digest"] = "sha256:" + SHA
    # Файлы релиза
    assets = [setup, {"name": "Nitegraf-portable.zip", "browser_download_url": updater.DOWNLOAD_PREFIX + "x/p.zip"}]
    # Нужен файл с суммой
    if sha_file:
        # Добавляем
        assets.append({"name": updater.SHA_NAME, "browser_download_url": SHA_URL})
    # Релиз
    return {"name": f"Нитеграф для Windows {version}", "assets": assets}


# «Сеть»: адрес → байты (или исключение)
@pytest.fixture()
# Подменяем сеть, запуск установщика и выход
def net(monkeypatch, tmp_path):
    # Что отвечать по адресам
    routes: dict[str, object] = {}
    # Что запускали
    launched: list = []
    # Сколько раз просили выйти
    exits: list = []

    # Подменённое открытие адреса
    def fake_open(req, timeout):
        # Ответ по адресу
        answer = routes.get(req.full_url)
        # Исключение — бросаем
        if isinstance(answer, Exception):
            # Как настоящая сеть
            raise answer
        # Нет адреса — как 404
        if answer is None:
            # Ошибка сети
            raise OSError("404")
        # Ответ
        return FakeResponse(answer if isinstance(answer, bytes) else json.dumps(answer).encode())

    # Ставим подмены
    monkeypatch.setattr(updater, "opener", fake_open)
    # Запуск установщика — только запоминаем
    monkeypatch.setattr(updater, "launch", lambda path: launched.append(path))
    # Выход — только запоминаем
    monkeypatch.setattr(updater, "exit_soon", lambda: exits.append(1))
    # Чистое состояние
    updater.reset()
    # Отдаём всё тесту
    yield {"routes": routes, "launched": launched, "exits": exits, "dir": tmp_path}
    # После теста — снова чистое
    updater.reset()


# Успех: скачали, сумма сошлась, установщик запущен, программа закроется
def test_update_success(net):
    # Релиз с суммой от GitHub
    net["routes"][updater.RELEASE_API] = release()
    # Сам установщик
    net["routes"][SETUP_URL] = SETUP
    # Обновляемся с 1.4.10
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Установка запущена
    assert (s["state"], s["version"], s["done"], s["total"], s["error"]) == ("installing", "1.4.20", len(SETUP), len(SETUP), None)
    # Запущен проверенный файл
    assert [p.name for p in net["launched"]] == ["Nitegraf-Setup-1.4.20.exe"] and net["launched"][0].read_bytes() == SETUP
    # Программа закроется
    assert net["exits"] == [1]


# Суммы от GitHub нет — берём файл .sha256 из релиза
def test_update_sha_file(net):
    # Релиз без digest, но с файлом суммы
    net["routes"][updater.RELEASE_API] = release(digest=False, sha_file=True)
    # Файл суммы в формате sha256sum
    net["routes"][SHA_URL] = f"{SHA.upper()}  Nitegraf-Setup.exe\n".encode()
    # Установщик
    net["routes"][SETUP_URL] = SETUP
    # Обновляемся
    assert updater.start("1.4.10", net["dir"], wait=True)["state"] == "installing"


# Ошибки: каждая — понятный текст, установщик не запускается
@pytest.mark.parametrize(
    # Что отдаёт «сеть» и какой текст ждём
    "routes, current, text",
    # Случаи
    [
        # Нет интернета
        ({}, "1.4.10", "Не удалось связаться с GitHub"),
        # Уже последняя
        ({updater.RELEASE_API: release("1.4.10")}, "1.4.10", "уже последняя версия 1.4.10"),
        # Новее, чем в релизе (сборка из будущего) — тоже «последняя»
        ({updater.RELEASE_API: release("1.4.9")}, "1.4.10", "уже последняя"),
        # В релизе нет номера версии
        ({updater.RELEASE_API: {"name": "что-то", "assets": []}}, "1.4.10", "нет номера версии"),
        # Установщик лежит на чужом сайте
        ({updater.RELEASE_API: release(url="https://evil.example/Nitegraf-Setup.exe")}, "1.4.10", "нет установщика"),
        # Нет ни суммы, ни файла с ней
        ({updater.RELEASE_API: release(digest=False)}, "1.4.10", "нет контрольной суммы"),
        # Файл суммы испорчен
        ({updater.RELEASE_API: release(digest=False, sha_file=True), SHA_URL: b"oops"}, "1.4.10", "испорчен"),
        # Файл суммы не скачался
        ({updater.RELEASE_API: release(digest=False, sha_file=True)}, "1.4.10", "контрольную сумму"),
        # Установщик подменён — сумма не сошлась
        ({updater.RELEASE_API: release(), SETUP_URL: b"MZ evil"}, "1.4.10", "не совпала"),
        # Скачивание оборвалось
        ({updater.RELEASE_API: release(), SETUP_URL: ConnectionResetError()}, "1.4.10", "прервалось"),
        # GitHub ответил не JSON
        ({updater.RELEASE_API: b"<html>"}, "1.4.10", "Не удалось связаться"),
        # JSON, но не объект
        ({updater.RELEASE_API: [1, 2]}, "1.4.10", "непонятный ответ"),
    ],
)
# Проверка одной ошибки
def test_update_errors(net, routes, current, text):
    # Ставим ответы
    net["routes"].update(routes)
    # Пробуем
    s = updater.start(current, net["dir"], wait=True)
    # Ошибка с нужным текстом
    assert s["state"] == "error" and text in s["error"], s
    # Ничего не запускали и не выходили
    assert net["launched"] == [] and net["exits"] == []
    # Недокачанных и подменённых файлов не осталось
    assert list(net["dir"].glob("*.exe")) == []


# Слишком большой установщик — отмена
def test_update_too_big(net, monkeypatch):
    # Лимит 1 КБ
    monkeypatch.setattr(updater, "MAX_SETUP_BYTES", 1024)
    # Куски по 512 байт
    monkeypatch.setattr(updater, "CHUNK", 512)
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Пробуем
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Отменено
    assert s["state"] == "error" and "большой" in s["error"] and not list(net["dir"].glob("*.exe"))


# Не удалось запустить установщик — ошибка, программа не закрывается
def test_update_launch_fails(net, monkeypatch):
    # Запуск падает
    monkeypatch.setattr(updater, "launch", lambda path: (_ for _ in ()).throw(PermissionError("нет доступа")))
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Пробуем
    s = updater.start("1.4.10", net["dir"], wait=True)
    # Текст с причиной
    assert s["state"] == "error" and "нет доступа" in s["error"] and net["exits"] == []


# Повторное нажатие во время скачивания не запускает второе
def test_update_twice(net):
    # Состояние «качаем»
    updater._set(state="downloading", done=5)
    # Нажимаем ещё раз
    assert updater.start("1.4.10", net["dir"])["state"] == "downloading"
    # Ничего не запускали
    assert net["launched"] == []


# Разбор версии и признак «поддерживается»
def test_helpers(monkeypatch):
    # Версия из заголовка
    assert updater.parse_version("Нитеграф для Windows 1.4.12") == (1, 4, 12) and updater.parse_version("") is None
    # Не программа для Windows — нет
    assert updater.supported(False) is False
    # Linux — нет (установщик только для Windows)
    monkeypatch.setattr(updater.os, "name", "posix")
    # Проверка
    assert updater.supported(True) is False
    # Windows — да
    monkeypatch.setattr(updater.os, "name", "nt")
    # Проверка
    assert updater.supported(True) is True


# Настоящий запуск установщика: отдельный процесс с параметрами тихой установки
def test_launch_args(monkeypatch, tmp_path):
    # Что передали в Popen
    calls = []
    # Подмена Popen
    monkeypatch.setattr(updater.subprocess, "Popen", lambda args, **kw: calls.append((args, kw)))
    # Запуск
    updater.launch(tmp_path / "setup.exe")
    # Путь и параметры
    args, kw = calls[0]
    # Тихая установка, закрыть программу, перезапустить после
    assert args[0].endswith("setup.exe") and "/SILENT" in args and "/RELAUNCH=1" in args and "/FORCECLOSEAPPLICATIONS" in args
    # Не держим дескрипторы
    assert kw["close_fds"] is True


# Выход через таймер, а не сразу
def test_exit_soon(monkeypatch):
    # Что запускали
    timers = []

    # Подмена таймера
    class FakeTimer:
        # Создание: задержка, функция, аргументы
        def __init__(self, delay, fn, args):
            # Запоминаем
            timers.append((delay, fn, args))

        # Запуск — ничего не делаем
        def start(self):
            # Пусто
            pass

    # Ставим подмену
    monkeypatch.setattr(updater.threading, "Timer", FakeTimer)
    # Просим выйти
    updater.exit_soon()
    # Выход с кодом 0 через EXIT_DELAY_S
    assert timers == [(updater.EXIT_DELAY_S, updater.os._exit, (0,))]


# API: в веб-версии обновление недоступно (TC-API-34)
def test_api_not_supported(client):
    # Состояние
    r = client.get("/api/update")
    # Ждём, не поддерживается
    assert r.status_code == 200 and r.json()["state"] == "idle" and r.json()["supported"] is False
    # Начать нельзя
    r = client.post("/api/update")
    # 404 с пояснением
    assert r.status_code == 404 and "только в программе для Windows" in r.json()["detail"]
    # В настройках — признак «не обновляется»
    assert client.get("/api/config").json()["app"]["update"] is False


# API в программе для Windows: старт и опрос
def test_api_supported(client, net, monkeypatch):
    # «Программа для Windows»
    monkeypatch.setattr(updater, "supported", lambda desktop: True)
    # Версия сборки
    monkeypatch.setattr(config, "app_version", lambda: "1.4.10")
    # Настоящий запуск обновления
    real_start = updater.start
    # Установщик — во временную папку теста, ждём конца
    monkeypatch.setattr(main.updater, "start", lambda current: real_start(current, net["dir"], wait=True))
    # Релиз и установщик
    net["routes"].update({updater.RELEASE_API: release(), SETUP_URL: SETUP})
    # Старт
    r = client.post("/api/update")
    # Принят
    assert r.status_code == 202 and r.json()["supported"] is True
    # Опрос: установка запущена
    assert client.get("/api/update").json()["state"] == "installing"
    # В настройках — «обновляется»
    assert client.get("/api/config").json()["app"]["update"] is True


# Сборка разработчика не обновляется даже на Windows
def test_api_dev_build(client, monkeypatch):
    # «Программа для Windows»
    monkeypatch.setattr(updater, "supported", lambda desktop: True)
    # Версия «dev»
    monkeypatch.setattr(config, "app_version", lambda: "dev")
    # Начать нельзя
    assert client.post("/api/update").status_code == 404
