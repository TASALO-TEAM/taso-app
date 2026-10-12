"""API de Mercado (``/api/market``, S10): el ``/p`` del bot dentro de la miniapp. Todo con ``initData``."""

from flask import Blueprint, current_app, g, jsonify

from src.auth.guard import require_user
from src.services import ai as ai_service
from src.services import market as market_service
from src.services.cache import Cached, TTLCache, UpstreamError

bp = Blueprint("api_market", __name__, url_prefix="/api/market")

MARKET_TTL = 60  # CMC refresca cada minuto
MARKET_MAX_STALE = 15 * 60
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
@require_user
def top():
    """Las 5 monedas más consultadas por los usuarios (con semilla BTC, ETH, SOL, BNB, HIVE mientras no haya uso)."""
    return jsonify({"ok": True, "symbols": market_service.top_symbols()})


@bp.route("/<symbol>")
@require_user
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
