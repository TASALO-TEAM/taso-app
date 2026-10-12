"""API de administración de la miniapp (blueprint ``api_admin``, prefijo ``/api/admin``). Solo admins (403 al resto).

La clave admin de taso-api vive en el servidor y nunca sale en una respuesta.
"""

from flask import Blueprint, current_app, jsonify, request

from src.auth.guard import require_admin
from src.services import admin_stats
from src.services.cache import UpstreamError

bp = Blueprint("api_admin", __name__, url_prefix="/api/admin")


@bp.route("/overview")
@require_admin
def overview():
    """Estado del sistema + estadísticas del bot y de la app. ``?window=24h|7d|30d`` (por defecto 24h)."""
    cache = current_app.config["TASALO_CACHE"]
    try:
        data, stale = admin_stats.get_overview(cache, request.args.get("window"))
    except UpstreamError:
        resp = jsonify({"ok": False, "error": {"code": "upstream_unavailable", "message": "No se pudieron cargar las estadísticas"}})
        resp.status_code = 502
        return resp
    resp = jsonify({"ok": True, "stale": stale, **data})
    resp.headers["Cache-Control"] = "no-store"
    return resp
