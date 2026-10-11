"""API de Mercado (``/api/market``, S10): el ``/p`` del bot dentro de la miniapp. Todo con ``initData``."""

from flask import Blueprint, current_app, g, jsonify

from src.auth.guard import require_user
from src.services import market as market_service
from src.services.cache import UpstreamError

bp = Blueprint("api_market", __name__, url_prefix="/api/market")

MARKET_TTL = 60  # CMC refresca cada minuto
MARKET_MAX_STALE = 15 * 60


def _err(status: int, code: str, message: str):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    return resp


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
    cache = current_app.config["TASALO_CACHE"]

    def load():
        data = market_service.get_market(sym)
        if data is None:
            raise UpstreamError("sin datos de mercado")
        return data

    try:
        result = cache.fetch(("market", sym), MARKET_TTL, MARKET_MAX_STALE, load)
    except UpstreamError:
        return _err(502, "upstream_unavailable", "No se pudieron cargar los datos de mercado")
    if result.value.get("not_found"):
        return _err(404, "not_found", f"No encontré la moneda {sym}")
    market_service.record_query(g.user_id, sym)
    return jsonify({"ok": True, "stale": result.stale, "market": result.value})
