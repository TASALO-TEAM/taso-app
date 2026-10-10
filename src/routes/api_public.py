"""API del BFF (blueprint ``api``, prefijo ``/api``): sesión, tasas, año e imagen de El Toque."""

from flask import Blueprint, Response, current_app, g, jsonify

from src.auth.guard import require_user
from src.services import rates as rates_service
from src.services.cache import UpstreamError, UpstreamNotFound

bp = Blueprint("api", __name__, url_prefix="/api")


def _err(status: int, code: str, message: str):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    return resp


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


@bp.route("/rates")
@require_user
def rates():
    """Tasas de las 4 fuentes, ya ordenadas y normalizadas.

    ``stale`` = true cuando taso-api falló y se sirve lo último guardado.
    Cada fuente trae su ``fetched_at`` real para avisar de datos viejos.
    """
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = rates_service.get_rates(cache)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudieron cargar las tasas")
    return jsonify(
        {
            "ok": True,
            "stale": result.stale,
            "updated_at": result.value["updated_at"],
            "sources": result.value["sources"],
            "image": {"available": rates_service.image_available(cache)},
        }
    )


@bp.route("/year")
@require_user
def year():
    """Progreso del año y frase del día (el cliente tiene cálculo local de respaldo)."""
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = rates_service.get_year(cache)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar el año")
    return jsonify({"ok": True, "stale": result.stale, **result.value})


@bp.route("/image/eltoque")
@require_user
def eltoque_image():
    """Última imagen de El Toque (la API la sirve como PNG)."""
    try:
        data, content_type = rates_service.get_image()
    except UpstreamNotFound:
        return _err(404, "not_found", "Todavía no hay imagen")
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar la imagen")
    return Response(data, mimetype=content_type)
