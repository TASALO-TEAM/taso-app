"""Alertas de precio propias: crear / listar / borrar (S10 F4 parte 1). Sin red: ``crypto.resolve_coin`` se sustituye."""

import pytest

from config import settings
from src.services import crypto, market_alerts as ma
from src.services.crypto import CoinRef, Reading

BTC = CoinRef("BTC", binance_pair="BTCUSDT", cmc_id=1, cg_id="bitcoin")


@pytest.fixture
def world(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "alerts.db"))

    class W:
        ref = BTC
        readings = {"binance": Reading(100.0, "binance")}

    def fake_resolve(symbol):
        return (W.ref if symbol == "BTC" else None), (W.readings if symbol == "BTC" else {})

    monkeypatch.setattr(crypto, "resolve_coin", fake_resolve)
    return W


def err(code, fn, *a):
    with pytest.raises(ma.AlertError) as exc:
        fn(*a)
    assert exc.value.code == code
    return exc.value


def test_crea_encima_y_debajo_deduce_la_direccion(world):
    up = ma.create_alert(1, "btc", 120)
    down = ma.create_alert(1, "$BTC", "80,5")
    assert (up["direction"], up["symbol"], up["target"], up["price_at_creation"]) == ("ABOVE", "BTC", 120.0, 100.0)
    assert (down["direction"], down["target"]) == ("BELOW", 80.5)
    assert up["status"] == "ACTIVE" and up["notified"] is False


def test_valida_simbolo_y_objetivo(world):
    err("bad_symbol", ma.create_alert, 1, "no es una moneda!", 10)
    err("bad_symbol", ma.create_alert, 1, None, 10)
    for bad in (0, -5, "abc", "", None, True, float("nan"), float("inf"), 1e13, "1" * 40):
        err("bad_target", ma.create_alert, 1, "BTC", bad)


def test_moneda_inexistente_y_sin_precio(world):
    err("unknown_coin", ma.create_alert, 1, "ZZZ", 10)
    world.readings = {}
    err("price_unavailable", ma.create_alert, 1, "BTC", 120)
    world.readings = {"cmc": Reading(100.0, "cmc", age_seconds=3600)}  # CMC con más de 15 min no sirve
    err("price_unavailable", ma.create_alert, 1, "BTC", 120)


def test_objetivo_casi_igual_al_precio_se_rechaza(world):
    err("too_close", ma.create_alert, 1, "BTC", 100.05)
    err("too_close", ma.create_alert, 1, "BTC", 99.95)
    assert ma.create_alert(1, "BTC", 100.2)["direction"] == "ABOVE"  # > 0,1 %: vale


def test_fuentes_que_se_contradicen_no_crean_alerta(world):
    world.readings = {"binance": Reading(100.0, "binance"), "coingecko": Reading(110.0, "coingecko")}
    err("price_mismatch", ma.create_alert, 1, "BTC", 150)
    assert ma.list_alerts(1) == []
    world.readings = {"binance": Reading(100.0, "binance"), "coingecko": Reading(100.8, "coingecko")}  # dentro de 1,5 %
    assert ma.create_alert(1, "BTC", 150)["target"] == 150.0


def test_duplicados_solo_si_misma_moneda_objetivo_y_direccion(world):
    ma.create_alert(1, "BTC", 120)
    err("duplicate", ma.create_alert, 1, "BTC", 120)
    err("duplicate", ma.create_alert, 1, "BTC", "120.0")
    ma.create_alert(1, "BTC", 121)       # otro objetivo
    ma.create_alert(2, "BTC", 120)       # otro usuario


def test_limites_por_moneda_y_por_usuario(world, monkeypatch):
    for i in range(ma.MAX_PER_COIN):
        ma.create_alert(1, "BTC", 120 + i)
    err("limit_coin", ma.create_alert, 1, "BTC", 200)
    assert ma.create_alert(2, "BTC", 200)["id"]  # el límite es por usuario

    monkeypatch.setattr(ma, "MAX_PER_COIN", 100)
    monkeypatch.setattr(ma, "MAX_PER_USER", 6)
    ma.create_alert(1, "BTC", 300)  # la 6.ª: aún cabe
    err("limit_user", ma.create_alert, 1, "BTC", 301)  # la 7.ª: no


def test_las_disparadas_no_cuentan_para_los_limites(world, monkeypatch):
    monkeypatch.setattr(ma, "MAX_PER_USER", 1)
    first = ma.create_alert(1, "BTC", 120)
    from src import db
    with db.connect() as conn:
        conn.execute("UPDATE price_alerts SET status='TRIGGERED', triggered_at=?, triggered_price=121 WHERE id=?", (db.now_iso(), first["id"]))
    assert ma.create_alert(1, "BTC", 130)["status"] == "ACTIVE"


def test_listar_es_solo_del_usuario_y_pone_activas_primero(world):
    a = ma.create_alert(1, "BTC", 120)
    b = ma.create_alert(1, "BTC", 130)
    ma.create_alert(2, "BTC", 140)
    from src import db
    with db.connect() as conn:
        conn.execute("UPDATE price_alerts SET status='TRIGGERED', triggered_at=?, triggered_price=121, trigger_kind='reached' WHERE id=?", (db.now_iso(), a["id"]))
    items = ma.list_alerts(1)
    assert [i["id"] for i in items] == [b["id"], a["id"]]
    assert [i["status"] for i in items] == ["ACTIVE", "TRIGGERED"]
    assert items[1]["trigger_kind"] == "reached" and items[1]["triggered_price"] == 121
    assert ma.list_alerts(99) == []


def test_borrar_solo_las_propias(world):
    mine = ma.create_alert(1, "BTC", 120)
    other = ma.create_alert(2, "BTC", 130)
    assert ma.delete_alert(2, mine["id"]) is False       # ajena: no se borra
    assert [i["id"] for i in ma.list_alerts(1)] == [mine["id"]]
    assert ma.delete_alert(1, mine["id"]) is True
    assert ma.delete_alert(1, mine["id"]) is False       # ya no existe
    assert [i["id"] for i in ma.list_alerts(2)] == [other["id"]]


def test_la_respuesta_no_filtra_campos_internos(world):
    item = ma.create_alert(1, "BTC", 120)
    assert "user_id" not in item and "binance_pair" not in item and "notify_error" not in item
