"""Blog: últimos posts de una cuenta de Hive (``bridge.get_account_posts``), con caché y nodos de respaldo.

Puerto de ``BlogClient.kt`` / ``BlogParser.kt`` de taso-android, pero en el servidor: la CSP de la miniapp solo
permite ``connect-src 'self'`` y así el texto se limpia una vez (``blog_text``) en vez de en cada teléfono.

Solo se sirven las cuentas de ``ACCOUNTS`` (el BFF no es un proxy abierto de Hive). Un nodo que falla o responde
algo inválido se salta y se prueba el siguiente; si todos fallan la caché sirve lo último (stale-if-error).
Una cuenta sin posts es una respuesta válida (lista vacía).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from src.services import blog_text
from src.services.cache import Cached, TTLCache, UpstreamError
from src.services.rates import parse_instant

logger = logging.getLogger("taso-miniapp.upstream")

ACCOUNTS = ("tasalo", "ersusoficial")
HIVE_NODES = ("https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu")
POSTS_LIMIT = 10

BLOG_TTL = 600.0               # los posts cambian como mucho unas veces al día
BLOG_MAX_STALE = 24 * 3600.0   # si Hive no responde, se sirve lo último hasta 24 h (la UI avisa)

NODE_TIMEOUT = 8.0
MAX_RESPONSE_BYTES = 4 * 1024 * 1024  # 10 posts largos pesan menos; tope defensivo

PERMLINK_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,255}$")
# Permlink real del Spotlight: tasalo-spotlight-09-oct-2026
_SPOTLIGHT_PERMLINK = re.compile(r"^tasalo-spotlight-\d{2}-[a-z]{3}-\d{4}$")
# Título real: «<emoji> TASALO Spotlight — 09 oct 2026», a veces con un espacio inicial. Se tolera cualquier
# prefijo que no sea letra/número (emoji, espacios) y raya larga, corta o guion.
_SPOTLIGHT_TITLE = re.compile(r"^[\W_]*TASALO\s+Spotlight\s*[\u2014\u2013-]", re.I)


def is_spotlight(author: str, permlink: str, title: str) -> bool:
    """¿Es el post diario «TASALO Spotlight» de @tasalo? Por permlink o por título recortado."""
    if author != "tasalo":
        return False
    return bool(_SPOTLIGHT_PERMLINK.match(permlink) or _SPOTLIGHT_TITLE.match(title.strip()))


# ---------- Hive ----------

def _rpc(node: str, payload: dict) -> Any:
    """POST JSON-RPC a un nodo → JSON. Lanza UpstreamError si falla, no es 200, pesa demasiado o no es JSON."""
    try:
        resp = httpx.post(node, json=payload, timeout=NODE_TIMEOUT, headers={"User-Agent": "TASALO-Miniapp"})
    except httpx.HTTPError as exc:
        logger.warning("hive %s falló: %s", node, type(exc).__name__)
        raise UpstreamError(node) from exc
    if resp.status_code != 200 or len(resp.content) > MAX_RESPONSE_BYTES:
        logger.warning("hive %s respondió %s (%d bytes)", node, resp.status_code, len(resp.content))
        raise UpstreamError(node)
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamError(node) from exc


def _declared_images(obj: dict) -> list[str]:
    """``json_metadata`` llega como objeto o como texto con JSON, según el nodo; ``image`` es la lista de portadas."""
    meta = obj.get("json_metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = None
    images = meta.get("image") if isinstance(meta, dict) else None
    return [i for i in images if isinstance(i, str)] if isinstance(images, list) else []


def _https(url: Optional[str]) -> Optional[str]:
    return url.strip() if isinstance(url, str) and url.strip().lower().startswith("https://") else None


def parse_post(obj: Any) -> Optional[dict]:
    """Un post de Hive → dict interno (con ``body`` ya en Markdown). Sin autor, permlink o título se descarta."""
    if not isinstance(obj, dict):
        return None
    author = str(obj.get("author") or "").strip()
    permlink = str(obj.get("permlink") or "").strip()
    title = str(obj.get("title") or "").strip()
    if not author or not permlink or not title or not PERMLINK_RE.match(permlink):
        return None
    body = blog_text.clean(str(obj.get("body") or ""))
    cover = next((c for c in map(_https, _declared_images(obj)) if c), None) or blog_text.first_image(body)
    return {
        "author": author,
        "permlink": permlink,
        "title": title,
        "summary": blog_text.summary(body),
        "created": parse_instant(obj.get("created")),
        "cover": cover,
        "url": f"https://ecency.com/@{author}/{permlink}",
        "spotlight": is_spotlight(author, permlink, title),
        "body": body,
    }


def parse_response(payload: Any) -> Optional[list[dict]]:
    """Respuesta JSON-RPC → posts, los más nuevos primero. None si no es válida (error del nodo, no es una lista…)."""
    if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
        return None
    posts = [p for p in map(parse_post, payload["result"]) if p is not None]
    posts.sort(key=lambda p: p["created"] or "", reverse=True)
    return posts


def fetch_account_posts(account: str) -> list[dict]:
    """Los últimos posts de ``account`` del primer nodo que responda bien. UpstreamError si ninguno."""
    payload = {
        "jsonrpc": "2.0",
        "method": "bridge.get_account_posts",
        "params": {"sort": "posts", "account": account, "limit": POSTS_LIMIT},
        "id": 1,
    }
    for node in HIVE_NODES:
        try:
            posts = parse_response(_rpc(node, payload))
        except UpstreamError:
            continue
        if posts is not None:
            return posts
        logger.warning("hive %s devolvió una respuesta que no es válida", node)
    raise UpstreamError("hive: ningún nodo respondió bien")


# ---------- API del servicio ----------

def get_posts(cache: TTLCache, account: str) -> Cached:
    """``{fetched_at, posts}`` de una cuenta permitida (el llamador valida ``account`` con ``ACCOUNTS``)."""

    def load() -> dict:
        posts = fetch_account_posts(account)
        return {"fetched_at": datetime.now(timezone.utc).isoformat(), "posts": posts}

    return cache.fetch(("blog", account), BLOG_TTL, BLOG_MAX_STALE, load)


def public_post(post: dict, with_body: bool = False) -> dict:
    """Post listo para el cliente. La lista no lleva ``body`` (pesa); el lector lo pide aparte."""
    out = {k: v for k, v in post.items() if k != "body"}
    if with_body:
        out["body"] = post["body"]
    return out


def find_post(value: dict, permlink: str) -> Optional[dict]:
    return next((p for p in value["posts"] if p["permlink"] == permlink), None)
