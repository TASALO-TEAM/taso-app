"""Tests de /api/admin/overview: solo admins, sin fugas de la clave, un bloque caído no tumba a los demás, caché."""

import json

import pytest

from config import settings
from src.services import admin_stats, taso_client
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_shell import USER, signed

SECRET = "SUPER-SECRET-ADMIN-KEY"

STATUS = {"ok": True, "is_scheduler_running": True, "updated_at": "2026-10-12T12:00:00Z", "jobs": [
    {"id": "refresh_all", "name": "Refresco", "next_run_at": "2026-10-12T12:05:00Z", "last_run_at": "2026-10-12T12:00:00Z", "error_count": 0, "last_error": None},
    {"id": "spotlight", "name": "Spotlight", "next_run_at": None, "last_run_at": None, "error_count": 2, "last_error": "x" * 400},
]}
SUMMARY = {"ok": True, "users": {"total": 120, "new_7d": 9, "active_24h": 31, "active_recent": 4},
           "commands": {"commands_24h": [{"command": "/ms", "count": 40}, {"command": "/p", "count": 70}],
                        "commands_7d": [{"command": "/ms", "count": 300}], "commands_30d": []},
           "top_users": {"top_users": [{"user_id": 1, "total_commands": 50}]},
           "performance": {"success_rate": 99.2, "avg_response_ms": 312.4, "total_requests_24h": 800}}
USAGE = {"ok": True, "window": "24h", "total_requests": 800, "total_errors": 6, "error_rate": 0.75, "avg_duration_ms": 280.6,
         "by_client": [{"client_id": "taso-app", "requests": 500, "errors": 2, "avg_duration_ms": 300.2},
                       {"client_id": "taso-bot", "requests": 300, "errors": 4, "avg_duration_ms": 200}],
         "by_endpoint": [{"path": "/api/v1/tasas/latest", "requests": 400, "errors": 1, "avg_duration_ms": 90}]}
HEALTH = {"ok": True, "version": "0.9.0.0", "git_commit": "59fa90f"}


@pytest.fixture
def adm(ctx, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(settings, "admin_chat_ids", str(USER["id"]))
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "a.db"))
    ctx.upstream["/api/v1/health"] = HEALTH
    ctx.admin_calls = []
    ctx.admin_routes = {
        "/api/v1/admin/status": (200, STATUS),
        "/api/v1/admin/stats/summary": (200, SUMMARY),
        "/api/v1/admin/stats/api-usage": (200, USAGE),
    }

    def fake_call(method, path, *, json=None, params=None, timeout=8.0):
        ctx.admin_calls.append((method, path, params))
        value = ctx.admin_routes.get(path, (500, None))
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(taso_client, "call", fake_call)
    return ctx


def test_sin_initdata_es_401_y_no_admin_es_403(adm, monkeypatch):
    assert adm.client.get("/api/admin/overview").status_code == 401
    monkeypatch.setattr(settings, "admin_chat_ids", "999")
    r = adm.get("/api/admin/overview")
    assert r.status_code == 403
    assert adm.admin_calls == []  # un no admin nunca llega a taso-api


def test_admin_recibe_todo_el_panel(adm):
    r = adm.get("/api/admin/overview")
    assert r.status_code == 200
    d = r.get_json()
    assert d["ok"] and not d["stale"] and d["window"] == "24h"
    assert d["health"] == {"level": "warn", "text": "Atención: hay errores recientes"}
    assert d["users"] == {"ok": True, "total": 120, "new_7d": 9, "active_24h": 31, "active_recent": 4}
    assert [c["command"] for c in d["commands"]["items"]] == ["/p", "/ms"]  # ordenado por uso
    assert d["performance"]["avg_response_ms"] == 312
    assert d["api"]["by_client"][0] == {"client_id": "taso-app", "requests": 500, "errors": 2, "avg_duration_ms": 300}
    assert d["versions"] == {"ok": True, "api_version": "0.9.0.0", "api_commit": "59fa90f"}
    job = d["scheduler"]["jobs"][1]
    assert len(job["last_error"]) == 150 and job["next_run_at"] is None
    assert d["app"]["ok"] is True and len(d["app"]["queries_by_day"]) == 7
    assert r.headers["Cache-Control"] == "no-store"


def test_ventana_valida_se_pasa_a_taso_api_y_la_rara_cae_a_24h(adm):
    adm.get("/api/admin/overview?window=7d")
    adm.get("/api/admin/overview?window=%3Cscript%3E")
    windows = [p["window"] for (_, path, p) in adm.admin_calls if path.endswith("api-usage")]
    assert windows == ["7d", "24h"]
    assert adm.get("/api/admin/overview?window=7d").get_json()["commands"]["items"] == [{"command": "/ms", "count": 300}]


def test_la_clave_admin_no_sale_en_ninguna_respuesta(adm, monkeypatch):
    monkeypatch.setattr(settings, "tasalo_admin_key", SECRET)
    adm.admin_routes["/api/v1/admin/status"] = (200, {**STATUS, "x_api_key": SECRET, "jobs": []})
    body = adm.get("/api/admin/overview").get_data(as_text=True)
    assert SECRET not in body
    assert "x_api_key" not in body


def test_un_bloque_caido_no_tumba_a_los_demas(adm):
    adm.admin_routes["/api/v1/admin/stats/api-usage"] = (500, None)
    d = adm.get("/api/admin/overview").get_json()
    assert d["api"] == {"ok": False}
    assert d["users"]["ok"] is True and d["scheduler"]["ok"] is True


def test_sin_scheduler_la_salud_es_desconocida_y_scheduler_parado_es_rojo(adm):
    adm.admin_routes["/api/v1/admin/status"] = (500, None)
    assert adm.get("/api/admin/overview").get_json()["health"]["level"] == "unknown"
    adm.clock.t += 100  # caduca la caché
    adm.admin_routes["/api/v1/admin/status"] = (200, {**STATUS, "is_scheduler_running": False})
    assert adm.get("/api/admin/overview").get_json()["health"] == {"level": "bad", "text": "Scheduler detenido"}


def test_todo_caido_es_502_y_con_caliente_sirve_lo_ultimo_como_stale(adm):
    assert adm.get("/api/admin/overview").status_code == 200
    adm.clock.t += 100  # caduca el TTL de 30 s pero no el límite de 10 min
    for p in list(adm.admin_routes):
        adm.admin_routes[p] = UpstreamError(p)
    r = adm.get("/api/admin/overview")
    assert r.status_code == 200 and r.get_json()["stale"] is True
    adm.clock.t += 5000  # ya no hay caché utilizable
    assert adm.get("/api/admin/overview").status_code == 502


def test_cache_de_30_s_no_repite_las_llamadas(adm):
    adm.get("/api/admin/overview")
    n = len(adm.admin_calls)
    adm.get("/api/admin/overview")
    assert len(adm.admin_calls) == n


def test_estadisticas_de_la_app_cuentan_monedas_y_dias(adm):
    from src.services import market
    for uid, sym in [(1, "BTC"), (2, "BTC"), (2, "ETH")]:
        market.record_query(uid, sym)
    app = json.loads(adm.get("/api/admin/overview").get_data())["app"]
    assert app["coins"][0] == {"symbol": "BTC", "users": 2}
    assert app["mercado_users"] == 2
    assert sum(d["count"] for d in app["queries_by_day"]) == 3
    assert admin_stats.normalize_window("30d") == "30d" and admin_stats.normalize_window(None) == "24h"
