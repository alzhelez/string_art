from __future__ import annotations

import os
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "autotests" / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def _isolated_db(tmp_path_factory: pytest.TempPathFactory):
    """Каждый прогон — своя пустая БД, рабочая база разработчика не трогается."""
    db = tmp_path_factory.mktemp("db") / "test.db"
    os.environ["STRINGART_DB"] = str(db)
    yield db


@pytest.fixture(scope="session")
def portrait_jpg() -> bytes:
    return (FIXTURES / "portrait.jpg").read_bytes()


@pytest.fixture(scope="session")
def portrait_png() -> bytes:
    return (FIXTURES / "portrait.png").read_bytes()


@pytest.fixture(scope="session")
def not_an_image() -> bytes:
    return (FIXTURES / "not-an-image.txt").read_bytes()


@pytest.fixture(scope="session")
def client(_isolated_db):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def project(client, portrait_jpg) -> dict:
    """Свежий проект для теста; удаляется после."""
    r = client.post(
        "/api/projects",
        files={"file": ("portrait.jpg", portrait_jpg, "image/jpeg")},
        data={"name": "Тестовый портрет", "diameter_cm": "50"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    yield data
    client.delete(f"/api/projects/{data['id']}")
