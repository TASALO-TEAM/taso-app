"""API de alertas del usuario (blueprint ``api_alerts``, prefijo ``/api/alerts``).

La identidad sale SOLO del initData validado (``g.user_id``): ninguna ruta acepta un ``uid`` del cliente, y un
cuerpo que traiga ``user_id`` se ignora. Así un usuario no puede leer ni borrar alertas de otro.
"""

from flask import Blueprint, g, jsonify, request

from src.auth.guard import require_user
from src.services import alerts as alerts_service
from src.services.cache import UpstreamError, UpstreamNotFound

bp = Blueprint("api_alerts", __name__, url_prefix="/api/alerts")


def _err(status: int, code: str, message: str):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    return resp


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _upstream_failed():
    return _err(502, "upstream_unavailable", "No se pudo completar la operación. Inténtalo de nuevo.")


def _not_found():
    return _err(404, "not_found", "No se encontró esa alerta")


@bp.route("")
@require_user
def overview():
    """Las cuatro secciones; si una falla viene ``{"ok": false}`` solo en esa y las demás siguen."""
    return jsonify({"ok": True, **alerts_service.get_overview(g.user_id)})


# ---------- Precio (solo lista y borrar; crear llega con S10) ----------

@bp.route("/price/<int:alert_id>", methods=["DELETE"])
@require_user
def delete_price(alert_id: int):
    try:
        alerts_service.delete_price(g.user_id, alert_id)
    except UpstreamNotFound:
        return _not_found()
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True})


# ---------- Imagen de El Toque ----------

@bp.route("/image", methods=["PUT"])
@require_user
def put_image():
    data = _body()
    alert_time = data.get("alert_time")
    format_type = data.get("format_type", "photo")
    enabled = data.get("enabled", True)
    if not alerts_service.valid_time(alert_time):
        return _err(400, "bad_request", "La hora debe tener el formato HH:MM")
    if format_type not in alerts_service.FORMATS:
        return _err(400, "bad_request", "Formato no válido")
    if not isinstance(enabled, bool):
        return _err(400, "bad_request", "Estado no válido")
    try:
        state = alerts_service.set_image(g.user_id, alert_time, format_type, enabled)
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True, **state})


@bp.route("/image", methods=["DELETE"])
@require_user
def delete_image():
    try:
        alerts_service.delete_image(g.user_id)
    except UpstreamNotFound:
        return _not_found()
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True})


# ---------- Año y frase del día (hora UTC) ----------

@bp.route("/year", methods=["PUT"])
@require_user
def put_year():
    hour = _body().get("hour")
    if not alerts_service.valid_hour(hour):
        return _err(400, "bad_request", "La hora debe estar entre 0 y 23")
    try:
        state = alerts_service.set_year(g.user_id, hour)
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True, **state})


@bp.route("/year", methods=["DELETE"])
@require_user
def delete_year():
    try:
        alerts_service.delete_year(g.user_id)
    except UpstreamNotFound:
        return _not_found()
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True})


# ---------- Spotlight diario (hasta 2 horarios, hora UTC) ----------

@bp.route("/spotlight", methods=["POST"])
@require_user
def add_spotlight():
    hour = _body().get("hour")
    if not alerts_service.valid_hour(hour):
        return _err(400, "bad_request", "La hora debe estar entre 0 y 23")
    try:
        state = alerts_service.add_spotlight(g.user_id, hour)
    except alerts_service.AlertConflict:
        return _err(409, "max_subscriptions_reached", "Ya tienes 2 horarios de Spotlight. Quita uno para añadir otro.")
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True, **state})


@bp.route("/spotlight/<int:hour>", methods=["DELETE"])
@require_user
def delete_spotlight(hour: int):
    if not alerts_service.valid_hour(hour):
        return _err(400, "bad_request", "La hora debe estar entre 0 y 23")
    try:
        state = alerts_service.delete_spotlight(g.user_id, hour)
    except UpstreamNotFound:
        return _not_found()
    except UpstreamError:
        return _upstream_failed()
    return jsonify({"ok": True, **state})
