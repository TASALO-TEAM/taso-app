"""Tests de /api/messages (Novedades): initData obligatorio, lista blanca, caché y degradación."""

import json

import pytest

from src.services import taso_client, team_messages
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)

GOOD = {
    "ok": True,
    "count": 3,
    "data": [
        {"id": 2, "title": "Mantenimiento", "body": "Esta noche *breve* corte", "format": "telegram", "created_at": "2026-10-12T10:00:00Z", "created_by": 123456, "secreto": "NO"},
        {"id": 5, "title": "Novedad", "body": "**Hola** [web](https://tasalo.duckdns.org)", "format": "markdown", "created_at": "2026-10-13T08:00:00Z"},
        {"id": 3, "title": "Otro", "body": "x", "format": "html-raro", "created_at": None},
    ],
}


@pytest.fixture
def ms(ctx, monkeypatch):  # noqa: F811
    ctx.paths = []
    ctx.upstream = GOOD

    def fake_get_json(path, timeout=8.0):
        ctx.paths.append(path)
        if isinstance(ctx.upstream, Exception):
            raise ctx.upstream
        return ctx.upstream

    monkeypatch.setattr(taso_client, "get_json", fake_get_json)
    return ctx


def body(resp):
    return json.loads(resp.get_data())


def test_sin_initdata_es_401(ms):
    assert ms.client.get("/api/messages").status_code == 401
    assert ms.paths == []


def test_lista_blanca_orden_y_formatos(ms):
    r = ms.get("/api/messages")
    assert r.status_code == 200
    d = body(r)
    assert d["ok"] is True and d["stale"] is False
    assert [m["id"] for m in d["items"]] == [5, 3, 2]  # más nuevos primero
    assert d["items"][2] == {"id": 2, "title": "Mantenimiento", "body": "Esta noche *breve* corte", "format": "telegram", "created_at": "2026-10-12T10:00:00Z"}
    assert d["items"][1]["format"] == "markdown", "un formato desconocido cae a markdown"
    raw = r.get_data(as_text=True)
    assert "created_by" not in raw and "secreto" not in raw and "123456" not in raw
    assert r.headers["Cache-Control"] == "no-store"
    assert ms.paths == [f"/api/v1/app/messages?limit={team_messages.LIMIT}"]


def test_cache_una_sola_llamada(ms):
    ms.get("/api/messages")
    ms.get("/api/messages")
    assert len(ms.paths) == 1


def test_taso_api_caida_sin_cache_es_502(ms):
    ms.upstream = UpstreamError("down")
    r = ms.get("/api/messages")
    assert r.status_code == 502
    assert body(r)["error"]["code"] == "upstream_unavailable"


def test_lista_vacia_no_es_error(ms):
    ms.upstream = {"ok": True, "data": [], "count": 0}
    d = body(ms.get("/api/messages"))
    assert d["ok"] is True and d["items"] == []


def test_normalize_descarta_basura_y_acota():
    items = team_messages.normalize(
        {
            "data": [
                None, 7, "x", {}, {"id": "9", "title": "t"}, {"id": True, "title": "t"}, {"id": 0, "title": "t"}, {"id": -1, "title": "t"},
                {"id": 10, "title": "", "body": "   "},
                {"id": 11, "title": "T" * 500, "body": "B" * 9000, "format": "markdown", "created_at": "2026-10-13T00:00:00Z" + "x" * 100},
            ]
        }
    )
    assert [m["id"] for m in items] == [11]
    assert len(items[0]["title"]) == 120 and len(items[0]["body"]) == 4096 and len(items[0]["created_at"]) == 40
    assert team_messages.normalize(None) == [] and team_messages.normalize({"data": "no"}) == []


def test_normalize_limita_la_cantidad():
    many = {"data": [{"id": i, "title": f"m{i}"} for i in range(1, 40)]}
    out = team_messages.normalize(many)
    assert len(out) == team_messages.LIMIT and out[0]["id"] == 39
