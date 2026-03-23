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
    assert b"Error 404" in response.data


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
