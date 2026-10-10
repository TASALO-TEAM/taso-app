"""Tests de los endpoints /api/rates, /api/year, /api/image/eltoque y del límite por usuario."""

import pytest

import src.app as app_module
from src.services import taso_client
from src.services.cache import RateLimiter, TTLCache, UpstreamError, UpstreamNotFound
from tests.test_shell import TOKEN, signed, tma

LATEST = {
    "ok": True,
    "data": {
        "eltoque": {"USD": {"rate": 520, "change": "down", "prev_rate": 521}, "EUR": {"rate": 585, "change": "up", "prev_rate": 582.5}},
        "cadeca": {"USD": {"buy": 118, "sell": 120, "change": "neutral"}},
        "bcc": {},
        "binance": {},
        "qvapay": {"CUP": {"rate": 515, "buy": 510, "sell": 520, "change": "up"}},
    },
    "updated_at": "2026-10-10T15:40:00",
    "sources_updated_at": {"eltoque": "2026-10-10T15:30:00+00:00"},
}
YEAR = {"ok": True, "progress": {"year": 2026, "percent": 77.5, "days_left": 83}, "quote": {"quote": "Una frase"}}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def ctx(monkeypatch):
    """App con caché de reloj controlable y un «taso-api» falso."""
    monkeypatch.setattr(app_module.settings, "tasalo_base_path", "")
    monkeypatch.setattr(app_module.settings, "telegram_bot_token", TOKEN)
    monkeypatch.setattr(app_module.settings, "admin_chat_ids", "")

    class Ctx:
        pass

    c = Ctx()
    c.clock = Clock()
    c.calls = {"json": 0, "probe": 0}
    c.upstream = {"/api/v1/tasas/latest": LATEST, "/api/v1/year/state": YEAR}
    c.probe_result = True
    c.file = (b"\x89PNG-fake", "image/png")

    def fake_get_json(path, timeout=8.0):
        c.calls["json"] += 1
        value = c.upstream[path]
        if isinstance(value, Exception):
            raise value
        return value

    def fake_probe(path, timeout=8.0):
        c.calls["probe"] += 1
        return c.probe_result

    def fake_get_file(path, timeout=15.0):
        if isinstance(c.file, Exception):
            raise c.file
        return c.file

    monkeypatch.setattr(taso_client, "get_json", fake_get_json)
    monkeypatch.setattr(taso_client, "probe", fake_probe)
    monkeypatch.setattr(taso_client, "get_file", fake_get_file)

    app = app_module.create_app()
    app.config["TESTING"] = True
    app.config["TASALO_CACHE"] = TTLCache(c.clock)
    c.app = app
    c.client = app.test_client()
    c.get = lambda path, init=None: c.client.get(path, headers=tma(init or signed()))
    return c


# ---------- Autenticación ----------

@pytest.mark.parametrize("path", ["/api/rates", "/api/year", "/api/image/eltoque"])
def test_sin_initdata_es_401(ctx, path):
    assert ctx.client.get(path).status_code == 401


def test_con_initdata_manipulado_es_401_y_no_llama_al_origen(ctx):
    r = ctx.get("/api/rates", init=signed().replace("Ernesto", "Otro"))
    assert r.status_code == 401
    assert ctx.calls["json"] == 0


# ---------- /api/rates ----------

def test_rates_normaliza_y_ordena(ctx):
    r = ctx.get("/api/rates")
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True and body["stale"] is False
    assert [x["code"] for x in body["sources"]["eltoque"]["rates"]] == ["EUR", "USD"]
    assert body["sources"]["eltoque"]["fetched_at"] == "2026-10-10T15:30:00+00:00"
    assert body["sources"]["cadeca"]["rates"][0]["rate"] == 120.0
    assert body["image"] == {"available": True}
    assert "binance" not in body["sources"]
    assert r.headers["Cache-Control"] == "no-store"


def test_rates_se_cachea_dentro_del_ttl(ctx):
    ctx.get("/api/rates")
    ctx.get("/api/rates")
    assert ctx.calls["json"] == 1


def test_rates_recarga_tras_el_ttl(ctx):
    ctx.get("/api/rates")
    ctx.clock.t += 31
    ctx.get("/api/rates")
    assert ctx.calls["json"] == 2


def test_si_taso_api_cae_sirve_lo_ultimo_con_stale(ctx):
    assert ctx.get("/api/rates").get_json()["stale"] is False
    ctx.upstream["/api/v1/tasas/latest"] = UpstreamError("caído")
    ctx.clock.t += 120
    r = ctx.get("/api/rates")
    assert r.status_code == 200
    body = r.get_json()
    assert body["stale"] is True
    assert body["sources"]["eltoque"]["rates"][0]["code"] == "EUR"


def test_si_taso_api_cae_y_no_hay_nada_guardado_es_502_json(ctx):
    ctx.upstream["/api/v1/tasas/latest"] = UpstreamError("caído")
    r = ctx.get("/api/rates")
    assert r.status_code == 502
    assert r.get_json() == {"ok": False, "error": {"code": "upstream_unavailable", "message": "No se pudieron cargar las tasas"}}


def test_lo_guardado_demasiado_viejo_ya_no_se_sirve(ctx):
    ctx.get("/api/rates")
    ctx.upstream["/api/v1/tasas/latest"] = UpstreamError("caído")
    ctx.clock.t += 6 * 3600 + 1
    assert ctx.get("/api/rates").status_code == 502


@pytest.mark.parametrize("basura", [{"ok": False}, {}, [], {"ok": True, "data": "x"}])
def test_respuesta_invalida_del_origen_es_502(ctx, basura):
    ctx.upstream["/api/v1/tasas/latest"] = basura
    assert ctx.get("/api/rates").status_code == 502


def test_image_available_false_si_no_hay_imagen(ctx):
    ctx.probe_result = False
    assert ctx.get("/api/rates").get_json()["image"] == {"available": False}


def test_el_error_no_filtra_detalles_internos(ctx):
    ctx.upstream["/api/v1/tasas/latest"] = UpstreamError("http://localhost:8040/secreto")
    texto = ctx.get("/api/rates").get_data(as_text=True)
    assert "localhost" not in texto and "8040" not in texto


# ---------- /api/year ----------

def test_year_ok(ctx):
    body = ctx.get("/api/year").get_json()
    assert body == {"ok": True, "stale": False, "year": 2026, "percent": 77.5, "days_left": 83, "quote": "Una frase"}


def test_year_502_si_el_origen_falla_sin_cache(ctx):
    ctx.upstream["/api/v1/year/state"] = UpstreamError("x")
    assert ctx.get("/api/year").status_code == 502


# ---------- /api/image/eltoque ----------

def test_imagen_ok(ctx):
    r = ctx.get("/api/image/eltoque")
    assert r.status_code == 200 and r.mimetype == "image/png" and r.data == b"\x89PNG-fake"
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_imagen_404_cuando_no_hay(ctx):
    ctx.file = UpstreamNotFound("x")
    r = ctx.get("/api/image/eltoque")
    assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"


def test_imagen_502_si_falla(ctx):
    ctx.file = UpstreamError("x")
    assert ctx.get("/api/image/eltoque").status_code == 502


# ---------- Límite por usuario ----------

def test_limite_por_usuario_429(ctx):
    ctx.app.config["TASALO_LIMITER"] = RateLimiter(3, 60.0, ctx.clock)
    codes = [ctx.get("/api/year").status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    r = ctx.get("/api/year")
    assert r.headers["Retry-After"] == "30" and r.get_json()["error"]["code"] == "rate_limited"


def test_el_limite_es_por_usuario_no_global(ctx):
    ctx.app.config["TASALO_LIMITER"] = RateLimiter(1, 60.0, ctx.clock)
    otro = {"id": 777, "first_name": "Otra"}
    assert ctx.get("/api/year").status_code == 200
    assert ctx.get("/api/year").status_code == 429
    assert ctx.get("/api/year", init=signed(user=otro)).status_code == 200


def test_las_peticiones_no_autenticadas_no_gastan_cupo(ctx):
    ctx.app.config["TASALO_LIMITER"] = RateLimiter(1, 60.0, ctx.clock)
    for _ in range(5):
        ctx.client.get("/api/year")
    assert ctx.get("/api/year").status_code == 200
