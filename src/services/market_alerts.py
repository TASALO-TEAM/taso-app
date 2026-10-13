"""Alertas de precio cripto propias de la app (S10 F4, parte 1: crear / listar / borrar).

Todo es de UN usuario: el id viene siempre del ``initData`` validado (nunca del cliente). Lo que se guarda es lo mínimo
(ver ``src/db.py``). Al crear se comprueba que la moneda exista, se deduce la dirección comparando con el precio de ese
momento y se rechazan objetivos «ya está ahí», duplicados y los límites por usuario / por moneda.

El chequeo periódico y el aviso por el bot van aparte (``market_alerts_checker.py``, siguiente paso de F4).
"""

from __future__ import annotations

import logging
import math
import sqlite3
from typing import Any, Optional

from src import db
from src.services import crypto
from src.services.market import normalize_symbol

logger = logging.getLogger("taso-miniapp.alerts-price")

MAX_PER_USER = 20
MAX_PER_COIN = 5
NEAR_PCT = 0.001          # a menos de 0,1 % del precio actual: «ya está ahí»
MAX_TARGET = 1e12
MISMATCH_PCT = 0.015      # dos fuentes que difieren más de 1,5 % no sirven para fijar la dirección
LIST_TRIGGERED = 30       # cuántas alertas ya disparadas se devuelven


class AlertError(Exception):
    """Error de negocio con código estable para el cliente (``status`` = código HTTP sugerido)."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def parse_target(value: Any) -> Optional[float]:
    """Precio objetivo válido (> 0, finito, razonable) o None. Admite números y texto con punto decimal."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
        if not value or len(value) > 32:
            return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0 or number > MAX_TARGET:
        return None
    return number


def _present(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "symbol": row["symbol"],
        "target": row["target"],
        "direction": row["direction"],
        "status": row["status"],
        "price_at_creation": row["price_at_creation"],
        "created_at": row["created_at"],
        "triggered_at": row["triggered_at"],
        "triggered_price": row["triggered_price"],
        "trigger_kind": row["trigger_kind"],
        "notified": bool(row["notified"]),
    }


def _current_price(readings: dict) -> Optional[float]:
    """Precio de referencia al crear: Binance, luego CMC, luego CoinGecko; solo lecturas utilizables.

    Si hay dos fuentes y se contradicen (> 1,5 %), no se fija nada: mejor pedir que lo intente de nuevo que crear una
    alerta con la dirección equivocada.
    """
    good = [r for r in (readings.get("binance"), readings.get("cmc"), readings.get("coingecko")) if crypto.usable(r)]
    if not good:
        return None
    first = good[0].price
    for other in good[1:]:
        if abs(other.price - first) / first > MISMATCH_PCT:
            raise AlertError("price_mismatch", "Las fuentes no coinciden en el precio ahora. Inténtalo en un momento.", 503)
    return first


def create_alert(user_id: int, symbol_raw: Any, target_raw: Any) -> dict:
    symbol = normalize_symbol(symbol_raw)
    if not symbol:
        raise AlertError("bad_symbol", "Escribe un símbolo válido, por ejemplo BTC.")
    target = parse_target(target_raw)
    if target is None:
        raise AlertError("bad_target", "El precio objetivo debe ser un número mayor que 0.")

    with db.connect() as conn:  # límite por usuario antes de gastar llamadas a las APIs
        (active,) = conn.execute("SELECT COUNT(*) FROM price_alerts WHERE user_id=? AND status='ACTIVE'", (user_id,)).fetchone()
    if active >= MAX_PER_USER:
        raise AlertError("limit_user", f"Ya tienes {MAX_PER_USER} alertas activas. Borra alguna para crear otra.", 409)

    ref, readings = crypto.resolve_coin(symbol)
    if ref is None:
        raise AlertError("unknown_coin", f"No encontré la moneda {symbol}.", 404)
    price = _current_price(readings)
    if price is None:
        raise AlertError("price_unavailable", "No pude leer el precio ahora. Inténtalo en un momento.", 503)
    if abs(target - price) / price < NEAR_PCT:
        raise AlertError("too_close", "Ese precio es casi el de ahora: elige uno más alejado.")
    direction = "ABOVE" if target > price else "BELOW"

    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")  # contar y crear en un solo bloque: sin carreras entre peticiones
        try:
            (n_user,) = conn.execute("SELECT COUNT(*) FROM price_alerts WHERE user_id=? AND status='ACTIVE'", (user_id,)).fetchone()
            (n_coin,) = conn.execute(
                "SELECT COUNT(*) FROM price_alerts WHERE user_id=? AND status='ACTIVE' AND symbol=?", (user_id, symbol)
            ).fetchone()
            if n_user >= MAX_PER_USER:
                raise AlertError("limit_user", f"Ya tienes {MAX_PER_USER} alertas activas. Borra alguna para crear otra.", 409)
            if n_coin >= MAX_PER_COIN:
                raise AlertError("limit_coin", f"Ya tienes {MAX_PER_COIN} alertas activas de {symbol}.", 409)
            dup = conn.execute(
                "SELECT 1 FROM price_alerts WHERE user_id=? AND status='ACTIVE' AND symbol=? AND direction=? "
                "AND ABS(target - ?) <= ? LIMIT 1",
                (user_id, symbol, direction, target, target * 1e-9),
            ).fetchone()
            if dup:
                raise AlertError("duplicate", "Ya tienes una alerta igual.", 409)
            cur = conn.execute(
                "INSERT INTO price_alerts (user_id, symbol, binance_pair, cmc_id, cg_id, target, direction, price_at_creation, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (user_id, symbol, ref.binance_pair, ref.cmc_id, ref.cg_id, target, direction, price, db.now_iso()),
            )
            alert_id = cur.lastrowid
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        row = conn.execute("SELECT * FROM price_alerts WHERE id=?", (alert_id,)).fetchone()
    logger.info("alerta de precio creada id=%s %s %s %s", alert_id, symbol, direction, target)
    return _present(row)


def list_alerts(user_id: int) -> list[dict]:
    """Activas primero (más nuevas arriba) y las últimas disparadas."""
    with db.connect() as conn:
        active = conn.execute(
            "SELECT * FROM price_alerts WHERE user_id=? AND status='ACTIVE' ORDER BY id DESC", (user_id,)
        ).fetchall()
        done = conn.execute(
            "SELECT * FROM price_alerts WHERE user_id=? AND status='TRIGGERED' ORDER BY triggered_at DESC, id DESC LIMIT ?",
            (user_id, LIST_TRIGGERED),
        ).fetchall()
    return [_present(r) for r in (*active, *done)]


def delete_alert(user_id: int, alert_id: int) -> bool:
    """Borra una alerta SOLO si es del usuario. False si no existe o es de otro (el cliente ve lo mismo: 404)."""
    with db.connect() as conn:
        cur = conn.execute("DELETE FROM price_alerts WHERE id=? AND user_id=?", (alert_id, user_id))
    return cur.rowcount > 0
