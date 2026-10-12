"""Tests del shell nuevo, la CSP, /api/me y el prefijo /miniapp."""

import json
import re
import time
from urllib.parse import urlencode

import pytest

import src.app as app_module
from src.auth.initdata import compute_hash

TOKEN = "123456:TEST-TOKEN-not-real"
USER = {"id": 424242, "first_name": "Ernesto", "language_code": "es", "allows_write_to_pm": True}


def signed(user=None, auth_date=None, token=TOKEN, **extra):
    fields = {
        "query_id": "AAH-test",
        "user": json.dumps(user or USER, separators=(",", ":")),
        "auth_date": str(int(time.time()) - 30 if auth_date is None else auth_date),
        **extra,
    }
    fields["hash"] = compute_hash(fields, token)
    return urlencode(fields)


def tma(init_data):
    return {"Authorization": f"tma {init_data}"}


@pytest.fixture
def make_client(monkeypatch):
    def _make(base_path="", admin_ids="", token=TOKEN):
        monkeypatch.setattr(app_module.settings, "tasalo_base_path", base_path)
        monkeypatch.setattr(app_module.settings, "telegram_bot_token", token)
        monkeypatch.setattr(app_module.settings, "admin_chat_ids", admin_ids)
        app = app_module.create_app()
        app.config["TESTING"] = True
        return app.test_client()

    return _make


@pytest.fixture
def client(make_client):
    return make_client()


# ---------- Shell ----------

def test_shell_responde_con_los_estados_globales(client):
    r = client.get("/")
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    for ident in ("state-loading", "state-unidentified", "state-error", "banner-offline", "shell", "retry"):
        assert f'id="{ident}"' in html
    assert "Ábrela desde @tasalobot" in html
    for tab in ("tasas", "mercado", "calculadora", "blog", "alertas"):
        assert f'data-tab="{tab}"' in html


def test_shell_sin_scripts_ni_estilos_en_linea(client):
    html = client.get("/").get_data(as_text=True)
    assert not re.search(r"<script(?![^>]*\bsrc=)", html), "script en línea"
    assert "<style" not in html, "bloque <style> en línea"
    assert not re.search(r"\sstyle\s*=", html), "atributo style en línea"
    assert not re.search(r"\son[a-z]+\s*=", html, re.I), "manejador on* en línea"


def test_shell_sin_cdn_ni_google_fonts_ni_tailwind_ni_chartjs(client):
    html = client.get("/").get_data(as_text=True).lower()
    for prohibido in ("cdn.tailwindcss", "cdn.jsdelivr", "googleapis", "gstatic", "chart.js", "unpkg"):
        assert prohibido not in html
    # La única fuente externa de scripts es el SDK de Telegram
    externos = re.findall(r'<script[^>]+src="(https?://[^"]+)"', html)
    assert externos == ["https://telegram.org/js/telegram-web-app.js"]


def test_csp_estricta_sin_unsafe_inline(client):
    r = client.get("/")
    csp = r.headers["Content-Security-Policy"]
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
    assert "default-src 'none'" in csp
    assert "script-src 'self' https://telegram.org" in csp
    assert "connect-src 'self'" in csp
    assert "frame-ancestors https://web.telegram.org https://*.telegram.org" in csp
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert r.headers["Cache-Control"] == "no-cache"


def test_estaticos_nuevos_se_sirven(client):
    css = client.get("/static/css/tokens.css")
    assert css.status_code == 200 and b"--bg" in css.data
    for path in ("js/main.js", "js/modules/sdk.js", "js/modules/api.js", "js/modules/version.js",
                 "fonts/space_grotesk.woff2", "fonts/jetbrains_mono.woff2", "css/shell.css"):
        assert client.get(f"/static/{path}").status_code == 200, path


# ---------- /api/me ----------

def test_me_sin_autorizacion_es_401_json_sin_cache(client):
    r = client.get("/api/me")
    assert r.status_code == 401
    assert r.get_json()["ok"] is False
    assert r.headers["Cache-Control"] == "no-store"
    assert "unsafe-inline" not in r.headers["Content-Security-Policy"]


@pytest.mark.parametrize("header", ["Bearer abc", "tma", "tma   ", "Basic dXNlcjpwYXNz", ""])
def test_me_con_esquema_equivocado_es_401(client, header):
    r = client.get("/api/me", headers={"Authorization": header})
    assert r.status_code == 401


def test_me_valido_devuelve_identidad(client):
    r = client.get("/api/me", headers=tma(signed(start_param="tab_alertas")))
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True
    assert body["user"] == {
        "id": 424242, "first_name": "Ernesto", "language_code": "es",
        "allows_write_to_pm": True, "is_admin": False,
    }
    assert body["start_param"] == "tab_alertas"


def test_me_ignora_cualquier_uid_del_cliente(client):
    """La identidad es solo la del initData: ?uid=, cuerpo y cabeceras extra no cuentan."""
    r = client.get("/api/me?uid=1&user_id=1", headers={**tma(signed()), "X-User-Id": "1"})
    assert r.get_json()["user"]["id"] == 424242


def test_me_initdata_manipulado_es_401(client):
    bueno = signed()
    malo = bueno.replace("Ernesto", "Hacker")
    assert client.get("/api/me", headers=tma(malo)).status_code == 401


def test_me_initdata_expirado_es_401(client):
    viejo = signed(auth_date=int(time.time()) - 86400 - 120)
    assert client.get("/api/me", headers=tma(viejo)).status_code == 401


def test_me_firmado_con_otro_token_es_401(client):
    assert client.get("/api/me", headers=tma(signed(token="999:otro"))).status_code == 401


def test_me_sin_token_de_bot_configurado_nunca_acepta(make_client):
    c = make_client(token="")
    r = c.get("/api/me", headers=tma(signed()))
    assert r.status_code == 503
    assert "TOKEN" not in r.get_data(as_text=True).upper().replace("TOKENS", "")


def test_la_respuesta_de_error_no_filtra_el_motivo(client):
    r = client.get("/api/me", headers=tma(signed(auth_date=int(time.time()) - 999999)))
    texto = r.get_data(as_text=True).lower()
    for pista in ("expired", "bad_hash", "hash", "auth_date", TOKEN.lower()):
        assert pista not in texto


def test_me_marca_admin_solo_si_esta_en_admin_chat_ids(make_client):
    c = make_client(admin_ids="1, 424242 ,3")
    assert c.get("/api/me", headers=tma(signed())).get_json()["user"]["is_admin"] is True
    otro = {**USER, "id": 999}
    assert c.get("/api/me", headers=tma(signed(user=otro))).get_json()["user"]["is_admin"] is False


# ---------- Prefijo /miniapp ----------

def test_funciona_con_y_sin_prefijo(make_client):
    c = make_client(base_path="/miniapp")
    assert c.get("/").status_code == 200
    assert c.get("/miniapp").status_code == 200
    assert c.get("/miniapp/").status_code == 200
    assert c.get("/miniapp/api/me").status_code == 401
    assert c.get("/miniapp/static/css/tokens.css").status_code == 200
    me = c.get("/miniapp/api/me", headers=tma(signed()))
    assert me.status_code == 200 and me.get_json()["user"]["id"] == 424242


def test_con_prefijo_las_urls_de_la_pagina_llevan_el_prefijo(make_client):
    html = make_client(base_path="/miniapp").get("/miniapp/").get_data(as_text=True)
    assert '<meta name="tasalo-base" content="/miniapp">' in html
    assert 'href="/miniapp/static/css/tokens.css?v=' in html
    assert 'src="/miniapp/static/js/main.js?v=' in html


def test_sin_prefijo_las_urls_son_absolutas_desde_la_raiz(client):
    html = client.get("/").get_data(as_text=True)
    assert '<meta name="tasalo-base" content="">' in html
    assert 'href="/static/css/tokens.css?v=' in html


def test_un_prefijo_parecido_no_se_recorta(make_client):
    c = make_client(base_path="/miniapp")
    assert c.get("/miniappx/").status_code == 404


# ---------- No regresiones ----------

def test_health_sigue_funcionando(client):
    assert client.get("/health").get_json() == {"ok": True}


def test_ruta_api_desconocida_es_404_json(client):
    r = client.get("/api/no-existe")
    assert r.status_code == 404 and r.get_json()["ok"] is False
