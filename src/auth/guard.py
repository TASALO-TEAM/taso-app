"""Guardia de autenticación del BFF: identidad desde ``Authorization: tma <initData>``.

``g.user_id`` es la ÚNICA fuente de identidad para los handlers. Cualquier ``uid`` que
llegue por URL, query o cuerpo debe ignorarse.
"""

from __future__ import annotations

import functools
import logging
from typing import Callable

from flask import current_app, g, jsonify, request

from src.auth.initdata import InitData, InitDataError, validate_init_data

logger = logging.getLogger("taso-miniapp.auth")

SCHEME = "tma"
# Mensajes genéricos: no revelan por qué falló la validación.
_PUBLIC_MESSAGE = "No se pudo identificar tu sesión de Telegram"


def _error(status: int, code: str, message: str):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp


def extract_init_data() -> str | None:
    header = request.headers.get("Authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != SCHEME or not value.strip():
        return None
    return value.strip()


def authenticate() -> InitData:
    """Valida la petición actual. Lanza InitDataError si no hay identidad válida."""
    cfg = current_app.config["TASALO_SETTINGS"]
    raw = extract_init_data()
    return validate_init_data(
        raw or "",
        cfg.telegram_bot_token,
        max_age_seconds=cfg.initdata_max_age,
    )


def require_user(view: Callable) -> Callable:
    """Decorador: 401 si no hay initData válido; si sí, deja ``g.init_data`` y ``g.user_id``."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        try:
            init = authenticate()
        except InitDataError as exc:
            # Se registra el código (útil para depurar) pero NUNCA el initData ni el token.
            logger.info("initData rechazado: %s", exc.code)
            if exc.code == "server_misconfigured":
                return _error(503, "server_misconfigured", "Servicio no disponible")
            return _error(401, "unauthenticated", _PUBLIC_MESSAGE)
        g.init_data = init
        g.user_id = init.user_id
        limiter = current_app.config.get("TASALO_LIMITER")
        if limiter is not None and not limiter.allow(init.user_id):
            resp = _error(429, "rate_limited", "Demasiadas peticiones; espera un momento")
            resp.headers["Retry-After"] = "30"
            return resp
        return view(*args, **kwargs)

    return wrapper


def require_admin(view: Callable) -> Callable:
    """Como require_user, pero además exige ``user_id`` ∈ ADMIN_CHAT_IDS (403 si no)."""

    @require_user
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        cfg = current_app.config["TASALO_SETTINGS"]
        if g.user_id not in cfg.admin_ids:
            return _error(403, "forbidden", "No tienes permiso para esto")
        return view(*args, **kwargs)

    return wrapper
