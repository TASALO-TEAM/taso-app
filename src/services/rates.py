"""Servicio de tasas y año: normaliza lo que devuelve taso-api y lo cachea.

El parseo es tolerante (como en Android): un campo raro se ignora y una fuente vacía es lista vacía,
no un error. Lo que no se puede interpretar como respuesta válida lanza ``UpstreamError`` para que
la caché sirva lo último guardado.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Optional

from src.services import taso_client
from src.services.cache import Cached, TTLCache, UpstreamError

SOURCES = ("eltoque", "qvapay", "bcc", "cadeca")

PREFERRED_ORDER = [
    "EUR", "USD", "MLC", "BTC", "TRX", "USDT",
    "CAD", "GBP", "CHF", "RUB", "AUD", "JPY",
    "MXN", "BRL", "COP",
]
QVAPAY_ORDER = ["CUP", "MLC", "TROPIPAY", "ETECSA", "ZELLE", "CLASICA", "BOLSATM", "BANDECPREPAGO", "SBERBANK"]
# En CADECA/BCC/El Toque "CUP" es la moneda base y no aporta nada; en QvaPay es un método de pago.
IGNORED = {"CUP"}

RATES_TTL = 30.0              # la API refresca cada 15 min; 30 s evita martillarla
RATES_MAX_STALE = 6 * 3600.0  # si la API cae, se sirve lo último hasta 6 h (con aviso en la UI)
YEAR_TTL = 300.0
YEAR_MAX_STALE = 24 * 3600.0
IMAGE_TTL = 300.0
IMAGE_MAX_STALE = 3600.0

LATEST_PATH = "/api/v1/tasas/latest"
YEAR_PATH = "/api/v1/year/state"
IMAGE_PATH = "/api/v1/images/eltoque/file/latest"


# ---------- Parseo tolerante ----------

def parse_number(value: Any) -> Optional[float]:
    """Número, o texto con coma decimal («365,5») y miles («1.234,5»). Nada válido → None."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if not isinstance(value, str):
        return None
    raw = value.strip().replace(" ", "")
    if not raw or raw.lower() == "null":
        return None
    if "." in raw and "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        number = float(raw)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_change(value: Any) -> str:
    text = value.lower() if isinstance(value, str) else ""
    return text if text in ("up", "down") else "neutral"


def parse_instant(value: Any) -> Optional[str]:
    """Fecha ISO de FastAPI (con o sin zona; sin zona = UTC) → ISO con zona. Inválida → None."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def parse_rate(code: str, obj: Any) -> Optional[dict]:
    """rate = rate ?? sell ?? buy; sin ninguno de los tres se descarta."""
    if not isinstance(obj, dict):
        return None
    buy = parse_number(obj.get("buy"))
    sell = parse_number(obj.get("sell"))
    rate = parse_number(obj.get("rate"))
    if rate is None:
        rate = sell if sell is not None else buy
    if rate is None:
        return None
    return {
        "code": code,
        "rate": rate,
        "buy": buy,
        "sell": sell,
        "change": parse_change(obj.get("change")),
        "prev_rate": parse_number(obj.get("prev_rate")),
    }


def _order_index(source: str, code: str) -> int:
    order = QVAPAY_ORDER if source == "qvapay" else PREFERRED_ORDER
    return order.index(code) if code in order else len(order) + 1000


def parse_source(source: str, obj: Any) -> list[dict]:
    if not isinstance(obj, dict):
        return []
    rates = []
    for code, value in obj.items():
        code = str(code).upper()
        if source != "qvapay" and code in IGNORED:
            continue
        rate = parse_rate(code, value)
        if rate is not None:
            rates.append(rate)
    rates.sort(key=lambda r: (_order_index(source, r["code"]), r["code"]))
    return rates


def normalize_latest(payload: Any) -> dict:
    """``/tasas/latest`` → contrato del BFF. Lanza UpstreamError si no es una respuesta válida."""
    if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get("data"), dict):
        raise UpstreamError("latest: respuesta inválida")
    data = payload["data"]
    per_source = payload.get("sources_updated_at")
    per_source = per_source if isinstance(per_source, dict) else {}
    overall = parse_instant(payload.get("updated_at"))
    sources = {}
    for source in SOURCES:
        sources[source] = {
            # Hora REAL del dato de esa fuente; si la API no la trae, la de la respuesta.
            "fetched_at": parse_instant(per_source.get(source)) or overall,
            "rates": parse_source(source, data.get(source)),
        }
    return {"sources": sources, "updated_at": overall}


def normalize_year(payload: Any) -> dict:
    """``/year/state`` → {year, percent, days_left, quote}. Lanza UpstreamError si no es válida."""
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise UpstreamError("year: respuesta inválida")
    progress = payload.get("progress") if isinstance(payload.get("progress"), dict) else {}
    quote_obj = payload.get("quote") if isinstance(payload.get("quote"), dict) else {}
    quote = quote_obj.get("quote")
    quote = quote.strip() if isinstance(quote, str) and quote.strip() else None

    def as_int(value: Any) -> Optional[int]:
        number = parse_number(value)
        return int(number) if number is not None else None

    return {
        "year": as_int(progress.get("year")),
        "percent": parse_number(progress.get("percent")),
        "days_left": as_int(progress.get("days_left")),
        "quote": quote,
    }


# ---------- Con caché ----------

def get_rates(cache: TTLCache) -> Cached:
    return cache.fetch(
        "rates", RATES_TTL, RATES_MAX_STALE,
        lambda: normalize_latest(taso_client.get_json(LATEST_PATH)),
    )


def get_year(cache: TTLCache) -> Cached:
    return cache.fetch(
        "year", YEAR_TTL, YEAR_MAX_STALE,
        lambda: normalize_year(taso_client.get_json(YEAR_PATH)),
    )


def image_available(cache: TTLCache) -> bool:
    """¿Hay imagen de El Toque? Si no se puede saber, se asume que no (el botón no aparece)."""
    try:
        return bool(cache.fetch("image", IMAGE_TTL, IMAGE_MAX_STALE, lambda: taso_client.probe(IMAGE_PATH)).value)
    except UpstreamError:
        return False


def get_image() -> tuple[bytes, str]:
    data, content_type = taso_client.get_file(IMAGE_PATH)
    if not content_type.lower().startswith("image/"):
        raise UpstreamError("image: tipo inesperado")
    return data, content_type
