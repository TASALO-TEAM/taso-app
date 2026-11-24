"""Login con Telegram para quien abre la web fuera de Telegram (``/auth/telegram/inicio`` y ``/callback``).

Flujo: /inicio crea state + PKCE (guardados en el servidor, un solo uso, 10 min), pone una cookie corta con el state
(ata el intento a este navegador: sin ella un callback ajeno no entra) y manda a Telegram. /callback comprueba esa
cookie, gasta el state, cambia el código por el id_token, verifica su firma y abre la sesión (cookie HttpOnly).
Todo error vuelve a la miniapp con ``?login=error`` y un mensaje genérico; el detalle solo va al log, sin códigos ni tokens.
"""

from __future__ import annotations

import hmac
import logging

from flask import Blueprint, current_app, redirect, request

from src.auth import websession
from src.auth.guard import FLOW_COOKIE, SESSION_COOKIE, client_ip

logger = logging.getLogger("taso-miniapp.login")

bp = Blueprint("auth_web", __name__, url_prefix="/auth")


def _home(query: str = ""):
    base = current_app.config["TASALO_SETTINGS"].base_path
    resp = redirect(f"{base}/{query}#/perfil", code=302)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _cookie_args() -> dict:
    return {"httponly": True, "secure": True, "samesite": "Lax", "path": "/"}


@bp.route("/telegram/inicio")
def login_start():
    cfg = websession.login_config()
    if cfg is None:
        return _home("?login=off")
    limiter = current_app.config.get("TASALO_LOGIN_LIMITER")
    if limiter is not None and not limiter.allow(client_ip()):
        return _home("?login=busy")
    try:
        state, url = websession.start_flow(cfg)
    except websession.LoginError as exc:
        logger.warning("login: no se pudo iniciar el flujo: %s", exc)
        return _home("?login=busy")
    resp = redirect(url, code=302)
    resp.headers["Cache-Control"] = "no-store"
    resp.set_cookie(FLOW_COOKIE, state, max_age=websession.FLOW_TTL, **_cookie_args())
    return resp


@bp.route("/telegram/callback")
def login_callback():
    cfg = websession.login_config()
    if cfg is None:
        return _home("?login=off")
    code, state = request.args.get("code", ""), request.args.get("state", "")
    cookie_state = request.cookies.get(FLOW_COOKIE, "")

    def fail(reason: str):
        logger.warning("login: rechazado (%s)", reason)
        resp = _home("?login=error")
        resp.delete_cookie(FLOW_COOKIE, path="/")
        return resp

    if request.args.get("error") or not code or not state or len(code) > 2048:
        return fail("sin código o con error de Telegram")
    if not cookie_state or not hmac.compare_digest(cookie_state.encode("utf-8"), state.encode("utf-8")):
        return fail("el state no coincide con la cookie de este navegador")
    verifier = websession.consume_flow(state)
    if verifier is None:
        return fail("state desconocido, usado o vencido")
    try:
        profile = websession.verify_id_token(websession.exchange_code(cfg, code, verifier), cfg)
    except websession.LoginError as exc:
        return fail(str(exc))
    token = websession.create_session(profile)
    resp = _home()
    resp.delete_cookie(FLOW_COOKIE, path="/")
    resp.set_cookie(SESSION_COOKIE, token, max_age=websession.SESSION_MAX, **_cookie_args())
    logger.info("login: sesión web abierta para el usuario %s", profile["id"])
    return resp
