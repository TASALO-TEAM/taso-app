"""Noticias de Mercado (S10 F5): parseo de RSS, tope por fuente, fuente caida y endpoint ``/api/market/news``."""

from __future__ import annotations

import pytest

from src.services import ai, news
from src.services.cache import TTLCache, UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)

_REAL_TRANSLATE = news._translate_titles

BEIN = news.Feed("bein", "BeInCrypto", "es", "https://es.beincrypto.com/feed/", 2)
@pytest.fixture(autouse=True)
def _sin_groq(monkeypatch):
    """Ningun test toca Groq ni arrastra traducciones de otro: ``_translate_titles`` falla salvo que el test lo cambie."""
    news._translated.clear()
    monkeypatch.setattr(news, "_retry_after", 0.0)

    def sin_groq(titles):
        raise ai.AiUnavailable("sin Groq en tests")

    monkeypatch.setattr(news, "_translate_titles", sin_groq)


YAHOO = news.Feed("yahoo", None, "en", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD", 2)


def item(title, link, pub="Mon, 23 Nov 2026 10:00:00 GMT", extra=""):
    date = f"<pubDate>{pub}</pubDate>" if pub else ""
    return f"<item><title>{title}</title><link>{link}</link>{date}{extra}</item>"


def rss(*items):
    return (
        '<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">'
        f"<channel>{''.join(items)}</channel></rss>"
    ).encode()


def test_parse_normaliza_ordena_y_limpia_html():
    body = rss(
        item("Antigua", "https://a.example/1", "Mon, 23 Nov 2026 08:00:00 GMT"),
        item("<![CDATA[<b>Bitcoin</b> sube &amp; sube]]>", "https://a.example/2", "Mon, 23 Nov 2026 12:30:00 +0200"),
    )
    out = news.parse(body, BEIN)
    assert [i["title"] for i in out] == ["Bitcoin sube & sube", "Antigua"]  # 10:30 UTC > 08:00 UTC
    first = out[0]
    assert first["published"] == "2026-11-23T10:30:00Z"
    assert first["source"] == "BeInCrypto" and first["lang"] == "es" and first["image"] is None


def test_parse_descarta_enlaces_no_https_sin_fecha_y_sin_titulo():
    body = rss(
        item("http plano", "http://a.example/1"),
        item("javascript", "javascript:alert(1)"),
        item("con usuario", "https://user@a.example/1"),
        item("sin fecha", "https://a.example/2", pub=""),
        item("fecha rota", "https://a.example/3", pub="ayer"),
        item("", "https://a.example/4"),
        item("buena", "https://a.example/5"),
    )
    assert [i["title"] for i in news.parse(body, BEIN)] == ["buena"]


def test_parse_quita_rastreo_de_yahoo_y_usa_el_dominio_como_fuente():
    out = news.parse(rss(item("Fed", "https://www.reuters.com/x?.tsrc=rss")), YAHOO)
    assert out[0]["url"] == "https://www.reuters.com/x"
    assert out[0]["source"] == "reuters.com"


def test_parse_repetidos_y_tope_por_fuente():
    body = rss(
        item("uno", "https://a.example/1", "Mon, 23 Nov 2026 09:00:00 GMT"),
        item("uno otra vez", "https://a.example/1", "Mon, 23 Nov 2026 09:05:00 GMT"),
        item("dos", "https://a.example/2", "Mon, 23 Nov 2026 10:00:00 GMT"),
        item("tres", "https://a.example/3", "Mon, 23 Nov 2026 11:00:00 GMT"),
    )
    out = news.parse(body, BEIN)  # take = 2
    assert [i["title"] for i in out] == ["tres", "dos"]
    assert len({i["url"] for i in news.parse(body, news.Feed("x", "X", "es", "https://x.example", 9))}) == 3


def test_parse_imagen_solo_de_hosts_permitidos():
    ok = '<media:content url="https://assets.beincrypto.com/img/a.jpg" medium="image"/>'
    ajena = '<media:content url="https://tracker.example/a.jpg" medium="image"/>'
    plana = '<media:thumbnail url="http://assets.beincrypto.com/a.jpg"/>'
    body = rss(
        item("a", "https://a.example/1", extra=ok),
        item("b", "https://a.example/2", "Mon, 23 Nov 2026 09:00:00 GMT", ajena),
        item("c", "https://a.example/3", "Mon, 23 Nov 2026 08:00:00 GMT", plana),
    )
    out = {i["title"]: i["image"] for i in news.parse(body, news.Feed("x", "X", "es", "https://x.example", 9))}
    assert out == {"a": "https://assets.beincrypto.com/img/a.jpg", "b": None, "c": None}


def test_parse_rechaza_dtd_y_xml_roto():
    with pytest.raises(UpstreamError):
        news.parse(b'<!DOCTYPE x [<!ENTITY a "b">]><rss version="2.0"><channel/></rss>', BEIN)
    with pytest.raises(UpstreamError):
        news.parse(b"<rss><channel>", BEIN)


def _bodies(monkeypatch, per_url):
    def fake(url):
        value = per_url[url]
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(news, "_download", fake)


def _all_feeds(monkeypatch, **overrides):
    per_url = {
        f.url: rss(item(f"noticia {f.id}", f"https://{f.id}.example/1", "Mon, 23 Nov 2026 10:00:00 GMT"))
        for f in news.FEEDS
    }
    for feed_id, value in overrides.items():
        per_url[next(f.url for f in news.FEEDS if f.id == feed_id)] = value
    _bodies(monkeypatch, per_url)


def test_get_news_junta_fuentes_y_una_caida_no_tumba_al_resto(monkeypatch):
    _all_feeds(monkeypatch, criptonoticias=UpstreamError("caida"))
    items, stale = news.get_news(TTLCache())
    assert {i["title"] for i in items} == {f"noticia {f.id}" for f in news.FEEDS if f.id != "criptonoticias"}
    assert stale is False


def test_get_news_sin_ninguna_fuente_lanza_error(monkeypatch):
    _bodies(monkeypatch, {f.url: UpstreamError("caida") for f in news.FEEDS})
    with pytest.raises(UpstreamError):
        news.get_news(TTLCache())


def test_get_news_sirve_lo_ultimo_si_la_fuente_cae_y_lo_marca_viejo(monkeypatch):
    now = [0.0]
    cache = TTLCache(clock=lambda: now[0])
    _all_feeds(monkeypatch)
    news.get_news(cache)
    now[0] += news.TTL + 1  # caduca la caché y ahora todo falla
    _bodies(monkeypatch, {f.url: UpstreamError("caida") for f in news.FEEDS})
    items, stale = news.get_news(cache)
    assert len(items) == len(news.FEEDS) and stale is True


def test_get_news_tope_total(monkeypatch):
    many = rss(*(item(f"n{i}", f"https://a.example/{i}", f"Mon, 23 Nov 2026 {i:02d}:00:00 GMT") for i in range(1, 9)))
    _bodies(monkeypatch, {f.url: many for f in news.FEEDS})
    items, _ = news.get_news(TTLCache())
    assert len(items) <= news.TOTAL
    assert [i["published"] for i in items] == sorted((i["published"] for i in items), reverse=True)


def test_api_news_exige_initdata_y_devuelve_titulares(ctx, monkeypatch):  # noqa: F811
    _all_feeds(monkeypatch)
    assert ctx.client.get("/api/market/news").status_code == 401
    r = ctx.get("/api/market/news")
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True and body["stale"] is False
    assert {"title", "url", "source", "lang", "published", "image"} <= set(body["items"][0])
    assert r.headers["Cache-Control"] == "no-store"


def test_api_news_sin_fuentes_es_502(ctx, monkeypatch):  # noqa: F811
    _bodies(monkeypatch, {f.url: UpstreamError("caida") for f in news.FEEDS})
    r = ctx.get("/api/market/news")
    assert r.status_code == 502 and r.get_json()["error"]["code"] == "upstream_unavailable"


# ---------------------------------------------------------------- Traducción de titulares (en → es)

EN = {"title": "hello", "url": "https://a.example/2", "lang": "en"}
ES = {"title": "hola", "url": "https://a.example/1", "lang": "es"}


def test_translate_solo_toca_lo_que_no_esta_en_espanol_y_recuerda_el_resultado(monkeypatch):
    calls = []

    def fake(titles):
        calls.append(titles)
        return [f"ES {t}" for t in titles]

    monkeypatch.setattr(news, "_translate_titles", fake)
    out = news.translate([ES, EN])
    assert [i["title"] for i in out] == ["hola", "ES hello"] and out[1]["lang"] == "es"
    news.translate([ES, EN])
    assert calls == [["hello"]]  # una sola llamada: el segundo pedido sale de la memoria


def test_translate_si_groq_falla_deja_el_original_y_no_reintenta_en_5_min(monkeypatch):
    calls = []

    def boom(titles):
        calls.append(titles)
        raise ai.AiUnavailable("caido")

    monkeypatch.setattr(news, "_translate_titles", boom)
    out = news.translate([EN])
    assert out[0]["title"] == "hello" and out[0]["lang"] == "en"
    news.translate([EN])
    assert len(calls) == 1


def test_translate_titles_valida_la_respuesta_de_groq(monkeypatch):
    sent = []

    def fake_groq(payload):
        sent.append(payload)
        return {"choices": [{"message": {"content": reply[0]}}]}

    reply = ['Claro: ["uno", "<b>dos</b>"]']
    monkeypatch.setattr(ai, "_call_groq", fake_groq)
    assert _REAL_TRANSLATE(["one", "two"]) == ["uno", "dos"]
    assert sent[0]["reasoning_effort"] == "low" and sent[0]["model"] == ai.MODEL
    for malo in ('["solo uno"]', "no es json", '["a", ""]', '{"a": 1}'):
        reply[0] = malo
        with pytest.raises(ValueError):
            _REAL_TRANSLATE(["one", "two"])


def test_get_news_traduce_los_titulares_en_ingles(monkeypatch):
    _all_feeds(monkeypatch)
    monkeypatch.setattr(news, "_translate_titles", lambda titles: [f"ES {t}" for t in titles])
    items, _ = news.get_news(TTLCache())
    por_titulo = {i["title"]: i for i in items}
    assert "ES noticia coindesk" in por_titulo and "ES noticia watcherguru" in por_titulo
    assert "noticia beincrypto" in por_titulo and all(i["lang"] == "es" for i in items)
