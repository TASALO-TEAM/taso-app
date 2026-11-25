"""Checker de alertas de precio (S10 F4 paso 2). Sin red ni hilos: lecturas, velas y envio se sustituyen."""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from config import settings
from src import db
from src.services import crypto, market_alerts_checker as chk
from src.services.crypto import Candle, CoinRef, Reading

NOW = datetime(2026, 11, 24, 12, 0, 0, tzinfo=timezone.utc)
BTC = CoinRef("BTC", binance_pair="BTCUSDT", cmc_id=1, cg_id="bitcoin")


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture
def world(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "checker.db"))
    monkeypatch.setattr(settings, "telegram_bot_token", "TESTTOKEN")
    db.init_db()

    class W:
        price = Reading(100.5, "binance")
        other = Reading(100.4, "cmc")  # segunda fuente; None = no hay
        candles: list = []
        sent: list = []
        send_result = (True, "", False)

    W.candles, W.sent = [], []
    monkeypatch.setattr(crypto, "fetch_primary", lambda refs: {r.key: W.price for r in refs} if W.price else {})
    monkeypatch.setattr(crypto, "fetch_confirmation", lambda ref, src: W.other)
    monkeypatch.setattr(crypto, "binance_candles", lambda pair, since: list(W.candles))

    def fake_send(chat_id, text):
        W.sent.append((chat_id, text))
        return W.send_result

    monkeypatch.setattr(chk, "send_message", fake_send)
    return W


def add(target, direction="ABOVE", **kw):
    row = dict(user_id=7, symbol="BTC", binance_pair="BTCUSDT", cmc_id=1, cg_id="bitcoin", target=target,
               direction=direction, price_at_creation=90.0, created_at=iso(NOW - timedelta(hours=1)))
    row.update(kw)
    cols = ", ".join(row)
    with db.connect() as conn:
        return conn.execute(f"INSERT INTO price_alerts ({cols}) VALUES ({', '.join('?' * len(row))})", tuple(row.values())).lastrowid


def get(alert_id):
    with db.connect() as conn:
        return dict(conn.execute("SELECT * FROM price_alerts WHERE id=?", (alert_id,)).fetchone())


# ---------------------------------------------------------------- utilidades puras

@pytest.mark.parametrize("direction,target,price,expected", [
    ("ABOVE", 100, 100.5, "passed"),
    ("ABOVE", 100, 99.95, "reached"),   # a menos de 0,1 %
    ("ABOVE", 100, 99.0, None),
    ("BELOW", 100, 99.5, "passed"),
    ("BELOW", 100, 100.05, "reached"),
    ("BELOW", 100, 101.0, None),
])
def test_spot_hit(direction, target, price, expected):
    assert chk.spot_hit(direction, target, price) == expected


def test_fmt_price():
    assert chk.fmt_price(67123.456) == "67,123.46"
    assert chk.fmt_price(2.5) == "2.5"
    assert chk.fmt_price(0.00001234) == "0.00001234"
    for bad in (None, 0, -1, float("nan"), "x", True):
        assert chk.fmt_price(bad) == "?"


def test_mensaje_escapa_y_distingue_tipos():
    base = dict(symbol="<b>X</b>", direction="ABOVE", target=100.0, triggered_price=105.0, price_at_creation=100.0,
                triggered_at=iso(NOW), last_checked_at=iso(NOW))
    passed = chk.build_message({**base, "trigger_kind": "passed"})
    assert "&lt;b&gt;X&lt;/b&gt;" in passed and "<b>X</b>" not in passed
    assert "Alerta de precio" in passed and "+5.0 % desde que creaste la alerta." in passed
    assert "pausa" not in passed
    reached = chk.build_message({**base, "trigger_kind": "reached"})
    assert "junto a tu objetivo" in reached
    wick = chk.build_message({**base, "trigger_kind": "wick", "triggered_at": iso(NOW)})
    assert "alrededor de las" in wick
    late = chk.build_message({**base, "trigger_kind": "passed", "last_checked_at": iso(NOW - timedelta(hours=2))})
    assert "pausa" in late


# ---------------------------------------------------------------- candado

def test_candado_entre_titulares(world):
    assert db.try_lease("job", "a", 60, now=1000.0) is True
    assert db.try_lease("job", "b", 60, now=1030.0) is False   # lo tiene a, sin caducar
    assert db.try_lease("job", "a", 60, now=1030.0) is True    # el titular renueva
    assert db.try_lease("job", "b", 60, now=1200.0) is True    # caduco: lo toma b
    assert db.try_lease("job", "a", 60, now=1210.0) is False


# ---------------------------------------------------------------- ciclos

def test_dispara_con_segunda_fuente_y_avisa_una_vez(world):
    alert = add(100.0)
    stats = chk.run_cycle(NOW)
    row = get(alert)
    assert (row["status"], row["trigger_kind"], row["triggered_price"], row["trigger_source"]) == ("TRIGGERED", "passed", 100.5, "binance")
    assert stats["triggered"] == 1 and stats["sent"] == 1 and row["notified"] == 1
    assert world.sent[0][0] == 7
    chk.run_cycle(NOW + timedelta(minutes=5))
    assert len(world.sent) == 1  # no se avisa dos veces


def test_sin_segunda_fuente_hacen_falta_dos_revisiones(world):
    world.other = None
    alert = add(100.0)
    chk.run_cycle(NOW)
    assert (get(alert)["status"], get(alert)["pending_hits"]) == ("ACTIVE", 1)
    chk.run_cycle(NOW + timedelta(minutes=5))
    assert get(alert)["status"] == "TRIGGERED"


def test_discrepancia_entre_fuentes_no_dispara(world):
    world.other = Reading(120.0, "cmc")
    alert = add(100.0)
    chk.run_cycle(NOW)
    row = get(alert)
    assert (row["status"], row["pending_hits"]) == ("ACTIVE", 0) and world.sent == []


def test_salto_sin_confirmar_se_descarta(world):
    with db.connect() as conn:
        conn.execute("INSERT INTO coin_ticks (coin_key, price, at) VALUES (?,?,?)", (BTC.key, 100.0, iso(NOW - timedelta(minutes=5))))
    world.price, world.other = Reading(200.0, "binance"), None
    alert = add(150.0)
    stats = chk.run_cycle(NOW)
    assert stats["coins"] == 0 and get(alert)["status"] == "ACTIVE"


def test_salto_confirmado_por_otra_fuente_se_acepta(world):
    with db.connect() as conn:
        conn.execute("INSERT INTO coin_ticks (coin_key, price, at) VALUES (?,?,?)", (BTC.key, 100.0, iso(NOW - timedelta(minutes=5))))
    world.price, world.other = Reading(200.0, "binance"), Reading(201.0, "cmc")
    alert = add(150.0)
    chk.run_cycle(NOW)
    assert get(alert)["status"] == "TRIGGERED"


def test_mecha_entre_ciclos_dispara(world):
    world.price = Reading(95.0, "binance")
    world.candles = [Candle(NOW - timedelta(minutes=10), 101.0, 94.0)]
    alert = add(100.0)
    chk.run_cycle(NOW)
    row = get(alert)
    assert (row["status"], row["trigger_kind"], row["triggered_price"]) == ("TRIGGERED", "wick", 101.0)
    assert row["triggered_at"] == iso(NOW - timedelta(minutes=10))


def test_mecha_absurda_se_ignora_y_vela_anterior_a_la_alerta_no_vale(world):
    world.price = Reading(95.0, "binance")
    world.candles = [Candle(NOW - timedelta(minutes=10), 500.0, 94.0),         # a mas de 25 % del precio
                     Candle(NOW - timedelta(hours=2), 101.0, 94.0)]            # anterior a la creacion
    alert = add(100.0)
    chk.run_cycle(NOW)
    row = get(alert)
    assert row["status"] == "ACTIVE" and row["last_checked_at"] == iso(NOW)


def test_sin_lectura_no_actualiza_last_checked(world):
    world.price = None
    alert = add(100.0)
    chk.run_cycle(NOW)
    assert get(alert)["status"] == "ACTIVE" and get(alert)["last_checked_at"] is None


def test_disparo_atomico(world):
    alert = add(100.0)
    assert chk._trigger(alert, "passed", 101.0, "binance", iso(NOW)) is True
    assert chk._trigger(alert, "passed", 102.0, "binance", iso(NOW)) is False
    assert get(alert)["triggered_price"] == 101.0


# ---------------------------------------------------------------- avisos

def _triggered(alert_id):
    with db.connect() as conn:
        conn.execute("UPDATE price_alerts SET status='TRIGGERED', triggered_at=?, triggered_price=105, trigger_kind='passed' WHERE id=?",
                     (iso(NOW), alert_id))


def test_usuario_bloqueo_el_bot_no_se_insiste(world):
    world.send_result = (False, "http 403: Forbidden", True)
    alert = add(100.0)
    _triggered(alert)
    chk._flush_notifications()
    chk._flush_notifications()
    row = get(alert)
    assert row["notify_error"].startswith("blocked") and row["notify_attempts"] == 1 and len(world.sent) == 1


def test_error_temporal_se_reintenta_hasta_el_tope(world):
    world.send_result = (False, "red: ConnectError", False)
    alert = add(100.0)
    _triggered(alert)
    for _ in range(chk.MAX_NOTIFY_ATTEMPTS + 3):
        chk._flush_notifications()
    assert len(world.sent) == chk.MAX_NOTIFY_ATTEMPTS and get(alert)["notified"] == 0
    world.send_result = (True, "", False)  # ya agotado: no vuelve a intentar
    chk._flush_notifications()
    assert len(world.sent) == chk.MAX_NOTIFY_ATTEMPTS


# ---------------------------------------------------------------- envio por el bot (httpx simulado)

class FakeResp:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body


def test_send_message_resultados(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "TESTTOKEN")
    monkeypatch.setattr(settings, "miniapp_url", "https://example.org/miniapp")
    seen = {}

    def post(url, json, timeout):
        seen["json"] = json
        return seen["resp"]

    monkeypatch.setattr(httpx, "post", post)
    seen["resp"] = FakeResp(200)
    assert chk.send_message(7, "hola") == (True, "", False)
    assert seen["json"]["reply_markup"]["inline_keyboard"][0][0]["web_app"]["url"] == "https://example.org/miniapp"
    seen["resp"] = FakeResp(403, {"description": "Forbidden: bot was blocked by the user"})
    assert chk.send_message(7, "hola")[0::2] == (False, True)
    seen["resp"] = FakeResp(400, {"description": "Bad Request: chat not found"})
    assert chk.send_message(7, "hola")[2] is True
    seen["resp"] = FakeResp(429, {"description": "Too Many Requests"})
    assert chk.send_message(7, "hola")[0::2] == (False, False)
    monkeypatch.setattr(settings, "miniapp_url", "")
    seen["resp"] = FakeResp(200)
    chk.send_message(7, "hola")
    assert "reply_markup" not in seen["json"]


def test_send_message_error_de_red_no_filtra_el_token(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "TESTTOKEN")

    def post(url, json, timeout):
        raise httpx.ConnectError(f"fallo contra {url}")

    monkeypatch.setattr(httpx, "post", post)
    ok, detail, permanent = chk.send_message(7, "hola")
    assert (ok, permanent) == (False, False) and "TESTTOKEN" not in detail and detail == "red: ConnectError"


def test_send_message_sin_token(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    assert chk.send_message(7, "hola") == (False, "sin token", False)


# ---------------------------------------------------------------- hilo

def test_start_respeta_intervalo_y_token(monkeypatch):
    monkeypatch.setattr(chk, "_loop", lambda: None)
    monkeypatch.setattr(settings, "telegram_bot_token", "TESTTOKEN")
    monkeypatch.setattr(settings, "price_check_interval_seconds", 0)
    assert chk.start() is False
    monkeypatch.setattr(settings, "price_check_interval_seconds", 300)
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    assert chk.start() is False
    monkeypatch.setattr(settings, "telegram_bot_token", "TESTTOKEN")
    monkeypatch.setattr(chk, "_thread", None)
    assert chk.start() is True
    chk._thread.join(timeout=2)
    chk.stop()
    monkeypatch.setattr(chk, "_thread", None)


def test_importar_la_app_no_arranca_el_hilo():
    import src.app  # noqa: F401  (bajo pytest el arranque del checker esta desactivado)

    assert chk.running() is False

