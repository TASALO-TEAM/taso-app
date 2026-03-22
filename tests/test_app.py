import pytest
from src.app import create_app


@pytest.fixture
def client():
    """Fixture para test client de Flask."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_health_endpoint(client):
    """GET /health devuelve {"ok": true}."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True


def test_index_endpoint_returns_html(client):
    """GET / devuelve HTML con título TASALO."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"TASALO" in response.data
    assert b"index.html" not in response.data  # Template se renderiza


def test_history_endpoint_returns_html(client):
    """GET /history devuelve HTML con título Historial."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"Historial" in response.data
