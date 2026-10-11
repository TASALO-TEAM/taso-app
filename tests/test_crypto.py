"""Tests de las fuentes de precios cripto (src/services/crypto.py) y de la SQLite propia (src/db.py). Sin red."""

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from config import settings
from src.services import crypto
from src.services.crypto import CoinRef, Reading


class Resp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("sin cuerpo")
        return self._body


class FakeNet:
    """Sustituye ``crypto._http_get``: enruta por trozo de URL y registra las llamadas."""

    def __init__(self):
        self.routes: list[tuple[str, object]] = []
        self.calls: list[tuple[str, dict, dict]] = []

    def on(self, fragment, response):
        """``response``: Resp, excepción o función ``(params, headers) -> Resp``. Las rutas se prueban en orden."""
        self.routes.append((fragment, response))
        return self

    def __call__(self, url, *, params=None, headers=None, timeout=None):
        self.calls.append((url, params or {}, headers or {}))
        for fragment, response in self.routes:
            if fragment in url:
                if isinstance(response, Exception):
                    raise response
                return response(params or {}, headers or {}) if callable(response) else response
        return Resp(404, {})

    def count(self, fragment):
        return sum(1 for url, _, _ in self.calls if fragment in url)


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet()
    monkeypatch.setattr(crypto, "_http_get", fake)
    monkeypatch.setattr(settings, "binance_base_url", "https://bn-us.test")
    monkeypatch.setattr(settings, "binance_fallback_url", "https://bn-global.test")
    monkeypatch.setattr(settings, "coinmarketcap_api_key", "cmc1,cmc2")
    monkeypatch.setattr(settings, "cmc_api_key_alerta", "")
    monkeypatch.setattr(settings, "coingecko_api_key", "cg1,cg2")
    crypto._cg_id_cache.clear()
    return fake


def iso_ago(seconds):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def cmc_body(prices: dict, age=30):
    return {
        "data": {
            str(i): {"id": i, "quote": {"USD": {"price": p, "last_updated": iso_ago(age)}}} for i, p in prices.items()
        }
    }


# ------------------------------------------------------------------ utilidades


@pytest.mark.parametrize("value", [0, -1, "x", None, float("nan"), float("inf"), "0"])
def test_to_price_rechaza_lecturas_invalidas(value):
    assert crypto.to_price(value) is None


def test_to_price_acepta_numeros_y_cadenas():
    assert crypto.to_price("65000.12") == 65000.12
    assert crypto.to_price(1e-8) == 1e-8


def test_keyring_rota_round_robin_y_sin_keys_es_falso():
    ring = crypto.KeyRing(["a", "b"])
    assert [ring.next() for _ in range(4)] == ["a", "b", "a", "b"]
    empty = crypto.KeyRing([])
    assert not empty and empty.next() is None


def test_cmc_alert_keys_cae_al_pool_interactivo(monkeypatch):
    monkeypatch.setattr(settings, "coinmarketcap_api_key", "k1, k2")
    monkeypatch.setattr(settings, "cmc_api_key_alerta", "")
    assert settings.cmc_alert_keys == ["k1", "k2"]
    monkeypatch.setattr(settings, "cmc_api_key_alerta", "z")
    assert settings.cmc_alert_keys == ["z"]


# ------------------------------------------------------------------ CMC


def test_cmc_rota_de_key_ante_429(net):
    seen = []

    def handler(params, headers):
        seen.append(headers["X-CMC_PRO_API_KEY"])
        return Resp(429, {}) if len(seen) == 1 else Resp(200, cmc_body({1: 65000.0}))

    net.on("coinmarketcap", handler)
    out = crypto.cmc_readings_by_id([1])
    assert out[1].price == 65000.0 and out[1].source == "cmc"
    assert len(set(seen)) == 2


def test_cmc_sin_keys_no_consulta(net, monkeypatch):
    monkeypatch.setattr(settings, "coinmarketcap_api_key", "")
    assert crypto.cmc_readings_by_id([1]) == {}
    assert net.count("coinmarketcap") == 0


def test_cmc_descarta_precios_invalidos(net):
    net.on("coinmarketcap", Resp(200, cmc_body({1: 0, 2: -5, 3: 12.5})))
    assert set(crypto.cmc_readings_by_id([1, 2, 3])) == {3}


def test_cmc_error_de_red_devuelve_vacio(net):
    net.on("coinmarketcap", httpx.ConnectError("boom"))
    assert crypto.cmc_readings_by_id([1]) == {}


# ------------------------------------------------------------------ Binance


def test_binance_prices_una_llamada_y_filtra(net):
    net.on(
        "/ticker/price",
        Resp(200, [{"symbol": "BTCUSDT", "price": "65000"}, {"symbol": "ETHUSDT", "price": "0"}]),
    )
    assert crypto.binance_prices(["btcusdt", "ETHUSDT"]) == {"BTCUSDT": 65000.0}
    assert net.count("/ticker/price") == 1


def test_binance_prices_si_un_par_no_existe_pide_el_listado_completo(net):
    def handler(params, headers):
        if "symbols" in params:
            return Resp(400, {"code": -1121})
        return Resp(200, [{"symbol": "BTCUSDT", "price": "65000"}, {"symbol": "XXXUSDT", "price": "1"}])

    net.on("/ticker/price", handler)
    assert crypto.binance_prices(["BTCUSDT", "NOEXISTE"]) == {"BTCUSDT": 65000.0}
    assert net.count("/ticker/price") == 3  # lista en US (400), lista en global (400), listado completo en US


def test_binance_usa_primero_la_de_us_y_no_toca_la_global(net):
    net.on("/ticker/price", Resp(200, [{"symbol": "BTCUSDT", "price": "65000"}]))
    assert crypto.binance_prices(["BTCUSDT"]) == {"BTCUSDT": 65000.0}
    assert [u for u, _, _ in net.calls] == ["https://bn-us.test/api/v3/ticker/price"]


def test_binance_cae_a_la_global_si_la_de_us_falla_o_no_tiene_el_par(net):
    net.on("bn-us.test", httpx.ConnectError("caída"))
    net.on("bn-global.test", Resp(200, {"symbol": "ABCUSDT", "price": "3.5"}))
    assert crypto.binance_resolve_pair("abc") == ("ABCUSDT", 3.5)
    net.routes.clear()
    net.calls.clear()
    net.on("bn-us.test", Resp(400, {"code": -1121}))
    net.on("bn-global.test", Resp(200, {"symbol": "ABCUSDT", "price": "3.6"}))
    assert crypto.binance_resolve_pair("ABC") == ("ABCUSDT", 3.6)
    assert [u.split("/api")[0] for u, _, _ in net.calls] == ["https://bn-us.test", "https://bn-global.test"]


def test_binance_global_con_451_y_us_caida_devuelve_vacio(net):
    net.on("bn-us.test", httpx.ReadTimeout("t"))
    net.on("bn-global.test", Resp(451, {}))
    assert crypto.binance_prices(["BTCUSDT"]) == {}


def test_binance_sin_respaldo_configurado_o_igual_a_la_principal_no_repite(net, monkeypatch):
    monkeypatch.setattr(settings, "binance_fallback_url", "https://bn-us.test/")
    net.on("/ticker/price", Resp(400, {}))
    assert crypto.binance_resolve_pair("ZZZ") is None
    assert {u.split("/api")[0] for u, _, _ in net.calls} == {"https://bn-us.test"}
    monkeypatch.setattr(settings, "binance_fallback_url", "")
    net.calls.clear()
    assert crypto.binance_resolve_pair("ZZZ") is None
    assert {u.split("/api")[0] for u, _, _ in net.calls} == {"https://bn-us.test"}


def test_binance_resolve_pair_prueba_usdt_y_luego_usdc(net):
    net.on("/ticker/price", lambda p, h: Resp(200, {"symbol": "ABCUSDC", "price": "2.5"}) if p["symbol"] == "ABCUSDC" else Resp(400, {}))
    assert crypto.binance_resolve_pair("abc") == ("ABCUSDC", 2.5)


def test_binance_resolve_pair_none_si_no_existe(net):
    net.on("/ticker/price", Resp(400, {}))
    assert crypto.binance_resolve_pair("ZZZ") is None


def test_binance_451_se_trata_como_fallo(net):
    net.on("/ticker/price", Resp(451, {}))
    assert crypto.binance_prices(["BTCUSDT"]) == {}


def test_binance_candles_descarta_velas_invalidas(net):
    t0 = int(datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)
    rows = [
        [t0, "1", "10", "9", "9.5"],
        [t0 + 300000, "1", "8", "9", "9"],  # low > high: inválida
        [t0 + 600000, "1", "0", "0", "0"],  # ceros: inválida
        ["x"],
    ]
    net.on("/klines", Resp(200, rows))
    candles = crypto.binance_candles("BTCUSDT", datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc))
    assert [(c.high, c.low) for c in candles] == [(10.0, 9.0)]


# ------------------------------------------------------------------ CoinGecko


def test_cg_resolve_id_exacto_y_cache(net):
    net.on("/search", Resp(200, {"coins": [{"id": "x-token", "symbol": "XT"}, {"id": "hive", "symbol": "hive"}]}))
    assert crypto.cg_resolve_id("HIVE") == "hive"
    assert crypto.cg_resolve_id("hive") == "hive"
    assert net.count("/search") == 1


def test_cg_resolve_id_inexistente_se_recuerda(net):
    net.on("/search", Resp(200, {"coins": []}))
    assert crypto.cg_resolve_id("NOPE") is None
    assert crypto.cg_resolve_id("NOPE") is None
    assert net.count("/search") == 1


def test_cg_error_de_red_no_se_recuerda_y_lanza(net):
    net.on("/search", httpx.ReadTimeout("t"))
    with pytest.raises(crypto.CoinGeckoNetworkError):
        crypto.cg_resolve_id("BTC")
    net.routes.clear()
    net.on("/search", Resp(200, {"coins": [{"id": "bitcoin", "symbol": "btc"}]}))
    assert crypto.cg_resolve_id("BTC") == "bitcoin"


def test_cg_rota_de_key_ante_429(net):
    seen = []

    def handler(params, headers):
        seen.append(headers["x-cg-demo-api-key"])
        return Resp(429, {}) if len(seen) == 1 else Resp(200, {"coins": [{"id": "bitcoin", "symbol": "btc"}]})

    net.on("/search", handler)
    assert crypto.cg_resolve_id("BTC") == "bitcoin"
    assert len(set(seen)) == 2


def test_cg_sin_keys_no_consulta(net, monkeypatch):
    monkeypatch.setattr(settings, "coingecko_api_key", "")
    assert crypto.cg_resolve_id("BTC") is None
    assert net.count("coingecko") == 0


def test_cg_readings_incluye_edad_y_descarta_invalidos(net):
    now = datetime.now(timezone.utc).timestamp()
    net.on(
        "/simple/price",
        Resp(200, {"hive": {"usd": 0.2, "last_updated_at": now - 60}, "bad": {"usd": 0}, "none": {}}),
    )
    out = crypto.cg_readings_by_id(["hive", "bad", "none"])
    assert set(out) == {"hive"} and 50 < out["hive"].age_seconds < 90


# ------------------------------------------------------------------ resolve_coin


def test_resolve_coin_junta_los_ids_de_las_tres_fuentes(net):
    net.on("/ticker/price", Resp(200, {"symbol": "BTCUSDT", "price": "65000"}))
    net.on("quotes/latest", Resp(200, {"data": {"BTC": {"id": 1, "quote": {"USD": {"price": 65010, "last_updated": iso_ago(20)}}}}}))
    net.on("/search", Resp(200, {"coins": [{"id": "bitcoin", "symbol": "btc"}]}))
    net.on("/simple/price", Resp(200, {"bitcoin": {"usd": 64990, "last_updated_at": datetime.now(timezone.utc).timestamp()}}))
    ref, readings = crypto.resolve_coin("btc")
    assert ref == CoinRef("BTC", "BTCUSDT", 1, "bitcoin")
    assert set(readings) == {"binance", "cmc", "coingecko"}
    assert ref.key == "bn:BTCUSDT"


def test_resolve_coin_solo_coingecko_si_binance_y_cmc_no_la_tienen(net):
    net.on("/ticker/price", Resp(400, {}))
    net.on("quotes/latest", Resp(400, {}))
    net.on("/search", Resp(200, {"coins": [{"id": "rare", "symbol": "rare"}]}))
    net.on("/simple/price", Resp(200, {"rare": {"usd": 0.5}}))
    ref, readings = crypto.resolve_coin("RARE")
    assert ref == CoinRef("RARE", None, None, "rare") and ref.key == "cg:rare"
    assert set(readings) == {"coingecko"}


def test_resolve_coin_inexistente(net):
    net.on("/ticker/price", Resp(400, {}))
    net.on("quotes/latest", Resp(400, {}))
    net.on("/search", Resp(200, {"coins": []}))
    assert crypto.resolve_coin("NOPE") == (None, {})


def test_resolve_coin_si_coingecko_cae_no_inventa_su_id(net):
    net.on("/ticker/price", Resp(200, {"symbol": "ETHUSDT", "price": "3000"}))
    net.on("quotes/latest", Resp(400, {}))
    net.on("/search", httpx.ConnectError("x"))
    ref, readings = crypto.resolve_coin("ETH")
    assert ref == CoinRef("ETH", "ETHUSDT", None, None) and set(readings) == {"binance"}


# ------------------------------------------------------------------ fetch_primary / fetch_confirmation


BTC = CoinRef("BTC", "BTCUSDT", 1, "bitcoin")
HIVE = CoinRef("HIVE", None, 5370, "hive")
ONLY_CG = CoinRef("RARE", None, None, "rare")


def test_fetch_primary_binance_primero_y_cmc_solo_para_el_resto(net):
    net.on("/ticker/price", Resp(200, [{"symbol": "BTCUSDT", "price": "65000"}]))
    net.on("quotes/latest", Resp(200, cmc_body({5370: 0.2})))
    out = crypto.fetch_primary([BTC, HIVE])
    assert out[BTC.key] == Reading(65000.0, "binance")
    assert out[HIVE.key].source == "cmc"
    assert net.count("quotes/latest") == 1  # una sola llamada por lote
    assert net.count("coingecko") == 0


def test_fetch_primary_descarta_cmc_viejo_y_cae_a_coingecko(net):
    net.on("quotes/latest", Resp(200, cmc_body({5370: 0.2}, age=3600)))
    net.on("/simple/price", Resp(200, {"hive": {"usd": 0.21, "last_updated_at": datetime.now(timezone.utc).timestamp() - 30}}))
    out = crypto.fetch_primary([HIVE])
    assert out[HIVE.key].source == "coingecko" and out[HIVE.key].price == 0.21


def test_fetch_primary_sin_lectura_valida_deja_la_moneda_fuera(net):
    net.on("quotes/latest", Resp(200, cmc_body({5370: 0.2}, age=3600)))
    net.on("/simple/price", Resp(200, {"hive": {"usd": 0.2, "last_updated_at": datetime.now(timezone.utc).timestamp() - 7200}}))
    assert crypto.fetch_primary([HIVE]) == {}


def test_fetch_primary_binance_caido_cae_a_cmc(net):
    net.on("/ticker/price", Resp(451, {}))
    net.on("quotes/latest", Resp(200, cmc_body({1: 64900.0})))
    out = crypto.fetch_primary([BTC])
    assert out[BTC.key].source == "cmc"


def test_fetch_confirmation_usa_otra_fuente_distinta(net):
    net.on("quotes/latest", Resp(200, cmc_body({1: 65010.0})))
    got = crypto.fetch_confirmation(BTC, "binance")
    assert got is not None and got.source == "cmc"
    net.on("/ticker/price", Resp(200, [{"symbol": "BTCUSDT", "price": "65005"}]))
    got = crypto.fetch_confirmation(BTC, "cmc")
    assert got is not None and got.source == "binance"


def test_fetch_confirmation_none_si_no_hay_segunda_fuente(net):
    assert crypto.fetch_confirmation(ONLY_CG, "coingecko") is None


# ------------------------------------------------------------------ SQLite


def test_init_db_es_idempotente_y_crea_las_tablas(tmp_path, monkeypatch):
    from src import db

    monkeypatch.setattr(settings, "db_path", str(tmp_path / "sub" / "t.db"))
    db.init_db()
    db.init_db()
    with db.connect() as conn:
        names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"price_alerts", "coin_queries", "coin_ticks", "lease"} <= names


def test_price_alerts_rechaza_estado_y_direccion_invalidos(tmp_path, monkeypatch):
    import sqlite3

    from src import db

    monkeypatch.setattr(settings, "db_path", str(tmp_path / "t.db"))
    db.init_db()
    with db.connect() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO price_alerts (user_id, symbol, target, direction, created_at) VALUES (1,'BTC',1,'SIDEWAYS','x')"
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO price_alerts (user_id, symbol, target, direction, status, created_at) VALUES (1,'BTC',1,'ABOVE','DONE','x')"
            )


# ------------------------------------------------------------------ cg_enrichment


COIN_BODY = {
    "symbol": "sol",
    "categories": [None, "Smart Contract Platform", "Layer 1"],
    "sentiment_votes_up_percentage": 80.5,
    "market_cap_rank": 7,
    "market_data": {
        "ath": {"usd": 260.0}, "ath_change_percentage": {"usd": -40.0}, "ath_date": {"usd": "2021-11-06T14:24:11.849Z"},
        "atl": {"usd": 0.5}, "atl_date": {"usd": "2020-05-11T19:35:23.449Z"},
        "circulating_supply": 430e6, "total_supply": 590e6, "max_supply": None,
        "current_price": {"usd": 150.0}, "price_change_percentage_24h": -2.0, "price_change_percentage_7d": 8.0,
        "market_cap": {"usd": 9e10}, "total_volume": {"usd": 4e9}, "high_24h": {"usd": 155.0}, "low_24h": {"usd": 145.0},
    },
}


def test_cg_enrichment_parsea_la_moneda(net):
    net.on("/search", Resp(200, {"coins": [{"id": "solana", "symbol": "sol"}]}))
    net.on("/coins/solana", Resp(200, COIN_BODY))
    e = crypto.cg_enrichment("sol")
    assert e["not_found"] is False and e["cg_id"] == "solana" and e["symbol_used"] == "SOL"
    assert e["ath"] == 260.0 and e["ath_change_pct"] == -40.0 and e["atl"] == 0.5
    assert e["category"] == "Smart Contract Platform" and e["max_supply"] is None
    assert e["price"] == 150.0 and e["high_24h"] == 155.0 and e["market_cap_rank"] == 7


def test_cg_enrichment_not_found_sin_keys_y_fallos(net, monkeypatch):
    net.on("/search", Resp(200, {"coins": []}))
    assert crypto.cg_enrichment("NOPE") == {"not_found": True}
    # la moneda existe pero /coins falla: se sigue sin el bloque
    crypto._cg_id_cache.clear()
    net.routes.clear()
    net.on("/search", Resp(200, {"coins": [{"id": "solana", "symbol": "sol"}]}))
    net.on("/coins/solana", Resp(500, {}))
    assert crypto.cg_enrichment("SOL") is None
    # /search caído: se propaga para no afirmar que no existe
    crypto._cg_id_cache.clear()
    net.routes.clear()
    net.on("/search", httpx.ConnectError("x"))
    with pytest.raises(crypto.CoinGeckoNetworkError):
        crypto.cg_enrichment("SOL")
    monkeypatch.setattr(settings, "coingecko_api_key", "")
    assert crypto.cg_enrichment("SOL") is None


def test_cg_enrichment_tolera_cuerpo_raro(net):
    net.on("/search", Resp(200, {"coins": [{"id": "x", "symbol": "x"}]}))
    net.on("/coins/x", Resp(200, {"market_data": "basura", "categories": None}))
    e = crypto.cg_enrichment("X")
    assert e["ath"] is None and e["category"] is None and e["price"] is None
