"""Обновление программы для Windows в одну кнопку.

Сервер сам узнаёт последний релиз desktop-latest на GitHub, скачивает установщик,
сверяет его контрольную сумму SHA-256, запускает установку без вопросов (/SILENT)
и закрывает программу; установщик ставит новую версию поверх и запускает её снова.
Адрес релиза зашит в код — с фронтенда приходит только «обнови», никаких ссылок.
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Контрольная сумма SHA-256
import hashlib
# Разбор ответа GitHub
import json
# Переменные окружения, выход из процесса, признак Windows
import os
# Поиск версии в тексте
import re
# Запуск установщика
import subprocess
# Папка для временных файлов
import tempfile
# Скачивание идёт в отдельном потоке
import threading
# Запросы к GitHub
import urllib.request
# Тип «функция»
from collections.abc import Callable
# Описание состояния
from dataclasses import asdict, dataclass
# Пути к файлам
from pathlib import Path
# Тип «что угодно»
from typing import Any

# Данные последнего релиза программы для Windows
RELEASE_API = "https://api.github.com/repos/alzhelez/string_art/releases/tags/desktop-latest"
# Скачивать разрешено только файлы релизов этого репозитория
DOWNLOAD_PREFIX = "https://github.com/alzhelez/string_art/releases/download/"
# Имя файла установщика в релизе
SETUP_NAME = "Nitegraf-Setup.exe"
# Файл с контрольной суммой рядом с установщиком (если GitHub не дал свою)
SHA_NAME = SETUP_NAME + ".sha256"
# Установка без вопросов, но с окном прогресса; /RELAUNCH=1 — запустить программу после установки
INSTALL_ARGS = ("/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS", "/RELAUNCH=1")
# Установщик больше 500 МБ — что-то не то
MAX_SETUP_BYTES = 500 * 1024 * 1024
# Качаем кусками по мегабайту
CHUNK = 1024 * 1024
# Ждать ответа сети не дольше 30 секунд
TIMEOUT_S = 30
# Через сколько секунд после запуска установщика закрыть программу (успевает уйти ответ фронтенду)
EXIT_DELAY_S = 1.5
# Состояния: ждём, узнаём релиз, качаем, проверяем, устанавливаем, ошибка
STATES = ("idle", "checking", "downloading", "verifying", "installing", "error")

# Как открывать адреса (в тестах подменяется)
opener: Callable[..., Any] = urllib.request.urlopen


# Состояние обновления — его опрашивает фронтенд
@dataclass
# Поля состояния
class Status:
    # Одно из STATES
    state: str = "idle"
    # Какая версия ставится
    version: str | None = None
    # Скачано байт
    done: int = 0
    # Всего байт (0 — пока неизвестно)
    total: int = 0
    # Текст ошибки для человека
    error: str | None = None


# Ошибка обновления с понятным текстом
class UpdateError(Exception):
    """Текст исключения показывается человеку как есть."""


# Текущее состояние
_status = Status()
# Замок: состояние меняет поток скачивания, читает — запрос фронтенда
_lock = threading.Lock()


# Умеет ли эта программа обновляться сама
def supported(desktop: bool) -> bool:
    # Только собранная программа (раздаёт фронтенд) и только на Windows: установщик — .exe
    return desktop and os.name == "nt"


# Снимок состояния для ответа API
def status() -> dict[str, Any]:
    # Под замком — поток мог как раз менять поля
    with _lock:
        # Копия полей словарём
        return asdict(_status)


# Поменять поля состояния
def _set(**fields: Any) -> None:
    # Под замком
    with _lock:
        # Каждое поле
        for key, value in fields.items():
            # Записываем
            setattr(_status, key, value)


# Сбросить состояние (для тестов и после ошибки)
def reset() -> None:
    # Объявляем, что меняем модульную переменную
    global _status
    # Под замком
    with _lock:
        # Новое пустое состояние
        _status = Status()


# «Нитеграф для Windows 1.4.12» → (1, 4, 12)
def parse_version(text: str) -> tuple[int, int, int] | None:
    # Три числа через точку
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    # Кортеж чисел или None
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


# Запрос к сети с заголовками и таймаутом
def _open(url: str, accept: str = "application/octet-stream"):
    # Запрос с понятным именем программы (GitHub требует User-Agent)
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "Nitegraf-updater"})
    # Открываем
    return opener(req, timeout=TIMEOUT_S)


# Данные релиза: версия, адрес установщика, размер, контрольная сумма или адрес файла с ней
def release_info(data: dict[str, Any]) -> dict[str, Any]:
    # Версия из заголовка релиза
    version = parse_version(str(data.get("name") or ""))
    # Без версии непонятно, что ставим
    if not version:
        # Ошибка
        raise UpdateError("В релизе на GitHub нет номера версии")
    # Файлы релиза по именам
    assets = {a.get("name"): a for a in data.get("assets") or [] if isinstance(a, dict)}
    # Установщик
    setup = assets.get(SETUP_NAME)
    # Его нет или адрес чужой
    if not setup or not str(setup.get("browser_download_url", "")).startswith(DOWNLOAD_PREFIX):
        # Ошибка
        raise UpdateError("В релизе нет установщика Nitegraf-Setup.exe")
    # Контрольная сумма, которую считает сам GitHub: «sha256:<64 знака>»
    digest = str(setup.get("digest") or "")
    # Файл с суммой рядом
    sha_file = assets.get(SHA_NAME)
    # Итог
    return {
        # Версия строкой
        "version": ".".join(map(str, version)),
        # Адрес установщика
        "url": setup["browser_download_url"],
        # Размер (если известен)
        "size": int(setup.get("size") or 0),
        # Сумма от GitHub (или None)
        "sha256": digest[7:].lower() if digest.startswith("sha256:") and len(digest) == 71 else None,
        # Адрес файла с суммой (только из нашего репозитория)
        "sha_url": sha_file["browser_download_url"]
        # Если файл есть и адрес наш
        if sha_file and str(sha_file.get("browser_download_url", "")).startswith(DOWNLOAD_PREFIX)
        # Иначе — нет
        else None,
    }


# Последний релиз с GitHub
def latest_release() -> dict[str, Any]:
    # Сеть может быть недоступна
    try:
        # Запрос к API GitHub
        with _open(RELEASE_API, "application/vnd.github+json") as r:
            # Разбираем JSON
            data = json.loads(r.read().decode("utf-8"))
    # Нет интернета, GitHub не ответил, ответ не JSON
    except (OSError, ValueError) as exc:
        # Понятная ошибка
        raise UpdateError("Не удалось связаться с GitHub — проверьте интернет") from exc
    # Ответ не объект
    if not isinstance(data, dict):
        # Ошибка
        raise UpdateError("GitHub вернул непонятный ответ")
    # Данные релиза
    return release_info(data)


# Какая контрольная сумма должна быть у установщика
def expected_sha256(release: dict[str, Any]) -> str:
    # GitHub посчитал сам — берём её
    if release["sha256"]:
        # Сумма
        return release["sha256"]
    # Нет ни суммы, ни файла с ней — ставить непроверенный файл нельзя
    if not release["sha_url"]:
        # Ошибка
        raise UpdateError("Не удалось проверить установщик: в релизе нет контрольной суммы")
    # Сеть может подвести
    try:
        # Скачиваем маленький файл с суммой
        with _open(release["sha_url"]) as r:
            # Первое слово файла — 64 шестнадцатеричных знака
            text = r.read(1024).decode("ascii", "replace").split()
    # Не скачался
    except OSError as exc:
        # Ошибка
        raise UpdateError("Не удалось скачать контрольную сумму установщика") from exc
    # Сумма в файле похожа на настоящую
    if text and re.fullmatch(r"[0-9a-fA-F]{64}", text[0]):
        # Строчными буквами
        return text[0].lower()
    # Файл испорчен
    raise UpdateError("Файл контрольной суммы испорчен")


# Скачать установщик и проверить сумму; вернуть путь к файлу
def download(release: dict[str, Any], folder: Path) -> Path:
    # Нужная сумма (до скачивания: без неё качать незачем)
    sha = expected_sha256(release)
    # Папка для файла
    folder.mkdir(parents=True, exist_ok=True)
    # Имя с версией — не путаем со старыми файлами
    path = folder / f"Nitegraf-Setup-{release['version']}.exe"
    # Сумма скачанного
    h = hashlib.sha256()
    # Скачано байт
    done = 0
    # Сеть может оборваться
    try:
        # Открываем установщик и файл для записи
        with _open(release["url"]) as r, open(path, "wb") as f:
            # Размер из заголовка, если релиз его не дал
            total = release["size"] or int(r.headers.get("Content-Length") or 0)
            # Сообщаем размер
            _set(state="downloading", total=total, done=0)
            # Пока есть данные
            while chunk := r.read(CHUNK):
                # Считаем объём
                done += len(chunk)
                # Слишком большой — останавливаемся
                if done > MAX_SETUP_BYTES:
                    # Ошибка
                    raise UpdateError("Установщик подозрительно большой — обновление отменено")
                # Добавляем в сумму
                h.update(chunk)
                # Пишем на диск
                f.write(chunk)
                # Прогресс
                _set(done=done)
    # Сеть оборвалась или диск полон
    except OSError as exc:
        # Убираем недокачанный файл
        path.unlink(missing_ok=True)
        # Ошибка
        raise UpdateError("Скачивание прервалось — попробуйте ещё раз") from exc
    # Наша ошибка (слишком большой)
    except UpdateError:
        # Убираем файл
        path.unlink(missing_ok=True)
        # Дальше
        raise
    # Проверяем сумму
    _set(state="verifying")
    # Не совпала — файл подменён или испорчен
    if h.hexdigest() != sha:
        # Удаляем
        path.unlink(missing_ok=True)
        # Ошибка
        raise UpdateError("Контрольная сумма не совпала — файл испорчен, обновление отменено")
    # Путь к проверенному установщику
    return path


# Запустить установщик отдельно от программы (в тестах подменяется)
def launch(path: Path) -> None:
    # Флаги Windows: свой процесс без консоли, не зависит от нашей программы
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    # Запускаем установщик с параметрами тихой установки
    subprocess.Popen([str(path), *INSTALL_ARGS], creationflags=flags, close_fds=True)


# Закрыть программу чуть позже — установщику нужно заменить её файлы (в тестах подменяется)
def exit_soon() -> None:
    # Таймер: через EXIT_DELAY_S секунд немедленный выход
    timer = threading.Timer(EXIT_DELAY_S, os._exit, (0,))
    # Не держит процесс
    timer.daemon = True
    # Запускаем
    timer.start()


# Весь путь обновления в фоновом потоке
def _run(current: str, folder: Path) -> None:
    # Любая ошибка — в состояние
    try:
        # Узнаём релиз
        release = latest_release()
        # Номер последней версии
        latest = parse_version(release["version"])
        # Номер текущей
        now = parse_version(current)
        # Уже последняя
        if latest and now and latest <= now:
            # Ошибка с понятным текстом
            raise UpdateError(f"У вас уже последняя версия {current}")
        # Версия, которую ставим
        _set(version=release["version"])
        # Скачиваем и проверяем
        path = download(release, folder)
        # Запускаем установку
        _set(state="installing")
        # Установщик
        launch(path)
        # Закрываем программу
        exit_soon()
    # Понятная ошибка
    except UpdateError as exc:
        # Показываем её текст
        _set(state="error", error=str(exc))
    # Непредвиденная ошибка (например, установщик не запустился)
    except Exception as exc:  # noqa: BLE001
        # Общий текст и причина
        _set(state="error", error=f"Обновление не удалось: {exc}")


# Начать обновление; повторное нажатие во время работы ничего не делает
def start(current: str, folder: Path | None = None, wait: bool = False) -> dict[str, Any]:
    # Объявляем, что меняем модульную переменную
    global _status
    # Под замком: проверить и занять
    with _lock:
        # Уже идёт
        if _status.state in ("checking", "downloading", "verifying", "installing"):
            # Отдаём как есть
            return asdict(_status)
        # Начинаем с чистого состояния
        _status = Status(state="checking")
    # Папка для установщика — временная папка системы
    target = folder or Path(tempfile.gettempdir()) / "Nitegraf-update"
    # Поток скачивания
    thread = threading.Thread(target=_run, args=(current, target), name="updater", daemon=True)
    # Запускаем
    thread.start()
    # В тестах можно дождаться конца
    if wait:
        # Ждём
        thread.join()
    # Состояние
    return status()
