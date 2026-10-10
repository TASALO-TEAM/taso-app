"""API del BFF (blueprint ``api``, prefijo ``/api``): endpoints de sesión."""

from flask import Blueprint, current_app, g, jsonify

from src.auth.guard import require_user

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/me")
@require_user
def me():
    """Identidad del usuario, tomada SOLO del initData validado."""
    cfg = current_app.config["TASALO_SETTINGS"]
    init = g.init_data
    return jsonify(
        {
            "ok": True,
            "user": {
                "id": init.user_id,
                "first_name": init.first_name,
                "language_code": init.language_code,
                "allows_write_to_pm": init.allows_write_to_pm,
                "is_admin": init.user_id in cfg.admin_ids,
            },
            "start_param": init.start_param,
        }
    )
