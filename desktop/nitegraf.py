"""Нитеграф — десктопная версия.

Один процесс: внутри работает тот же Python-бэкенд (FastAPI), он же раздаёт собранный
фронтенд (frontend/out), а окно приложения — системный WebView (на Windows — Edge WebView2,
он есть в Windows 10/11). Node.js и браузер не нужны.

Данные (портреты, модель удаления фона, журнал) — в %LOCALAPPDATA%\\Nitegraf
(macOS: ~/Library/Application Support/Nitegraf, Linux: ~/.local/share/Nitegraf).

Запуск из исходников (для разработки):
    cd frontend && npm run build:desktop && cd ..
    python desktop/nitegraf.py              # окно приложения
    python desktop/nitegraf.py --server-only --port 8765   # только сервер (проверки, CI)
"""

# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Разбор параметров командной строки (--browser, --port …)
import argparse
# Журнал сообщений
import logging
# Переменные окружения и выход из процесса
import os
# Поиск свободного сетевого порта
import socket
# Признак «запущено из .exe», потоки вывода
import sys
# Сервер работает в отдельном потоке, а окно — в главном
import threading
# Паузы и таймауты
import time
# Проверка «сервер уже отвечает»
import urllib.request
# Открыть приложение в обычном браузере (запасной вариант)
import webbrowser
# Пути к файлам
from pathlib import Path

# Имя папки с данными
APP_NAME = "Nitegraf"
# Заголовок окна
TITLE = "Нитеграф — портрет из нитей"
# True, если программа собрана PyInstaller в .exe (тогда sys.frozen установлен)
FROZEN = getattr(sys, "frozen", False)


# Где лежат файлы программы
def bundle_dir() -> Path:
    """Где лежат web/ и app/: внутри сборки PyInstaller или в репозитории."""
    # Собранная программа
    if FROZEN:
        # PyInstaller распаковывает файлы в _MEIPASS (или они лежат рядом с .exe)
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    # Запуск из исходников — корень репозитория (на уровень выше папки desktop)
    return Path(__file__).resolve().parent.parent


# Папка собранного фронтенда
def web_dir() -> Path:
    # Корень файлов программы
    base = bundle_dir()
    # В .exe — папка web, в репозитории — frontend/out
    return base / "web" if FROZEN else base / "frontend" / "out"


# Папка с данными пользователя
def data_dir() -> Path:
    # Windows
    if os.name == "nt":
        # %LOCALAPPDATA% (обычно C:\Users\<имя>\AppData\Local)
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    # macOS
    elif sys.platform == "darwin":
        # Стандартная папка данных программ на Mac
        root = Path.home() / "Library" / "Application Support"
    # Linux
    else:
        # По стандарту XDG
        root = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    # Своя подпапка
    path = root / APP_NAME
    # Создаём, если нет
    path.mkdir(parents=True, exist_ok=True)
    # Путь к данным
    return path


# Настроить бэкенд через переменные окружения (до его импорта)
def setup_environment(data: Path) -> None:
    # База портретов — в папке данных (setdefault — не перезаписываем, если задано вручную)
    os.environ.setdefault("STRINGART_DB", str(data / "stringart.db"))
    # Модель удаления фона — тоже туда
    os.environ.setdefault("STRINGART_MODELS_DIR", str(data / "models"))
    # Бэкенд будет раздавать собранный фронтенд
    os.environ["STRINGART_STATIC_DIR"] = str(web_dir())
    # Запуск из исходников
    if not FROZEN:
        # Чтобы «from app.main import app» нашёл пакет backend/app
        sys.path.insert(0, str(bundle_dir() / "backend"))
    # Сборка без консоли: stdout/stderr = None, а uvicorn пишет журнал именно туда.
    # Если потоков вывода нет
    if sys.stdout is None or sys.stderr is None:
        # Пишем журнал в файл nitegraf.log (buffering=1 — построчно, чтобы ничего не терялось)
        log = open(data / "nitegraf.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        # Подменяем стандартный вывод
        sys.stdout = sys.stdout or log
        # И вывод ошибок
        sys.stderr = sys.stderr or log


# Найти свободный порт
def free_port() -> int:
    # Временный сокет
    with socket.socket() as s:
        # Порт 0 — система сама выдаст свободный
        s.bind(("127.0.0.1", 0))
        # Какой порт выдала система
        return s.getsockname()[1]


# Запустить сервер в фоне и дождаться, пока он ответит
def start_server(port: int):
    # Сервер ASGI
    import uvicorn

    # Наше приложение (импорт после setup_environment — переменные уже заданы)
    from app.main import app

    # Сервер только на локальном адресе — снаружи компьютера он недоступен
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info"))
    # Отдельный поток; daemon — не мешает закрыть программу
    thread = threading.Thread(target=server.run, name="server", daemon=True)
    # Запускаем
    thread.start()
    # Адрес сервера
    url = f"http://127.0.0.1:{port}"
    # Ждём не больше минуты
    deadline = time.time() + 60
    # Пока не вышло время
    while time.time() < deadline:
        # Поток сервера упал
        if not thread.is_alive():
            # Сообщаем, где искать подробности
            raise RuntimeError("Сервер не запустился — подробности в nitegraf.log")
        # Сервер может ещё не слушать порт
        try:
            # Пробуем запрос health
            with urllib.request.urlopen(f"{url}/api/health", timeout=1) as r:
                # Ответил «ок»
                if r.status == 200:
                    # Сервер готов
                    return server, url
        # Ещё не готов
        except OSError:
            # Ждём 0,2 с и пробуем снова
            time.sleep(0.2)
    # Не дождались
    raise RuntimeError("Сервер не ответил за минуту")


# Открыть окно приложения (WebView)
def open_window(url: str, data: Path) -> None:
    # pywebview — окно с системным браузерным движком
    import webview

    # Разрешаем скачивания (PDF, шаблон, видео)
    webview.settings["ALLOW_DOWNLOADS"] = True  # PDF-инструкция
    # Внешние ссылки (YouTube, релизы) — в обычном браузере, а не в окне программы
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    # Окно: заголовок, адрес, размер и минимальный размер, цвет фона до загрузки страницы
    webview.create_window(TITLE, url, width=1320, height=900, min_size=(900, 640), background_color="#EEF0F4")
    # private_mode=False — настройки (тема, звук, ссылки на музыку) сохраняются между запусками
    # Запуск цикла окна (блокирует до закрытия окна)
    webview.start(private_mode=False, storage_path=str(data / "webview"))


# Запасной вариант без WebView
def fallback_browser(url: str) -> None:
    """Если окно WebView не открылось — приложение в обычном браузере и маленькое окно «Выйти»."""
    # Открываем в браузере по умолчанию
    webbrowser.open(url)
    # Tk может отсутствовать
    try:
        # Простая библиотека окон, встроенная в Python
        import tkinter as tk

        # Главное окно
        root = tk.Tk()
        # Заголовок
        root.title("Нитеграф")
        # Размер 420 × 150
        root.geometry("420x150")
        # Пояснение (pady — отступы сверху и снизу)
        tk.Label(root, text="Нитеграф открыт в браузере.\nНе закрывайте это окно, пока работаете.", pady=16).pack()
        # Строка для кнопок
        row = tk.Frame(root)
        # Разместить строку
        row.pack()
        # Кнопка «открыть ещё раз» (если вкладку закрыли)
        tk.Button(row, text="Открыть ещё раз", command=lambda: webbrowser.open(url)).pack(side="left", padx=6)
        # Кнопка «Выйти» — закрывает окно, а с ним и программу
        tk.Button(row, text="Выйти", command=root.destroy).pack(side="left", padx=6)
        # Цикл окна (до закрытия)
        root.mainloop()
    # Нет Tk
    except Exception:  # noqa: BLE001 — нет Tk: просто держим сервер, пока процесс не закроют
        # Бесконечно ждём — сервер работает, пока процесс не завершат
        while True:
            # Спим по часу
            time.sleep(3600)


# Точка входа программы
def main(argv: list[str] | None = None) -> int:
    # Описание параметров командной строки
    parser = argparse.ArgumentParser(description=TITLE)
    # Только сервер без окна (для проверок в CI)
    parser.add_argument("--server-only", action="store_true", help="без окна: только сервер (для проверок)")
    # Конкретный порт
    parser.add_argument("--port", type=int, default=0, help="порт сервера (по умолчанию — любой свободный)")
    # Открыть в браузере (например, ради голосового управления, которого нет в WebView2)
    parser.add_argument("--browser", action="store_true", help="открыть в браузере вместо окна приложения")
    # Разбираем параметры
    args = parser.parse_args(argv)

    # Папка данных
    data = data_dir()
    # Переменные окружения для бэкенда
    setup_environment(data)
    # Журнал уровня INFO
    logging.basicConfig(level=logging.INFO)
    # Свой журнал программы
    log = logging.getLogger("nitegraf")
    # Нет собранного фронтенда — показывать нечего
    if not (web_dir() / "index.html").is_file():
        # Подсказка, как собрать
        log.error("Не найден собранный фронтенд: %s (выполните npm run build:desktop)", web_dir())
        # Код ошибки 2
        return 2

    # Запускаем сервер на заданном или свободном порту
    server, url = start_server(args.port or free_port())
    # Сообщаем адрес и папку данных
    log.info("Нитеграф работает: %s, данные — %s", url, data)
    # Ctrl+C должен завершать аккуратно
    try:
        # Режим «только сервер»
        if args.server_only:
            # Печатаем адрес (его читает скрипт проверки в CI)
            print(url, flush=True)
            # Работаем, пока процесс не остановят
            while True:
                # Спим по часу
                time.sleep(3600)
        # Режим «в браузере»
        elif args.browser:
            # Открываем в браузере
            fallback_browser(url)
        # Обычный режим — окно
        else:
            # Окно может не открыться (нет WebView2)
            try:
                # Открываем окно
                open_window(url, data)
            # Не получилось
            except Exception:  # noqa: BLE001
                # Пишем причину в журнал
                log.exception("Окно приложения не открылось — открываем в браузере")
                # И открываем в браузере
                fallback_browser(url)
    # Нажали Ctrl+C
    except KeyboardInterrupt:
        # Ничего не делаем — просто выходим
        pass
    # В любом случае
    finally:
        # Просим сервер остановиться
        server.should_exit = True
    # Код «успешно»
    return 0


# Файл запущен как программа (а не импортирован)
if __name__ == "__main__":
    # Запускаем
    code = main()
    # Окно закрыто — выходим сразу, не дожидаясь фоновых задач (расчёт маски и т. п.)
    # Досылаем остатки вывода в журнал
    sys.stdout and sys.stdout.flush()
    # Немедленный выход с кодом
    os._exit(code)
