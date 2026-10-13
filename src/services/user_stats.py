"""Estadísticas PERSONALES de uso («Mis estadísticas»): lo que el bot y la miniapp saben de UN usuario.

La identidad llega siempre del ``initData`` validado (``g.user_id``); este módulo no acepta ningún id que
venga del navegador. Solo LEE de taso-api (``/admin/stats/users/{id}``, con la clave admin del servidor) y de la
SQLite local. Cada bloque lleva su propio ``ok``: si uno falla, el otro se sigue viendo. De la respuesta de
taso-api se copian solo campos conocidos (lista blanca).
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from src import db
from src.services import taso_client
from src.services.cache import TTLCache, UpstreamError

logger = logging.getLogger("taso-miniapp.userstats")

WINDOWS = ("24h", "7d", "30d")
DEFAULT_WINDOW = "7d"
STATS_TTL = 30.0         # un usuario que recarga o cambia de periodo y vuelve no martillea a taso-api
STATS_MAX_STALE = 600.0
MAX_ITEMS = 8
APP_DAYS = {"24h": 1, "7d": 7, "30d": 30}


def normalize_window(value: Optional[str]) -> str:
    return value if value in WINDOWS else DEFAULT_WINDOW


def _num(value: Any, default: float = 0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value else default


def _int(value: Any) -> int:
    return int(_num(value))


def _str(value: Any, limit: int = 60) -> str:
    return str(value)[:limit] if value is not None else ""


def _items(value: Any) -> list[dict]:
    out = []
    for i in value if isinstance(value, list) else []:
        if isinstance(i, dict) and _str(i.get("name")):
            out.append({"name": _str(i.get("name")), "count": _int(i.get("count"))})
    out.sort(key=lambda i: -i["count"])
    return out[:MAX_ITEMS]


def _iso(value: Any) -> Optional[str]:
    return _str(value, 40) if isinstance(value, str) and value else None


def _fetch_bot(user_id: int, window: str) -> dict:
    """Bloque del bot (taso-api). Lanza UpstreamError si no hay un cuerpo bueno: así la caché sirve lo último que tenga."""
    status, body = taso_client.call("GET", f"/api/v1/admin/stats/users/{int(user_id)}", params={"window": window})
    if status != 200 or not isinstance(body, dict) or body.get("ok") is False:
        logger.warning("taso-api stats/users respondió %s", status)
        raise UpstreamError("user-stats")
    total = _int(body.get("total_commands"))
    return {
        "ok": True,
        "found": bool(body.get("found")),
        "total": total,
        "successful": _int(body.get("successful")),
        "failed": _int(body.get("failed")),
        "success_rate": round(_num(body.get("success_rate")), 1) if total else None,
        "commands": _items(body.get("by_command")),
        "sources": _items(body.get("by_source")),
        "total_all_time": _int(body.get("total_commands_all_time")),
        "first_seen": _iso(body.get("first_seen")),
        "last_seen": _iso(body.get("last_seen")),
    }


def app_block(user_id: int, window: str, now: Optional[datetime] = None) -> dict:
    """Lo que la miniapp guarda de ESTE usuario en su SQLite: consultas de Mercado y alertas de precio."""
    days = APP_DAYS[window]
    today = (now or datetime.now(timezone.utc)).date()
    since = (today - timedelta(days=days - 1)).isoformat()
    uid = int(user_id)
    try:
        with db.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n, COUNT(DISTINCT day) AS d FROM coin_queries WHERE user_id = ? AND day >= ?", (uid, since)
            ).fetchone()
            coins = conn.execute(
                "SELECT symbol, COUNT(*) AS n FROM coin_queries WHERE user_id = ? AND day >= ? "
                "GROUP BY symbol ORDER BY n DESC, symbol ASC LIMIT 5", (uid, since)
            ).fetchall()
            alerts = {
                r["status"]: r["n"]
                for r in conn.execute("SELECT status, COUNT(*) AS n FROM price_alerts WHERE user_id = ? GROUP BY status", (uid,)).fetchall()
            }
    except sqlite3.Error as exc:
        logger.warning("No se pudieron leer las estadísticas locales: %s", exc)
        return {"ok": False}
    return {
        "ok": True,
        "mercado_queries": int(row["n"]),
        "mercado_days": int(row["d"]),
        "coins": [{"name": r["symbol"], "count": int(r["n"])} for r in coins],
        "alerts_active": int(alerts.get("ACTIVE", 0)),
        "alerts_triggered": int(alerts.get("TRIGGERED", 0)),
    }


def get_user_stats(cache: TTLCache, user_id: int, window: Optional[str]) -> tuple[dict, bool]:
    """(datos, stale). Nunca lanza: si taso-api no responde, el bloque ``bot`` sale con ``ok: False``."""
    w = normalize_window(window)
    stale = False
    try:
        result = cache.fetch(("user-stats", int(user_id), w), STATS_TTL, STATS_MAX_STALE, lambda: _fetch_bot(user_id, w))
        bot, stale = result.value, result.stale
    except UpstreamError:
        bot = {"ok": False}
    return {
        "window": w,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "bot": bot,
        "app": app_block(user_id, w),
    }, stale
