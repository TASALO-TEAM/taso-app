"""Rutas /api/alerts/market (S10 F4, paso 1): crear, listar y borrar alertas de precio propias. Sin red."""

import pytest

from config import settings
from src.services import crypto
from src.services.cache import RateLimiter
from src.services.crypto import CoinRef, Reading
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_shell import USER, signed, tma

BTC = CoinRef("BTC", binance_pair="BTCUSDT", cmc_id=1, cg_id="bitcoin")


@pytest.fixture
def world(ctx, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "alerts.db"))

    def fake_resolve(symbol):
        if symbol == "BTC":
            return BTC, {"binance": Reading(100.0, "binance")}
        return None, {}

    monkeypatch.setattr(crypto, "resolve_coin", fake_resolve)
    return ctx


def call(ctx, method, path, user_id=USER["id"], body=None):
    user = {**USER, "id": user_id}
    return getattr(ctx.client, method)(path, headers=tma(signed(user=user)), json=body)


def test_exige_initdata(world):
    assert world.client.get("/api/alerts/market").status_code == 401
    assert world.client.post("/api/alerts/market", json={"symbol": "BTC", "target": 120}).status_code == 401
    assert world.client.delete("/api/alerts/market/1").status_code == 401


def test_crea_y_lista_sin_campos_internos(world):
    r = call(world, "post", "/api/alerts/market", body={"symbol": "btc", "target": 120})
    body = r.get_json()
    assert r.status_code == 201 and body["ok"] is True
    alert = body["alert"]
    assert (alert["symbol"], alert["direction"], alert["target"], alert["status"]) == ("BTC", "ABOVE", 120.0, "ACTIVE")
    assert "user_id" not in alert and "cmc_id" not in alert and "binance_pair" not in alert

    listed = call(world, "get", "/api/alerts/market").get_json()
    assert listed["ok"] is True and [a["id"] for a in listed["alerts"]] == [alert["id"]]
    assert listed["limits"] == {"per_user": 20, "per_coin": 5}


def test_el_user_id_del_cuerpo_se_ignora(world):
    r = call(world, "post", "/api/alerts/market", user_id=1, body={"symbol": "BTC", "target": 120, "user_id": 999})
    assert r.status_code == 201
    assert call(world, "get", "/api/alerts/market", user_id=999).get_json()["alerts"] == []
    assert len(call(world, "get", "/api/alerts/market", user_id=1).get_json()["alerts"]) == 1


def test_un_usuario_no_ve_ni_borra_las_de_otro(world):
    alert_id = call(world, "post", "/api/alerts/market", user_id=1, body={"symbol": "BTC", "target": 120}).get_json()["alert"]["id"]
    assert call(world, "get", "/api/alerts/market", user_id=2).get_json()["alerts"] == []
    other = call(world, "delete", f"/api/alerts/market/{alert_id}", user_id=2)
    assert other.status_code == 404 and other.get_json()["error"]["code"] == "not_found"
    assert len(call(world, "get", "/api/alerts/market", user_id=1).get_json()["alerts"]) == 1  # sigue ahi
    assert call(world, "delete", f"/api/alerts/market/{alert_id}", user_id=1).get_json() == {"ok": True}
    assert call(world, "get", "/api/alerts/market", user_id=1).get_json()["alerts"] == []
    assert call(world, "delete", f"/api/alerts/market/{alert_id}", user_id=1).status_code == 404


@pytest.mark.parametrize(
    "body, status, code",
    [
        ({"symbol": "BTC", "target": 0}, 400, "bad_target"),
        ({"symbol": "BTC", "target": "abc"}, 400, "bad_target"),
        ({"symbol": "BTC"}, 400, "bad_target"),
        ({"target": 120}, 400, "bad_symbol"),
        ({"symbol": "no es moneda!", "target": 120}, 400, "bad_symbol"),
        ({"symbol": "ZZZ", "target": 120}, 404, "unknown_coin"),
        ({"symbol": "BTC", "target": 100.05}, 400, "too_close"),
    ],
)
def test_errores_de_negocio_con_codigo_estable(world, body, status, code):
    r = call(world, "post", "/api/alerts/market", body=body)
    assert r.status_code == status
    assert r.get_json() == {"ok": False, "error": {"code": code, "message": r.get_json()["error"]["message"]}}
    assert call(world, "get", "/api/alerts/market").get_json()["alerts"] == []  # nada se creo


def test_cuerpo_que_no_es_json_no_rompe(world):
    r = world.client.post("/api/alerts/market", headers=tma(signed()), data="no json", content_type="text/plain")
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "bad_symbol"


def test_limite_por_moneda_y_duplicado_dan_409(world):
    for target in (110, 120, 130, 140, 150):
        assert call(world, "post", "/api/alerts/market", body={"symbol": "BTC", "target": target}).status_code == 201
    sixth = call(world, "post", "/api/alerts/market", body={"symbol": "BTC", "target": 160})
    assert sixth.status_code == 409 and sixth.get_json()["error"]["code"] == "limit_coin"
    # otro usuario no comparte el cupo
    assert call(world, "post", "/api/alerts/market", user_id=2, body={"symbol": "BTC", "target": 160}).status_code == 201


def test_duplicado_da_409(world):
    assert call(world, "post", "/api/alerts/market", body={"symbol": "BTC", "target": 120}).status_code == 201
    dup = call(world, "post", "/api/alerts/market", body={"symbol": "BTC", "target": 120})
    assert dup.status_code == 409 and dup.get_json()["error"]["code"] == "duplicate"


def test_limite_de_creaciones_por_minuto_es_por_usuario(world):
    world.app.config["TASALO_ALERT_LIMITER"] = RateLimiter(2, 60.0)
    for target in (110, 120):
        assert call(world, "post", "/api/alerts/market", user_id=1, body={"symbol": "BTC", "target": target}).status_code == 201
    blocked = call(world, "post", "/api/alerts/market", user_id=1, body={"symbol": "BTC", "target": 130})
    assert blocked.status_code == 429 and blocked.get_json()["error"]["code"] == "rate_limited"
    assert len(call(world, "get", "/api/alerts/market", user_id=1).get_json()["alerts"]) == 2  # la bloqueada no se creo
    assert call(world, "post", "/api/alerts/market", user_id=2, body={"symbol": "BTC", "target": 130}).status_code == 201
