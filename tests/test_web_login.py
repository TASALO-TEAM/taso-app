"""Login web con Telegram (OIDC + PKCE) y sesion por cookie: flujo, id_token, sesiones, CSRF y visitantes anonimos."""

import json
import time
import urllib.parse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from config import settings
from src.auth import websession
from src.auth.guard import FLOW_COOKIE, SESSION_COOKIE
from src.services.cache import RateLimiter
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_shell import signed, tma

CID = "123456789"
HTTPS = "https://tasalo.test"
CFG = websession.LoginConfig(CID, "s3cret", HTTPS + "/auth/telegram/callback")
PROFILE = {"id": 777, "name": "Ana", "username": "ana_k", "photo_url": "https://t.me/i/u.jpg"}
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "web.db"))


@pytest.fixture
def web(ctx, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "telegram_login_client_id", CID)
    monkeypatch.setattr(settings, "telegram_login_client_secret", "s3cret")
    monkeypatch.setattr(settings, "tasalo_public_url", HTTPS)
    ctx.get_https = lambda path, **kw: ctx.client.get(path, base_url=HTTPS, **kw)
    ctx.post_https = lambda path, **kw: ctx.client.post(path, base_url=HTTPS, **kw)
    return ctx


def id_token(**over):
    now = int(time.time())
    claims = {"iss": websession.ISSUER, "aud": CID, "iat": now, "exp": now + 600, "id": 777, "name": "Ana", "preferred_username": "ana_k"}
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, KEY, algorithm="RS256")


def verify(tok):
    return websession.verify_id_token(tok, CFG, get_key=lambda _t: KEY.public_key())


# ---------------------------------------------------------------- flujo state + PKCE
def test_state_se_gasta_una_sola_vez():
    state, url = websession.start_flow(CFG)
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    assert q["code_challenge_method"] == ["S256"] and q["state"] == [state] and q["client_id"] == [CID]
    assert q["redirect_uri"] == [CFG.redirect_uri] and "client_secret" not in url
    assert websession.consume_flow(state)  # verificador
    assert websession.consume_flow(state) is None


def test_state_vencido_o_inventado():
    state, _ = websession.start_flow(CFG, now=1000.0)
    assert websession.consume_flow(state, now=1000.0 + websession.FLOW_TTL + 1) is None
    assert websession.consume_flow("inventado") is None and websession.consume_flow("") is None


def test_tope_de_intentos_abiertos(monkeypatch):
    monkeypatch.setattr(websession, "MAX_FLOWS", 3)
    for _ in range(3):
        websession.start_flow(CFG)
    with pytest.raises(websession.LoginError):
        websession.start_flow(CFG)


# ---------------------------------------------------------------- id_token
def test_id_token_valido_usa_el_claim_id_no_sub():
    p = verify(id_token(sub="999"))
    assert p == {"id": 777, "name": "Ana", "username": "ana_k", "photo_url": ""}
    assert verify(id_token(id="42"))["id"] == 42


@pytest.mark.parametrize(
    "over",
    [{"aud": "otro"}, {"iss": "https://falso.example"}, {"exp": 1}, {"id": None}, {"id": -5}, {"id": True}, {"id": "abc"}, {"iat": None}],
)
def test_id_token_invalido(over):
    with pytest.raises(websession.LoginError):
        verify(id_token(**over))


def test_id_token_solo_rs256():
    now = int(time.time())
    base = {"iss": websession.ISSUER, "aud": CID, "iat": now, "exp": now + 60, "id": 1}
    for tok in (jwt.encode(base, "x" * 40, algorithm="HS256"), jwt.encode(base, None, algorithm="none")):
        with pytest.raises(websession.LoginError):
            verify(tok)
    otra = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(websession.LoginError):  # firma de otra clave
        verify(jwt.encode(base, otra, algorithm="RS256"))


def test_perfil_se_sanea():
    p = verify(id_token(preferred_username="@mal nombre!", picture="http://inseguro/x.png", name="  A\x00na \n  K  "))
    assert p["username"] == "" and p["photo_url"] == "" and p["name"] == "Ana K"


def test_canje_no_filtra_secret_en_errores():
    class R:
        status_code, content = 400, b"{}"

    with pytest.raises(websession.LoginError) as exc:
        websession.exchange_code(CFG, "codigo", "ver", post=lambda *a, **k: R())
    assert "s3cret" not in str(exc.value) and "codigo" not in str(exc.value)


# ---------------------------------------------------------------- sesiones
def test_sesion_crear_cargar_cerrar():
    tok = websession.create_session(PROFILE)
    assert websession.load_session(tok)["id"] == 777
    websession.delete_session(tok)
    assert websession.load_session(tok) is None and websession.load_session("x" * 200) is None


def test_sesion_caduca_por_inactividad_y_por_edad():
    vivo = websession.create_session(PROFILE, now=1000.0)
    muerto = websession.create_session(PROFILE, now=1000.0)
    assert websession.load_session(vivo, now=1000.0 + websession.SESSION_IDLE - 1)
    assert websession.load_session(muerto, now=1000.0 + websession.SESSION_IDLE + 1) is None
    tok2 = websession.create_session(PROFILE, now=5000.0)
    t = 5000.0
    while t < 5000.0 + websession.SESSION_MAX:  # activa todo el rato: igual vence a los 30 dias
        t += websession.SESSION_IDLE - 10
        if websession.load_session(tok2, now=t) is None:
            break
    assert websession.load_session(tok2, now=5000.0 + websession.SESSION_MAX + 1) is None


def test_sesion_en_base_solo_guarda_el_hash():
    from src import db

    tok = websession.create_session(PROFILE)
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM web_sessions")]
    assert tok not in json.dumps(rows) and rows[0]["token_hash"] == websession._sha(tok)


def test_tope_de_sesiones_por_usuario(monkeypatch):
    monkeypatch.setattr(websession, "MAX_SESSIONS_PER_USER", 2)
    toks = [websession.create_session(PROFILE, now=1000.0 + i) for i in range(3)]
    assert websession.load_session(toks[0], now=1003.0) is None
    assert websession.load_session(toks[1], now=1003.0) and websession.load_session(toks[2], now=1003.0)


# ---------------------------------------------------------------- rutas /auth
def location(resp):
    return resp.headers.get("Location", "")


def test_login_apagado_sin_credenciales(ctx, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "telegram_login_client_id", "")
    r = ctx.client.get("/auth/telegram/inicio", base_url=HTTPS)
    assert r.status_code == 302 and "login=off" in location(r) and "oauth.telegram.org" not in location(r)
    assert "login=off" in location(ctx.client.get("/auth/telegram/callback?code=a&state=b", base_url=HTTPS))


def test_inicio_redirige_a_telegram_y_pone_cookie_de_flujo(web):
    r = web.get_https("/auth/telegram/inicio")
    assert r.status_code == 302 and location(r).startswith(websession.AUTH_URL + "?")
    cookie = next(c for c in r.headers.getlist("Set-Cookie") if c.startswith(FLOW_COOKIE + "="))
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=Lax" in cookie
    assert r.headers["Cache-Control"] == "no-store"


def test_inicio_con_limite_por_ip(web):
    web.app.config["TASALO_LOGIN_LIMITER"] = RateLimiter(1, 60.0)
    assert "oauth.telegram.org" in location(web.get_https("/auth/telegram/inicio"))
    assert "login=busy" in location(web.get_https("/auth/telegram/inicio"))


def start(web):
    """Hace /inicio y devuelve el state (la cookie de flujo queda en el cliente)."""
    url = location(web.get_https("/auth/telegram/inicio"))
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["state"][0]


def fake_telegram(monkeypatch, profile=PROFILE):
    monkeypatch.setattr(websession, "exchange_code", lambda cfg, code, verifier, post=None: "tok")
    monkeypatch.setattr(websession, "verify_id_token", lambda tok, cfg, get_key=None: profile)


def test_callback_ok_abre_sesion_y_me_funciona_con_cookie(web, monkeypatch):
    fake_telegram(monkeypatch)
    state = start(web)
    r = web.get_https(f"/auth/telegram/callback?code=abc&state={state}")
    assert r.status_code == 302 and "login=" not in location(r)
    cookies = r.headers.getlist("Set-Cookie")
    sess = next(c for c in cookies if c.startswith(SESSION_COOKIE + "="))
    assert "HttpOnly" in sess and "Secure" in sess and "SameSite=Lax" in sess
    me = web.get_https("/api/me")
    d = json.loads(me.get_data())
    assert me.status_code == 200 and d["via"] == "web" and d["user"]["id"] == 777 and d["user"]["is_admin"] is False
    assert web.get_https(f"/auth/telegram/callback?code=abc&state={state}").status_code == 302  # state ya gastado
    assert "login=error" in location(web.get_https(f"/auth/telegram/callback?code=abc&state={state}"))


def test_callback_rechaza_sin_cookie_de_flujo(web, monkeypatch):
    fake_telegram(monkeypatch)
    state = start(web)
    web.client.delete_cookie(FLOW_COOKIE, domain="tasalo.test")
    assert "login=error" in location(web.get_https(f"/auth/telegram/callback?code=abc&state={state}"))
    assert web.get_https("/api/me").status_code == 401


@pytest.mark.parametrize("qs", ["", "?error=access_denied&state=x", "?code=abc", "?state=zzz", "?code=abc&state=otro"])
def test_callback_rechaza_parametros_malos(web, qs):
    start(web)
    assert "login=error" in location(web.get_https("/auth/telegram/callback" + qs))
    assert web.get_https("/api/me").status_code == 401


def test_callback_token_falso_no_abre_sesion(web, monkeypatch):
    def boom(*a, **k):
        raise websession.LoginError("firma mala")

    monkeypatch.setattr(websession, "exchange_code", lambda *a, **k: "tok")
    monkeypatch.setattr(websession, "verify_id_token", boom)
    state = start(web)
    assert "login=error" in location(web.get_https(f"/auth/telegram/callback?code=abc&state={state}"))
    assert web.get_https("/api/me").status_code == 401


# ---------------------------------------------------------------- cookie vs initData, CSRF, anonimos
def login(web, monkeypatch, profile=PROFILE):
    fake_telegram(monkeypatch, profile)
    web.get_https(f"/auth/telegram/callback?code=abc&state={start(web)}")


def test_visitante_ve_lo_publico_y_no_lo_privado(web):
    assert web.get_https("/api/rates").status_code == 200
    for path in ("/api/me", "/api/me/stats", "/api/alerts/market"):
        assert web.get_https(path).status_code == 401, path


def test_visitante_con_limite_por_ip(web):
    web.app.config["TASALO_ANON_LIMITER"] = RateLimiter(2, 60.0)
    assert [web.get_https("/api/rates").status_code for _ in range(3)] == [200, 200, 429]


def test_initdata_tiene_prioridad_sobre_la_cookie(web, monkeypatch):
    login(web, monkeypatch)  # cookie de 777
    me = web.get_https("/api/me", headers=tma(signed()))
    assert json.loads(me.get_data())["via"] == "telegram"


def test_initdata_roto_en_ruta_publica_es_visitante_y_en_privada_401(web):
    bad = {"Authorization": "tma basura"}
    assert web.get_https("/api/rates", headers=bad).status_code == 200
    assert web.get_https("/api/me", headers=bad).status_code == 401


def test_csrf_con_cookie_en_metodos_que_cambian_datos(web, monkeypatch):
    login(web, monkeypatch)
    body = {"symbol": "", "target": "1"}
    assert web.post_https("/api/alerts/market", json=body).status_code == 403  # sin cabecera propia
    ajeno = {"X-Tasalo-Csrf": "1", "Origin": "https://malo.example"}
    assert web.post_https("/api/alerts/market", json=body, headers=ajeno).status_code == 403
    ok = {"X-Tasalo-Csrf": "1", "Origin": HTTPS}
    assert web.post_https("/api/alerts/market", json=body, headers=ok).status_code not in (401, 403)


def test_initdata_no_necesita_csrf(web):
    r = web.post_https("/api/alerts/market", json={"symbol": "", "target": "1"}, headers=tma(signed()))
    assert r.status_code not in (401, 403)


def test_logout_cierra_la_sesion_en_el_servidor(web, monkeypatch):
    login(web, monkeypatch)
    assert web.post_https("/api/auth/logout").status_code == 403  # exige la cabecera
    tok = web.client.get_cookie(SESSION_COOKIE, domain="tasalo.test").value
    assert web.post_https("/api/auth/logout", headers={"X-Tasalo-Csrf": "1"}).status_code == 200
    assert web.get_https("/api/me").status_code == 401
    assert websession.load_session(tok) is None, "la sesion robada tampoco sirve tras cerrar"
