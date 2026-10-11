"""Mercado (``/p`` del bot) en la miniapp (S10 F2): datos de una moneda y top de las más consultadas.

Es el puerto a Flask de ``taso-bot/src/crypto_client.py::get_crypto_data``. Orden de fuentes, igual que el bot:
1. CoinMarketCap (precio, 1h/24h/7d, rank, cap, volumen, precio en ETH y BTC) + CoinGecko en paralelo (bloque extra).
2. Si CMC no tiene la moneda o falla, CoinGecko pasa a ser la fuente primaria (``source: "coingecko"``).
3. high/low 24h: Binance (USDT/USDC, US y global de respaldo) y, si no hay, CoinGecko.
CryptoCompare ya no se usa. «No existe» solo se afirma si CoinGecko lo confirma; si no, un fallo es técnico (None).
"""

from __future__ import annotations

import logging
import math
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from src import db
from src.services import crypto
from src.services.crypto import CoinGeckoNetworkError

logger = logging.getLogger("taso-miniapp.market")

SEED_TOP = ("BTC", "ETH", "SOL", "BNB", "HIVE")
TOP_N = 5
TOP_DAYS = 30
SYMBOL_RE = re.compile(r"^[A-Z0-9]{1,15}$")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="market")


def normalize_symbol(raw: Any) -> Optional[str]:
    """Símbolo en mayúsculas (admite ``$btc``) o None si no es válido."""
    symbol = str(raw or "").strip().lstrip("$").upper()
    return symbol if SYMBOL_RE.match(symbol) else None


def _num(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _pos(value: Any) -> Optional[float]:
    """Número finito > 0 o None (un 0 de la API es «sin dato», no un precio)."""
    number = _num(value)
    return number if number and number > 0 else None


def _quote_item(data: Optional[dict], symbol: str) -> Optional[dict]:
    item = (data or {}).get(symbol)
    if isinstance(item, list):  # algunas versiones de CMC devuelven una lista por símbolo
        item = item[0] if item else None
    return item if isinstance(item, dict) else None


def _high_low(symbol: str, cg: Optional[dict]) -> tuple[Optional[float], Optional[float]]:
    for quote in crypto.QUOTE_ASSETS:
        ticker = crypto.binance_ticker_24h(symbol + quote)
        if ticker and ticker["high"]:
            return ticker["high"], ticker["low"]
    if cg and not cg.get("not_found") and _pos(cg.get("high_24h")):
        return _pos(cg.get("high_24h")), _pos(cg.get("low_24h"))
    return None, None


def _public_enrichment(cg: Optional[dict], cmc_rank: Optional[int]) -> Optional[dict]:
    if not cg or cg.get("not_found"):
        return None
    cg_rank = cg.get("market_cap_rank")
    return {
        "ath": _pos(cg.get("ath")),
        "ath_change_pct": _num(cg.get("ath_change_pct")),
        "ath_date": cg.get("ath_date"),
        "atl": _pos(cg.get("atl")),
        "atl_date": cg.get("atl_date"),
        "circulating_supply": _pos(cg.get("circulating_supply")),
        "total_supply": _pos(cg.get("total_supply")),
        "max_supply": _pos(cg.get("max_supply")),
        "category": cg.get("category") or None,
        "sentiment_up_pct": _num(cg.get("sentiment_up_pct")),
        # Solo si difiere del de CMC (igual que el bot).
        "cg_rank": cg_rank if cg_rank and cg_rank != cmc_rank else None,
    }


def get_market(symbol: str) -> Optional[dict]:
    """Datos completos de una moneda.

    Devuelve un dict de mercado, ``{"not_found": True, "symbol": ...}`` si CoinGecko confirma que no existe, o None
    si todo falló por red (error técnico). Los ceros de la API pasan a None para no mostrar «$0».
    """
    symbol = symbol.upper()
    cmc_symbols = list(dict.fromkeys([symbol, "ETH", "BTC"]))
    f_cmc = _pool.submit(crypto.cmc_quotes_by_symbol, cmc_symbols)
    f_cg = _pool.submit(crypto.cg_enrichment, symbol)
    cmc = f_cmc.result()
    cg_not_found = False
    try:
        cg = f_cg.result()
    except CoinGeckoNetworkError as exc:
        logger.warning("CoinGecko sin respuesta para %s: %s", symbol, exc)
        cg = None
    if cg and cg.get("not_found"):
        cg_not_found, cg = True, None

    # CMC primaria: hace falta la moneda y también ETH y BTC (como el bot).
    item = _quote_item(cmc, symbol)
    if item and all(_quote_item(cmc, s) for s in cmc_symbols):
        try:
            usd = item["quote"]["USD"]
            price = _pos(usd.get("price"))
            if price is not None:
                price_eth = _pos(_quote_item(cmc, "ETH")["quote"]["USD"].get("price"))
                price_btc = _pos(_quote_item(cmc, "BTC")["quote"]["USD"].get("price"))
                high, low = _high_low(symbol, cg)
                rank = int(item.get("cmc_rank") or 0) or None
                return {
                    "symbol": str(item.get("symbol") or symbol).upper(),
                    "name": item.get("name") or None,
                    "source": "coinmarketcap",
                    "price": price,
                    "price_eth": price / price_eth if price_eth else None,
                    "price_btc": price / price_btc if price_btc else None,
                    "high_24h": high,
                    "low_24h": low,
                    "change_1h": _num(usd.get("percent_change_1h")),
                    "change_24h": _num(usd.get("percent_change_24h")),
                    "change_7d": _num(usd.get("percent_change_7d")),
                    "rank": rank,
                    "market_cap": _pos(usd.get("market_cap")),
                    "volume_24h": _pos(usd.get("volume_24h")),
                    "enrichment": _public_enrichment(cg, rank),
                    "fetched_at": db.now_iso(),
                }
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            logger.warning("Datos de CMC raros para %s: %s", symbol, type(exc).__name__)

    # CoinGecko como fuente primaria (tokens que CMC no tiene o CMC caído).
    if cg and _pos(cg.get("price")):
        rank = int(cg.get("market_cap_rank") or 0) or None
        high, low = _high_low(symbol, cg)
        return {
            "symbol": cg.get("symbol_used") or symbol,
            "name": None,
            "source": "coingecko",
            "price": _pos(cg.get("price")),
            "price_eth": None,
            "price_btc": None,
            "high_24h": high,
            "low_24h": low,
            "change_1h": None,
            "change_24h": _num(cg.get("percent_change_24h")),
            "change_7d": _num(cg.get("percent_change_7d")),
            "rank": rank,
            "market_cap": _pos(cg.get("market_cap")),
            "volume_24h": _pos(cg.get("volume_24h")),
            "enrichment": _public_enrichment(cg, rank),
            "fetched_at": db.now_iso(),
        }

    if cg_not_found:
        return {"not_found": True, "symbol": symbol}
    return None


# ---------------------------------------------------------------- Uso de monedas → top 5


def record_query(user_id: int, symbol: str) -> None:
    """Anota que este usuario consultó la moneda hoy (una fila por usuario, moneda y día). Nunca rompe la petición."""
    today = datetime.now(timezone.utc).date()
    try:
        with db.connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO coin_queries (user_id, symbol, day) VALUES (?, ?, ?)",
                (int(user_id), symbol, today.isoformat()),
            )
            conn.execute("DELETE FROM coin_queries WHERE day < ?", ((today - timedelta(days=TOP_DAYS * 2)).isoformat(),))
    except sqlite3.Error as exc:
        logger.warning("No se pudo anotar la consulta de %s: %s", symbol, exc)


def top_symbols(n: int = TOP_N) -> list[str]:
    """Las ``n`` monedas más consultadas (usuarios distintos, últimos 30 días); lo que falte se completa con la semilla."""
    since = (datetime.now(timezone.utc).date() - timedelta(days=TOP_DAYS)).isoformat()
    top: list[str] = []
    try:
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT symbol, COUNT(DISTINCT user_id) AS users FROM coin_queries WHERE day >= ? "
                "GROUP BY symbol ORDER BY users DESC, symbol ASC LIMIT ?",
                (since, n),
            ).fetchall()
        top = [r["symbol"] for r in rows]
    except sqlite3.Error as exc:
        logger.warning("No se pudo leer el top de monedas: %s", exc)
    for seed in SEED_TOP:
        if len(top) >= n:
            break
        if seed not in top:
            top.append(seed)
    return top[:n]
