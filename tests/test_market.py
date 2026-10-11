"""Tests de Mercado (/p): servicio ``src/services/market.py`` y API ``/api/market``. Sin red."""

import pytest

from config import settings
from src.services import crypto, market
from src.services.crypto import CoinGeckoNetworkError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)


def cmc_item(symbol, price, rank=5, **usd):
    quote = {"price": price, "percent_change_1h": 0.5, "percent_change_24h": -2.5, "percent_change_7d": 8.1,
             "market_cap": 1_000_000.0, "volume_24h": 50_000.0}
    quote.update(usd)
    return {"id": 1, "symbol": symbol, "name": symbol.title(), "cmc_rank": rank, "quote": {"USD": quote}}


def cmc_data(symbol="SOL", price=150.0, eth=3000.0, btc=60000.0, **usd):
    data = {symbol: cmc_item(symbol, price, **usd)}
    data.setdefault("ETH", cmc_item("ETH", eth, rank=2))
    data.setdefault("BTC", cmc_item("BTC", btc, rank=1))
    return data


CG = {
    "not_found": False, "symbol_used": "SOL", "ath": 260.0, "ath_change_pct": -42.3, "ath_date": "2021-11-06T14:24:11.849Z",
    "atl": 0.5, "atl_date": "2020-05-11T19:35:23.449Z", "circulating_supply": 430e6, "total_supply": 590e6,
    "max_supply": None, "category": "Smart Contract Platform", "sentiment_up_pct": 81.0, "market_cap_rank": 7,
    "price": 149.5, "percent_change_24h": -2.4, "percent_change_7d": 8.0, "market_cap": 9e10, "volume_24h": 4e9,
    "high_24h": 155.0, "low_24h": 145.0,
}


@pytest.fixture
def src(monkeypatch, tmp_path):
    """Fuentes simuladas y SQLite temporal. ``s.cmc`` / ``s.cg`` / ``s.binance`` se pueden cambiar en cada test."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "t.db"))

    class S:
        cmc = cmc_data()
        cg = dict(CG)
        binance = {"SOLUSDT": {"price": 150.0, "high": 156.0, "low": 144.0, "change_pct": -2.5, "volume_quote": 1.0}}
        calls = {"cmc": 0, "cg": 0}

    def fake_cmc(symbols, ring=None):
        S.calls["cmc"] += 1
        if isinstance(S.cmc, Exception):
            raise S.cmc
        return S.cmc

    def fake_cg(symbol):
        S.calls["cg"] += 1
        if isinstance(S.cg, Exception):
            raise S.cg
        return S.cg

    monkeypatch.setattr(crypto, "cmc_quotes_by_symbol", fake_cmc)
    monkeypatch.setattr(crypto, "cg_enrichment", fake_cg)
    monkeypatch.setattr(crypto, "binance_ticker_24h", lambda pair: S.binance.get(pair))
    return S


# ------------------------------------------------------------------ símbolo


@pytest.mark.parametrize("raw,expected", [("btc", "BTC"), (" $eth ", "ETH"), ("1INCH", "1INCH"), ("", None),
                                          ("BT C", None), ("A" * 16, None), ("../x", None), (None, None)])
def test_normalize_symbol(raw, expected):
    assert market.normalize_symbol(raw) == expected


# ------------------------------------------------------------------ get_market


def test_cmc_es_la_fuente_primaria_con_todos_los_datos(src):
    m = market.get_market("sol")
    assert m["source"] == "coinmarketcap" and m["symbol"] == "SOL" and m["name"] == "Sol"
    assert m["price"] == 150.0 and m["rank"] == 5
    assert m["price_eth"] == pytest.approx(150 / 3000) and m["price_btc"] == pytest.approx(150 / 60000)
    assert (m["high_24h"], m["low_24h"]) == (156.0, 144.0)
    assert (m["change_1h"], m["change_24h"], m["change_7d"]) == (0.5, -2.5, 8.1)
    assert m["market_cap"] == 1_000_000.0 and m["volume_24h"] == 50_000.0
    e = m["enrichment"]
    assert e["ath"] == 260.0 and e["atl"] == 0.5 and e["category"] == "Smart Contract Platform"
    assert e["max_supply"] is None and e["cg_rank"] == 7  # difiere del de CMC (5)
    assert m["fetched_at"].endswith("Z")


def test_el_rank_de_coingecko_solo_se_muestra_si_difiere(src):
    src.cg = dict(CG, market_cap_rank=5)
    assert market.get_market("SOL")["enrichment"]["cg_rank"] is None


def test_los_ceros_de_la_api_son_sin_dato(src):
    src.cmc = cmc_data(market_cap=0, volume_24h=0, percent_change_1h=None)
    m = market.get_market("SOL")
    assert m["market_cap"] is None and m["volume_24h"] is None and m["change_1h"] is None


def test_consultar_eth_o_btc_no_duplica_simbolos(src, monkeypatch):
    seen = []
    monkeypatch.setattr(crypto, "cmc_quotes_by_symbol", lambda symbols, ring=None: seen.append(symbols) or cmc_data("ETH", 3000.0))
    src.cg = {"not_found": False, "symbol_used": "ETH"}
    market.get_market("ETH")
    assert seen == [["ETH", "BTC"]]


def test_high_low_prueba_usdc_y_luego_coingecko(src):
    src.binance = {"SOLUSDC": {"price": 150.0, "high": 157.0, "low": 143.0, "change_pct": 0, "volume_quote": 0}}
    assert (market.get_market("SOL")["high_24h"], market.get_market("SOL")["low_24h"]) == (157.0, 143.0)
    src.binance = {}
    m = market.get_market("SOL")
    assert (m["high_24h"], m["low_24h"]) == (155.0, 145.0)
    src.cg = dict(CG, high_24h=None, low_24h=None)
    m = market.get_market("SOL")
    assert m["high_24h"] is None and m["low_24h"] is None


def test_si_coingecko_cae_se_sigue_sin_el_bloque_extra(src):
    src.cg = CoinGeckoNetworkError("timeout")
    m = market.get_market("SOL")
    assert m["source"] == "coinmarketcap" and m["enrichment"] is None
    assert (m["high_24h"], m["low_24h"]) == (156.0, 144.0)


def test_si_cmc_no_trae_eth_o_btc_se_usa_coingecko_como_primaria(src):
    data = cmc_data()
    del data["ETH"]
    src.cmc = data
    m = market.get_market("SOL")
    assert m["source"] == "coingecko" and m["price"] == 149.5
    assert m["price_eth"] is None and m["price_btc"] is None and m["change_1h"] is None


def test_cmc_caido_y_coingecko_con_la_moneda(src):
    src.cmc = None
    m = market.get_market("SOL")
    assert m["source"] == "coingecko" and m["rank"] == 7 and m["enrichment"]["ath"] == 260.0


def test_cmc_con_precio_invalido_cae_a_coingecko(src):
    src.cmc = cmc_data(price=0)
    assert market.get_market("SOL")["source"] == "coingecko"


def test_no_existe_solo_si_coingecko_lo_confirma(src):
    src.cmc = None
    src.cg = {"not_found": True}
    assert market.get_market("NOPE") == {"not_found": True, "symbol": "NOPE"}


def test_fallo_tecnico_si_todo_cae_por_red(src):
    src.cmc = None
    src.cg = CoinGeckoNetworkError("x")
    assert market.get_market("SOL") is None
    src.cg = None  # CoinGecko sin keys
    assert market.get_market("SOL") is None


def test_datos_raros_de_cmc_no_rompen(src):
    src.cmc = {"SOL": {"symbol": "SOL"}, "ETH": {"quote": 3}, "BTC": cmc_item("BTC", 1)}
    assert market.get_market("SOL")["source"] == "coingecko"


# ------------------------------------------------------------------ top 5


def test_top_sin_uso_es_la_semilla(src):
    assert market.top_symbols() == ["BTC", "ETH", "SOL", "BNB", "HIVE"]


def test_top_cuenta_usuarios_distintos_y_completa_con_la_semilla(src):
    for uid in (1, 2, 3):
        market.record_query(uid, "DOGE")
    for uid in (1, 2):
        market.record_query(uid, "HIVE")
    market.record_query(1, "HIVE")  # mismo usuario y día: no suma
    market.record_query(9, "ADA")
    assert market.top_symbols() == ["DOGE", "HIVE", "ADA", "BTC", "ETH"]


def test_top_un_usuario_que_repite_no_pesa_mas(src):
    for _ in range(5):
        market.record_query(1, "XRP")
    for uid in (1, 2):
        market.record_query(uid, "LTC")
    assert market.top_symbols()[:2] == ["LTC", "XRP"]


def test_top_ignora_consultas_de_mas_de_30_dias(src):
    from src import db

    with db.connect() as conn:
        conn.execute("INSERT INTO coin_queries (user_id, symbol, day) VALUES (1, 'OLD', '2020-01-01')")
    assert "OLD" not in market.top_symbols()


def test_record_query_limpia_filas_muy_viejas(src):
    from src import db

    with db.connect() as conn:
        conn.execute("INSERT INTO coin_queries (user_id, symbol, day) VALUES (1, 'OLD', '2020-01-01')")
    market.record_query(2, "BTC")
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM coin_queries WHERE symbol='OLD'").fetchone()[0] == 0


# ------------------------------------------------------------------ API


def test_api_exige_initdata(ctx, src):  # noqa: F811
    assert ctx.client.get("/api/market/SOL").status_code == 401
    assert ctx.client.get("/api/market/top").status_code == 401


def test_api_moneda_ok_y_anota_la_consulta(ctx, src):  # noqa: F811
    r = ctx.get("/api/market/sol")
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True and body["stale"] is False
    assert body["market"]["symbol"] == "SOL" and body["market"]["price"] == 150.0
    assert ctx.get("/api/market/top").get_json()["symbols"][0] == "SOL"
    assert r.headers["Content-Security-Policy"] and r.headers["Cache-Control"] == "no-store"


def test_api_simbolo_invalido_es_400_y_no_consulta(ctx, src):  # noqa: F811
    for bad in ("BT%20C", "AAAAAAAAAAAAAAAAAAAA", "%24"):
        assert ctx.get(f"/api/market/{bad}").status_code == 400
    assert src.calls == {"cmc": 0, "cg": 0}


def test_api_no_existe_es_404_y_no_cuenta_para_el_top(ctx, src):  # noqa: F811
    src.cmc, src.cg = None, {"not_found": True}
    r = ctx.get("/api/market/NOPE")
    assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"
    assert "NOPE" not in ctx.get("/api/market/top").get_json()["symbols"]


def test_api_fallo_tecnico_es_502(ctx, src):  # noqa: F811
    src.cmc, src.cg = None, None
    r = ctx.get("/api/market/SOL")
    assert r.status_code == 502 and r.get_json()["error"]["code"] == "upstream_unavailable"


def test_api_se_cachea_un_minuto_y_sirve_lo_ultimo_si_cae(ctx, src):  # noqa: F811
    ctx.get("/api/market/SOL")
    ctx.get("/api/market/SOL")
    assert src.calls["cmc"] == 1
    ctx.clock.t += 61
    src.cmc, src.cg = None, None
    body = ctx.get("/api/market/SOL").get_json()
    assert body["stale"] is True and body["market"]["price"] == 150.0
    ctx.clock.t += 16 * 60
    assert ctx.get("/api/market/SOL").status_code == 502


def test_api_top_devuelve_cinco(ctx, src):  # noqa: F811
    body = ctx.get("/api/market/top").get_json()
    assert body == {"ok": True, "symbols": ["BTC", "ETH", "SOL", "BNB", "HIVE"]}
