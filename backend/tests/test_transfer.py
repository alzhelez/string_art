"""Перенос портрета файлом «.nitegraf» (TC-API-33): экспорт, импорт, ошибки."""

# Буферы в памяти
import io
# Разбор файла
import json

# Массивы — проверка маски
import numpy as np
# Фикстуры и параметризация
import pytest
# Картинки
from PIL import Image

# Модули: хранилище и перенос
from app import storage, transfer

# Путь к фикстурам
from .conftest import FIXTURES


# Помощник: открыть файл проекта (байты) через API
def _import(client, data: bytes):
    # POST с файлом
    return client.post("/api/projects/import", files={"file": ("p.nitegraf", data, "application/json")})


# Портрет из одной нити с фото и маской, поправленной кистью
@pytest.fixture()
# Фикстура: портрет, после теста удаляется
def mono(client):
    # Фото с лицом
    img = client.post("/api/images", files={"file": ("face.jpg", (FIXTURES / "face.jpg").read_bytes(), "image/jpeg")}).json()
    # Маска: левая половина — человек
    mask = Image.new("L", (img["width"], img["height"]), 0)
    # Половина
    mask.paste(255, (0, 0, img["width"] // 2, img["height"]))
    # Буфер
    buf = io.BytesIO()
    # PNG
    mask.save(buf, "PNG")
    # Сохраняем маску как поправленную кистью
    assert client.put(f"/api/images/{img['id']}/mask.png", content=buf.getvalue()).status_code == 200
    # Портрет
    p = client.post("/api/projects/from-image", json={"image_id": img["id"], "name": "Мама"}).json()
    # Прогресс, скорость и своя катушка
    client.patch(f"/api/projects/{p['id']}", json={"current_step": 321, "speed_sec": 3.4, "own_spool_m": 450})
    # Время плетения за два дня
    client.post(f"/api/projects/{p['id']}/activity", json={"date": "2026-10-27", "seconds": 120, "steps": 30})
    # Второй день
    client.post(f"/api/projects/{p['id']}/activity", json={"date": "2026-10-28", "seconds": 60, "steps": 12})
    # Отдаём свежий проект
    yield client.get(f"/api/projects/{p['id']}").json()
    # Удаляем
    client.delete(f"/api/projects/{p['id']}")


# Экспорт: имя файла, формат, всё содержимое на месте
def test_export_file(client, mono):
    # Скачиваем
    r = client.get(f"/api/projects/{mono['id']}/export")
    # JSON-вложение
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    # Имя файла по-русски с расширением .nitegraf
    assert "attachment" in r.headers["content-disposition"] and "%D0%9C%D0%B0%D0%BC%D0%B0.nitegraf" in r.headers["content-disposition"]
    # Содержимое
    data = r.json()
    # Формат и версия
    assert data["format"] == "nitegraf" and data["version"] == transfer.VERSION
    # Прогресс и настройки
    assert data["project"]["current_step"] == 321 and data["project"]["speed_sec"] == 3.4 and data["project"]["own_spool_m"] == 450
    # Учёт времени как в базе
    assert data["project"]["activity"] == {"2026-10-27": [120.0, 30], "2026-10-28": [60.0, 12]}
    # Фото и маска с отметкой «поправлена кистью»
    assert data["image"]["mask_source"] == "edited" and data["image"]["original_jpeg"] and data["image"]["mask_png"]
    # Русские буквы без \\u-экранирования — файл читается блокнотом
    assert "Мама" in r.content.decode("utf-8")


# Импорт: новый портрет с тем же прогрессом, своим фото и маской
def test_roundtrip_mono(client, mono):
    # Экспорт
    file = client.get(f"/api/projects/{mono['id']}/export").content
    # Импорт
    r = _import(client, file)
    # Создан
    assert r.status_code == 201, r.text
    # Новый портрет
    copy = r.json()
    # Блок с уборкой
    try:
        # Новый id и своё фото
        assert copy["id"] != mono["id"] and copy["image_id"] and copy["image_id"] != mono["image_id"]
        # Те же поля
        for key in ("name", "diameter_cm", "line_count", "current_step", "speed_sec", "own_spool_m", "sequence", "prep", "mode"):
            # Совпадают
            assert copy[key] == mono[key], key
        # Учёт времени тот же
        assert copy["activity"] == mono["activity"]
        # Маска перенесена и осталась «поправленной кистью»
        status = client.get(f"/api/images/{copy['image_id']}/mask").json()
        # Готова, поправлена
        assert status["status"] == "ready" and status["edited"] is True
        # Левая половина маски — человек
        mask = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{copy['image_id']}/mask.png").content)))
        # Проверка
        assert mask[:, :10].min() == 255 and mask[:, -10:].max() == 0
        # «Изменить фото» работает и у копии
        assert client.put(f"/api/projects/{copy['id']}/photo", json={"zoom": 1.5}).status_code == 200
    # В любом случае —
    finally:
        # — удаляем копию
        client.delete(f"/api/projects/{copy['id']}")


# Цветной портрет: все нити, их прогресс и текущая нить
def test_roundtrip_layers(client):
    # Фото
    img = client.post("/api/images", files={"file": ("face.jpg", (FIXTURES / "face.jpg").read_bytes(), "image/jpeg")}).json()
    # Портрет из двух нитей
    p = client.post("/api/projects/from-image", json={"image_id": img["id"], "mode": "color", "colors": ["red", "black"], "board": "beige"}).json()
    # Прогресс второй нити и текущая нить
    client.patch(f"/api/projects/{p['id']}", json={"layer": 1, "current_step": 42, "current_layer": 1})
    # Экспорт и импорт
    copy = _import(client, client.get(f"/api/projects/{p['id']}/export").content).json()
    # Блок с уборкой
    try:
        # Режим, доска, текущая нить
        assert (copy["mode"], copy["board"]["key"], copy["current_layer"]) == ("color", "beige", 1)
        # Нити те же, с прогрессом
        assert [(l["color"], l["line_count"], l["current_step"], l["sequence"]) for l in copy["layers"]] == [
            # Ожидание — из исходного проекта
            (l["color"], l["line_count"], 42 if i == 1 else 1, l["sequence"]) for i, l in enumerate(p["layers"])
        ]
        # Исходник цветной
        assert Image.open(io.BytesIO(client.get(f"/api/projects/{copy['id']}/source.png").content)).mode == "RGB"
    # В любом случае —
    finally:
        # — удаляем оба
        for pid in (p["id"], copy["id"]):
            # Удаление
            client.delete(f"/api/projects/{pid}")


# Старый портрет без исходного фото переносится, но без «Изменить фото»
def test_roundtrip_without_image(client):
    # Последовательность из 1001 гвоздя
    seq = [0] + [i % 240 for i in range(17, 17 * 1001, 17)][:1000]
    # Буфер для «подготовленного фото»
    buf = io.BytesIO()
    # Белая картинка 400×400
    Image.new("L", (400, 400), 255).save(buf, "PNG")
    # Портрет без фото прямо в хранилище
    p = storage.create_project(name="Старый", diameter_cm=40, line_count=1000, speed_sec=2.0, sequence=seq, source_png=buf.getvalue())
    # Экспорт
    data = client.get(f"/api/projects/{p['id']}/export").json()
    # Фото нет
    assert data["image"] is None
    # Импорт
    copy = _import(client, json.dumps(data).encode()).json()
    # Блок с уборкой
    try:
        # Без фото, схема та же
        assert copy["image_id"] is None and copy["sequence"] == seq
    # В любом случае —
    finally:
        # — удаляем оба
        for pid in (p["id"], copy["id"]):
            # Удаление
            client.delete(f"/api/projects/{pid}")


# Экспорт неизвестного проекта → 404
def test_export_unknown(client):
    # Нет такого
    assert client.get("/api/projects/000000000000/export").status_code == 404


# Испорченный файл: что поменять и какой ответ
@pytest.mark.parametrize(
    # Как портим и ожидаемый статус
    "spoil, status",
    # Случаи
    [
        # Номер гвоздя вне круга
        (lambda d: d["project"].update(sequence=[0, 999]), 422),
        # Файл из будущей версии
        (lambda d: d.update(version=99), 422),
        # Неизвестная доска
        (lambda d: d["project"].update(board="rainbow"), 422),
        # Одна нить, но в файле есть «слои»
        (lambda d: d["project"].update(layers=[{"color": "black", "sequence": [0, 120], "line_count": 1}]), 422),
        # Линий больше, чем в схеме
        (lambda d: d["project"].update(line_count=5000, sequence=[0, 120, 0]), 422),
        # Испорченный base64
        (lambda d: d.update(source_png="@@@"), 422),
        # Не картинка внутри
        (lambda d: d.update(source_png="aGVsbG8="), 422),
        # Испорченный учёт времени
        (lambda d: d["project"].update(activity={"вчера": [1, 1]}), 422),
        # Лишнее поле
        (lambda d: d.update(extra=1), 422),
        # Другой формат
        (lambda d: d.update(format="other"), 400),
    ],
)
# Каждая порча — понятная ошибка, а не 500
def test_import_rejects_broken(client, mono, spoil, status):
    # Экспорт
    data = client.get(f"/api/projects/{mono['id']}/export").json()
    # Портим
    spoil(data)
    # Импорт
    r = _import(client, json.dumps(data).encode())
    # Статус как ожидали, текст понятный
    assert r.status_code == status and r.json()["detail"]


# Не JSON вовсе → 400, слишком большой → 413
def test_import_not_json_and_too_big(client, monkeypatch):
    # Текст
    assert _import(client, b"hello").status_code == 400
    # Байты не UTF-8
    assert _import(client, b"\xff\xfe\x00").status_code == 400
    # JSON, но не объект
    assert _import(client, b"[1, 2]").status_code == 400
    # Лимит 10 байт
    monkeypatch.setattr(transfer, "MAX_FILE_BYTES", 10)
    # Больше лимита
    assert _import(client, b'{"format": "nitegraf"}').status_code == 413
