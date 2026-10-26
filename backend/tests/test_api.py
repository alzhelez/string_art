"""API-тесты. Те же сценарии (TC-API-xx) реализованы на других языках в /autotests."""

import io

import pytest
from pypdf import PdfReader


def _upload(client, content, filename="portrait.jpg", mime="image/jpeg", **data):
    return client.post("/api/projects", files={"file": (filename, content, mime)}, data=data)


# TC-API-01
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# TC-API-02
def test_config(client):
    cfg = client.get("/api/config").json()
    assert cfg["sectors"] == ["A", "B", "C", "D"]
    assert cfg["nails_per_sector"] == 60 and cfg["total_nails"] == 240
    assert cfg["diameter"]["presets_cm"] == [30, 40, 50, 60, 70]
    assert cfg["speed"] == {"default_sec": 2.0, "step_sec": 0.1, "min_sec": 0.5, "max_sec": 10.0}
    assert cfg["thread"]["margin"] == 0.15
    assert cfg["lines"]["min"] == 1000 and cfg["lines"]["max"] == 5000


# TC-API-03
def test_create_project(project):
    assert len(project["id"]) == 12
    assert project["name"] == "Тестовый портрет"
    assert project["diameter_cm"] == 50
    assert project["line_count"] == 2000  # 40 линий × 50 см
    assert project["current_step"] == 1
    assert project["speed_sec"] == 2.0
    assert len(project["sequence"]) == 5001
    assert project["sequence"][0] == 0  # старт A1
    stats = project["stats"]
    assert stats["steps"] == 2000
    assert stats["total_length_m"] == pytest.approx(stats["raw_length_m"] * 1.15, rel=1e-3)
    assert stats["spool_m"] * stats["spool_count"] >= stats["total_length_m"]


# TC-API-04
def test_create_uses_filename_when_no_name(client, portrait_png):
    r = _upload(client, portrait_png, filename="Бабушка.png", mime="image/png", diameter_cm="70")
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Бабушка"
    assert body["diameter_cm"] == 70
    assert body["line_count"] == 2800
    client.delete(f"/api/projects/{body['id']}")


# TC-API-05
@pytest.mark.parametrize(
    "kwargs, status",
    [
        ({"content": b"", "filename": "empty.jpg"}, 400),
        ({"content": "not-image", "filename": "x.txt", "mime": "text/plain"}, 400),
        ({"content": "portrait", "diameter_cm": "19.9"}, 422),
        ({"content": "portrait", "diameter_cm": "150.1"}, 422),
        ({"content": "portrait", "diameter_cm": "abc"}, 422),
    ],
    ids=["empty", "not-image", "diameter-too-small", "diameter-too-big", "diameter-nan"],
)
def test_create_validation(client, portrait_jpg, not_an_image, kwargs, status):
    content = {"portrait": portrait_jpg, "not-image": not_an_image}.get(kwargs.pop("content"), b"")
    assert _upload(client, content, **kwargs).status_code == status


# TC-API-06
def test_create_without_file(client):
    assert client.post("/api/projects", data={"name": "x"}).status_code == 422


# TC-API-07
def test_list_contains_project_without_sequence(client, project):
    items = client.get("/api/projects").json()
    found = [p for p in items if p["id"] == project["id"]]
    assert len(found) == 1
    assert "sequence" not in found[0]
    assert found[0]["stats"]["steps"] == project["line_count"]


# TC-API-08
@pytest.mark.parametrize("pid", ["000000000000", "nope", "ABCDEF123456"])
def test_get_unknown_project_404(client, pid):
    assert client.get(f"/api/projects/{pid}").status_code == 404


# TC-API-09
def test_save_progress(client, project):
    pid = project["id"]
    r = client.patch(f"/api/projects/{pid}", json={"current_step": 137})
    assert r.status_code == 200
    assert client.get(f"/api/projects/{pid}").json()["current_step"] == 137


# TC-API-10
@pytest.mark.parametrize("value, saved", [(2.1, 2.1), (1.9, 1.9), (2.04999, 2.0), (0.5, 0.5), (10, 10)])
def test_speed_is_rounded_to_tenth(client, project, value, saved):
    r = client.patch(f"/api/projects/{project['id']}", json={"speed_sec": value})
    assert r.status_code == 200
    assert r.json()["speed_sec"] == saved


# TC-API-11
@pytest.mark.parametrize(
    "body",
    [
        {"speed_sec": 0.4},
        {"speed_sec": 10.1},
        {"current_step": 0},
        {"current_step": 2001},
        {"line_count": 999},
        {"line_count": 5001},
        {"diameter_cm": 10},
        {"name": ""},
        {"name": "   "},
        {"sequence": [1, 2, 3]},
    ],
)
def test_patch_validation(client, project, body):
    assert client.patch(f"/api/projects/{project['id']}", json=body).status_code == 422


# TC-API-12
def test_reducing_lines_clamps_progress(client, project):
    pid = project["id"]
    client.patch(f"/api/projects/{pid}", json={"current_step": 1900})
    body = client.patch(f"/api/projects/{pid}", json={"line_count": 1500}).json()
    assert body["line_count"] == 1500
    assert body["current_step"] == 1500
    assert body["stats"]["steps"] == 1500


# TC-API-13
def test_diameter_changes_thread_but_not_sequence(client, project):
    pid = project["id"]
    body = client.patch(f"/api/projects/{pid}", json={"diameter_cm": 100}).json()
    assert body["sequence"] == project["sequence"]
    assert body["stats"]["raw_length_m"] == pytest.approx(project["stats"]["raw_length_m"] * 2, rel=1e-3)


# TC-API-14
def test_steps_pagination_and_continuity(client, project):
    pid = project["id"]
    first = client.get(f"/api/projects/{pid}/steps", params={"offset": 0, "limit": 50}).json()
    assert first["total"] == 2000 and len(first["items"]) == 50
    items = first["items"]
    assert items[0]["number"] == 1 and items[0]["from_label"] == "A1"
    for a, b in zip(items, items[1:]):
        assert a["to_nail"] == b["from_nail"]
        assert b["thread_used_m"] > a["thread_used_m"]
    tail = client.get(f"/api/projects/{pid}/steps", params={"offset": 1990, "limit": 50}).json()
    assert [s["number"] for s in tail["items"]] == list(range(1991, 2001))


# TC-API-15
def test_preview_and_source_png(client, project):
    pid = project["id"]
    for url in (f"/api/projects/{pid}/preview.png?size=300", f"/api/projects/{pid}/source.png"):
        r = client.get(url)
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content[:4] == b"\x89PNG"
    assert client.get(f"/api/projects/{pid}/preview.png?size=50").status_code == 422


# TC-API-16
def test_pdf_instructions(client, project):
    pid = project["id"]
    client.patch(f"/api/projects/{pid}", json={"line_count": 1000})
    r = client.get(f"/api/projects/{pid}/instructions.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "attachment" in r.headers["content-disposition"]
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    reader = PdfReader(io.BytesIO(r.content))
    assert len(reader.pages) == 2 + 5  # обложка + схема + 1000/200 страниц шагов


# TC-API-17
def test_delete_project(client, portrait_jpg):
    pid = _upload(client, portrait_jpg).json()["id"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert client.delete(f"/api/projects/{pid}").status_code == 404


# TC-API-18
@pytest.mark.parametrize("d, spacing, lines", [(30, 3.93, 1200), (50, 6.54, 2000), (70, 9.16, 2800)])
def test_geometry_endpoint(client, d, spacing, lines):
    body = client.get("/api/geometry", params={"diameter_cm": d}).json()
    assert body["nail_spacing_mm"] == spacing
    assert body["recommended_lines"] == lines
