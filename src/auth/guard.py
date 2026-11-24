"""Guardia de autenticación del BFF: quién eres y desde dónde.

Dos formas de identidad, las dos verificadas en el servidor:
  * dentro de Telegram: ``Authorization: tma <initData>`` (HMAC con el token del bot);
  * en el navegador, tras «Entrar con Telegram»: cookie de sesión ``tasalo_session`` (``src/auth/websession.py``).

``g.user_id`` es la ÚNICA fuente de identidad para los handlers (el mismo id de Telegram en ambos casos). Cualquier
``uid`` que llegue por URL, query o cuerpo debe ignorarse.

``require_user`` exige identidad; ``optional_user`` deja pasar a visitantes anónimos (``g.user_id`` = None) para las
rutas de solo lectura pública, con límite por IP. Con cookie, los métodos que cambian datos exigen además la cabecera
``X-Tasalo-Csrf: 1`` y, si viene ``Origin``, que sea el propio sitio (defensa extra sobre SameSite=Lax).
"""

from __future__ import annotations

import functools
import ipaddress
import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from flask import current_app, g, jsonify, request

from src.auth import websession
from src.auth.initdata import InitData, InitDataError, validate_init_data

logger = logging.getLogger("taso-miniapp.auth")

SCHEME = "tma"
SESSION_COOKIE = "tasalo_session"
FLOW_COOKIE = "tasalo_login"
CSRF_HEADER = "X-Tasalo-Csrf"
# Mensajes genéricos: no revelan por qué falló la validación.
_PUBLIC_MESSAGE = "No se pudo identificar tu sesión de Telegram"
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_LOOPBACK = frozenset({"127.0.0.1", "::1"})


@dataclass(frozen=True)
class Identity:
    user_id: int
    profile: dict[str, Any]
    via: str  # "telegram" | "web"
    init: Optional[InitData] = None


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
    """Valida el initData de la petición actual. Lanza InitDataError si no hay identidad válida."""
    cfg = current_app.config["TASALO_SETTINGS"]
    raw = extract_init_data()
    return validate_init_data(
        raw or "",
        cfg.telegram_bot_token,
        max_age_seconds=cfg.initdata_max_age,
    )


def client_ip() -> str:
    """IP del visitante. Detrás de Caddy (que escribe ``X-Real-IP``, a veces con puerto) solo se confía en esa cabecera
    si la conexión directa viene del propio servidor; si no, se usa la dirección directa."""
    direct = request.remote_addr or "unknown"
    forwarded = request.headers.get("X-Real-IP", "").strip()
    if forwarded and direct in _LOOPBACK:
        if forwarded.startswith("["):
            forwarded = forwarded[1:].split("]", 1)[0]
        elif forwarded.count(":") == 1:
            forwarded = forwarded.split(":", 1)[0]
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return direct


def csrf_ok() -> bool:
    """Para peticiones con cookie que cambian datos: cabecera propia y, si hay Origin, que sea este mismo sitio."""
    if request.method in _SAFE_METHODS:
        return True
    if request.headers.get(CSRF_HEADER) != "1":
        return False
    origin = request.headers.get("Origin")
    return not origin or urlsplit(origin).netloc.lower() == request.host.lower()


def _profile_from_init(init: InitData) -> dict[str, Any]:
    return {
        "first_name": init.first_name,
        "last_name": init.last_name,
        "username": init.username,
        "photo_url": init.photo_url,
        "is_premium": init.is_premium,
        "language_code": init.language_code,
        "allows_write_to_pm": init.allows_write_to_pm,
    }


def _profile_from_session(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "first_name": row["name"],
        "last_name": "",
        "username": row["username"],
        "photo_url": row["photo_url"],
        "is_premium": False,
        "language_code": None,
        "allows_write_to_pm": False,
    }


def identify() -> Optional[Identity]:
    """Identidad de esta petición o None. initData tiene prioridad; si viene y es inválido lanza InitDataError."""
    if extract_init_data() is not None:
        init = authenticate()
        return Identity(init.user_id, _profile_from_init(init), "telegram", init)
    row = websession.load_session(request.cookies.get(SESSION_COOKIE))
    if row is not None:
        return Identity(row["id"], _profile_from_session(row), "web")
    return None


def _set_identity(ident: Optional[Identity]) -> None:
    g.identity = ident
    g.init_data = ident.init if ident else None
    g.user_id = ident.user_id if ident else None
    g.profile = ident.profile if ident else None
    g.auth_via = ident.via if ident else None


def _too_many():
    resp = _error(429, "rate_limited", "Demasiadas peticiones; espera un momento")
    resp.headers["Retry-After"] = "30"
    return resp


def require_user(view: Callable) -> Callable:
    """Decorador: 401 si no hay identidad válida; si sí, deja ``g.user_id``, ``g.profile`` y ``g.auth_via``."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        try:
            ident = identify()
        except InitDataError as exc:
            # Se registra el código (útil para depurar) pero NUNCA el initData ni el token.
            logger.info("initData rechazado: %s", exc.code)
            if exc.code == "server_misconfigured":
                return _error(503, "server_misconfigured", "Servicio no disponible")
            return _error(401, "unauthenticated", _PUBLIC_MESSAGE)
        if ident is None:
            return _error(401, "unauthenticated", _PUBLIC_MESSAGE)
        if ident.via == "web" and not csrf_ok():
            return _error(403, "csrf", "Petición no válida")
        _set_identity(ident)
        limiter = current_app.config.get("TASALO_LIMITER")
        if limiter is not None and not limiter.allow(ident.user_id):
            return _too_many()
        return view(*args, **kwargs)

    return wrapper


def optional_user(view: Callable) -> Callable:
    """Para rutas de lectura pública: con identidad válida, como ``require_user``; sin ella (o con un initData roto)
    pasa como visitante (``g.user_id`` = None) con el límite por IP."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        try:
            ident = identify()
        except InitDataError as exc:
            logger.info("initData rechazado (se trata como visitante): %s", exc.code)
            ident = None
        if ident is not None and ident.via == "web" and not csrf_ok():
            return _error(403, "csrf", "Petición no válida")
        _set_identity(ident)
        if ident is not None:
            limiter, key = current_app.config.get("TASALO_LIMITER"), ident.user_id
        else:
            limiter, key = current_app.config.get("TASALO_ANON_LIMITER"), client_ip()
        if limiter is not None and not limiter.allow(key):
            return _too_many()
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
