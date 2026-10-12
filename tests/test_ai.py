"""Tests del Panorama IA (S10 F3): servicio ``src/services/ai.py`` y ``POST /api/market/<SIMBOLO>/panorama``. Sin red."""

import json

import httpx
import pytest

from config import settings
from src.services import ai, crypto
from src.services.cache import RateLimiter
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_market import cmc_data, src  # noqa: F401  (fuentes simuladas)
from tests.test_shell import USER, signed, tma

MARKET = {
    "symbol": "SOL", "name": "Solana", "source": "coinmarketcap", "price": 150.0, "high_24h": 156.0, "low_24h": 144.0,
    "change_1h": 0.5, "change_24h": -2.5, "change_7d": 8.1, "rank": 5, "market_cap": 9e10, "volume_24h": 4e9,
    "enrichment": {"ath": 260.0, "ath_change_pct": -42.3, "atl": 0.5, "circulating_supply": 430e6, "total_supply": 590e6,
                   "max_supply": None, "category": "Smart Contract Platform", "sentiment_up_pct": 81.0},
}
TEXT = "El precio cayó un poco en el día. Aun así, la semana sigue en positivo.\n\nLa capitalización la mantiene en el top 5.\n\nEl mercado parece cauteloso."


class FakeResponse:
    def __init__(self, status=200, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text or json.dumps(body or {})

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def groq_ok(content=TEXT, finish="stop"):
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}], "usage": {"prompt_tokens": 400, "completion_tokens": 200}}


@pytest.fixture
def groq(monkeypatch):
    """Groq simulado con dos claves. ``g.queue`` = respuestas en orden (la última se repite); ``g.calls`` = lo enviado."""
    monkeypatch.setattr(settings, "groq_api_key", "gsk_aaaa1111,gsk_bbbb2222")

    class G:
        queue = [FakeResponse(200, groq_ok())]
        calls = []

    def fake_post(url, *, json, headers, timeout=ai.TIMEOUT):
        G.calls.append({"url": url, "json": json, "key": headers["Authorization"].split()[-1]})
        item = G.queue.pop(0) if len(G.queue) > 1 else G.queue[0]
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(ai, "_http_post", fake_post)
    return G


# ------------------------------------------------------------------ texto del prompt


def test_format_market_text_solo_trae_lo_que_existe():
    text = ai.format_market_text({"symbol": "NEWC", "source": "coingecko", "price": 0.00001234, "change_24h": 3.0, "rank": None,
                                  "market_cap": 0, "volume_24h": None, "high_24h": None, "low_24h": None, "enrichment": None})
    assert "Precio actual: $0.00001234 USD" in text
    assert "Variación 24h: +3.00%" in text and "Fuente principal: CoinGecko" in text
    for absent in ("None", "Ranking", "Capitalización", "Volumen", "Máximo", "ATH", "$0 "):
        assert absent not in text


def test_format_market_text_completo():
    text = ai.format_market_text(MARKET)
    for expected in ("Nombre: Solana", "Precio actual: $150.00 USD", "Máximo 24h: $156.00", "Variación 1h: +0.50%", "Variación 7d: +8.10%",
                     "Ranking por capitalización: #5", "ATH (máximo histórico): $260.00 USD", "Distancia respecto al ATH: -42.30%",
                     "Oferta circulante: 430,000,000", "Oferta total: 590,000,000", "Categoría del proyecto: Smart Contract Platform",
                     "Sentimiento positivo de la comunidad: 81.0%"):
        assert expected in text
    assert "Oferta máxima" not in text  # max_supply None: se usa la total


def test_clean_text_quita_markdown_disclaimer_del_modelo_y_parte_en_parrafos():
    raw = "## Titulo\n**Bitcoin** sube. Es un dato. Otro dato. Cuarto dato. Quinto dato. Sexto dato. Séptimo dato.\nAnálisis generado por IA. No constituye asesoramiento financiero."
    out = ai.clean_text(raw)
    assert "*" not in out and "#" not in out and "generado por IA" not in out
    assert "\n\n" in out  # un bloque único se reparte en párrafos


def test_clean_text_cortado_por_longitud_termina_en_una_frase_completa():
    out = ai.clean_text("Primera frase completa. Segunda frase completa. Tercera frase que se queda a medi", cut_by_length=True)
    assert out.endswith("Segunda frase completa.")


# ------------------------------------------------------------------ Groq


def test_generate_panorama_envia_el_payload_del_bot_y_devuelve_texto_aparte_del_disclaimer(groq):
    out = ai.generate_panorama(MARKET)
    sent = groq.calls[0]["json"]
    assert sent["model"] == "openai/gpt-oss-120b" and sent["reasoning_effort"] == "low" and sent["max_completion_tokens"] >= 512
    assert "Precio actual: $150.00 USD" in sent["messages"][1]["content"]
    assert out["text"] == TEXT and out["disclaimer"] == ai.DISCLAIMER and "generated_at" in out
    assert "No constituye" not in out["text"]


def test_un_429_pasa_a_la_siguiente_clave(groq):
    groq.queue = [FakeResponse(429, {}), FakeResponse(200, groq_ok())]
    ai.generate_panorama(MARKET)
    assert len(groq.calls) == 2 and groq.calls[0]["key"] != groq.calls[1]["key"]


def test_429_en_todas_las_claves_es_ai_unavailable(groq):
    groq.queue = [FakeResponse(429, {})]
    with pytest.raises(ai.AiUnavailable):
        ai.generate_panorama(MARKET)
    assert len(groq.calls) == 2


def test_un_500_no_rota_de_clave(groq):
    groq.queue = [FakeResponse(500, {}, text="boom")]
    with pytest.raises(ai.AiUnavailable):
        ai.generate_panorama(MARKET)
    assert len(groq.calls) == 1


@pytest.mark.parametrize("failure", [httpx.ConnectError("x"), httpx.ReadTimeout("x"), FakeResponse(200, None), FakeResponse(200, {"choices": []}),
                                     FakeResponse(200, groq_ok("   ")), FakeResponse(200, [1, 2])])
def test_fallos_y_respuestas_raras_son_ai_unavailable(groq, failure):
    groq.queue = [failure]
    with pytest.raises(ai.AiUnavailable):
        ai.generate_panorama(MARKET)


def test_sin_claves_no_llama_a_nadie(monkeypatch, groq):
    monkeypatch.setattr(settings, "groq_api_key", "")
    with pytest.raises(ai.AiUnavailable):
        ai.generate_panorama(MARKET)
    assert groq.calls == []


def test_groq_ring_rota_claves():
    assert crypto.groq_ring() is not None


# ------------------------------------------------------------------ API


def post(ctx, path, user_id=USER["id"]):  # noqa: F811
    user = {**USER, "id": user_id}
    return ctx.client.post(path, headers=tma(signed(user=user)))


def test_api_exige_initdata(ctx, src, groq):  # noqa: F811
    assert ctx.client.post("/api/market/SOL/panorama").status_code == 401
    assert groq.calls == []


def test_api_get_no_esta_permitido(ctx, src, groq):  # noqa: F811
    assert ctx.get("/api/market/SOL/panorama").status_code == 405


def test_api_ok_y_cache_compartida_entre_usuarios_sin_gastar_limite(ctx, src, groq):  # noqa: F811
    ctx.app.config["TASALO_AI_LIMITER"] = RateLimiter(1, 3600.0)
    first = post(ctx, "/api/market/sol/panorama", user_id=1)
    body = first.get_json()
    assert first.status_code == 200 and body["ok"] is True and body["symbol"] == "SOL" and body["cached"] is False
    assert body["text"] == TEXT and body["disclaimer"] == ai.DISCLAIMER
    assert first.headers["Cache-Control"] == "no-store"
    # otro usuario, mismo resultado, sin llamar a Groq
    second = post(ctx, "/api/market/SOL/panorama", user_id=2).get_json()
    assert second["cached"] is True and second["text"] == TEXT
    # el usuario 1 ya gastó su único análisis, pero leer lo ya generado no cuenta
    again = post(ctx, "/api/market/SOL/panorama", user_id=1)
    assert again.status_code == 200 and len(groq.calls) == 1


def test_api_limite_por_usuario_solo_cuenta_las_llamadas_a_groq(ctx, src, groq):  # noqa: F811
    ctx.app.config["TASALO_AI_LIMITER"] = RateLimiter(2, 3600.0)
    for sym in ("SOL", "ADA"):
        src.cmc = cmc_data(symbol=sym)
        assert post(ctx, f"/api/market/{sym}/panorama", user_id=7).status_code == 200
    src.cmc = cmc_data(symbol="DOT")
    blocked = post(ctx, "/api/market/DOT/panorama", user_id=7)
    assert blocked.status_code == 429 and blocked.get_json()["error"]["code"] == "ai_rate_limited"
    assert len(groq.calls) == 2  # lo bloqueado no llegó a Groq
    assert post(ctx, "/api/market/DOT/panorama", user_id=8).status_code == 200  # el límite es por usuario
    assert post(ctx, "/api/market/SOL/panorama", user_id=7).status_code == 200  # y lo ya generado se sigue leyendo


def test_api_el_resultado_caduca_a_los_15_minutos(ctx, src, groq):  # noqa: F811
    post(ctx, "/api/market/SOL/panorama")
    ctx.clock.t += 16 * 60
    assert post(ctx, "/api/market/SOL/panorama").get_json()["cached"] is False
    assert len(groq.calls) == 2


def test_api_groq_caido_es_503_y_no_se_cachea(ctx, src, groq):  # noqa: F811
    groq.queue = [FakeResponse(500, {})]
    r = post(ctx, "/api/market/SOL/panorama")
    assert r.status_code == 503 and r.get_json()["error"]["code"] == "ai_unavailable"
    groq.queue = [FakeResponse(200, groq_ok())]
    assert post(ctx, "/api/market/SOL/panorama").status_code == 200


def test_api_simbolo_invalido_inexistente_y_mercado_caido(ctx, src, groq):  # noqa: F811
    assert post(ctx, "/api/market/BT%20C/panorama").status_code == 400
    src.cmc, src.cg = None, {"not_found": True}
    assert post(ctx, "/api/market/NOPE/panorama").status_code == 404
    from src.services.cache import UpstreamError
    src.cmc = UpstreamError("x")
    assert post(ctx, "/api/market/XYZ/panorama").status_code in (404, 502)
    assert groq.calls == []
