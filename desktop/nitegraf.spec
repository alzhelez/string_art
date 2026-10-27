# PyInstaller: сборка десктопной версии в папку dist/Nitegraf (Nitegraf.exe + библиотеки).
# Запуск: pyinstaller desktop/nitegraf.spec --noconfirm   (из корня репозитория,
# предварительно: cd frontend && npm run build:desktop)
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).parent
backend = root / "backend"
web = root / "frontend" / "out"
if not (web / "index.html").is_file():
    raise SystemExit("Нет frontend/out — сначала: cd frontend && npm run build:desktop")

datas = [
    (str(web), "web"),
    (str(backend / "app" / "assets"), "app/assets"),
    (str(backend / "app" / "models"), "app/models"),
]
datas += collect_data_files("webview")  # JS-мост pywebview
datas += collect_data_files("cv2", includes=["data/*.xml"])  # запасной поиск лиц (Хаар)

hiddenimports = collect_submodules("app") + collect_submodules("uvicorn") + [
    "onnxruntime",
    "reportlab.graphics.barcode",
]

a = Analysis(
    [str(root / "desktop" / "nitegraf.py")],
    pathex=[str(backend)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["matplotlib", "pytest", "IPython", "jupyter", "notebook", "scipy", "skimage", "numba", "rembg"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Nitegraf",
    icon=str(root / "desktop" / "icon.ico"),
    console=False,  # без чёрного окна консоли; журнал — в %LOCALAPPDATA%\Nitegraf\nitegraf.log
)
coll = COLLECT(exe, a.binaries, a.datas, name="Nitegraf")
