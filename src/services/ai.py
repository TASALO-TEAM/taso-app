"""Panorama IA (S10 F3): comentario «Spotlight» de una moneda con Groq, como el botón «Panorama IA» de ``/p`` del bot.

Es el puerto síncrono de ``taso-bot/src/core/ai_logic.py::get_groq_price_spotlight``. Igual que el bot: ``openai/gpt-oss-120b``,
``reasoning_effort: "low"`` (es redacción a partir de datos ya resueltos; sin esto los tokens de razonamiento se comen el
presupuesto de ``max_completion_tokens`` y la respuesta sale cortada), rotación round-robin de varias claves con salto a la
siguiente ante un 429 y disclaimer añadido por código, nunca por el modelo.

Diferencias a propósito: el texto sale en párrafos de texto plano (sin Markdown de Telegram) y el cliente lo pinta con
``textContent``; el disclaimer va aparte en su propio campo. Los tests sustituyen ``_http_post`` para no tocar la red.
"""

from __future__ import annotations

import logging
import math
import re
import threading
from typing import Any, Optional

import httpx

from src import db
from src.services import crypto
from src.services.cache import UpstreamError

logger = logging.getLogger("taso-miniapp.ai")

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"
TIMEOUT = 25.0
REASONING_EFFORT = "low"
MAX_COMPLETION_TOKENS = 1024  # el bot usa 512; aquí hay margen extra para que nunca salga cortado
TEMPERATURE = 0.7
MAX_TEXT_CHARS = 3000
DISCLAIMER = "Análisis generado por IA. No constituye asesoramiento financiero."

SYSTEM_PROMPT = (
    "Eres un analista de mercado de criptomonedas que escribe comentarios breves, claros y conversacionales en español, "
    "sin tecnicismos de trading."
)

PRICE_SPOTLIGHT_PROMPT = """Eres un analista profesional de criptomonedas.

Tu tarea NO es hacer un análisis técnico tradicional.

Debes generar un comentario estilo "Spotlight" similar al que aparece en CoinMarketCap.

Recibirás datos de una criptomoneda provenientes de CoinMarketCap y/o CoinGecko.

=== DATOS DE MERCADO ===
{market_data_text}
=== FIN DATOS ===

Analiza:
- comportamiento del precio
- variación 1h, 24h y 7d (si está disponible)
- capitalización de mercado
- volumen
- distancia respecto al ATH (si está disponible)
- oferta circulante y máxima (si está disponible)
- sentimiento del mercado (si está disponible)
- posición en el ranking
- cualquier otro dato disponible

No inventes información ni uses datos que no aparezcan arriba.

No menciones indicadores técnicos como RSI, MACD o medias móviles porque no están disponibles.

Explica qué significan los datos para un inversor promedio.

El análisis debe sentirse humano y conversacional.

Debe responder preguntas implícitas como:
¿Qué está pasando? ¿Por qué es importante? ¿Qué transmite el mercado?
¿Qué podría significar para las próximas sesiones?

No hagas predicciones absolutas. Utiliza expresiones como: podría indicar...,
sugiere..., parece reflejar..., el mercado muestra..., los inversores parecen...

Evita lenguaje exagerado. No uses emojis dentro de los párrafos.

FORMATO DE SALIDA (muy importante):
- Escribe el análisis en 3 párrafos cortos y separados, NO un bloque único.
- Cada párrafo debe tratar una idea distinta, por ejemplo:
  1) Qué está pasando con el precio y el momentum reciente.
  2) Qué dicen la capitalización, el volumen y/o el ranking sobre la posición del activo.
  3) Qué transmite el sentimiento del mercado o la distancia al ATH/ATL para el inversor.
- Separa cada párrafo con una línea en blanco (doble salto de línea).
- Cada párrafo debe tener entre 2 y 4 frases.
- No uses títulos, encabezados ni numeración para los párrafos.
- Texto plano: sin asteriscos, guiones bajos, almohadillas ni ningún otro formato Markdown.

La respuesta debe ocupar entre 120 y 180 palabras en total, en español.

Termina el último párrafo con una conclusión breve de una sola frase.

NO incluyas tú mismo la línea del disclaimer final — se añade automáticamente
después de tu respuesta. Termina tu texto justo después de la conclusión.
"""


class AiUnavailable(UpstreamError):
    """Groq no pudo responder (sin claves, red, error HTTP o respuesta vacía)."""


class AiRateLimited(Exception):
    """El usuario ya gastó sus análisis de IA de esta hora. A propósito NO es ``UpstreamError``: no es un fallo del origen."""


# ---------------------------------------------------------------- HTTP

_client: Optional[httpx.Client] = None
_client_lock = threading.Lock()


def _http_post(url: str, *, json: dict, headers: dict, timeout: float = TIMEOUT):
    """POST con un cliente compartido. Lo sustituyen los tests."""
    global _client
    with _client_lock:
        if _client is None or _client.is_closed:
            _client = httpx.Client(timeout=httpx.Timeout(TIMEOUT, connect=5.0))
        client = _client
    return client.post(url, json=json, headers=headers, timeout=timeout)


def _call_groq(payload: dict) -> dict:
    """Llama a Groq rotando claves: un 429 pasa a la siguiente; cualquier otro fallo corta (rotar no arregla un 400)."""
    ring = crypto.groq_ring()
    if not len(ring):
        logger.error("Groq: GROQ_API_KEY sin configurar")
        raise AiUnavailable("sin API key de Groq")
    for attempt in range(len(ring)):
        key = ring.next()
        try:
            resp = _http_post(GROQ_API_URL, json=payload, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        except httpx.HTTPError as exc:
            logger.warning("Groq sin respuesta: %s", type(exc).__name__)
            raise AiUnavailable(type(exc).__name__) from exc
        if resp.status_code == 429 and attempt < len(ring) - 1:
            logger.warning("Groq 429 con la key ...%s; pruebo la siguiente (%d/%d)", (key or "")[-4:], attempt + 2, len(ring))
            continue
        if resp.status_code != 200:
            logger.error("Groq respondió %s (key ...%s): %s", resp.status_code, (key or "")[-4:], (resp.text or "")[:300])
            raise AiUnavailable(f"http {resp.status_code}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise AiUnavailable("respuesta no JSON") from exc
        if not isinstance(data, dict):
            raise AiUnavailable("respuesta inesperada")
        return data
    raise AiUnavailable("429 en todas las claves")  # no se llega aquí, por si acaso


# ---------------------------------------------------------------- Texto del prompt


def _num(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value else None


def _pos(value: Any) -> Optional[float]:
    n = _num(value)
    return n if n is not None and n > 0 and n != float("inf") else None


def _price(value: float) -> str:
    """Precio en USD: 2 decimales desde 1; por debajo, 4 cifras significativas (nunca «0.0000»)."""
    if value >= 1:
        return f"${value:,.2f}"
    decimals = min(12, max(4, 3 - math.floor(math.log10(value))))
    return f"${value:.{decimals}f}".rstrip("0") if decimals > 4 else f"${value:.4f}"


_SOURCE_NAMES = {"coinmarketcap": "CoinMarketCap", "coingecko": "CoinGecko"}


def format_market_text(m: dict) -> str:
    """Datos de ``market.get_market`` en líneas «Etiqueta: valor». Solo lo que existe: nada de «None» ni «$0» que
    lleven al modelo a inventar contexto."""
    lines = [f"Símbolo: {m.get('symbol') or 'N/A'}"]
    if m.get("name"):
        lines.append(f"Nombre: {m['name']}")
    lines.append(f"Fuente principal: {_SOURCE_NAMES.get(m.get('source'), 'desconocida')}")
    price = _pos(m.get("price"))
    if price:
        lines.append(f"Precio actual: {_price(price)} USD")
    high, low = _pos(m.get("high_24h")), _pos(m.get("low_24h"))
    if high and low:
        lines.append(f"Máximo 24h: {_price(high)}")
        lines.append(f"Mínimo 24h: {_price(low)}")
    for label, key in (("1h", "change_1h"), ("24h", "change_24h"), ("7d", "change_7d")):
        value = _num(m.get(key))
        if value is not None:
            lines.append(f"Variación {label}: {value:+.2f}%")
    if isinstance(m.get("rank"), int) and m["rank"] > 0:
        lines.append(f"Ranking por capitalización: #{m['rank']}")
    if _pos(m.get("market_cap")):
        lines.append(f"Capitalización de mercado: ${m['market_cap']:,.0f} USD")
    if _pos(m.get("volume_24h")):
        lines.append(f"Volumen 24h: ${m['volume_24h']:,.0f} USD")

    e = m.get("enrichment") or {}
    if _pos(e.get("ath")):
        lines.append(f"ATH (máximo histórico): {_price(e['ath'])} USD")
        if _num(e.get("ath_change_pct")) is not None:
            lines.append(f"Distancia respecto al ATH: {e['ath_change_pct']:.2f}%")
    if _pos(e.get("atl")):
        lines.append(f"ATL (mínimo histórico): {_price(e['atl'])} USD")
    if _pos(e.get("circulating_supply")):
        lines.append(f"Oferta circulante: {e['circulating_supply']:,.0f}")
    if _pos(e.get("max_supply")):
        lines.append(f"Oferta máxima: {e['max_supply']:,.0f}")
    elif _pos(e.get("total_supply")):
        lines.append(f"Oferta total: {e['total_supply']:,.0f}")
    if e.get("category"):
        lines.append(f"Categoría del proyecto: {e['category']}")
    if _num(e.get("sentiment_up_pct")) is not None:
        lines.append(f"Sentimiento positivo de la comunidad: {e['sentiment_up_pct']:.1f}%")
    return "\n".join(lines)


# ---------------------------------------------------------------- Texto de la respuesta

_DISCLAIMER_RE = re.compile(r"an[aá]lisis generado por ia[^\n]*", re.IGNORECASE)


def _paragraphs(text: str) -> str:
    """Garantiza párrafos separados (el modelo a veces devuelve un bloque único) — misma regla que el bot."""
    text = text.strip()
    if "\n\n" in text:
        return re.sub(r"\n{3,}", "\n\n", text)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])", text) if s.strip()]
    if len(sentences) <= 3:
        return text
    size = 3 if len(sentences) > 6 else 2
    return "\n\n".join(" ".join(sentences[i : i + size]) for i in range(0, len(sentences), size))


def clean_text(raw: str, *, cut_by_length: bool = False) -> str:
    """Texto plano y presentable: sin Markdown suelto, sin disclaimer del modelo, en párrafos y de largo acotado."""
    text = raw.replace("\r\n", "\n")
    text = re.sub(r"[*`]+", "", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = _DISCLAIMER_RE.sub("", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = _paragraphs(text)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS].rsplit(" ", 1)[0] + "…"
        cut_by_length = False
    if cut_by_length:
        # El modelo se quedó sin presupuesto a media frase: se recorta hasta el último punto en vez de mostrar medio texto.
        end = text.rfind(".")
        if end > len(text) // 2:
            text = text[: end + 1]
    return text.strip()


# ---------------------------------------------------------------- API pública


def generate_panorama(market: dict) -> dict:
    """Comentario de una moneda a partir de sus datos de ``market.get_market``. Lanza ``AiUnavailable`` si no se puede."""
    prompt = PRICE_SPOTLIGHT_PROMPT.replace("{market_data_text}", format_market_text(market))
    data = _call_groq(
        {
            "model": MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            "temperature": TEMPERATURE,
            "max_completion_tokens": MAX_COMPLETION_TOKENS,
            "reasoning_effort": REASONING_EFFORT,
        }
    )
    choices = data.get("choices")
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
    content = str(message.get("content") or "").strip()
    if not content:
        logger.warning("Groq devolvió contenido vacío para %s (finish_reason=%s)", market.get("symbol"), choice.get("finish_reason"))
        raise AiUnavailable("respuesta vacía")
    text = clean_text(content, cut_by_length=choice.get("finish_reason") == "length")
    if not text:
        raise AiUnavailable("respuesta vacía tras limpiar")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    logger.info("Panorama IA de %s: tokens p=%s c=%s", market.get("symbol"), usage.get("prompt_tokens"), usage.get("completion_tokens"))
    return {"text": text, "disclaimer": DISCLAIMER, "generated_at": db.now_iso()}
