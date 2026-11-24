"""Noticias de Mercado (S10 F5): titulares de RSS públicos (sin clave) para el carrusel de la pantalla Mercado.

Se leen en el servidor, se normalizan con lista blanca y límites, y al navegador solo viajan titular, enlace https,
fuente, hora y, si la fuente es de confianza, una imagen. Nada de HTML del origen llega al cliente.

Por qué estas fuentes: CoinMarketCap (``content/latest``) da 403 con el plan Basic y NewsData.io (el /news del bot)
tiene 200 créditos al día que son del bot. Ver ``docs/HANDOFF_AGENTE.md`` (sesión 20b).
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

import httpx

from src.services.cache import Cached, TTLCache, UpstreamError

logger = logging.getLogger("taso-miniapp.news")

TTL = 600.0            # cada fuente se pide como mucho cada 10 min, se comparta entre todos los usuarios
MAX_STALE = 6 * 3600.0  # si la fuente cae, se sigue sirviendo lo último hasta 6 h
TOTAL = 8              # noticias del carrusel (son 8 marcadores; más no caben en una pantalla de móvil)
TIMEOUT = 8.0
MAX_BYTES = 1_000_000
TITLE_MAX = 160
USER_AGENT = "TASALO-miniapp/1.0 (+https://tasalo.duckdns.org)"
# Solo se enlazan imágenes de estos hosts (cada imagen cargada le da la IP del usuario a quien la sirve).
IMAGE_HOSTS = frozenset({"assets.beincrypto.com"})


@dataclass(frozen=True)
class Feed:
    id: str
    name: str | None  # None = se muestra el dominio del enlace (Yahoo agrupa muchos medios y no dice cuál)
    lang: str
    url: str
    take: int          # máximo de noticias de esta fuente en el carrusel, para que ninguna lo copie


FEEDS = (
    Feed("beincrypto", "BeInCrypto", "es", "https://es.beincrypto.com/feed/", 3),
    Feed("criptonoticias", "CriptoNoticias", "es", "https://www.criptonoticias.com/feed/", 2),
    Feed("yahoo-btc", None, "en", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US", 2),
    Feed("yahoo-mercados", None, "en", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US", 2),
)

_TAG = re.compile(r"<[^>]*>")
_SPACE = re.compile(r"\s+")
_DTD = re.compile(rb"<!(DOCTYPE|ENTITY)", re.IGNORECASE)
_TRACKING = re.compile(r"[?&]\.tsrc=rss$")  # Yahoo añade esto a cada enlace


def _clean(value, limit: int) -> str:
    return _SPACE.sub(" ", _TAG.sub(" ", unescape(value))).strip()[:limit] if isinstance(value, str) else ""


def _https(url) -> str | None:
    """El enlace tal cual si es https con host y sin usuario; si no, None (nada de ``javascript:`` ni ``http:``)."""
    if not isinstance(url, str) or len(url) > 500:
        return None
    parts = urlsplit(url.strip())
    return url.strip() if parts.scheme == "https" and parts.hostname and "@" not in parts.netloc else None


def _image(item) -> str | None:
    for el in item.iter():
        if el.tag.rsplit("}", 1)[-1] in ("content", "thumbnail", "enclosure"):
            url = _https(el.get("url"))
            if url and urlsplit(url).hostname in IMAGE_HOSTS:
                return url
    return None


def parse(body: bytes, feed: Feed) -> list[dict]:
    """RSS 2.0 → noticias válidas de esa fuente, las más nuevas primero (máx. ``feed.take``).

    shortcut: solo RSS 2.0 (``<item>``), sin Atom; si una fuente cambia de formato se queda sin noticias y el resto sigue.
    """
    # Sin DTD ni entidades: un RSS no las necesita y así no hay entidades anidadas que inflen la memoria.
    if _DTD.search(body):
        raise UpstreamError("RSS con DTD")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise UpstreamError("RSS no válido") from exc
    out: dict[str, dict] = {}
    for item in root.iter("item"):
        title = _clean(item.findtext("title"), TITLE_MAX)
        url = _https(_TRACKING.sub("", (item.findtext("link") or "").strip()))
        try:
            when = parsedate_to_datetime((item.findtext("pubDate") or "").strip())
        except (TypeError, ValueError):
            continue
        if not title or not url:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        out.setdefault(
            url,
            {
                "title": title,
                "url": url,
                "source": feed.name or urlsplit(url).hostname.removeprefix("www."),
                "lang": feed.lang,
                "published": when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "image": _image(item),
            },
        )
    return sorted(out.values(), key=lambda i: i["published"], reverse=True)[: feed.take]


def _download(url: str) -> bytes:
    try:
        with httpx.stream("GET", url, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as resp:
            if resp.status_code != 200:
                raise UpstreamError(f"RSS respondió {resp.status_code}")
            body = b""
            for chunk in resp.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise UpstreamError("RSS demasiado grande")
            return body
    except httpx.HTTPError as exc:
        raise UpstreamError("RSS sin respuesta") from exc


def _one(cache: TTLCache, feed: Feed) -> Cached | None:
    try:
        return cache.fetch(("news-feed", feed.id), TTL, MAX_STALE, lambda: parse(_download(feed.url), feed))
    except UpstreamError as exc:
        logger.warning("noticias: falló %s (%s)", feed.id, exc)
        return None


def get_news(cache: TTLCache) -> tuple[list[dict], bool]:
    """(noticias, algo_viejo). Una fuente caída no tumba al resto; lanza UpstreamError solo si no hay ninguna."""
    with ThreadPoolExecutor(len(FEEDS)) as pool:  # en paralelo: el peor caso es un solo timeout, no cuatro
        results = [r for r in pool.map(lambda f: _one(cache, f), FEEDS) if r is not None]
    if not results:
        raise UpstreamError("sin noticias")
    items = sorted((i for r in results for i in r.value), key=lambda i: i["published"], reverse=True)
    return items[:TOTAL], any(r.stale for r in results)
