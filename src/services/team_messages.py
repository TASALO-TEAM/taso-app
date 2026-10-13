"""Novedades (P5): los mensajes del equipo TASALO que publica taso-api (``GET /api/v1/app/messages``, público).

Se normalizan con lista blanca y límites antes de llegar al navegador: nada de campos que no se usen y nada que
no sea texto. El cuerpo viaja como Markdown (``format`` = telegram | markdown); el cliente lo pinta sin interpretar HTML.
"""

from __future__ import annotations

import logging
from typing import Any

from src.services import taso_client
from src.services.cache import TTLCache

logger = logging.getLogger("taso-miniapp.messages")

PATH = "/api/v1/app/messages"
LIMIT = 10
TTL = 300.0           # unos minutos bastan: son avisos del equipo, no cotizaciones
MAX_STALE = 3600.0
FORMATS = ("telegram", "markdown")


def _clip(value: Any, limit: int) -> str:
    return value[:limit] if isinstance(value, str) else ""


def normalize(body: Any) -> list[dict]:
    """Respuesta de taso-api → lista de mensajes válidos, los más nuevos primero. Lo que no encaje se descarta."""
    raw = body.get("data") if isinstance(body, dict) else None
    out: list[dict] = []
    for m in raw if isinstance(raw, list) else []:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        if isinstance(mid, bool) or not isinstance(mid, int) or mid <= 0:
            continue
        title, text = _clip(m.get("title"), 120).strip(), _clip(m.get("body"), 4096)
        if not title and not text.strip():
            continue
        out.append(
            {
                "id": mid,
                "title": title,
                "body": text,
                "format": m.get("format") if m.get("format") in FORMATS else "markdown",
                "created_at": _clip(m.get("created_at"), 40) or None,
            }
        )
    out.sort(key=lambda i: -i["id"])
    return out[:LIMIT]


def get_messages(cache: TTLCache):
    """Mensajes con caché y stale-if-error. Lanza UpstreamError si no hay nada que servir."""
    return cache.fetch(("team-messages",), TTL, MAX_STALE, lambda: normalize(taso_client.get_json(f"{PATH}?limit={LIMIT}")))
