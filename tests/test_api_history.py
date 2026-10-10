"""Tests de los endpoints /api/history/summary y /api/history/daily y de su normalización."""

import pytest

from src.services import history as history_service
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)

SUMMARY_PATH = "/api/v1/tasas/history/summary?days=30"
DAILY_USD = "/api/v1/tasas/history/daily?source=eltoque&currency=USD&days=180"

SUMMARY = {
    "ok": True,
    "tz": "America/Havana",
    "days": 30,
    "data": {
        "eltoque": {
            "USD": [{"date": "2026-10-09", "rate": 520}, {"date": "2026-10-08", "rate": "515,5"}],
            "CUP": [{"date": "2026-10-09", "rate": 1}],
            "EUR": [],
        },
        "binance": {"BTC": [{"date": "2026-10-09", "rate": 1}]},
        "qvapay": {"CUP": [{"date": "2026-10-09", "rate": 480}]},
    },
}
DAILY = {
    "ok": True,
    "source": "eltoque",
    "currency": "USD",
    "days": 180,
    "data": [
        {"date": "2026-10-09", "rate": 520},
        {"date": "2026-10-07T00:00:00", "rate": 510},
        {"date": "2026-10-07", "rate": 511},
        {"date": "no-es-fecha", "rate": 500},
        {"date": "2026-10-06", "rate": 0},
        {"date": "2026-10-05", "rate": None},
        "basura",
    ],
}


@pytest.fixture
def h(ctx):  # noqa: F811
    ctx.upstream[SUMMARY_PATH] = SUMMARY
    ctx.upstream[DAILY_USD] = DAILY
    return ctx


# ---------- Normalización ----------

def test_summary_solo_4_fuentes_ordena_y_descarta_lo_invalido(h):
    body = h.get("/api/history/summary").get_json()
    assert body["ok"] is True and body["stale"] is False and body["days"] == 30
    sources = body["sources"]
    assert set(sources) == {"eltoque", "qvapay", "bcc", "cadeca"}
    assert sources["eltoque"]["USD"] == [{"date": "2026-10-08", "rate": 515.5}, {"date": "2026-10-09", "rate": 520.0}]
    assert "CUP" not in sources["eltoque"] and "EUR" not in sources["eltoque"]
    assert sources["qvapay"]["CUP"] == [{"date": "2026-10-09", "rate": 480.0}]
    assert sources["bcc"] == {} and sources["cadeca"] == {}


def test_daily_valida_fechas_precios_y_duplicados(h):
    body = h.get("/api/history/daily?source=eltoque&currency=usd&days=180").get_json()
    assert body["ok"] is True and body["source"] == "eltoque" and body["currency"] == "USD" and body["days"] == 180
    assert body["points"] == [{"date": "2026-10-07", "rate": 511.0}, {"date": "2026-10-09", "rate": 520.0}]


# ---------- Validación de parámetros ----------

@pytest.mark.parametrize(
    "query",
    [
        "source=binance&currency=USD&days=180",
        "source=otra&currency=USD&days=180",
        "currency=USD&days=180",
        "source=eltoque&currency=&days=180",
        "source=eltoque&currency=US%20D&days=180",
        "source=eltoque&currency=" + "A" * 17 + "&days=180",
        "source=eltoque&currency=USD&days=0",
        "source=eltoque&currency=USD&days=45",
        "source=eltoque&currency=USD&days=abc",
        "source=eltoque&currency=USD&days=-5",
    ],
)
def test_daily_parametros_invalidos_son_400_y_no_llaman_al_origen(h, query):
    r = h.get("/api/history/daily?" + query)
    assert r.status_code == 400
    assert r.get_json()["error"]["code"] == "bad_request"
    assert h.calls["json"] == 0


def test_daily_dias_por_defecto_180(h):
    assert h.get("/api/history/daily?source=eltoque&currency=USD").get_json()["days"] == 180


# ---------- Autenticación, caché y fallos ----------

@pytest.mark.parametrize("path", ["/api/history/summary", "/api/history/daily?source=eltoque&currency=USD"])
def test_historial_sin_initdata_es_401(h, path):
    assert h.client.get(path).status_code == 401
    assert h.calls["json"] == 0


def test_summary_se_cachea_y_sirve_lo_ultimo_si_el_origen_cae(h):
    h.get("/api/history/summary")
    h.get("/api/history/summary")
    assert h.calls["json"] == 1
    h.upstream[SUMMARY_PATH] = UpstreamError("caído")
    h.clock.t += 700
    r = h.get("/api/history/summary")
    assert r.status_code == 200 and r.get_json()["stale"] is True


def test_daily_502_sin_nada_guardado_y_sin_filtrar_detalles(h):
    h.upstream[DAILY_USD] = UpstreamError("http://localhost:8040/secreto")
    r = h.get("/api/history/daily?source=eltoque&currency=USD")
    assert r.status_code == 502
    texto = r.get_data(as_text=True)
    assert "localhost" not in texto and "8040" not in texto


@pytest.mark.parametrize("basura", [{"ok": False}, {"ok": True, "data": "x"}, [], {}])
def test_respuesta_invalida_del_origen_es_502(h, basura):
    h.upstream[DAILY_USD] = basura
    assert h.get("/api/history/daily?source=eltoque&currency=USD").status_code == 502


def test_parse_points_tolera_formatos_raros():
    assert history_service.parse_points("x") == []
    assert history_service.parse_points([{"date": "2026-02-30", "rate": 5}]) == []
    assert history_service.parse_points([{"date": "2026-10-09", "rate": "1.234,5"}]) == [{"date": "2026-10-09", "rate": 1234.5}]
