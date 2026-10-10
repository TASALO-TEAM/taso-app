"""Historial de precios: normaliza ``history/summary`` y ``history/daily`` de taso-api y los cachea.

taso-api ya entrega un punto por fecha de Cuba (la lectura más cercana a las 7:00 a. m.), así que aquí
solo se valida y se ordena: fecha ``YYYY-MM-DD`` real, precio finito y > 0, sin fechas repetidas.
Lo que no se puede interpretar se descarta; una respuesta que no es válida lanza ``UpstreamError``
para que la caché sirva lo último guardado.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from src.services import taso_client
from src.services.cache import Cached, TTLCache, UpstreamError
from src.services.rates import IGNORED, SOURCES, parse_number

SUMMARY_PATH = "/api/v1/tasas/history/summary"
DAILY_PATH = "/api/v1/tasas/history/daily"

SUMMARY_DAYS = 30
ALLOWED_DAYS = (30, 90, 180, 365)  # lo que el cliente pide; acota las entradas de caché
CODE_RE = re.compile(r"^[A-Z0-9]{2,16}$")

SUMMARY_TTL = 600.0           # la API ya cachea unos minutos y el dato cambia una vez al día
SUMMARY_MAX_STALE = 6 * 3600.0
DAILY_TTL = 300.0
DAILY_MAX_STALE = 24 * 3600.0


def parse_point(obj: Any) -> Optional[dict]:
    if not isinstance(obj, dict):
        return None
    raw_date = obj.get("date")
    if not isinstance(raw_date, str):
        return None
    try:
        day = date.fromisoformat(raw_date.strip()[:10])
    except ValueError:
        return None
    rate = parse_number(obj.get("rate"))
    if rate is None or rate <= 0:
        return None
    return {"date": day.isoformat(), "rate": rate}


def parse_points(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    by_date: dict[str, dict] = {}
    for item in value:
        point = parse_point(item)
        if point is not None:
            by_date[point["date"]] = point
    return [by_date[k] for k in sorted(by_date)]


def normalize_summary(payload: Any) -> dict:
    """``{source: {CODE: [{date, rate}]}}`` solo de las 4 fuentes de la miniapp (sin Binance)."""
    if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get("data"), dict):
        raise UpstreamError("summary: respuesta inválida")
    out: dict[str, dict[str, list[dict]]] = {}
    for source in SOURCES:
        currencies = payload["data"].get(source)
        result: dict[str, list[dict]] = {}
        if isinstance(currencies, dict):
            for code, points in currencies.items():
                code = str(code).upper()
                if source != "qvapay" and code in IGNORED:
                    continue
                parsed = parse_points(points)
                if parsed:
                    result[code] = parsed
        out[source] = result
    return {"sources": out}


def normalize_daily(payload: Any) -> list[dict]:
    if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get("data"), list):
        raise UpstreamError("daily: respuesta inválida")
    return parse_points(payload["data"])


def get_summary(cache: TTLCache) -> Cached:
    return cache.fetch(
        "history-summary", SUMMARY_TTL, SUMMARY_MAX_STALE,
        lambda: normalize_summary(taso_client.get_json(f"{SUMMARY_PATH}?days={SUMMARY_DAYS}")),
    )


def get_daily(cache: TTLCache, source: str, code: str, days: int) -> Cached:
    path = f"{DAILY_PATH}?source={source}&currency={code}&days={days}"
    return cache.fetch(
        ("history-daily", source, code, days), DAILY_TTL, DAILY_MAX_STALE,
        lambda: normalize_daily(taso_client.get_json(path)),
    )
