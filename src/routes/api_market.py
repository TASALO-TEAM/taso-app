"""API de Mercado (``/api/market``, S10): el ``/p`` del bot dentro de la miniapp. Lectura pública; el Panorama IA exige sesión."""

from flask import Blueprint, current_app, g, jsonify, request

from src.auth.guard import optional_user, require_user
from src.services import ai as ai_service
from src.services import market as market_service
from src.services import news as news_service
from src.services.cache import Cached, TTLCache, UpstreamError

bp = Blueprint("api_market", __name__, url_prefix="/api/market")

MARKET_TTL = 60  # CMC refresca cada minuto
MARKET_MAX_STALE = 15 * 60
CHART_MAX_STALE = 24 * 3600  # una gráfica vieja es mejor que ninguna
PANORAMA_TTL = 15 * 60  # el comentario de IA se comparte entre usuarios 15 min por moneda


def _err(status: int, code: str, message: str):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    return resp


def _market_cached(cache: TTLCache, sym: str) -> Cached:
    """Datos de una moneda con la caché compartida de 60 s (lo usan la ficha y el Panorama IA)."""

    def load():
        data = market_service.get_market(sym)
        if data is None:
            raise UpstreamError("sin datos de mercado")
        return data

    return cache.fetch(("market", sym), MARKET_TTL, MARKET_MAX_STALE, load)


@bp.route("/top")
@optional_user
def top():
    """Las 5 monedas más consultadas por los usuarios (con semilla BTC, ETH, SOL, BNB, HIVE mientras no haya uso)."""
    return jsonify({"ok": True, "symbols": market_service.top_symbols()})


@bp.route("/news")
@optional_user
def news():
    """Titulares para el carrusel de Mercado (RSS públicos sin clave; ver ``services/news.py``). General, no por moneda."""
    try:
        items, stale = news_service.get_news(current_app.config["TASALO_CACHE"])
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudieron cargar las noticias")
    return jsonify({"ok": True, "stale": stale, "items": items})


@bp.route("/<symbol>/chart")
@optional_user
def chart(symbol: str):
    """Serie de precios de una moneda (``?range=1d|7d|1m|1y|max``, por defecto 1d): gráfica y sparklines."""
    sym = market_service.normalize_symbol(symbol)
    range_id = request.args.get("range", "1d")
    if sym is None or range_id not in market_service.CHART_RANGES:
        return _err(400, "bad_request", "Moneda o rango no válidos")

    def load():
        points = market_service.get_chart(sym, range_id)
        if not points:
            raise UpstreamError("sin gráfica")
        return points

    ttl = market_service.CHART_RANGES[range_id][2]
    try:
        result = current_app.config["TASALO_CACHE"].fetch(("chart", sym, range_id), ttl, CHART_MAX_STALE, load)
    except UpstreamError:
        return _err(404, "no_chart", f"No hay gráfica de {sym}")
    return jsonify({"ok": True, "stale": result.stale, "range": range_id, "points": result.value})


@bp.route("/<symbol>")
@optional_user
def coin(symbol: str):
    """Datos de una moneda: precio, high/low 24h, ETH/BTC, variaciones, rank, cap, volumen y bloque de CoinGecko."""
    sym = market_service.normalize_symbol(symbol)
    if sym is None:
        return _err(400, "bad_request", "Escribe el símbolo de una moneda (por ejemplo BTC)")
    try:
        result = _market_cached(current_app.config["TASALO_CACHE"], sym)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudieron cargar los datos de mercado")
    if result.value.get("not_found"):
        return _err(404, "not_found", f"No encontré la moneda {sym}")
    if g.user_id is not None:  # los visitantes sin sesión no mueven el top 5
        market_service.record_query(g.user_id, sym)
    return jsonify({"ok": True, "stale": result.stale, "market": result.value})


@bp.route("/<symbol>/panorama", methods=["POST"])
@require_user
def panorama(symbol: str):
    """Panorama IA (Groq) de una moneda. Los datos los lee el servidor (nunca se confía en los del cliente).

    El resultado se comparte 15 min por moneda. El límite por usuario (``AI_RATE_LIMIT_PER_HOUR``) solo se gasta
    cuando de verdad hay que llamar a Groq: leer un resultado ya generado no cuesta nada.
    """
    sym = market_service.normalize_symbol(symbol)
    if sym is None:
        return _err(400, "bad_request", "Escribe el símbolo de una moneda (por ejemplo BTC)")
    cache = current_app.config["TASALO_CACHE"]
    limiter = current_app.config["TASALO_AI_LIMITER"]
    try:
        market = _market_cached(cache, sym)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudieron cargar los datos de mercado")
    if market.value.get("not_found"):
        return _err(404, "not_found", f"No encontré la moneda {sym}")

    generated = []

    def generate():
        if not limiter.allow(g.user_id):
            raise ai_service.AiRateLimited()
        value = ai_service.generate_panorama(market.value)
        generated.append(True)
        return value

    try:
        result = cache.fetch(("panorama", sym), PANORAMA_TTL, 0, generate)
    except ai_service.AiRateLimited:
        return _err(429, "ai_rate_limited", "Llegaste al límite de análisis de IA de esta hora. Inténtalo más tarde.")
    except UpstreamError:
        return _err(503, "ai_unavailable", "La IA no está disponible ahora. Inténtalo en un momento.")
    return jsonify({"ok": True, "symbol": sym, "cached": not generated, **result.value})
