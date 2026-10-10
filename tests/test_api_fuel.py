"""Tests de /api/fuel y de la normalización de combustible."""

import pytest

from src.services import fuel as fuel_service
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)

FUEL_PATH = "/api/v1/tasas/fuel"

FUEL = {
    "source": "fuel",
    "rates": {
        "Gas_LP": {"rate": 1800, "buy": None, "sell": None, "change": "neutral", "prev_rate": 1800},
        "Petroleo": {"rate": 520, "buy": 500, "sell": 540, "change": "up", "prev_rate": 510},
        "B-94": {"rate": "610,5", "buy": 600, "sell": 620, "change": "down", "prev_rate": 615},
        "B-83": {"rate": 400, "buy": 420, "sell": 380, "change": "raro"},  # buy > sell: se ordena
        "B-90": "basura",
        "Otro": {"rate": 1, "buy": 1, "sell": 1},  # clave desconocida: se ignora
    },
    "updated_at": "2026-10-10T15:40:00",
}


@pytest.fixture
def f(ctx):  # noqa: F811
    ctx.upstream[FUEL_PATH] = FUEL
    return ctx


# ---------- Normalización ----------

def test_items_en_el_orden_fijo_solo_claves_conocidas_y_validas(f):
    body = f.get("/api/fuel").get_json()
    assert body["ok"] is True and body["stale"] is False
    assert [i["key"] for i in body["items"]] == ["B-94", "B-83", "Petroleo", "Gas_LP"]


def test_rango_minimo_maximo_como_android(f):
    items = {i["key"]: i for i in f.get("/api/fuel").get_json()["items"]}
    assert items["B-94"] == {"key": "B-94", "min": 600.0, "max": 620.0, "change": "down"}
    assert items["Petroleo"] == {"key": "Petroleo", "min": 500.0, "max": 540.0, "change": "up"}
    # sin compra/venta usa la tasa en ambos extremos
    assert items["Gas_LP"] == {"key": "Gas_LP", "min": 1800.0, "max": 1800.0, "change": "neutral"}
    # compra > venta se intercambia; un change desconocido es neutral
    assert items["B-83"] == {"key": "B-83", "min": 380.0, "max": 420.0, "change": "neutral"}


def test_fetched_at_es_la_hora_real_con_zona(f):
    assert f.get("/api/fuel").get_json()["fetched_at"] == "2026-10-10T15:40:00+00:00"


def test_sin_updated_at_fetched_at_es_null_no_se_inventa(f):
    f.upstream[FUEL_PATH] = {"rates": FUEL["rates"]}
    body = f.get("/api/fuel").get_json()
    assert body["ok"] is True and body["fetched_at"] is None


def test_parse_item_casos_limite():
    assert fuel_service.parse_item("B-94", {"buy": 10}) == {"key": "B-94", "min": 10.0, "max": 10.0, "change": "neutral"}
    assert fuel_service.parse_item("B-94", {"sell": 12}) == {"key": "B-94", "min": 12.0, "max": 12.0, "change": "neutral"}
    assert fuel_service.parse_item("B-94", {"change": "up"}) is None
    assert fuel_service.parse_item("B-94", None) is None


# ---------- Respuestas inválidas y caché ----------

@pytest.mark.parametrize("basura", [{}, [], {"rates": "x"}, {"rates": {}}, {"rates": {"Otro": {"rate": 1}}}, {"rates": {"B-94": {}}}])
def test_respuesta_invalida_o_sin_precios_es_502(f, basura):
    f.upstream[FUEL_PATH] = basura
    r = f.get("/api/fuel")
    assert r.status_code == 502
    assert r.get_json() == {"ok": False, "error": {"code": "upstream_unavailable", "message": "No se pudo cargar el combustible"}}


def test_se_cachea_dentro_del_ttl_y_recarga_despues(f):
    f.get("/api/fuel")
    f.get("/api/fuel")
    assert f.calls["json"] == 1
    f.clock.t += 301
    f.get("/api/fuel")
    assert f.calls["json"] == 2


def test_si_taso_api_cae_sirve_lo_ultimo_con_stale(f):
    assert f.get("/api/fuel").get_json()["stale"] is False
    f.upstream[FUEL_PATH] = UpstreamError("caído")
    f.clock.t += 600
    body = f.get("/api/fuel").get_json()
    assert body["stale"] is True and body["items"][0]["key"] == "B-94"


def test_una_lectura_vacia_no_tapa_la_ultima_buena(f):
    f.get("/api/fuel")
    f.upstream[FUEL_PATH] = {"source": "fuel", "rates": {}, "updated_at": "2026-10-10T16:00:00"}
    f.clock.t += 600
    body = f.get("/api/fuel").get_json()
    assert body["stale"] is True and len(body["items"]) == 4
    assert body["fetched_at"] == "2026-10-10T15:40:00+00:00"


def test_lo_guardado_demasiado_viejo_ya_no_se_sirve(f):
    f.get("/api/fuel")
    f.upstream[FUEL_PATH] = UpstreamError("caído")
    f.clock.t += 6 * 3600 + 1
    assert f.get("/api/fuel").status_code == 502


# ---------- Seguridad ----------

def test_sin_initdata_es_401_y_no_llama_al_origen(f):
    assert f.client.get("/api/fuel").status_code == 401
    assert f.calls["json"] == 0


def test_el_error_no_filtra_detalles_internos(f):
    f.upstream[FUEL_PATH] = UpstreamError("http://localhost:8040/secreto")
    texto = f.get("/api/fuel").get_data(as_text=True)
    assert "localhost" not in texto and "8040" not in texto
