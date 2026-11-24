"""Páginas: shell único de la miniapp."""

from flask import Blueprint, current_app, render_template

bp = Blueprint("pages", __name__)


@bp.route("/")
def shell():
    """Shell de la miniapp. No lleva datos del usuario: la identidad se resuelve por /api/me.

    ``login_enabled`` solo dice si el servidor tiene configurado «Entrar con Telegram» (para mostrar o no el botón).
    """
    cfg = current_app.config["TASALO_SETTINGS"]
    return render_template(
        "app.html",
        base_path=cfg.base_path,
        bot_username=cfg.bot_username.lstrip("@"),
        login_enabled=cfg.telegram_login_ready,
    )
