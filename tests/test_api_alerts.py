"""Tests de /api/alerts: identidad solo del initData, aislamiento entre usuarios, validación y errores."""

import pytest

from src.services import taso_client
from src.services.cache import UpstreamError
from tests.test_api_rates import ctx  # noqa: F401  (fixture compartida)
from tests.test_shell import USER, signed, tma

UID = USER["id"]  # 424242
OTHER = 777

PRICE_LIST = {"ok": True, "count": 3, "data": [
    {"id": 5, "user_id": UID, "coin": "BTC", "target_price": 70000, "condition": "ABOVE", "status": "ACTIVE",
     "price_at_creation": 65000.5, "note": "S1 · Análisis 4h", "created_at": "2026-10-10T12:00:00"},
    {"id": 6, "user_id": UID, "coin": "BTC", "target_price": "60000", "condition": "BELOW", "status": "ACTIVE",
     "price_at_creation": None, "note": "", "created_at": "2026-10-10T12:00:00"},
    {"id": "x", "coin": "ETH", "target_price": 1, "condition": "ABOVE"},  # basura: se descarta
]}


@pytest.fixture
def a(ctx, monkeypatch):  # noqa: F811
    """Un «taso-api» falso para las alertas. ``a.routes[(método, ruta)]`` = (status, cuerpo) o excepción."""
    a = ctx
    a.calls = []
    a.routes = {
        ("GET", f"/api/v1/alerts/{UID}"): (200, PRICE_LIST),
        ("GET", f"/api/v1/images/alerts/{UID}"): (200, {"ok": True, "count": 1, "data": {"alert_time": "07:30", "format_type": "photo", "enabled": True}}),
        ("GET", f"/api/v1/year/subscriptions/me/{UID}"): (404, {"detail": "No subscription"}),
        ("GET", f"/api/v1/tspl/subscriptions/me/{UID}"): (200, {"ok": True, "count": 1, "data": [{"id": 1, "user_id": UID, "hour": 13}]}),
    }

    def fake_call(method, path, *, json=None, params=None, timeout=8.0):
        a.calls.append((method, path, json, params))
        value = a.routes.get((method, path), (500, None))
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(taso_client, "call", fake_call)
    a.mutations = lambda: [c for c in a.calls if c[0] != "GET"]
    return a


def send(a, method, path, body=None, init=None):
    return a.client.open(path, method=method, json=body, headers=tma(init or signed()))


# ---------- Autenticación ----------

@pytest.mark.parametrize("method, path", [
    ("GET", "/api/alerts"), ("DELETE", "/api/alerts/price/5"), ("PUT", "/api/alerts/image"), ("DELETE", "/api/alerts/image"),
    ("PUT", "/api/alerts/year"), ("DELETE", "/api/alerts/year"), ("POST", "/api/alerts/spotlight"), ("DELETE", "/api/alerts/spotlight/13"),
])
def test_sin_initdata_es_401_y_no_toca_la_api(a, method, path):
    assert a.client.open(path, method=method, json={"hour": 1}).status_code == 401
    assert a.calls == []


def test_cabeceras_estrictas_en_las_rutas_de_alertas(a):
    r = send(a, "GET", "/api/alerts")
    assert "script-src 'self' https://telegram.org" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"


# ---------- Resumen ----------

def test_resumen_normaliza_las_cuatro_secciones(a):
    body = send(a, "GET", "/api/alerts").get_json()
    assert body["ok"] is True
    assert body["price"] == {"ok": True, "items": [
        {"id": 5, "coin": "BTC", "target_price": 70000.0, "condition": "ABOVE", "price_at_creation": 65000.5, "note": "S1 · Análisis 4h", "created_at": "2026-10-10T12:00:00+00:00"},
        {"id": 6, "coin": "BTC", "target_price": 60000.0, "condition": "BELOW", "price_at_creation": None, "note": None, "created_at": "2026-10-10T12:00:00+00:00"},
    ]}
    assert body["image"] == {"ok": True, "config": {"alert_time": "07:30", "format_type": "photo", "enabled": True}}
    assert body["year"] == {"ok": True, "hour": None}
    assert body["spotlight"] == {"ok": True, "hours": [13], "max": 2}


def test_solo_pregunta_por_el_usuario_del_initdata(a):
    send(a, "GET", "/api/alerts?uid=777&user_id=777")
    paths = [c[1] for c in a.calls]
    assert paths and all(str(UID) in p for p in paths)
    assert not any(str(OTHER) in p for p in paths)
    assert all(c[3] in (None, {"status": "ACTIVE"}) for c in a.calls)


def test_dos_usuarios_ven_solo_lo_suyo(a):
    a.routes[("GET", f"/api/v1/alerts/{OTHER}")] = (200, {"ok": True, "data": []})
    for sect in ("images/alerts", "year/subscriptions/me", "tspl/subscriptions/me"):
        a.routes[("GET", f"/api/v1/{sect}/{OTHER}")] = (404, None)
    otro = signed(user={"id": OTHER, "first_name": "Otro"})
    body = send(a, "GET", "/api/alerts", init=otro).get_json()
    assert body["price"]["items"] == []
    assert all(f"/{UID}" not in c[1] for c in a.calls)


def test_una_seccion_caida_no_tumba_las_demas(a):
    a.routes[("GET", f"/api/v1/alerts/{UID}")] = UpstreamError("x")
    a.routes[("GET", f"/api/v1/year/subscriptions/me/{UID}")] = (500, None)
    body = send(a, "GET", "/api/alerts").get_json()
    assert body["price"] == {"ok": False} and body["year"] == {"ok": False}
    assert body["image"]["ok"] is True and body["spotlight"]["ok"] is True


def test_respuestas_raras_de_la_api_son_seccion_no_disponible(a):
    a.routes[("GET", f"/api/v1/alerts/{UID}")] = (200, {"ok": False})
    a.routes[("GET", f"/api/v1/images/alerts/{UID}")] = (200, "texto")
    a.routes[("GET", f"/api/v1/tspl/subscriptions/me/{UID}")] = (200, None)
    body = send(a, "GET", "/api/alerts").get_json()
    assert [body[k]["ok"] for k in ("price", "image", "spotlight")] == [False, False, False]


# ---------- Precio ----------

def test_borrar_precio_manda_el_user_id_del_initdata(a):
    a.routes[("DELETE", "/api/v1/alerts/5")] = (200, {"ok": True})
    r = send(a, "DELETE", "/api/alerts/price/5?user_id=777", body={"user_id": 777})
    assert r.status_code == 200 and r.get_json() == {"ok": True}
    assert a.mutations() == [("DELETE", "/api/v1/alerts/5", None, {"user_id": UID})]


def test_borrar_la_alerta_de_otro_es_404(a):
    a.routes[("DELETE", "/api/v1/alerts/99")] = (404, {"detail": "no pertenece"})
    r = send(a, "DELETE", "/api/alerts/price/99")
    assert r.status_code == 404 and r.get_json()["error"]["code"] == "not_found"


def test_borrar_con_la_api_caida_es_502(a):
    a.routes[("DELETE", "/api/v1/alerts/5")] = UpstreamError("x")
    assert send(a, "DELETE", "/api/alerts/price/5").status_code == 502
    a.routes[("DELETE", "/api/v1/alerts/5")] = (500, None)
    assert send(a, "DELETE", "/api/alerts/price/5").status_code == 502


def test_no_hay_ruta_para_crear_alertas_de_precio(a):
    assert send(a, "POST", "/api/alerts/price", body={"coin": "BTC"}).status_code in (404, 405)
    assert a.calls == []


# ---------- Imagen ----------

IMG_OK = (200, {"ok": True, "count": 1, "data": {"alert_time": "08:15", "format_type": "document", "enabled": True}})


def test_guardar_imagen(a):
    a.routes[("POST", "/api/v1/images/alerts")] = IMG_OK
    r = send(a, "PUT", "/api/alerts/image", {"alert_time": "08:15", "format_type": "document", "enabled": True, "user_id": 777})
    assert r.status_code == 200
    assert r.get_json()["config"] == {"alert_time": "08:15", "format_type": "document", "enabled": True}
    assert a.mutations() == [("POST", "/api/v1/images/alerts", {"user_id": UID, "alert_time": "08:15", "format_type": "document", "enabled": True}, None)]


def test_imagen_con_valores_por_defecto(a):
    a.routes[("POST", "/api/v1/images/alerts")] = IMG_OK
    send(a, "PUT", "/api/alerts/image", {"alert_time": "07:30"})
    assert a.mutations()[0][2] == {"user_id": UID, "alert_time": "07:30", "format_type": "photo", "enabled": True}


@pytest.mark.parametrize("body", [
    {}, {"alert_time": "7:30"}, {"alert_time": "24:00"}, {"alert_time": "07:60"}, {"alert_time": 730},
    {"alert_time": "07:30", "format_type": "gif"}, {"alert_time": "07:30", "enabled": "yes"}, {"alert_time": "07:30\n"},
])
def test_imagen_invalida_es_400_sin_llamar_a_la_api(a, body):
    assert send(a, "PUT", "/api/alerts/image", body).status_code == 400
    assert a.mutations() == []


def test_imagen_cuerpo_no_json_es_400(a):
    r = a.client.put("/api/alerts/image", data="no json", headers=tma(signed()))
    assert r.status_code == 400


def test_imagen_si_la_api_responde_ok_false_es_502(a):
    a.routes[("POST", "/api/v1/images/alerts")] = (200, {"ok": False, "error": {"code": 500}})
    assert send(a, "PUT", "/api/alerts/image", {"alert_time": "07:30"}).status_code == 502


def test_quitar_imagen(a):
    a.routes[("DELETE", f"/api/v1/images/alerts/{UID}")] = (200, {"ok": True})
    assert send(a, "DELETE", "/api/alerts/image").status_code == 200
    assert a.mutations() == [("DELETE", f"/api/v1/images/alerts/{UID}", None, None)]


# ---------- Año ----------

def test_guardar_y_quitar_año(a):
    a.routes[("POST", f"/api/v1/year/subscriptions/me/{UID}")] = (200, {"ok": True, "id": 1, "user_id": UID, "hour": 11})
    r = send(a, "PUT", "/api/alerts/year", {"hour": 11, "user_id": 777})
    assert r.get_json() == {"ok": True, "hour": 11}
    assert a.mutations() == [("POST", f"/api/v1/year/subscriptions/me/{UID}", {"user_id": UID, "hour": 11}, None)]
    a.routes[("DELETE", f"/api/v1/year/subscriptions/me/{UID}")] = (200, {"ok": True})
    assert send(a, "DELETE", "/api/alerts/year").status_code == 200


@pytest.mark.parametrize("hour", [-1, 24, 1.5, "7", None, True, [3]])
def test_hora_de_año_invalida(a, hour):
    assert send(a, "PUT", "/api/alerts/year", {"hour": hour}).status_code == 400
    assert a.mutations() == []


# ---------- Spotlight ----------

def test_añadir_horario_devuelve_el_estado(a):
    a.routes[("POST", f"/api/v1/tspl/subscriptions/me/{UID}")] = (200, {"ok": True, "id": 2, "user_id": UID, "hour": 17})
    a.routes[("GET", f"/api/v1/tspl/subscriptions/me/{UID}")] = (200, {"ok": True, "data": [{"hour": 17}, {"hour": 13}]})
    r = send(a, "POST", "/api/alerts/spotlight", {"hour": 17, "user_id": 777})
    assert r.get_json() == {"ok": True, "hours": [13, 17], "max": 2}
    assert a.mutations() == [("POST", f"/api/v1/tspl/subscriptions/me/{UID}", {"user_id": UID, "hour": 17}, None)]


def test_tercer_horario_es_409_con_mensaje_claro(a):
    a.routes[("POST", f"/api/v1/tspl/subscriptions/me/{UID}")] = (409, {"detail": "Máximo 2"})
    r = send(a, "POST", "/api/alerts/spotlight", {"hour": 5})
    body = r.get_json()
    assert r.status_code == 409 and body["error"]["code"] == "max_subscriptions_reached"
    assert "2 horarios" in body["error"]["message"]


def test_si_falla_la_relectura_tras_escribir_no_se_finge_error(a):
    a.routes[("POST", f"/api/v1/tspl/subscriptions/me/{UID}")] = (200, {"ok": True})
    a.routes[("GET", f"/api/v1/tspl/subscriptions/me/{UID}")] = (500, None)
    r = send(a, "POST", "/api/alerts/spotlight", {"hour": 5})
    assert r.status_code == 200 and r.get_json() == {"ok": True}


def test_quitar_un_horario(a):
    a.routes[("DELETE", f"/api/v1/tspl/subscriptions/me/{UID}/13")] = (200, {"ok": True, "deleted": True})
    a.routes[("GET", f"/api/v1/tspl/subscriptions/me/{UID}")] = (200, {"ok": True, "data": []})
    r = send(a, "DELETE", "/api/alerts/spotlight/13")
    assert r.get_json() == {"ok": True, "hours": [], "max": 2}


@pytest.mark.parametrize("hour", [-1, 24, 99])
def test_quitar_hora_fuera_de_rango_es_400(a, hour):
    assert send(a, "DELETE", f"/api/alerts/spotlight/{hour}").status_code in (400, 404)
    assert a.mutations() == []


@pytest.mark.parametrize("hour", [-1, 24, "3", None, 2.5])
def test_añadir_hora_invalida_es_400(a, hour):
    assert send(a, "POST", "/api/alerts/spotlight", {"hour": hour}).status_code == 400
    assert a.mutations() == []


def test_limite_por_usuario_tambien_aplica(a):
    a.app.config["TASALO_LIMITER"].limit = 2
    codes = [send(a, "GET", "/api/alerts").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
