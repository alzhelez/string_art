# Современная запись типов в любой версии Python 3
from __future__ import annotations

# Переменные окружения — подменяем путь к базе
import os
# Пути к фикстурам
from pathlib import Path

# pytest — фреймворк тестов; фикстуры — подготовка данных для тестов
import pytest

# Папка с общими тестовыми файлами (её используют тесты на всех языках)
FIXTURES = Path(__file__).resolve().parents[2] / "autotests" / "fixtures"


# Фикстура на всю сессию, включается автоматически для каждого теста
@pytest.fixture(scope="session", autouse=True)
# Отдельная временная база данных для прогона тестов
def _isolated_db(tmp_path_factory: pytest.TempPathFactory):
    """Каждый прогон — своя пустая БД, рабочая база разработчика не трогается."""
    # Временная папка pytest + файл базы
    db = tmp_path_factory.mktemp("db") / "test.db"
    # Бэкенд берёт путь к базе из этой переменной
    os.environ["STRINGART_DB"] = str(db)
    # Отдаём путь (после yield — ничего убирать не нужно: папку удалит pytest)
    yield db


# Фикстура на всю сессию — файл читается один раз
@pytest.fixture(scope="session")
# Байты тестового портрета JPEG
def portrait_jpg() -> bytes:
    # Читаем файл
    return (FIXTURES / "portrait.jpg").read_bytes()


# Та же сессионная фикстура
@pytest.fixture(scope="session")
# PNG с прозрачностью
def portrait_png() -> bytes:
    # Читаем файл
    return (FIXTURES / "portrait.png").read_bytes()


# Сессионная фикстура
@pytest.fixture(scope="session")
# Текстовый файл — для проверки «не картинка»
def not_an_image() -> bytes:
    # Читаем файл
    return (FIXTURES / "not-an-image.txt").read_bytes()


# Один тестовый клиент на всю сессию (зависит от изолированной базы)
@pytest.fixture(scope="session")
# HTTP-клиент FastAPI, работающий без сети
def client(_isolated_db):
    # Импорт внутри — после того, как подменили базу
    from fastapi.testclient import TestClient

    # Само приложение
    from app.main import app

    # with — при входе выполняется lifespan (предрасчёт линий, прогрев модели)
    with TestClient(app) as c:
        # Отдаём клиента тестам
        yield c


# Фикстура на каждый тест
@pytest.fixture()
# Свежий проект
def project(client, portrait_jpg) -> dict:
    """Свежий проект для теста; удаляется после."""
    # Создаём проект запросом
    r = client.post(
        # Адрес
        "/api/projects",
        # Файл
        files={"file": ("portrait.jpg", portrait_jpg, "image/jpeg")},
        # Название и диаметр
        data={"name": "Тестовый портрет", "diameter_cm": "50"},
    )
    # Проект создан (иначе тест сразу падает с текстом ответа)
    assert r.status_code == 201, r.text
    # Тело ответа
    data = r.json()
    # Отдаём проект тесту
    yield data
    # После теста — удаляем, чтобы тесты не влияли друг на друга
    client.delete(f"/api/projects/{data['id']}")
