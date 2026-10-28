# PyInstaller: сборка десктопной версии в папку dist/Nitegraf (Nitegraf.exe + библиотеки).
# Запуск: pyinstaller desktop/nitegraf.spec --noconfirm   (из корня репозитория,
# предварительно: cd frontend && npm run build:desktop)
# Пути к файлам
from pathlib import Path

# Помощники PyInstaller: собрать файлы данных и все подмодули пакета
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# Корень репозитория (SPECPATH — папка этого .spec-файла, её задаёт PyInstaller)
root = Path(SPECPATH).parent
# Папка бэкенда
backend = root / "backend"
# Собранный фронтенд
web = root / "frontend" / "out"
# Фронтенд не собран — дальше нет смысла
if not (web / "index.html").is_file():
    # Остановить сборку с подсказкой
    raise SystemExit("Нет frontend/out — сначала: cd frontend && npm run build:desktop")

# Какие файлы положить в программу: (откуда, куда внутри сборки)
datas = [
    # Фронтенд → web
    (str(web), "web"),
    # Шрифты для PDF
    (str(backend / "app" / "assets"), "app/assets"),
    # Модель поиска лиц YuNet
    (str(backend / "app" / "models"), "app/models"),
]
# Файл версии есть только при сборке в GitHub Actions
if (backend / "app" / "_version.txt").is_file():  # версию пишет сборка (GitHub Actions)
    # Кладём его в app
    datas.append((str(backend / "app" / "_version.txt"), "app"))
# Скрипты pywebview для связи окна и Python
datas += collect_data_files("webview")  # JS-мост pywebview
# Файлы каскадов Хаара из OpenCV
datas += collect_data_files("cv2", includes=["data/*.xml"])  # запасной поиск лиц (Хаар)

# Модули, которые импортируются динамически, — PyInstaller сам их не найдёт
hiddenimports = collect_submodules("app") + collect_submodules("uvicorn") + [
    # Нейросеть удаления фона (импортируется внутри функции)
    "onnxruntime",
    # ReportLab подгружает этот модуль на лету
    "reportlab.graphics.barcode",
]

# Анализ: какие модули и файлы нужны программе
a = Analysis(
    # Главный скрипт
    [str(root / "desktop" / "nitegraf.py")],
    # Где искать пакет app
    pathex=[str(backend)],
    # Файлы данных
    datas=datas,
    # Скрытые импорты
    hiddenimports=hiddenimports,
    # Тяжёлые пакеты, которые не нужны, — не тащим (меньше размер установщика)
    excludes=["matplotlib", "pytest", "IPython", "jupyter", "notebook", "scipy", "skimage", "numba", "rembg"],
    # Модули упаковываются в архив
    noarchive=False,
)
# Архив Python-модулей
pyz = PYZ(a.pure)
# Исполняемый файл
exe = EXE(
    # Архив модулей
    pyz,
    # Скрипты запуска
    a.scripts,
    # Без дополнительных параметров
    [],
    # Библиотеки рядом с .exe, а не внутри (быстрее запуск)
    exclude_binaries=True,
    # Имя файла Nitegraf.exe
    name="Nitegraf",
    # Значок
    icon=str(root / "desktop" / "icon.ico"),
    # Без консоли
    console=False,  # без чёрного окна консоли; журнал — в %LOCALAPPDATA%\Nitegraf\nitegraf.log
)
# Собрать всё в папку dist/Nitegraf
coll = COLLECT(exe, a.binaries, a.datas, name="Nitegraf")
