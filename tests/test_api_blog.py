"""Tests del Blog: /api/blog/<cuenta>[/<permlink>], parseo de Hive, nodos de respaldo y detección del Spotlight."""

import pytest

from src.services import blog as blog_service
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)

NODE1, NODE2, NODE3 = blog_service.HIVE_NODES
EMOJI = "\U0001F4CA"
DASH = "\u2014"


def hive_post(title, permlink, created, body="Texto del post.", author="tasalo", meta=None):
    return {
        "author": author, "permlink": permlink, "title": title, "created": created, "body": body,
        "json_metadata": meta if meta is not None else {},
    }


SPOTLIGHT = hive_post(f"{EMOJI} TASALO Spotlight {DASH} 10 oct 2026", "tasalo-spotlight-10-oct-2026",
                      "2026-10-10T14:27:09", body="# Titular\n\nEl dólar sube.\n\n![g](https://i.ecency.com/g.png)")
OTRO = hive_post("USD1: ¿dinero digital?", "usd1-dinero-digital-para-el", "2026-10-08T13:51:03",
                 body="<p>Hola <b>mundo</b></p><img src='http://i.ecency.com/a.png'>",
                 meta='{"image": ["https://i.ecency.com/portada.png"]}')
VIEJO = hive_post(f" {EMOJI} TASALO Spotlight {DASH} 06 oct 2026", "tasalo-spotlight-06-oct-2026", "2026-10-06T12:40:39")
BASURA = hive_post("", "sin-titulo", "2026-10-09T00:00:00")  # sin título: se descarta


def rpc_ok(*posts):
    return {"jsonrpc": "2.0", "id": 1, "result": list(posts)}


@pytest.fixture
def b(ctx, monkeypatch):  # noqa: F811
    ctx.hive = {NODE1: rpc_ok(OTRO, BASURA, SPOTLIGHT, VIEJO)}  # desordenado a propósito
    ctx.hive_calls = []

    def fake_rpc(node, payload):
        ctx.hive_calls.append((node, payload["params"]["account"]))
        value = ctx.hive.get(node, UpstreamError(node))
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(blog_service, "_rpc", fake_rpc)
    return ctx


def test_sin_initdata_es_401(b):
    assert b.client.get("/api/blog/tasalo").status_code == 401
    assert b.client.get("/api/blog/tasalo/x").status_code == 401
    assert b.hive_calls == []


# ---------- Lista ----------

def test_lista_ordenada_sin_cuerpo_y_con_spotlight_marcado(b):
    body = b.get("/api/blog/tasalo").get_json()
    assert body["ok"] is True and body["stale"] is False and body["account"] == "tasalo"
    assert body["fetched_at"]
    assert [p["permlink"] for p in body["posts"]] == [
        "tasalo-spotlight-10-oct-2026", "usd1-dinero-digital-para-el", "tasalo-spotlight-06-oct-2026",
    ]
    assert all("body" not in p for p in body["posts"])
    assert [p["spotlight"] for p in body["posts"]] == [True, False, True]


def test_campos_del_post(b):
    posts = {p["permlink"]: p for p in b.get("/api/blog/tasalo").get_json()["posts"]}
    sp = posts["tasalo-spotlight-10-oct-2026"]
    assert sp["title"] == f"{EMOJI} TASALO Spotlight {DASH} 10 oct 2026"
    assert sp["created"] == "2026-10-10T14:27:09+00:00"  # Hive manda UTC sin zona
    assert sp["summary"] == "El dólar sube."
    assert sp["cover"] == "https://i.ecency.com/g.png"  # sin portada declarada: primera imagen del cuerpo
    assert sp["url"] == "https://ecency.com/@tasalo/tasalo-spotlight-10-oct-2026"
    otro = posts["usd1-dinero-digital-para-el"]
    assert otro["cover"] == "https://i.ecency.com/portada.png"  # json_metadata como texto JSON
    assert otro["summary"] == "Hola mundo"


def test_el_titulo_con_espacio_inicial_se_recorta(b):
    posts = {p["permlink"]: p for p in b.get("/api/blog/tasalo").get_json()["posts"]}
    assert posts["tasalo-spotlight-06-oct-2026"]["title"].startswith(EMOJI)


def test_cache_no_vuelve_a_llamar_a_hive_dentro_del_ttl(b):
    b.get("/api/blog/tasalo")
    b.get("/api/blog/tasalo")
    b.get("/api/blog/tasalo/usd1-dinero-digital-para-el")
    assert len(b.hive_calls) == 1


def test_cada_cuenta_tiene_su_cache(b):
    b.hive[NODE1] = rpc_ok(hive_post("Mío", "mio", "2026-10-01T00:00:00", author="ersusoficial"))
    body = b.get("/api/blog/ersusoficial").get_json()
    assert [p["permlink"] for p in body["posts"]] == ["mio"]
    assert b.hive_calls[-1] == (NODE1, "ersusoficial")


# ---------- Nodos de respaldo y errores ----------

def test_si_un_nodo_falla_se_usa_el_siguiente(b):
    b.hive = {NODE1: UpstreamError(NODE1), NODE2: rpc_ok(SPOTLIGHT)}
    body = b.get("/api/blog/tasalo").get_json()
    assert [p["permlink"] for p in body["posts"]] == ["tasalo-spotlight-10-oct-2026"]
    assert [n for n, _ in b.hive_calls] == [NODE1, NODE2]


@pytest.mark.parametrize("invalida", [{"error": {"code": -32000}}, {"result": "no es lista"}, [], "texto", None])
def test_respuesta_invalida_de_un_nodo_pasa_al_siguiente(b, invalida):
    b.hive = {NODE1: invalida, NODE2: rpc_ok(SPOTLIGHT)}
    r = b.get("/api/blog/tasalo")
    assert r.status_code == 200 and len(r.get_json()["posts"]) == 1


def test_cuenta_sin_posts_es_valida(b):
    b.hive = {NODE1: rpc_ok()}
    body = b.get("/api/blog/tasalo").get_json()
    assert body["ok"] is True and body["posts"] == []


def test_todos_los_nodos_caidos_sin_cache_es_502(b):
    b.hive = {}
    r = b.get("/api/blog/tasalo")
    assert r.status_code == 502 and r.get_json()["error"]["code"] == "upstream_unavailable"
    assert [n for n, _ in b.hive_calls] == [NODE1, NODE2, NODE3]


def test_si_hive_cae_se_sirve_lo_ultimo_con_stale(b):
    assert b.get("/api/blog/tasalo").get_json()["stale"] is False
    b.hive = {}
    b.clock.t += blog_service.BLOG_TTL + 1
    body = b.get("/api/blog/tasalo").get_json()
    assert body["ok"] is True and body["stale"] is True and len(body["posts"]) == 3


def test_pasado_el_maximo_ya_no_se_sirve_lo_viejo(b):
    b.get("/api/blog/tasalo")
    b.hive = {}
    b.clock.t += blog_service.BLOG_MAX_STALE + 1
    assert b.get("/api/blog/tasalo").status_code == 502


# ---------- Cuentas permitidas ----------

@pytest.mark.parametrize("cuenta", ["otrousuario", "TASALO", "tasalo.evil", "..", "a" * 40])
def test_solo_se_sirven_las_cuentas_permitidas(b, cuenta):
    r = b.get(f"/api/blog/{cuenta}")
    assert r.status_code == 404
    assert b.hive_calls == []


# ---------- Detalle ----------

def test_detalle_trae_el_cuerpo_en_markdown(b):
    r = b.get("/api/blog/tasalo/usd1-dinero-digital-para-el")
    assert r.status_code == 200
    post = r.get_json()["post"]
    assert post["body"].startswith("Hola **mundo**")
    assert "![](https://i.ecency.com/a.png)" in post["body"]  # http → https
    assert "<" not in post["body"]


def test_detalle_de_un_post_que_no_esta_en_los_ultimos_es_404(b):
    assert b.get("/api/blog/tasalo/no-existe").status_code == 404
    assert b.get("/api/blog/tasalo/sin-titulo").status_code == 404  # el descartado


@pytest.mark.parametrize("permlink", ["MAYUSCULAS", "con espacio", "-empieza", "a/b", "x" * 300])
def test_permlink_invalido_es_404_sin_llamar_a_hive(b, permlink):
    assert b.get(f"/api/blog/tasalo/{permlink}").status_code == 404
    assert b.hive_calls == []


# ---------- Detección del Spotlight ----------

# Los 10 posts reales leídos de Hive el 2026-10-10 (títulos y permlinks tal cual).
REALES = [
    (f"{EMOJI} TASALO Spotlight {DASH} 10 oct 2026", "tasalo-spotlight-10-oct-2026", True),
    (f"{EMOJI} TASALO Spotlight {DASH} 09 oct 2026", "tasalo-spotlight-09-oct-2026", True),
    ("USD1: ¿dinero digital para el día a día o una falsa sensación de seguridad?", "usd1-dinero-digital-para-el", False),
    ("TASALO: resumen técnico del último mes", "tasalo-resumen-tecnico-del-ultimo", False),
    (f"{EMOJI} TASALO Spotlight {DASH} 08 oct 2026", "tasalo-spotlight-08-oct-2026", True),
    (f"{EMOJI} TASALO Spotlight {DASH} 07 oct 2026", "tasalo-spotlight-07-oct-2026", True),
    (f" {EMOJI} TASALO Spotlight {DASH} 06 oct 2026", "tasalo-spotlight-06-oct-2026", True),  # espacio inicial
    ("Análisis de las tasas de cambio del dólar en Cuba", "analisis-de-las-tasas-de", False),
    ("Super Intelligence Force: qué significa", "super-intelligence-force-que-significa", False),
    (f"{EMOJI} TASALO Spotlight {DASH} 05 oct 2026", "tasalo-spotlight-05-oct-2026", True),
]


@pytest.mark.parametrize("title, permlink, esperado", REALES)
def test_deteccion_con_los_10_posts_reales(title, permlink, esperado):
    assert blog_service.is_spotlight("tasalo", permlink, title) is esperado


def test_detecta_por_titulo_aunque_el_permlink_sea_otro():
    assert blog_service.is_spotlight("tasalo", "otro-permlink", f"{EMOJI} TASALO Spotlight {DASH} 11 oct 2026")
    assert blog_service.is_spotlight("tasalo", "otro-permlink", f"  TASALO Spotlight {DASH} 11 oct 2026")


def test_detecta_por_permlink_aunque_el_titulo_cambie():
    assert blog_service.is_spotlight("tasalo", "tasalo-spotlight-11-oct-2026", "Otro título")


def test_otra_cuenta_no_puede_hacerse_pasar_por_el_spotlight():
    assert not blog_service.is_spotlight("ersusoficial", "tasalo-spotlight-10-oct-2026", f"{EMOJI} TASALO Spotlight {DASH} 10 oct 2026")


@pytest.mark.parametrize("title", ["Mi TASALO Spotlight — hoy", "Spotlight — TASALO", "TASALO Spotlights", ""])
def test_titulos_parecidos_no_cuentan(title):
    assert not blog_service.is_spotlight("tasalo", "algo", title)
