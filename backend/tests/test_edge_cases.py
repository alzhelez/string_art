"""Крайние случаи, которые раньше не проверялись: запасной поиск лица, скачивание модели,
ошибки загрузки модели, лимиты API и десктопная раздача файлов."""

# io.BytesIO — картинки и «скачиваемые» данные в памяти
import io
# sys.modules — чтобы изобразить отсутствие OpenCV
import sys

# numpy — читаем пиксели масок
import numpy as np
# pytest — пропуски, raises, monkeypatch
import pytest
# Pillow — тестовые картинки
from PIL import Image

# Модули настроек, фото и хранилища
from app import config, photo, storage


# Помощник: PNG нужного размера и цвета в байтах
def _png(size=(64, 48), color="white") -> bytes:
    # Буфер в памяти
    buf = io.BytesIO()
    # Рисуем однотонную картинку и сохраняем как PNG
    Image.new("RGB", size, color).save(buf, format="PNG")
    # Отдаём байты
    return buf.getvalue()


# Раздел: поиск лица
# --- поиск лица ---------------------------------------------------------------
# Если основной детектор YuNet недоступен, лицо находят каскады Хаара
def test_haar_fallback_finds_face_when_yunet_unavailable(monkeypatch):
    # Без OpenCV —
    if not photo.face_detection_available():
        # — пропускаем
        pytest.skip("нет OpenCV")
    # Путь к фикстурам
    from .conftest import FIXTURES

    # Фото астронавта в том виде, как после загрузки
    img = photo.normalize_original(Image.open(FIXTURES / "face.jpg"))
    # Лицо, найденное основным детектором — эталон
    yunet = photo.detect_faces(img)[0]
    # «Ломаем» YuNet: он ничего не возвращает
    monkeypatch.setattr(photo, "_detect_yunet", lambda _img: None)
    # Ищем снова — теперь работает запасной детектор
    faces = photo.detect_faces(img)
    # Лицо найдено
    assert len(faces) >= 1
    # Первое лицо запасного детектора
    haar = faces[0]
    # Запасной детектор находит то же лицо: центры рядом, высота сопоставима
    # Центры по горизонтали отличаются меньше чем на 5 % кадра
    assert abs((haar.x + haar.w / 2) - (yunet.x + yunet.w / 2)) < 0.05
    # По вертикали — меньше чем на 6 %
    assert abs((haar.y + haar.h / 2) - (yunet.y + yunet.h / 2)) < 0.06
    # Высоты отличаются не больше чем в 1,4 раза
    assert 0.7 < haar.h / yunet.h < 1.4


# Ошибка OpenCV при создании YuNet не роняет программу
def test_yunet_error_switches_to_haar(monkeypatch):
    # Без OpenCV —
    if not photo.face_detection_available():
        # — пропускаем
        pytest.skip("нет OpenCV")
    # Сам OpenCV — чтобы подменить в нём функцию
    import cv2

    # Подменная функция всегда падает с ошибкой OpenCV
    def broken(*_a, **_kw):
        # Как бывает при несовместимой версии модели
        raise cv2.error("модель не подходит к этой версии OpenCV")

    # Ставим её вместо создания детектора
    monkeypatch.setattr(cv2.FaceDetectorYN, "create", broken)
    # YuNet сообщает «нет результата», а не падает
    assert photo._detect_yunet(Image.new("RGB", (300, 300), "white")) is None
    # detect_faces при этом не падает, а уходит в каскады Хаара
    # Общий поиск лица тоже не падает
    assert photo.detect_faces(Image.new("RGB", (300, 300), "white")) == []


# Без OpenCV лиц просто нет — без ошибок
def test_no_opencv_means_no_faces(monkeypatch):
    # Сбрасываем запомненный ответ «OpenCV есть?»
    photo.face_detection_available.cache_clear()
    # None в sys.modules — import cv2 падает с ImportError
    monkeypatch.setitem(sys.modules, "cv2", None)  # import cv2 → ImportError
    # Блок, после которого всё вернём как было
    try:
        # Поиск лица сообщает «недоступен»
        assert photo.face_detection_available() is False
        # И возвращает пустой список
        assert photo.detect_faces(Image.new("RGB", (100, 100))) == []
    # В любом случае —
    finally:
        # — возвращаем cv2
        monkeypatch.undo()
        # — и снова сбрасываем запомненный ответ
        photo.face_detection_available.cache_clear()


# Раздел: модель удаления фона
# --- модель удаления фона -------------------------------------------------------
# Подделка ответа urllib для «скачивания» без интернета
class _FakeResponse:
    # Данные и наличие заголовка с длиной
    def __init__(self, data: bytes, length: bool = True):
        # Отдаём данные из буфера в памяти
        self._buf = io.BytesIO(data)
        # Заголовок Content-Length — только если попросили
        self.headers = {"Content-Length": str(len(data))} if length else {}

    # Чтение очередного куска
    def read(self, n):
        # Берём n байт из буфера
        return self._buf.read(n)

    # Поддержка with … as
    def __enter__(self):
        # Возвращаем себя
        return self

    # Выход из with
    def __exit__(self, *exc):
        # Ошибки не глушим
        return False


# Скачивание модели: прогресс растёт, файл переименовывается из .part
def test_model_download_reports_progress_and_renames(tmp_path, monkeypatch):
    # Модуль, в котором подменяем urlopen
    import urllib.request

    # Папка моделей — временная
    monkeypatch.setenv("STRINGART_MODELS_DIR", str(tmp_path))
    # Минимальный размер модели — 1000 байт
    monkeypatch.setattr(photo, "MODEL_MIN_BYTES", 1000)
    # Сюда записываем прогресс после каждого куска
    seen = []
    # Новый движок удаления фона
    engine = photo.BackgroundEngine()

    # Подделка, которая запоминает прогресс
    class Tracking(_FakeResponse):
        # При чтении очередного куска —
        def read(self, n):
            # — читаем
            chunk = super().read(n)
            # — запоминаем текущий прогресс
            seen.append(engine.progress)
            # — отдаём кусок
            return chunk

    # «Скачивание» отдаёт 3 000 000 байт
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_kw: Tracking(b"m" * 3_000_000))
    # Скачиваем
    path = engine._download()
    # Файл на месте и нужного размера
    assert path == tmp_path / photo.MODEL_FILE and path.stat().st_size == 3_000_000
    # Временного .part не осталось
    assert not (tmp_path / "u2net_human_seg.part").exists()
    # Прогресс рос по кускам по 1 МБ и обнулился после скачивания
    # Прогресс: 35 %, 70 %, 100 % — по кускам в 1 МБ
    assert [round(p, 2) for p in seen if p is not None] == [0.35, 0.7, 1.0]
    # После скачивания прогресса нет
    assert engine.progress is None


# Недокачанная модель удаляется
def test_truncated_download_is_deleted(tmp_path, monkeypatch):
    # Модуль с urlopen
    import urllib.request

    # Временная папка
    monkeypatch.setenv("STRINGART_MODELS_DIR", str(tmp_path))
    # Минимум 1000 байт
    monkeypatch.setattr(photo, "MODEL_MIN_BYTES", 1000)
    # «Скачивание» отдаёт 10 байт без заголовка длины
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_kw: _FakeResponse(b"x" * 10, length=False))
    # Новый движок
    engine = photo.BackgroundEngine()
    # Ошибка «скачано не полностью»
    with pytest.raises(RuntimeError, match="не полностью"):
        # Скачиваем
        engine._download()
    # Папка пустая — обрывок удалён
    assert list(tmp_path.iterdir()) == []


# Ошибка загрузки модели видна в статусе и при расчёте маски
def test_engine_load_error_is_reported(monkeypatch):
    # Нужен onnxruntime, иначе пропускаем
    pytest.importorskip("onnxruntime")
    # Новый движок
    engine = photo.BackgroundEngine()
    # Модели на диске нет
    monkeypatch.setattr(photo, "find_model", lambda: None)

    # Скачивание падает —
    def no_internet(self):
        # — «нет сети»
        raise OSError("нет сети")

    # Подменяем скачивание
    monkeypatch.setattr(photo.BackgroundEngine, "_download", no_internet)
    # Запускаем загрузку модели в фоне
    engine.warm_up()
    # Ждём окончания до 10 с
    engine._ready.wait(10)
    # Статус «ошибка» с текстом причины
    assert engine.state == "error" and "нет сети" in engine.error
    # Расчёт маски тоже сообщает причину
    with pytest.raises(RuntimeError, match="нет сети"):
        # Пробуем посчитать маску
        engine.mask(Image.new("RGB", (10, 10)))


# Без onnxruntime движок не пытается что-то загрузить
def test_engine_without_onnxruntime_stays_idle(monkeypatch):
    # Делаем вид, что onnxruntime нет
    monkeypatch.setattr(photo, "background_removal_available", lambda: False)
    # Новый движок
    engine = photo.BackgroundEngine()
    # Пробуем прогреть
    engine.warm_up()
    # Остался «ожидающим»
    assert engine.state == "idle"
    # Статус: не установлен, без ошибки и прогресса
    assert engine.status() == {"installed": False, "state": "idle", "error": None, "progress": None}


# Одинаковые задачи не повторяются, а упавшие — перезапускаются
def test_submit_reuses_running_job_and_retries_failed():
    # Новый движок
    engine = photo.BackgroundEngine()
    # Задача с ключом «k»
    first = engine.submit("k", lambda: 1)
    # Выполнилась
    assert first.result() == 1
    # Повтор с тем же ключом возвращает ту же задачу
    assert engine.submit("k", lambda: 2) is first  # успешная задача не повторяется
    # Задача, которая упадёт
    failed = engine.submit("e", lambda: 1 / 0)
    # Её результат —
    with pytest.raises(ZeroDivisionError):
        # — ошибка деления на ноль
        failed.result()
    # Повтор упавшей задачи запускает новую
    retried = engine.submit("e", lambda: 3)
    # Новая задача выполнилась
    assert retried is not failed and retried.result() == 3


# Раздел: лимиты и ошибки API
# --- API: лимиты и ошибки -------------------------------------------------------
# Слишком большой файл → 413 с понятным текстом
def test_upload_too_large_is_413(client, monkeypatch):
    # Лимит 100 байт для теста
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 100)
    # Отправляем 200 байт
    r = client.post("/api/images", files={"file": ("big.png", b"0" * 200, "image/png")})
    # 413, текст называет настоящий лимит
    assert r.status_code == 413 and "15 МБ" in r.json()["detail"]


# Название из одних пробелов → 422
def test_blank_name_after_trim_is_422(client, project):
    # Отправляем пробелы
    r = client.patch(f"/api/projects/{project['id']}", json={"name": "   "})
    # 422 и понятный текст
    assert r.status_code == 422 and r.json()["detail"] == "Название не может быть пустым"


# «Автонастройка» с «Выделить лицо» на фото без лица → 422
def test_auto_tone_face_focus_without_face_is_422(client):
    # Загружаем белую картинку
    r = client.post("/api/images", files={"file": ("blank.png", _png((300, 300)), "image/png")})
    # Лиц нет
    assert r.status_code == 201 and r.json()["faces"] == []
    # Просим автонастройку с лицом
    r2 = client.post(f"/api/images/{r.json()['id']}/auto-tone", json={"prep": {"face_focus": True}})
    # 422, текст про лицо
    assert r2.status_code == 422 and "лицо" in r2.json()["detail"]


# Маска того же размера сохраняется без изменений
def test_mask_upload_same_size_is_kept(client):
    # Загружаем картинку 80×60
    img = client.post("/api/images", files={"file": ("w.png", _png((80, 60)), "image/png")}).json()
    # Маска: всё фон —
    mask = Image.new("L", (80, 60), 0)
    # — кроме левой половины
    mask.paste(255, (0, 0, 40, 60))
    # Буфер
    buf = io.BytesIO()
    # Сохраняем маску как PNG
    mask.save(buf, format="PNG")
    # Отправляем
    r = client.put(f"/api/images/{img['id']}/mask.png", content=buf.getvalue())
    # 200, отметка «исправлено»
    assert r.status_code == 200 and r.json()["edited"] is True
    # Скачиваем сохранённую
    saved = Image.open(io.BytesIO(client.get(f"/api/images/{img['id']}/mask.png").content))
    # Размер тот же
    assert saved.size == (80, 60)
    # Как массив
    arr = np.asarray(saved)
    # Левая половина — человек, правая — фон, без размытия
    assert arr[:, :40].min() == 255 and arr[:, 40:].max() == 0


# Слишком большая маска → 413
def test_mask_upload_too_big_is_413(client, monkeypatch):
    # Модуль приложения — там лимит
    from app import main

    # Загружаем картинку
    img = client.post("/api/images", files={"file": ("w.png", _png(), "image/png")}).json()
    # Лимит маски 10 байт
    monkeypatch.setattr(main, "MAX_MASK_BYTES", 10)
    # Любая PNG больше лимита → 413
    assert client.put(f"/api/images/{img['id']}/mask.png", content=_png()).status_code == 413


# Проект без исходного фото нельзя перекадрировать
def test_update_photo_without_original_is_409(client):
    # Последовательность из 1001 гвоздя
    seq = [0] + [i % 240 for i in range(17, 17 * 1001, 17)][:1000]
    # Создаём проект напрямую в хранилище, без фото — как в старых базах
    p = storage.create_project(
        # Параметры проекта
        name="Старый проект", diameter_cm=50, line_count=1000, speed_sec=2.0, sequence=seq, source_png=_png()
    )
    # Блок с уборкой в конце
    try:
        # Пытаемся перекадрировать
        r = client.put(f"/api/projects/{p['id']}/photo", json={})
        # 409 и понятный текст
        assert r.status_code == 409 and "исходное фото" in r.json()["detail"]
    # В любом случае —
    finally:
        # — удаляем проект
        storage.delete_project(p["id"])


# Страница /api со ссылкой на документацию
def test_api_index_page(client):
    # Запрашиваем
    r = client.get("/api")
    # 200 и ссылка на /docs
    assert r.status_code == 200 and "/docs" in r.text


# Раздел: десктопная версия
# --- десктопная версия ----------------------------------------------------------
# Своя иконка и обычный 404 без страницы 404.html
def test_desktop_favicon_and_plain_404(client, tmp_path, monkeypatch):
    # Главная собранного сайта
    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    # Иконка
    (tmp_path / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")
    # Включаем раздачу сайта
    monkeypatch.setenv("STRINGART_STATIC_DIR", str(tmp_path))
    # Запрашиваем иконку
    r = client.get("/favicon.ico")
    # Отдаётся наш файл
    assert r.status_code == 200 and r.content == b"\x00\x00\x01\x00"
    # Нет 404.html в сборке — обычный JSON-ответ 404
    # Несуществующая страница
    r = client.get("/no-such-page")
    # JSON 404
    assert r.status_code == 404 and r.json()["detail"] == "Не найдено"
    # Неизвестный адрес API в десктопной версии не превращается в страницу
    # Неизвестный адрес API — тоже 404
    assert client.get("/api/no-such-endpoint").status_code == 404
