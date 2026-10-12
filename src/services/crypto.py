"""Fuentes de precios cripto de la app (S10): CoinMarketCap, Binance y CoinGecko. Todo síncrono (httpx).

Es la adaptación a Flask de ``taso-bot/src/crypto_client.py`` y ``coingecko_client.py``. Diferencias a propósito:
- Binance se consulta primero en Binance US (``settings.binance_base_url``) y, si falla o no tiene el par, en la global (``binance_fallback_url``), como el bot.
- CryptoCompare ya no se usa (exige API key desde 2026); high/low 24h salen de Binance y, si no hay, de CoinGecko.
- Las alertas se identifican por ids exactos (par de Binance, id de CMC, id de CoinGecko), no por símbolo.

Los tests sustituyen ``_http_get`` para no tocar la red.
"""

from __future__ import annotations

import itertools
import json
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from config import settings

logger = logging.getLogger("taso-miniapp.crypto")

CMC_BASE = "https://pro-api.coinmarketcap.com"
CG_BASE = "https://api.coingecko.com/api/v3"
TIMEOUT = 8.0

SOURCES = ("binance", "cmc", "coingecko")

_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="crypto")


class CoinGeckoNetworkError(Exception):
    """Fallo de red/HTTP con CoinGecko: no significa que la moneda no exista."""


def _http_get(url: str, *, params: Optional[dict] = None, headers: Optional[dict] = None, timeout: float = TIMEOUT):
    """GET con un cliente compartido. Lo sustituyen los tests."""
    global _client
    with _client_lock:
        if _client is None or _client.is_closed:
            _client = httpx.Client(timeout=httpx.Timeout(TIMEOUT, connect=4.0))
        client = _client
    return client.get(url, params=params, headers=headers, timeout=timeout)


class KeyRing:
    """Rotación round-robin de varias API keys (seguro entre hilos). Sin keys, ``next()`` devuelve None."""

    def __init__(self, keys: list[str]):
        self.keys = list(keys)
        self._cycle = itertools.cycle(self.keys) if self.keys else None
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self.keys)

    def next(self) -> Optional[str]:
        if not self._cycle:
            return None
        with self._lock:
            return next(self._cycle)


def interactive_ring() -> KeyRing:
    return _ring("cmc", settings.cmc_keys)


def alert_ring() -> KeyRing:
    return _ring("cmc_alert", settings.cmc_alert_keys)


def coingecko_ring() -> KeyRing:
    return _ring("cg", settings.coingecko_keys)


def groq_ring() -> KeyRing:
    return _ring("groq", settings.groq_keys)


_rings: dict[str, tuple[tuple, KeyRing]] = {}


def _ring(name: str, keys: list[str]) -> KeyRing:
    """Un KeyRing por nombre, recreado solo si cambian las keys (así la rotación persiste entre llamadas)."""
    cached = _rings.get(name)
    if cached and cached[0] == tuple(keys):
        return cached[1]
    ring = KeyRing(keys)
    _rings[name] = (tuple(keys), ring)
    return ring


def to_price(value: Any) -> Optional[float]:
    """Precio válido (número finito > 0) o None."""
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) and price > 0 else None


@dataclass(frozen=True)
class Reading:
    """Una lectura de precio: de qué fuente viene y cuántos segundos tiene el dato (None = en vivo/desconocido)."""

    price: float
    source: str
    age_seconds: Optional[float] = None


def _age_from_iso(value: Any) -> Optional[float]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())


# ---------------------------------------------------------------- CoinMarketCap


def _cmc_get(path: str, params: dict, ring: KeyRing) -> Optional[dict]:
    """GET a CMC con rotación de keys ante 429. None si no hay key, falla o responde mal."""
    if not len(ring):
        logger.warning("CMC: sin API key configurada")
        return None
    for attempt in range(len(ring)):
        key = ring.next()
        try:
            resp = _http_get(
                CMC_BASE + path, params=params, headers={"X-CMC_PRO_API_KEY": key or "", "Accept": "application/json"}
            )
        except httpx.HTTPError as exc:
            logger.warning("CMC %s falló: %s", path, type(exc).__name__)
            return None
        if resp.status_code == 429 and attempt < len(ring) - 1:
            logger.warning("CMC 429 con la key ...%s; pruebo la siguiente", (key or "")[-4:])
            continue
        if resp.status_code != 200:
            logger.warning("CMC %s respondió %s", path, resp.status_code)
            return None
        try:
            data = resp.json().get("data")
        except ValueError:
            return None
        return data if isinstance(data, dict) else None
    return None


def cmc_quotes_by_symbol(symbols: list[str], ring: Optional[KeyRing] = None) -> Optional[dict]:
    """``data`` de quotes/latest por símbolos (``{"BTC": {...}}``). None si falla (CMC rechaza la lista si hay un símbolo inválido)."""
    return _cmc_get(
        "/v1/cryptocurrency/quotes/latest", {"symbol": ",".join(symbols), "convert": "USD"}, ring or interactive_ring()
    )


def cmc_readings_by_id(ids: list[int], ring: Optional[KeyRing] = None) -> dict[int, Reading]:
    """Precios de varias monedas en UNA llamada (1 crédito por 100 monedas). Solo las lecturas válidas."""
    if not ids:
        return {}
    data = _cmc_get(
        "/v1/cryptocurrency/quotes/latest", {"id": ",".join(str(i) for i in ids), "convert": "USD"}, ring or alert_ring()
    )
    out: dict[int, Reading] = {}
    for key, item in (data or {}).items():
        try:
            usd = item["quote"]["USD"]
            price = to_price(usd.get("price"))
            if price is not None:
                out[int(key)] = Reading(price, "cmc", _age_from_iso(usd.get("last_updated")))
        except (KeyError, TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------- Binance (datos públicos, sin clave)

QUOTE_ASSETS = ("USDT", "USDC")


def _binance_bases() -> list[str]:
    """Primero Binance US y, como respaldo, la global (sin repetidas ni vacías)."""
    bases: list[str] = []
    for url in (settings.binance_base_url, settings.binance_fallback_url):
        url = (url or "").strip().rstrip("/")
        if url and url not in bases:
            bases.append(url)
    return bases


def _binance_get(path: str, params: Optional[dict] = None) -> Any:
    """GET a Binance: primero ``binance_base_url`` (US) y, si falla o no responde 200 (red, 451, par que no existe
    ahí), prueba ``binance_fallback_url`` (global). None si ninguna da una respuesta válida."""
    for base in _binance_bases():
        try:
            resp = _http_get(base + path, params=params)
        except httpx.HTTPError as exc:
            logger.warning("Binance %s%s falló: %s", base, path, type(exc).__name__)
            continue
        if resp.status_code != 200:
            logger.info("Binance %s%s respondió %s", base, path, resp.status_code)
            continue
        try:
            return resp.json()
        except ValueError:
            continue
    return None


def binance_prices(pairs: list[str]) -> dict[str, float]:
    """Precio actual de varios pares en UNA llamada. Solo lecturas válidas.

    Binance rechaza TODA la lista si un par no existe (400); en ese caso se pide el listado completo y se filtra.
    """
    pairs = sorted({p.upper() for p in pairs if p})
    if not pairs:
        return {}
    data = _binance_get("/api/v3/ticker/price", {"symbols": json.dumps(pairs, separators=(",", ":"))})
    if data is None:
        data = _binance_get("/api/v3/ticker/price")
    wanted = set(pairs)
    out: dict[str, float] = {}
    for item in data if isinstance(data, list) else []:
        if isinstance(item, dict) and item.get("symbol") in wanted:
            price = to_price(item.get("price"))
            if price is not None:
                out[item["symbol"]] = price
    return out


def binance_resolve_pair(symbol: str) -> Optional[tuple[str, float]]:
    """Primer par ``<SYM>USDT`` / ``<SYM>USDC`` que exista en Binance, con su precio. None si no hay."""
    symbol = symbol.upper()
    for quote in QUOTE_ASSETS:
        pair = symbol + quote
        data = _binance_get("/api/v3/ticker/price", {"symbol": pair})
        price = to_price(data.get("price")) if isinstance(data, dict) else None
        if price is not None:
            return pair, price
    return None


def binance_ticker_24h(pair: str) -> Optional[dict]:
    """Estadísticas de 24 h de un par: ``{price, high, low, change_pct, volume_quote}``. None si falla."""
    data = _binance_get("/api/v3/ticker/24hr", {"symbol": pair})
    if not isinstance(data, dict):
        return None
    price, high, low = to_price(data.get("lastPrice")), to_price(data.get("highPrice")), to_price(data.get("lowPrice"))
    if price is None:
        return None
    return {
        "price": price,
        "high": high,
        "low": low,
        "change_pct": _num(data.get("priceChangePercent")),
        "volume_quote": _num(data.get("quoteVolume")),
    }


def _num(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


@dataclass(frozen=True)
class Candle:
    open_time: datetime
    high: float
    low: float


def binance_candles(pair: str, since: datetime, interval: str = "5m", limit: int = 1000) -> list[Candle]:
    """Velas desde ``since`` (UTC), para detectar mechas entre revisiones. Descarta velas con datos inválidos."""
    start_ms = int(since.timestamp() * 1000)
    data = _binance_get("/api/v3/klines", {"symbol": pair, "interval": interval, "startTime": start_ms, "limit": limit})
    out: list[Candle] = []
    for row in data if isinstance(data, list) else []:
        try:
            high, low = to_price(row[2]), to_price(row[3])
            if high is None or low is None or low > high:
                continue
            out.append(Candle(datetime.fromtimestamp(int(row[0]) / 1000, tz=timezone.utc), high, low))
        except (IndexError, TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------- CoinGecko (plan Demo)

_cg_id_cache: dict[str, Optional[str]] = {}


def _cg_get(path: str, params: dict, timeout: float = TIMEOUT) -> Any:
    """GET a CoinGecko con rotación de keys ante 429. Lanza ``CoinGeckoNetworkError`` si falla; None si no hay keys."""
    ring = coingecko_ring()
    if not len(ring):
        return None
    last: Optional[Exception] = None
    for attempt in range(len(ring)):
        key = ring.next()
        try:
            resp = _http_get(CG_BASE + path, params=params, headers={"x-cg-demo-api-key": key or ""}, timeout=timeout)
        except httpx.HTTPError as exc:
            raise CoinGeckoNetworkError(type(exc).__name__) from exc
        if resp.status_code == 429 and attempt < len(ring) - 1:
            logger.warning("CoinGecko 429 con la key ...%s; pruebo la siguiente", (key or "")[-4:])
            last = CoinGeckoNetworkError("429")
            continue
        if resp.status_code != 200:
            raise CoinGeckoNetworkError(f"HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise CoinGeckoNetworkError("respuesta no JSON") from exc
    raise last or CoinGeckoNetworkError("sin respuesta")


def cg_resolve_id(symbol: str) -> Optional[str]:
    """Símbolo → id de CoinGecko (primer resultado con símbolo exacto, el de mayor ranking).

    Devuelve None si CoinGecko confirma que no existe (se recuerda); lanza ``CoinGeckoNetworkError`` si no se pudo
    comprobar (no se recuerda: podría existir). Sin keys devuelve None sin consultar.
    """
    symbol = symbol.upper()
    if symbol in _cg_id_cache:
        return _cg_id_cache[symbol]
    data = _cg_get("/search", {"query": symbol}, timeout=5.0)
    if data is None:
        return None
    coins = data.get("coins") if isinstance(data, dict) else None
    match = next((c for c in coins or [] if str(c.get("symbol", "")).upper() == symbol), None)
    coin_id = match.get("id") if match else None
    _cg_id_cache[symbol] = coin_id
    return coin_id


def cg_readings_by_id(ids: list[str]) -> dict[str, Reading]:
    """Precios de varias monedas en UNA llamada (``simple/price``). Vacío si falla (el checker no depende de esto)."""
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    try:
        data = _cg_get(
            "/simple/price",
            {"ids": ",".join(ids), "vs_currencies": "usd", "include_last_updated_at": "true"},
        )
    except CoinGeckoNetworkError as exc:
        logger.warning("CoinGecko simple/price falló: %s", exc)
        return {}
    out: dict[str, Reading] = {}
    for coin_id, item in (data or {}).items() if isinstance(data, dict) else []:
        if not isinstance(item, dict):
            continue
        price = to_price(item.get("usd"))
        if price is None:
            continue
        updated = item.get("last_updated_at")
        age = max(0.0, datetime.now(timezone.utc).timestamp() - float(updated)) if isinstance(updated, (int, float)) else None
        out[coin_id] = Reading(price, "coingecko", age)
    return out


# ---------------------------------------------------------------- Moneda con sus ids exactos


@dataclass(frozen=True)
class CoinRef:
    """Una moneda con el identificador exacto en cada fuente (no solo el símbolo). Es lo que guarda una alerta."""

    symbol: str
    binance_pair: Optional[str] = None
    cmc_id: Optional[int] = None
    cg_id: Optional[str] = None

    @property
    def key(self) -> str:
        """Clave estable de la moneda para agrupar alertas y guardar la última lectura."""
        if self.binance_pair:
            return f"bn:{self.binance_pair}"
        if self.cmc_id is not None:
            return f"cmc:{self.cmc_id}"
        return f"cg:{self.cg_id}"


MAX_AGE_SECONDS = 15 * 60  # una lectura de CMC/CoinGecko más vieja que esto no sirve para disparar


def usable(reading: Optional[Reading]) -> bool:
    return reading is not None and (reading.age_seconds is None or reading.age_seconds <= MAX_AGE_SECONDS)


def resolve_coin(symbol: str) -> tuple[Optional[CoinRef], dict[str, Reading]]:
    """Busca la moneda en las tres fuentes a la vez. Devuelve ``(ref, lecturas por fuente)``.

    ``ref`` es None si ninguna fuente la conoce. Si CoinGecko no se pudo consultar, no se afirma nada de su id.
    """
    symbol = symbol.upper()
    f_bn = _pool.submit(binance_resolve_pair, symbol)
    f_cmc = _pool.submit(cmc_quotes_by_symbol, [symbol])
    f_cg = _pool.submit(cg_resolve_id, symbol)
    readings: dict[str, Reading] = {}

    pair = None
    found = f_bn.result()
    if found:
        pair, price = found
        readings["binance"] = Reading(price, "binance")

    cmc_id = None
    data = f_cmc.result()
    item = (data or {}).get(symbol)
    if isinstance(item, list):  # algunas versiones de CMC devuelven una lista por símbolo
        item = item[0] if item else None
    if isinstance(item, dict):
        try:
            cmc_id = int(item["id"])
            usd = item["quote"]["USD"]
            price = to_price(usd.get("price"))
            if price is not None:
                readings["cmc"] = Reading(price, "cmc", _age_from_iso(usd.get("last_updated")))
        except (KeyError, TypeError, ValueError):
            cmc_id = None

    try:
        cg_id = f_cg.result()
    except CoinGeckoNetworkError as exc:
        logger.warning("CoinGecko no pudo resolver %s: %s", symbol, exc)
        cg_id = None
    if cg_id:
        cg = cg_readings_by_id([cg_id]).get(cg_id)
        if cg:
            readings["coingecko"] = cg

    if not (pair or cmc_id is not None or cg_id):
        return None, {}
    return CoinRef(symbol, pair, cmc_id, cg_id), readings


# ---------------------------------------------------------------- Lecturas para el checker de alertas


def fetch_primary(refs: list[CoinRef]) -> dict[str, Reading]:
    """Una lectura por moneda (``ref.key``): Binance en una sola llamada; lo que no esté ahí, CMC por lote y, al final, CoinGecko.

    Las lecturas inválidas o viejas se descartan (la moneda queda sin lectura y el checker la salta esta ronda).
    """
    out: dict[str, Reading] = {}
    binance = binance_prices([r.binance_pair for r in refs if r.binance_pair])
    rest: list[CoinRef] = []
    for ref in refs:
        price = binance.get(ref.binance_pair or "")
        if price is not None:
            out[ref.key] = Reading(price, "binance")
        else:
            rest.append(ref)

    need_cmc = [r for r in rest if r.cmc_id is not None]
    cmc = cmc_readings_by_id([r.cmc_id for r in need_cmc]) if need_cmc else {}
    rest2: list[CoinRef] = []
    for ref in rest:
        reading = cmc.get(ref.cmc_id) if ref.cmc_id is not None else None
        if usable(reading):
            out[ref.key] = reading
        else:
            rest2.append(ref)

    cg = cg_readings_by_id([r.cg_id for r in rest2 if r.cg_id]) if rest2 else {}
    for ref in rest2:
        reading = cg.get(ref.cg_id or "")
        if usable(reading):
            out[ref.key] = reading
    return out


def fetch_confirmation(ref: CoinRef, primary_source: str) -> Optional[Reading]:
    """Lectura de OTRA fuente distinta a ``primary_source`` para confirmar un posible disparo. None si no hay."""
    if primary_source != "binance" and ref.binance_pair:
        price = binance_prices([ref.binance_pair]).get(ref.binance_pair)
        if price is not None:
            return Reading(price, "binance")
    if primary_source != "cmc" and ref.cmc_id is not None:
        reading = cmc_readings_by_id([ref.cmc_id]).get(ref.cmc_id)
        if usable(reading):
            return reading
    if primary_source != "coingecko" and ref.cg_id:
        reading = cg_readings_by_id([ref.cg_id]).get(ref.cg_id)
        if usable(reading):
            return reading
    return None


def _usd(market: dict, key: str) -> Any:
    value = market.get(key)
    return value.get("usd") if isinstance(value, dict) else None


def cg_enrichment(symbol: str) -> Optional[dict]:
    """Datos de ``/coins/{id}`` de CoinGecko para el bloque extra de Mercado (y como fuente primaria de último recurso).

    - None: CoinGecko no está configurado o falló la consulta de la moneda (se sigue sin el bloque).
    - ``{"not_found": True}``: CoinGecko confirma que el símbolo no existe.
    - Lanza ``CoinGeckoNetworkError`` si ni siquiera se pudo resolver el símbolo (no se sabe si existe).
    """
    if not len(coingecko_ring()):
        return None
    coin_id = cg_resolve_id(symbol)
    if not coin_id:
        return {"not_found": True}
    try:
        data = _cg_get(
            f"/coins/{coin_id}",
            {
                "localization": "false",
                "tickers": "false",
                "market_data": "true",
                "community_data": "true",
                "developer_data": "false",
                "sparkline": "false",
            },
        )
    except CoinGeckoNetworkError as exc:
        logger.warning("CoinGecko /coins/%s falló: %s", coin_id, exc)
        return None
    if not isinstance(data, dict):
        return None
    market = data.get("market_data") if isinstance(data.get("market_data"), dict) else {}
    categories = [c for c in data.get("categories") or [] if c]
    return {
        "not_found": False,
        "cg_id": coin_id,
        "symbol_used": str(data.get("symbol") or symbol).upper(),
        "ath": _usd(market, "ath"),
        "ath_change_pct": _usd(market, "ath_change_percentage"),
        "ath_date": _usd(market, "ath_date"),
        "atl": _usd(market, "atl"),
        "atl_date": _usd(market, "atl_date"),
        "circulating_supply": market.get("circulating_supply"),
        "total_supply": market.get("total_supply"),
        "max_supply": market.get("max_supply"),
        "category": categories[0] if categories else None,
        "sentiment_up_pct": data.get("sentiment_votes_up_percentage"),
        "market_cap_rank": market.get("market_cap_rank") or data.get("market_cap_rank"),
        # Solo se usan como fuente primaria cuando CMC no tiene la moneda.
        "price": _usd(market, "current_price"),
        "percent_change_24h": market.get("price_change_percentage_24h"),
        "percent_change_7d": market.get("price_change_percentage_7d"),
        "market_cap": _usd(market, "market_cap"),
        "volume_24h": _usd(market, "total_volume"),
        "high_24h": _usd(market, "high_24h"),
        "low_24h": _usd(market, "low_24h"),
    }
