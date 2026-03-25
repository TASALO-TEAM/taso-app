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


def test_index_includes_js_script(client):
    """GET / incluye referencia al archivo app.js."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"app.js" in response.data
    assert b"refresh-btn" in response.data


def test_index_has_loading_and_error_states(client):
    """GET / incluye estados de loading y error."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"id=\"loading\"" in response.data
    assert b"id=\"error\"" in response.data
    assert b"id=\"rates-container\"" in response.data


def test_index_has_api_url_injected(client):
    """GET / inyecta TASALO_API_URL como variable JS."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"window.TASALO_API_URL" in response.data


def test_history_has_chart_canvas(client):
    """GET /history incluye canvas para Chart.js."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"id=\"history-chart\"" in response.data


def test_history_has_currency_selector(client):
    """GET /history incluye selector de moneda."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"id=\"currency-select\"" in response.data


def test_history_has_days_selector(client):
    """GET /history incluye selector de días."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"id=\"days-select\"" in response.data


def test_history_has_update_button(client):
    """GET /history incluye botón de actualizar."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"id=\"update-chart\"" in response.data


def test_history_has_back_navigation(client):
    """GET /history incluye navegación de regreso."""
    response = client.get("/history")
    assert response.status_code == 200
    assert b"href=\"/\"" in response.data


def test_provincias_endpoint_returns_html(client):
    """GET /provincias devuelve HTML con lista de provincias."""
    response = client.get("/provincias")
    assert response.status_code == 200
    assert b"Provincias" in response.data
    assert b"provincias.html" not in response.data  # Template se renderiza


def test_provincias_has_source_selector(client):
    """GET /provincias incluye selector de fuente."""
    response = client.get("/provincias")
    assert response.status_code == 200
    assert b"id=\"source-select\"" in response.data


def test_provincias_has_provincia_cards_container(client):
    """GET /provincias incluye contenedor de tarjetas."""
    response = client.get("/provincias")
    assert response.status_code == 200
    assert b"id=\"provincias-container\"" in response.data


def test_provincias_has_back_navigation(client):
    """GET /provincias incluye navegación de regreso."""
    response = client.get("/provincias")
    assert response.status_code == 200
    assert b"href=\"/\"" in response.data


def test_index_has_ticker_container(client):
    """GET / incluye contenedor del Binance ticker."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"id=\"tickerContainer\"" in response.data
    assert b"Binance Top 10" in response.data


def test_index_has_horizontal_cards_container(client):
    """GET / incluye contenedor de tarjetas horizontales."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"id=\"horizontalRatesContainer\"" in response.data


def test_settings_has_display_preferences(client):
    """GET /settings incluye sección de Display Preferences."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"Display Preferences" in response.data
    assert b"Layout Mode" in response.data
    assert b"Horizontal Cards" in response.data


def test_settings_has_card_size_option(client):
    """GET /settings incluye opción de Card Size."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"Card Size" in response.data
    assert b"Compact" in response.data
    assert b"Standard" in response.data
    assert b"Wide" in response.data


def test_settings_has_ticker_options(client):
    """GET /settings incluye opciones del ticker."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"Show Binance Ticker" in response.data
    assert b"Ticker Speed" in response.data
    assert b"Ticker Currencies" in response.data


def test_settings_has_show_flags_option(client):
    """GET /settings incluye opción de mostrar banderas."""
    response = client.get("/settings")
    assert response.status_code == 200
    assert b"Show Flags on Cards" in response.data
