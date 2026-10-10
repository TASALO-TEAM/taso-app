"""Combustible: normaliza ``/tasas/fuel`` de taso-api y lo cachea.

``/tasas/fuel`` no trae ``ok`` (``{source, rates, updated_at}``). ``updated_at`` es la hora REAL de la lectura
(``taso-api`` ya no la sustituye por la hora de la consulta), así que la UI puede avisar de datos viejos.
Parseo tolerante como en Android (``Parsers.fuel``): solo claves conocidas, en el orden fijo de la UI; un
campo raro se ignora. Una respuesta sin ningún precio se trata como fallo del origen para que la caché
siga sirviendo la última lectura buena en vez de tapar un dato válido con una lista vacía.
"""

from __future__ import annotations

from typing import Any, Optional

from src.services import taso_client
from src.services.cache import Cached, TTLCache, UpstreamError
from src.services.rates import parse_change, parse_instant, parse_number

FUEL_PATH = "/api/v1/tasas/fuel"
FUEL_ORDER = ("B-94", "B-90", "B-83", "Petroleo", "Gas_LP")

FUEL_TTL = 300.0              # taso-api ya cachea (hasta 60 min) y scrapea bajo demanda
FUEL_MAX_STALE = 6 * 3600.0   # si la API cae, se sirve lo último hasta 6 h (con aviso en la UI)


def parse_item(key: str, obj: Any) -> Optional[dict]:
    """Rango de precio de un combustible: mínimo = compra ?? tasa ?? venta, máximo = venta ?? tasa ?? compra."""
    if not isinstance(obj, dict):
        return None
    buy = parse_number(obj.get("buy"))
    sell = parse_number(obj.get("sell"))
    rate = parse_number(obj.get("rate"))
    low = buy if buy is not None else rate if rate is not None else sell
    high = sell if sell is not None else rate if rate is not None else buy
    if low is None and high is None:
        return None
    if low is not None and high is not None and low > high:
        low, high = high, low
    return {"key": key, "min": low, "max": high, "change": parse_change(obj.get("change"))}


def normalize_fuel(payload: Any) -> dict:
    """``/tasas/fuel`` → ``{fetched_at, items}``. Lanza UpstreamError si no es válida o no trae precios."""
    if not isinstance(payload, dict) or not isinstance(payload.get("rates"), dict):
        raise UpstreamError("fuel: respuesta inválida")
    rates = payload["rates"]
    items = [item for key in FUEL_ORDER if (item := parse_item(key, rates.get(key))) is not None]
    if not items:
        raise UpstreamError("fuel: sin precios")
    return {"fetched_at": parse_instant(payload.get("updated_at")), "items": items}


def get_fuel(cache: TTLCache) -> Cached:
    return cache.fetch(
        "fuel", FUEL_TTL, FUEL_MAX_STALE,
        lambda: normalize_fuel(taso_client.get_json(FUEL_PATH)),
    )
