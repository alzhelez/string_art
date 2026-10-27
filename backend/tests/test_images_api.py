"""API редактора фото: TC-API-19…24."""

import io

import numpy as np
import pytest
from PIL import Image

from app import photo


@pytest.fixture()
def face_bytes():
    from .conftest import FIXTURES

    return (FIXTURES / "face.jpg").read_bytes()


@pytest.fixture()
def image(client, face_bytes):
    r = client.post("/api/images", files={"file": ("face.jpg", face_bytes, "image/jpeg")})
    assert r.status_code == 201, r.text
    return r.json()


def _create(client, image_id, **kw):
    r = client.post("/api/projects/from-image", json={"image_id": image_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()


# TC-API-19
def test_upload_image_finds_face(client, image):
    assert len(image["id"]) == 12
    assert (image["width"], image["height"]) == (512, 512)
    assert image["has_mask"] is False
    if photo.face_detection_available():
        assert len(image["faces"]) >= 1
        fp = image["face_prep"]
        assert fp["face_focus"] is True and fp["zoom"] > 1.5
    assert client.get(f"/api/images/{image['id']}").json()["id"] == image["id"]


def test_upload_image_validation(client, not_an_image):
    assert client.post("/api/images", files={"file": ("x.txt", not_an_image, "text/plain")}).status_code == 400
    assert client.get("/api/images/000000000000").status_code == 404
    assert client.get("/api/images/bad/original.jpg").status_code == 404


# TC-API-20
def test_original_and_prepared(client, image):
    r = client.get(f"/api/images/{image['id']}/original.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    base = client.get(f"/api/images/{image['id']}/prepared.png")
    bright = client.get(f"/api/images/{image['id']}/prepared.png", params={"brightness": 0.3})
    zoomed = client.get(f"/api/images/{image['id']}/prepared.png", params={"zoom": 3, "center_x": 0.43})
    for res in (base, bright, zoomed):
        assert res.status_code == 200
        assert Image.open(io.BytesIO(res.content)).size == (400, 400)
    mean = lambda res: np.asarray(Image.open(io.BytesIO(res.content))).mean()  # noqa: E731
    assert mean(bright) > mean(base) + 20
    assert mean(zoomed) != pytest.approx(mean(base), abs=1)
    assert client.get(f"/api/images/{image['id']}/prepared.png", params={"zoom": 5}).status_code == 422


# TC-API-21
def test_create_from_image_with_prep(client, image):
    prep = {"center_x": 0.45, "center_y": 0.3, "zoom": 2, "brightness": 0.1, "contrast": 0.2}
    p = _create(client, image["id"], name="Кадр", diameter_cm=60, prep=prep)
    assert p["name"] == "Кадр" and p["diameter_cm"] == 60
    assert p["line_count"] == client.get(f"/api/projects/{p['id']}/similarity").json()["best_lines"]
    assert p["image_id"] == image["id"]
    assert p["prep"] == {**prep, "remove_background": False, "face_focus": False}
    plain = _create(client, image["id"], name="Без правок")
    assert plain["sequence"] != p["sequence"]
    for pid in (p["id"], plain["id"]):
        client.delete(f"/api/projects/{pid}")


def test_create_from_image_validation(client, image):
    bad = [
        {"image_id": "000000000000"},
        {"image_id": image["id"], "prep": {"zoom": 0.5}},
        {"image_id": image["id"], "prep": {"brightness": 0.9}},
        {"image_id": image["id"], "prep": {"rotate": 90}},
        {"image_id": image["id"], "diameter_cm": 5},
    ]
    expected = [404, 422, 422, 422, 422]
    for body, status in zip(bad, expected):
        assert client.post("/api/projects/from-image", json=body).status_code == status, body


# TC-API-22
@pytest.mark.skipif(not photo.face_detection_available(), reason="OpenCV не установлен")
def test_face_focus(client, image):
    p = _create(client, image["id"], prep=image["face_prep"])
    assert p["prep"]["face_focus"] is True
    client.delete(f"/api/projects/{p['id']}")


def test_face_focus_without_face_is_422(client):
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), "white").save(buf, "PNG")
    img = client.post("/api/images", files={"file": ("blank.png", buf.getvalue(), "image/png")}).json()
    assert img["faces"] == [] and img["face_prep"] is None
    r = client.post("/api/projects/from-image", json={"image_id": img["id"], "prep": {"face_focus": True}})
    assert r.status_code == 422
    assert "лицо" in r.json()["detail"]


# TC-API-23
def test_update_photo_resets_progress(client, image):
    p = _create(client, image["id"])
    client.patch(f"/api/projects/{p['id']}", json={"current_step": 500})
    r = client.put(f"/api/projects/{p['id']}/photo", json={"zoom": 2.5, "center_x": 0.43, "center_y": 0.3})
    assert r.status_code == 200
    body = r.json()
    assert body["current_step"] == 1
    assert body["prep"]["zoom"] == 2.5
    assert body["sequence"] != p["sequence"]
    assert client.put(f"/api/projects/{p['id']}/photo", json={"zoom": 9}).status_code == 422
    assert client.put("/api/projects/000000000000/photo", json={}).status_code == 404
    client.delete(f"/api/projects/{p['id']}")


def test_legacy_upload_also_keeps_photo(client, project):
    assert project["image_id"]
    assert project["prep"]["zoom"] == 1.0


# TC-API-24
def _wait_mask(client, image_id, timeout=300):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        st = client.get(f"/api/images/{image_id}/mask").json()
        if st["status"] in ("ready", "error"):
            return st
        time.sleep(0.3)
    raise AssertionError("маска не посчиталась")


@pytest.mark.skipif(not photo.background_removal_available(), reason="onnxruntime не установлен")
def test_background_removal(client, image):
    assert client.get(f"/api/images/{image['id']}/mask.png").status_code == 409  # ещё не считали
    r = client.post(f"/api/images/{image['id']}/mask")
    assert r.status_code in (200, 202)
    assert _wait_mask(client, image["id"])["status"] == "ready"
    r = client.get(f"/api/images/{image['id']}/mask.png")
    assert r.status_code == 200
    mask = np.asarray(Image.open(io.BytesIO(r.content)))
    assert mask.shape == (512, 512)
    assert mask[250, 256] > 200  # человек в центре
    assert mask[30, 20] < 50  # флаг слева сверху — фон
    assert client.get(f"/api/images/{image['id']}").json()["has_mask"] is True
    p = _create(client, image["id"], prep={"remove_background": True})
    assert p["prep"]["remove_background"] is True
    client.delete(f"/api/projects/{p['id']}")


def test_mask_request_never_blocks(client, image, monkeypatch):
    """Регрессия: долгая модель не должна держать HTTP-запрос (прокси Next.js рвёт его через 30 с)."""
    import time

    monkeypatch.setattr(photo, "background_removal_available", lambda: True)
    monkeypatch.setattr(photo, "background_mask", lambda img, faces=None: (time.sleep(1.0), Image.new("L", img.size, 255))[1])
    t = time.time()
    r = client.post(f"/api/images/{image['id']}/mask")
    assert time.time() - t < 0.5
    assert r.status_code == 202 and r.json()["status"] == "processing"
    assert client.get(f"/api/images/{image['id']}/mask").json()["status"] == "processing"
    assert _wait_mask(client, image["id"], timeout=10)["status"] == "ready"


def test_mask_error_is_reported(client, image, monkeypatch):
    monkeypatch.setattr(photo, "background_removal_available", lambda: True)

    def boom(img, faces=None):
        raise RuntimeError("нет сети")

    monkeypatch.setattr(photo, "background_mask", boom)
    client.post(f"/api/images/{image['id']}/mask")
    st = _wait_mask(client, image["id"], timeout=10)
    assert st["status"] == "error" and "нет сети" in st["message"]


def test_background_removal_unavailable(client, image, monkeypatch):
    monkeypatch.setattr(photo, "background_removal_available", lambda: False)
    for r in (client.post(f"/api/images/{image['id']}/mask"), client.get(f"/api/images/{image['id']}/mask")):
        assert r.status_code == 503
        assert "requirements-bg.txt" in r.json()["detail"]
    cfg = client.get("/api/config").json()
    assert cfg["features"]["background_removal"] is False


def test_config_does_not_import_heavy_onnxruntime():
    """Регрессия: /api/config раньше импортировал тяжёлую библиотеку, и на Windows первый запрос шёл >30 с."""
    import subprocess
    import sys

    code = (
        "import sys; from fastapi.testclient import TestClient; from app.main import app; "
        "c = TestClient(app); assert c.get('/api/config').status_code == 200; "
        "print('onnxruntime' in sys.modules or 'rembg' in sys.modules)"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "False"


def test_delete_project_removes_unused_image(client, image):
    p = _create(client, image["id"])
    client.delete(f"/api/projects/{p['id']}")
    assert client.get(f"/api/images/{image['id']}").status_code == 404


# TC-API-27
def test_auto_tone(client, image):
    r = client.post(f"/api/images/{image['id']}/auto-tone", json={"diameter_cm": 50})
    assert r.status_code == 200, r.text
    t = r.json()
    assert -0.5 <= t["brightness"] <= 0.5 and -0.5 <= t["contrast"] <= 1.0
    assert t["score_after"] >= t["score_before"]  # хуже, чем без коррекций, не бывает
    assert t["candidates"] == 6
    assert 1000 <= t["best_lines"] <= 5000
    bad = client.post(f"/api/images/{image['id']}/auto-tone", json={"diameter_cm": 5})
    assert bad.status_code == 422
    assert client.post("/api/images/000000000000/auto-tone", json={}).status_code == 404


# TC-API-28
def test_mask_brush_edit_and_reset(client, image, monkeypatch):
    """Маска, поправленная кистью, сохраняется и идёт в расчёт; правки можно отменить."""
    monkeypatch.setattr(photo, "background_removal_available", lambda: True)
    auto = Image.new("L", (512, 512), 0)
    auto.paste(255, (156, 100, 356, 512))  # «человек» — прямоугольник по центру
    monkeypatch.setattr(photo, "background_mask", lambda img, faces=None: auto)
    iid = image["id"]
    assert client.put(f"/api/images/{iid}/mask.png", content=b"").status_code == 400
    assert client.put(f"/api/images/{iid}/mask.png", content=b"not png").status_code == 400
    client.post(f"/api/images/{iid}/mask")
    st = _wait_mask(client, iid, timeout=10)
    assert st["status"] == "ready" and st["edited"] is False

    edited = auto.copy()
    edited.paste(0, (156, 100, 356, 250))  # стёрли верх кистью
    buf = io.BytesIO()
    edited.convert("RGBA").resize((256, 256)).save(buf, "PNG")  # canvas может прислать другой размер и RGBA
    r = client.put(f"/api/images/{iid}/mask.png", content=buf.getvalue(), headers={"Content-Type": "image/png"})
    assert r.status_code == 200 and r.json()["edited"] is True
    got = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/mask.png").content)))
    assert got.shape == (512, 512) and got[180, 256] < 50 and got[400, 256] > 200
    assert client.get(f"/api/images/{iid}/mask.png").headers["cache-control"] == "no-cache"

    # правка влияет на то, что считает алгоритм: стёртая область стала белой
    prep = {"remove_background": True}
    px = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/prepared.png", params=prep).content)))
    assert px[int(180 / 512 * 400), 200] == 255

    r = client.delete(f"/api/images/{iid}/mask/edits")
    assert r.status_code == 200 and r.json()["edited"] is False
    got = np.asarray(Image.open(io.BytesIO(client.get(f"/api/images/{iid}/mask.png").content)))
    assert got[180, 256] > 200
    assert client.put("/api/images/000000000000/mask.png", content=buf.getvalue()).status_code == 404


def test_legacy_mask_is_recomputed(client, image, monkeypatch):
    """Маски старой версии (без чистки) не используются — считаются заново."""
    from app import storage

    storage.save_mask(image["id"], photo.png_bytes(Image.new("L", (512, 512), 255)))
    with storage._connect() as conn:
        conn.execute("UPDATE images SET mask_source = NULL WHERE id = ?", (image["id"],))
    assert client.get(f"/api/images/{image['id']}").json()["has_mask"] is False
    assert client.get(f"/api/images/{image['id']}/mask.png").status_code == 409
