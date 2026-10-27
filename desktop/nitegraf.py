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

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "Nitegraf"
TITLE = "Нитеграф — портрет из нитей"
FROZEN = getattr(sys, "frozen", False)


def bundle_dir() -> Path:
    """Где лежат web/ и app/: внутри сборки PyInstaller или в репозитории."""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def web_dir() -> Path:
    base = bundle_dir()
    return base / "web" if FROZEN else base / "frontend" / "out"


def data_dir() -> Path:
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    path = root / APP_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def setup_environment(data: Path) -> None:
    os.environ.setdefault("STRINGART_DB", str(data / "stringart.db"))
    os.environ.setdefault("STRINGART_MODELS_DIR", str(data / "models"))
    os.environ["STRINGART_STATIC_DIR"] = str(web_dir())
    if not FROZEN:
        sys.path.insert(0, str(bundle_dir() / "backend"))
    # Сборка без консоли: stdout/stderr = None, а uvicorn пишет журнал именно туда.
    if sys.stdout is None or sys.stderr is None:
        log = open(data / "nitegraf.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int):
    import uvicorn

    from app.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info"))
    thread = threading.Thread(target=server.run, name="server", daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 60
    while time.time() < deadline:
        if not thread.is_alive():
            raise RuntimeError("Сервер не запустился — подробности в nitegraf.log")
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=1) as r:
                if r.status == 200:
                    return server, url
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("Сервер не ответил за минуту")


def open_window(url: str, data: Path) -> None:
    import webview

    webview.settings["ALLOW_DOWNLOADS"] = True  # PDF-инструкция
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.create_window(TITLE, url, width=1320, height=900, min_size=(900, 640), background_color="#EEF0F4")
    # private_mode=False — настройки (тема, звук, ссылки на музыку) сохраняются между запусками
    webview.start(private_mode=False, storage_path=str(data / "webview"))


def fallback_browser(url: str) -> None:
    """Если окно WebView не открылось — приложение в обычном браузере и маленькое окно «Выйти»."""
    webbrowser.open(url)
    try:
        import tkinter as tk

        root = tk.Tk()
        root.title("Нитеграф")
        root.geometry("420x150")
        tk.Label(root, text="Нитеграф открыт в браузере.\nНе закрывайте это окно, пока работаете.", pady=16).pack()
        row = tk.Frame(root)
        row.pack()
        tk.Button(row, text="Открыть ещё раз", command=lambda: webbrowser.open(url)).pack(side="left", padx=6)
        tk.Button(row, text="Выйти", command=root.destroy).pack(side="left", padx=6)
        root.mainloop()
    except Exception:  # noqa: BLE001 — нет Tk: просто держим сервер, пока процесс не закроют
        while True:
            time.sleep(3600)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=TITLE)
    parser.add_argument("--server-only", action="store_true", help="без окна: только сервер (для проверок)")
    parser.add_argument("--port", type=int, default=0, help="порт сервера (по умолчанию — любой свободный)")
    parser.add_argument("--browser", action="store_true", help="открыть в браузере вместо окна приложения")
    args = parser.parse_args(argv)

    data = data_dir()
    setup_environment(data)
    logging.basicConfig(level=logging.INFO)
    log = logging.getLogger("nitegraf")
    if not (web_dir() / "index.html").is_file():
        log.error("Не найден собранный фронтенд: %s (выполните npm run build:desktop)", web_dir())
        return 2

    server, url = start_server(args.port or free_port())
    log.info("Нитеграф работает: %s, данные — %s", url, data)
    try:
        if args.server_only:
            print(url, flush=True)
            while True:
                time.sleep(3600)
        elif args.browser:
            fallback_browser(url)
        else:
            try:
                open_window(url, data)
            except Exception:  # noqa: BLE001
                log.exception("Окно приложения не открылось — открываем в браузере")
                fallback_browser(url)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
    return 0


if __name__ == "__main__":
    code = main()
    # Окно закрыто — выходим сразу, не дожидаясь фоновых задач (расчёт маски и т. п.)
    sys.stdout and sys.stdout.flush()
    os._exit(code)
