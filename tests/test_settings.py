import pytest
from src.app import create_app


@pytest.fixture
def client():
    """Fixture para test client de Flask."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_settings_endpoint_returns_html(client):
    """GET /settings devuelve HTML con título Configuración."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"Configuraci" in response.data  # Configuración
    assert b"settings.html" not in response.data  # Template se renderiza


def test_settings_has_theme_selector(client):
    """GET /settings incluye selector de tema."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"name=\"theme\"" in response.data


def test_settings_has_refresh_interval_selector(client):
    """GET /settings incluye selector de intervalo de refresh."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"id=\"refresh-interval\"" in response.data


def test_settings_has_save_button(client):
    """GET /settings incluye botón de guardar."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"id=\"save-settings\"" in response.data


def test_settings_has_back_navigation(client):
    """GET /settings incluye navegación de regreso."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"href=\"/\"" in response.data


def test_settings_has_theme_options(client):
    """GET /settings incluye las 3 opciones de tema."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"value=\"light\"" in response.data
    assert b"value=\"dark\"" in response.data
    assert b"value=\"auto\"" in response.data


def test_settings_has_refresh_options(client):
    """GET /settings incluye las 3 opciones de refresh."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"value=\"30000\"" in response.data
    assert b"value=\"60000\"" in response.data
    assert b"value=\"120000\"" in response.data
