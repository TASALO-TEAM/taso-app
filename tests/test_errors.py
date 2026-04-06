import pytest
from src.app import create_app


@pytest.fixture
def client():
    """Fixture para test client de Flask."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_404_for_nonexistent_route(client):
    """GET a ruta inexistente devuelve 404."""
    response = client.get("/nonexistent-route")
    assert response.status_code == 404
    assert b"404" in response.data
    assert b"Desaparecida" in response.data or "Desaparecida".encode("utf-8") in response.data


def test_404_for_api_route(client):
    """GET a ruta API inexistente devuelve JSON 404."""
    response = client.get("/api/v1/nonexistent")
    assert response.status_code == 404
    data = response.get_json()
    assert data["ok"] is False
    assert "error" in data


def test_error_template_has_back_link(client):
    """Template de error incluye link para volver."""
    response = client.get("/nonexistent-route")
    assert response.status_code == 404
    assert b'href="/"' in response.data
    assert b"Volver" in response.data


def test_404_has_quick_actions(client):
    """404 page includes quick action links."""
    response = client.get("/nonexistent-route")
    assert response.status_code == 404
    assert b'href="/settings"' in response.data
    assert b"Inicio" in response.data
    assert b"Ajustes" in response.data


def test_404_has_popular_pages(client):
    """404 page includes popular pages section."""
    response = client.get("/nonexistent-route")
    assert response.status_code == 404
    assert b"Paginas Populares" in response.data or "Páginas Populares".encode("utf-8") in response.data
    assert b'href="/history"' in response.data
    assert b'href="/provincias"' in response.data


def test_404_has_explanation(client):
    """404 page includes explanation of what happened."""
    response = client.get("/nonexistent-route")
    assert response.status_code == 404
    assert b"Que paso" in response.data or "¿Qué pasó?".encode("utf-8") in response.data
    assert b"no esta registrada" in response.data or "no está registrada".encode("utf-8") in response.data
