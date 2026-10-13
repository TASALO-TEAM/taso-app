"""Tests de /api/me/stats («Mis estadísticas»): el id sale solo del initData, un bloque caído no tumba al otro, sin fugas."""

import json

import pytest

from config import settings
from src import db
from src.services import market, taso_client, user_stats
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_shell import USER, signed

SECRET = "SUPER-SECRET-ADMIN-KEY"
ME = USER["id"]

BOT = {
    "ok": True, "user_id": ME, "window": "7d", "found": True, "total_commands": 12, "successful": 11, "failed": 1,
    "success_rate": 91.666, "total_commands_all_time": 340,
    "by_command": [{"name": "/ms", "count": 3}, {"name": "/p", "count": 9}],
    "by_source": [{"name": "eltoque", "count": 8}, {"name": "bcc", "count": 2}],
    "first_seen": "2026-01-03T10:00:00Z", "last_seen": "2026-10-12T11:00:00Z",
    "internal_secret": "NO-DEBE-SALIR", "username": "ersus93",
}


@pytest.fixture
def us(ctx, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "u.db"))
    monkeypatch.setattr(settings, "tasalo_admin_key", SECRET)
    ctx.calls_admin = []
    ctx.admin_route = (200, BOT)

    def fake_call(method, path, *, json=None, params=None, timeout=8.0):
        ctx.calls_admin.append((method, path, params))
        if isinstance(ctx.admin_route, Exception):
            raise ctx.admin_route
        return ctx.admin_route

    monkeypatch.setattr(taso_client, "call", fake_call)
    return ctx


def body(resp):
    return json.loads(resp.get_data())


def test_sin_initdata_es_401_y_no_se_llama_a_taso_api(us):
    assert us.client.get("/api/me/stats").status_code == 401
    assert us.calls_admin == []


def test_cualquier_usuario_ve_lo_suyo_y_se_pide_con_su_id(us):
    r = us.get("/api/me/stats?window=30d")  # el usuario de pruebas NO es admin
    assert r.status_code == 200
    assert us.calls_admin == [("GET", f"/api/v1/admin/stats/users/{ME}", {"window": "30d"})]
    data = body(r)
    assert data["ok"] is True and data["window"] == "30d"
    assert data["bot"]["ok"] is True and data["bot"]["total"] == 12
    assert data["bot"]["success_rate"] == 91.7
    assert data["bot"]["commands"][0] == {"name": "/p", "count": 9}  # ordenado por uso
    assert data["bot"]["sources"][0] == {"name": "eltoque", "count": 8}
    assert data["bot"]["total_all_time"] == 340
    assert r.headers["Cache-Control"] == "no-store"


def test_un_id_enviado_por_el_cliente_se_ignora(us):
    us.get("/api/me/stats?uid=1&user_id=2&id=3")
    assert us.calls_admin[0][1] == f"/api/v1/admin/stats/users/{ME}"
    assert all("/1" not in c[1] and "/2" not in c[1] for c in us.calls_admin)


def test_lista_blanca_y_la_clave_no_sale(us):
    raw = us.get("/api/me/stats").get_data(as_text=True)
    assert "NO-DEBE-SALIR" not in raw and SECRET not in raw
    assert "internal_secret" not in raw and "ersus93" not in raw


def test_ventana_rara_cae_a_7d(us):
    assert body(us.get("/api/me/stats?window=1y"))["window"] == "7d"
    assert us.calls_admin[0][2] == {"window": "7d"}
    assert user_stats.normalize_window("24h") == "24h" and user_stats.normalize_window(None) == "7d"


def test_taso_api_caida_no_tumba_el_bloque_de_la_app(us):
    market.record_query(ME, "BTC")
    us.admin_route = UpstreamError("down")
    r = us.get("/api/me/stats")
    assert r.status_code == 200
    d = body(r)
    assert d["bot"] == {"ok": False}
    assert d["app"]["ok"] is True and d["app"]["mercado_queries"] == 1


def test_taso_api_responde_error_es_bloque_caido(us):
    us.admin_route = (500, None)
    assert body(us.get("/api/me/stats"))["bot"] == {"ok": False}
    us.admin_route = (200, {"ok": False})
    assert body(us.get("/api/me/stats?window=24h"))["bot"] == {"ok": False}


def test_usuario_sin_datos_no_inventa_porcentajes(us):
    us.admin_route = (200, {"ok": True, "found": False, "total_commands": 0})
    d = body(us.get("/api/me/stats"))
    assert d["bot"]["found"] is False and d["bot"]["total"] == 0
    assert d["bot"]["success_rate"] is None and d["bot"]["commands"] == []


def test_datos_raros_de_taso_api_no_rompen(us):
    us.admin_route = (200, {"ok": True, "found": True, "total_commands": "x", "successful": None, "by_command": "no", "by_source": [1, {"name": "", "count": 3}, {"name": "bcc", "count": float("nan")}]})
    d = body(us.get("/api/me/stats"))["bot"]
    assert d["ok"] is True and d["total"] == 0 and d["commands"] == []
    assert d["sources"] == [{"name": "bcc", "count": 0}]


def test_app_solo_cuenta_lo_del_propio_usuario(us):
    for uid, sym in [(ME, "BTC"), (ME, "ETH"), (999, "BTC"), (999, "SOL")]:
        market.record_query(uid, sym)
    with db.connect() as conn:
        for uid, status in [(ME, "ACTIVE"), (ME, "ACTIVE"), (ME, "TRIGGERED"), (999, "ACTIVE")]:
            conn.execute(
                "INSERT INTO price_alerts (user_id, symbol, target, direction, status, created_at) VALUES (?, 'BTC', 1.0, 'ABOVE', ?, '2026-10-12T00:00:00Z')",
                (uid, status),
            )
    app = body(us.get("/api/me/stats"))["app"]
    assert app["mercado_queries"] == 2 and app["mercado_days"] == 1
    assert sorted(c["name"] for c in app["coins"]) == ["BTC", "ETH"]
    assert app["alerts_active"] == 2 and app["alerts_triggered"] == 1


def test_cache_de_30_s_por_usuario_y_ventana(us):
    us.get("/api/me/stats")
    us.get("/api/me/stats")
    assert len(us.calls_admin) == 1
    us.get("/api/me/stats?window=30d")  # otra ventana = otra consulta
    assert len(us.calls_admin) == 2
    us.get("/api/me/stats", init=signed({**USER, "id": 777}))  # otro usuario = otra consulta, con SU id
    assert us.calls_admin[-1][1] == "/api/v1/admin/stats/users/777"
