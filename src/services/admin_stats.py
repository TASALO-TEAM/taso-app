"""Estadísticas de admin para la miniapp: lo del /status del bot, adaptado a la web, más datos propios de la app.

Solo LEE de taso-api (``/admin/status``, ``/admin/stats/summary``, ``/admin/stats/api-usage``, ``/health``) con la
clave admin del servidor. Cada bloque llega con su propio ``ok``: si uno falla, los demás se siguen viendo. De la
respuesta se copian solo campos conocidos (lista blanca): ni la clave ni nada inesperado llegan al navegador.
"""

from __future__ import annotations

import logging
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from src import db
from src.services import taso_client
from src.services.cache import TTLCache, UpstreamError

logger = logging.getLogger("taso-miniapp.admin")

WINDOWS = ("24h", "7d", "30d")
DEFAULT_WINDOW = "24h"
OVERVIEW_TTL = 30.0        # varios admins o varios clics no martillan a taso-api
OVERVIEW_MAX_STALE = 600.0
APP_DAYS = 7
MAX_JOBS = 30
MAX_ITEMS = 10


def normalize_window(value: Optional[str]) -> str:
    return value if value in WINDOWS else DEFAULT_WINDOW


# ---------- Helpers de lectura tolerante ----------
def _num(value: Any, default: float = 0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value else default


def _int(value: Any) -> int:
    return int(_num(value))


def _str(value: Any, limit: int = 200) -> str:
    return str(value)[:limit] if value is not None else ""


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _admin_get(path: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET autenticado; ``None`` si no hubo respuesta buena (nunca lanza)."""
    try:
        status, body = taso_client.call("GET", path, params=params)
    except UpstreamError:
        return None
    if status != 200 or not isinstance(body, dict) or body.get("ok") is False:
        logger.warning("taso-api %s respondió %s", path, status)
        return None
    return body


def _public_get(path: str) -> Optional[dict]:
    try:
        body = taso_client.get_json(path)
    except UpstreamError:
        return None
    return body if isinstance(body, dict) else None


# ---------- Bloques (cada uno devuelve {"ok": bool, ...}) ----------
def _users_block(summary: Optional[dict]) -> dict:
    users = _dict(summary.get("users")) if summary else None
    if users is None:
        return {"ok": False}
    return {
        "ok": True,
        "total": _int(users.get("total")),
        "new_7d": _int(users.get("new_7d")),
        "active_24h": _int(users.get("active_24h")),
        "active_recent": _int(users.get("active_recent")),
    }


def _commands_block(summary: Optional[dict], window: str) -> dict:
    if summary is None:
        return {"ok": False}
    items = _list(_dict(summary.get("commands")).get(f"commands_{window}"))
    out = [{"command": _str(i.get("command"), 40), "count": _int(i.get("count"))} for i in items if isinstance(i, dict)]
    out.sort(key=lambda i: -i["count"])
    return {"ok": True, "items": out[:MAX_ITEMS]}


def _top_users_block(summary: Optional[dict]) -> dict:
    if summary is None:
        return {"ok": False}
    items = _list(_dict(summary.get("top_users")).get("top_users"))
    out = [{"user_id": _int(i.get("user_id")), "total_commands": _int(i.get("total_commands"))} for i in items if isinstance(i, dict)]
    return {"ok": True, "items": out[:5]}


def _performance_block(summary: Optional[dict]) -> dict:
    perf = _dict(summary.get("performance")) if summary else None
    if not perf:
        return {"ok": False}
    return {
        "ok": True,
        "success_rate": round(_num(perf.get("success_rate")), 1),
        "avg_response_ms": round(_num(perf.get("avg_response_ms"))),
        "total_requests_24h": _int(perf.get("total_requests_24h")),
    }


def _api_block(usage: Optional[dict]) -> dict:
    if usage is None:
        return {"ok": False}

    def row(i: dict, key: str) -> dict:
        return {key: _str(i.get(key), 80), "requests": _int(i.get("requests")), "errors": _int(i.get("errors")),
                "avg_duration_ms": round(_num(i.get("avg_duration_ms")))}

    clients = [row(i, "client_id") for i in _list(usage.get("by_client")) if isinstance(i, dict)]
    endpoints = [row(i, "path") for i in _list(usage.get("by_endpoint")) if isinstance(i, dict)]
    return {
        "ok": True,
        "total_requests": _int(usage.get("total_requests")),
        "total_errors": _int(usage.get("total_errors")),
        "error_rate": round(_num(usage.get("error_rate")), 2),
        "avg_duration_ms": round(_num(usage.get("avg_duration_ms"))),
        "by_client": clients[:8],
        "by_endpoint": endpoints[:8],
    }


def _scheduler_block(status: Optional[dict]) -> dict:
    if status is None:
        return {"ok": False}
    jobs = []
    for j in _list(status.get("jobs"))[:MAX_JOBS]:
        if not isinstance(j, dict):
            continue
        jobs.append({
            "id": _str(j.get("id"), 60),
            "name": _str(j.get("name") or j.get("id"), 80),
            "next_run_at": _str(j.get("next_run_at"), 40) or None,
            "last_run_at": _str(j.get("last_run_at"), 40) or None,
            "error_count": _int(j.get("error_count")),
            "last_error": _str(j.get("last_error"), 150) or None,
        })
    return {"ok": True, "running": bool(status.get("is_scheduler_running")), "jobs": jobs}


def compute_health(scheduler: dict) -> dict:
    """Mismo criterio que ``_compute_health`` del bot: scheduler parado o errores de jobs => aviso."""
    if not scheduler.get("ok"):
        return {"level": "unknown", "text": "Sin datos del scheduler"}
    if not scheduler.get("running"):
        return {"level": "bad", "text": "Scheduler detenido"}
    worst = max((j["error_count"] for j in scheduler["jobs"]), default=0)
    if worst == 0:
        return {"level": "ok", "text": "Todo operativo"}
    if worst <= 5:
        return {"level": "warn", "text": "Atención: hay errores recientes"}
    return {"level": "bad", "text": "Errores persistentes en el scheduler"}


def _versions_block(health: Optional[dict]) -> dict:
    if health is None:
        return {"ok": False}
    return {"ok": True, "api_version": _str(health.get("version"), 20), "api_commit": _str(health.get("git_commit"), 12)}


def app_stats(now: Optional[datetime] = None) -> dict:
    """Uso de la propia miniapp (SQLite local): monedas más vistas y consultas por día del módulo Mercado."""
    today = (now or datetime.now(timezone.utc)).date()
    since = (today - timedelta(days=APP_DAYS - 1)).isoformat()
    try:
        with db.connect() as conn:
            coins = conn.execute(
                "SELECT symbol, COUNT(DISTINCT user_id) AS users FROM coin_queries WHERE day >= ? "
                "GROUP BY symbol ORDER BY users DESC, symbol ASC LIMIT 5", (since,)).fetchall()
            per_day = {r["day"]: r["n"] for r in conn.execute(
                "SELECT day, COUNT(*) AS n FROM coin_queries WHERE day >= ? GROUP BY day", (since,)).fetchall()}
            users = conn.execute("SELECT COUNT(DISTINCT user_id) AS n FROM coin_queries WHERE day >= ?", (since,)).fetchone()["n"]
            alerts = conn.execute("SELECT COUNT(*) AS n FROM price_alerts").fetchone()["n"]
    except sqlite3.Error as exc:
        logger.warning("No se pudieron leer las estadísticas locales: %s", exc)
        return {"ok": False}
    days = [(today - timedelta(days=APP_DAYS - 1 - i)).isoformat() for i in range(APP_DAYS)]
    return {
        "ok": True,
        "days": APP_DAYS,
        "mercado_users": int(users),
        "coins": [{"symbol": r["symbol"], "users": int(r["users"])} for r in coins],
        "queries_by_day": [{"day": d, "count": int(per_day.get(d, 0))} for d in days],
        "price_alerts": int(alerts),
    }


# ---------- Ensamblado ----------
def _load(window: str) -> dict:
    with ThreadPoolExecutor(max_workers=4) as pool:
        f_status = pool.submit(_admin_get, "/api/v1/admin/status")
        f_summary = pool.submit(_admin_get, "/api/v1/admin/stats/summary")
        f_usage = pool.submit(_admin_get, "/api/v1/admin/stats/api-usage", {"window": window})
        f_health = pool.submit(_public_get, "/api/v1/health")
        status, summary, usage, health = f_status.result(), f_summary.result(), f_usage.result(), f_health.result()
    if status is None and summary is None and usage is None:
        raise UpstreamError("admin")  # nada que mostrar: que sirva la caché vieja o dé 502
    scheduler = _scheduler_block(status)
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "window": window,
        "health": compute_health(scheduler),
        "versions": _versions_block(health),
        "scheduler": scheduler,
        "users": _users_block(summary),
        "commands": _commands_block(summary, window),
        "top_users": _top_users_block(summary),
        "performance": _performance_block(summary),
        "api": _api_block(usage),
    }


def get_overview(cache: TTLCache, window: Optional[str]) -> tuple[dict, bool]:
    """(datos, stale). Lanza UpstreamError si taso-api no respondió nada y no hay caché utilizable."""
    w = normalize_window(window)
    result = cache.fetch(("admin-overview", w), OVERVIEW_TTL, OVERVIEW_MAX_STALE, lambda: _load(w))
    # Lo propio de la app va fuera de la caché de taso-api: es local y barato.
    return {**result.value, "app": app_stats()}, result.stale
