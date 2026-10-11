"""Alertas del usuario (precio, imagen de El Toque, año y Spotlight) contra taso-api.

El ``user_id`` SIEMPRE lo pone el llamador desde el initData validado (``g.user_id``); este módulo nunca lo
lee de la petición del cliente. La API de alertas de precio exige ``X-API-Key``; las demás la exigirán cuando se
active ``REQUIRE_KEY_USER_ENDPOINTS`` (C-API-2), por eso todas las llamadas pasan por ``taso_client.call``.

Horas: año y Spotlight se guardan en UTC (0-23); la imagen guarda ``HH:MM`` en hora de Cuba tal cual el bot.
La conversión Cuba↔UTC la hace el cliente con la fecha actual (D7), aquí solo se validan y se pasan.

Creación de alertas de precio: NO está aquí a propósito. La API exige ``price_at_creation`` (precio real de la
moneda) y el BFF todavía no tiene fuente de precios; llega con S10 (Mercado ``/p``).
"""

from __future__ import annotations

import re
from typing import Any, Optional

from src.services import taso_client
from src.services.cache import UpstreamError, UpstreamNotFound
from src.services.rates import parse_instant, parse_number

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d\Z")
FORMATS = ("photo", "document")
CONDITIONS = ("ABOVE", "BELOW")
MAX_SPOTLIGHT_HOURS = 2


class AlertConflict(Exception):
    """Ya hay el máximo de horarios de Spotlight (409 ``max_subscriptions_reached``)."""


def valid_hour(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 23


def valid_time(value: Any) -> bool:
    return isinstance(value, str) and bool(TIME_RE.match(value))


# ---------- Normalización ----------

def _data(body: Any) -> Any:
    return body.get("data") if isinstance(body, dict) else None


def parse_price_alert(obj: Any) -> Optional[dict]:
    if not isinstance(obj, dict):
        return None
    alert_id = obj.get("id")
    coin = obj.get("coin")
    target = parse_number(obj.get("target_price"))
    condition = obj.get("condition")
    if not isinstance(alert_id, int) or isinstance(alert_id, bool) or not isinstance(coin, str) or target is None:
        return None
    if condition not in CONDITIONS:
        return None
    note = obj.get("note")
    return {
        "id": alert_id,
        "coin": coin,
        "target_price": target,
        "condition": condition,
        "price_at_creation": parse_number(obj.get("price_at_creation")),
        "note": note if isinstance(note, str) and note else None,
        "created_at": parse_instant(obj.get("created_at")),
    }


def parse_image_alert(obj: Any) -> Optional[dict]:
    if not isinstance(obj, dict) or not valid_time(obj.get("alert_time")):
        return None
    fmt = obj.get("format_type")
    return {
        "alert_time": obj["alert_time"],
        "format_type": fmt if fmt in FORMATS else "photo",
        "enabled": obj.get("enabled") is not False,
    }


def _hours(items: Any) -> list[int]:
    if not isinstance(items, list):
        return []
    return sorted({i["hour"] for i in items if isinstance(i, dict) and valid_hour(i.get("hour"))})


# ---------- Lectura ----------

def _section(fn) -> dict:
    """Una sección que falla no tumba a las demás: ``{"ok": False}`` y la UI la marca como no disponible."""
    try:
        return {"ok": True, **fn()}
    except UpstreamError:
        return {"ok": False}


def _price(uid: int) -> dict:
    status, body = taso_client.call("GET", f"/api/v1/alerts/{uid}", params={"status": "ACTIVE"})
    if status != 200 or not isinstance(body, dict) or body.get("ok") is not True:
        raise UpstreamError("price")
    items = [a for a in map(parse_price_alert, _data(body) or []) if a is not None]
    return {"items": items}


def _image(uid: int) -> dict:
    status, body = taso_client.call("GET", f"/api/v1/images/alerts/{uid}")
    if status != 200 or not isinstance(body, dict) or body.get("ok") is not True:
        raise UpstreamError("image")
    return {"config": parse_image_alert(_data(body))}


def _year(uid: int) -> dict:
    status, body = taso_client.call("GET", f"/api/v1/year/subscriptions/me/{uid}")
    if status == 404:
        return {"hour": None}
    if status != 200 or not isinstance(body, dict):
        raise UpstreamError("year")
    hour = body.get("hour")
    return {"hour": hour if valid_hour(hour) else None}


def _spotlight(uid: int) -> dict:
    status, body = taso_client.call("GET", f"/api/v1/tspl/subscriptions/me/{uid}")
    if status != 200 or not isinstance(body, dict):
        raise UpstreamError("spotlight")
    return {"hours": _hours(body.get("data")), "max": MAX_SPOTLIGHT_HOURS}


def get_overview(uid: int) -> dict:
    """Las cuatro secciones del usuario ``uid``."""
    return {
        "price": _section(lambda: _price(uid)),
        "image": _section(lambda: _image(uid)),
        "year": _section(lambda: _year(uid)),
        "spotlight": _section(lambda: _spotlight(uid)),
    }


# ---------- Escritura ----------

def _expect_ok(status: int, path: str, ok_codes: tuple[int, ...] = (200,)) -> None:
    if status == 404:
        raise UpstreamNotFound(path)
    if status not in ok_codes:
        raise UpstreamError(f"{path}: {status}")


def delete_price(uid: int, alert_id: int) -> None:
    """Borra una alerta de precio PROPIA: la API comprueba que ``user_id`` sea el dueño (404 si no)."""
    status, _ = taso_client.call("DELETE", f"/api/v1/alerts/{alert_id}", params={"user_id": uid})
    _expect_ok(status, "price")


def set_image(uid: int, alert_time: str, format_type: str, enabled: bool) -> dict:
    status, body = taso_client.call(
        "POST", "/api/v1/images/alerts",
        json={"user_id": uid, "alert_time": alert_time, "format_type": format_type, "enabled": enabled},
    )
    _expect_ok(status, "image")
    config = parse_image_alert(_data(body)) if isinstance(body, dict) and body.get("ok") is True else None
    if config is None:
        raise UpstreamError("image: respuesta inválida")
    return {"config": config}


def delete_image(uid: int) -> None:
    status, _ = taso_client.call("DELETE", f"/api/v1/images/alerts/{uid}")
    _expect_ok(status, "image")


def set_year(uid: int, hour: int) -> dict:
    status, body = taso_client.call("POST", f"/api/v1/year/subscriptions/me/{uid}", json={"user_id": uid, "hour": hour})
    _expect_ok(status, "year")
    saved = body.get("hour") if isinstance(body, dict) else None
    return {"hour": saved if valid_hour(saved) else hour}


def delete_year(uid: int) -> None:
    status, _ = taso_client.call("DELETE", f"/api/v1/year/subscriptions/me/{uid}")
    _expect_ok(status, "year")


def _spotlight_after_write(uid: int) -> dict:
    """Estado tras escribir; si la relectura falla la escritura ya ocurrió: se devuelve vacío y el cliente relee."""
    try:
        return _spotlight(uid)
    except UpstreamError:
        return {}


def add_spotlight(uid: int, hour: int) -> dict:
    status, _ = taso_client.call("POST", f"/api/v1/tspl/subscriptions/me/{uid}", json={"user_id": uid, "hour": hour})
    if status == 409:
        raise AlertConflict("max_subscriptions_reached")
    _expect_ok(status, "spotlight")
    return _spotlight_after_write(uid)


def delete_spotlight(uid: int, hour: int) -> dict:
    status, _ = taso_client.call("DELETE", f"/api/v1/tspl/subscriptions/me/{uid}/{hour}")
    _expect_ok(status, "spotlight")
    return _spotlight_after_write(uid)
