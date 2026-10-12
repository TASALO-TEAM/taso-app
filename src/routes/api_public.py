"""API del BFF (blueprint ``api``, prefijo ``/api``): sesión, tasas, año e imagen de El Toque."""

from flask import Blueprint, Response, current_app, g, jsonify, request

from src.auth.guard import require_user
from src.services import blog as blog_service
from src.services import history as history_service
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
                "last_name": init.last_name,
                "username": init.username,
                "photo_url": init.photo_url,
                "is_premium": init.is_premium,
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



@bp.route("/blog/<account>")
@require_user
def blog_list(account: str):
    """Últimos posts de una cuenta de Hive permitida (sin cuerpo: el lector lo pide aparte). ``spotlight`` marca el diario."""
    if account not in blog_service.ACCOUNTS:
        return _err(404, "not_found", "Cuenta no disponible")
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = blog_service.get_posts(cache, account)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar el blog")
    return jsonify(
        {
            "ok": True,
            "stale": result.stale,
            "account": account,
            "fetched_at": result.value["fetched_at"],
            "posts": [blog_service.public_post(p) for p in result.value["posts"]],
        }
    )


@bp.route("/blog/<account>/<permlink>")
@require_user
def blog_post(account: str, permlink: str):
    """Un post (con su cuerpo en Markdown) de los últimos que ya tiene el servidor de esa cuenta."""
    if account not in blog_service.ACCOUNTS or not blog_service.PERMLINK_RE.match(permlink):
        return _err(404, "not_found", "Post no encontrado")
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = blog_service.get_posts(cache, account)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar el post")
    post = blog_service.find_post(result.value, permlink)
    if post is None:
        return _err(404, "not_found", "Post no encontrado")
    return jsonify({"ok": True, "stale": result.stale, "post": blog_service.public_post(post, with_body=True)})


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


@bp.route("/history/summary")
@require_user
def history_summary():
    """Últimos 30 días de todas las tarjetas (fondo de las tarjetas de Tasas)."""
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = history_service.get_summary(cache)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar el historial")
    return jsonify({"ok": True, "stale": result.stale, "days": history_service.SUMMARY_DAYS, **result.value})


@bp.route("/history/daily")
@require_user
def history_daily():
    """Serie diaria de una moneda de una fuente (detalle histórico)."""
    source = request.args.get("source", "")
    code = request.args.get("currency", "").strip().upper()
    days_raw = request.args.get("days", "180")
    if source not in rates_service.SOURCES:
        return _err(400, "bad_request", "Fuente no válida")
    if not history_service.CODE_RE.match(code):
        return _err(400, "bad_request", "Moneda no válida")
    if not days_raw.isdigit() or int(days_raw) not in history_service.ALLOWED_DAYS:
        return _err(400, "bad_request", "Rango no válido")
    days = int(days_raw)
    cache = current_app.config["TASALO_CACHE"]
    try:
        result = history_service.get_daily(cache, source, code, days)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudo cargar el historial")
    return jsonify(
        {"ok": True, "stale": result.stale, "source": source, "currency": code, "days": days, "points": result.value}
    )
