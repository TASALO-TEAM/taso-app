"""Tests del parseo tolerante y la normalización de tasas/año (src/services/rates.py)."""

import pytest

from src.services import rates as svc
from src.services.cache import TTLCache, UpstreamError


# ---------- parse_number ----------

@pytest.mark.parametrize("valor,esperado", [
    (520, 520.0), (520.5, 520.5), ("520", 520.0), ("365,5", 365.5), ("1.234,5", 1234.5),
    (" 12 ", 12.0), ("1 234,5", 1234.5), (0, 0.0), ("0", 0.0),
])
def test_parse_number_validos(valor, esperado):
    assert svc.parse_number(valor) == esperado


@pytest.mark.parametrize("valor", [None, "", "  ", "null", "NULL", "abc", True, False, [], {}, float("nan"), float("inf"), "inf"])
def test_parse_number_invalidos(valor):
    assert svc.parse_number(valor) is None


# ---------- parse_change / parse_instant ----------

@pytest.mark.parametrize("valor,esperado", [("up", "up"), ("DOWN", "down"), ("neutral", "neutral"), ("x", "neutral"), (None, "neutral"), (5, "neutral")])
def test_parse_change(valor, esperado):
    assert svc.parse_change(valor) == esperado


def test_parse_instant_con_y_sin_zona():
    assert svc.parse_instant("2026-10-10T15:40:00+00:00") == "2026-10-10T15:40:00+00:00"
    assert svc.parse_instant("2026-10-10T15:40:00Z") == "2026-10-10T15:40:00+00:00"
    # sin zona = UTC
    assert svc.parse_instant("2026-10-10T15:40:00") == "2026-10-10T15:40:00+00:00"
    # otra zona → UTC
    assert svc.parse_instant("2026-10-10T11:40:00-04:00") == "2026-10-10T15:40:00+00:00"


@pytest.mark.parametrize("valor", [None, "", "  ", "ayer", 123])
def test_parse_instant_invalido(valor):
    assert svc.parse_instant(valor) is None


# ---------- parse_rate ----------

def test_parse_rate_completa():
    r = svc.parse_rate("USD", {"rate": 520, "buy": 518, "sell": 522, "change": "up", "prev_rate": 515})
    assert r == {"code": "USD", "rate": 520.0, "buy": 518.0, "sell": 522.0, "change": "up", "prev_rate": 515.0}


def test_parse_rate_sin_rate_usa_sell_y_luego_buy():
    assert svc.parse_rate("EUR", {"sell": 590, "buy": 580})["rate"] == 590.0
    assert svc.parse_rate("EUR", {"buy": 580})["rate"] == 580.0


def test_parse_rate_sin_ningun_valor_se_descarta():
    assert svc.parse_rate("EUR", {"change": "up"}) is None
    assert svc.parse_rate("EUR", None) is None
    assert svc.parse_rate("EUR", "texto") is None


def test_parse_rate_no_interpola_un_cero_ni_inventa_prev():
    r = svc.parse_rate("MLC", {"rate": 410, "change": "neutral"})
    assert r["prev_rate"] is None and r["buy"] is None and r["sell"] is None


# ---------- parse_source: orden y CUP ----------

def test_orden_preferido_y_desconocidas_al_final_por_codigo():
    obj = {k: {"rate": 1} for k in ["XYZ", "USDT", "BTC", "EUR", "ABC", "USD"]}
    codes = [r["code"] for r in svc.parse_source("eltoque", obj)]
    assert codes == ["EUR", "USD", "BTC", "USDT", "ABC", "XYZ"]


def test_cup_se_ignora_salvo_en_qvapay():
    obj = {"CUP": {"rate": 1}, "USD": {"rate": 520}}
    assert [r["code"] for r in svc.parse_source("cadeca", obj)] == ["USD"]
    assert [r["code"] for r in svc.parse_source("qvapay", obj)] == ["CUP", "USD"]


def test_qvapay_usa_su_propio_orden():
    obj = {k: {"rate": 1} for k in ["ZELLE", "ETECSA", "CUP", "MLC", "TROPIPAY"]}
    assert [r["code"] for r in svc.parse_source("qvapay", obj)] == ["CUP", "MLC", "TROPIPAY", "ETECSA", "ZELLE"]


def test_codigos_en_minuscula_se_normalizan():
    assert svc.parse_source("eltoque", {"usd": {"rate": 520}})[0]["code"] == "USD"


@pytest.mark.parametrize("obj", [None, [], "x", 5])
def test_fuente_vacia_o_rara_es_lista_vacia(obj):
    assert svc.parse_source("eltoque", obj) == []


# ---------- normalize_latest ----------

def latest(**over):
    payload = {
        "ok": True,
        "data": {
            "eltoque": {"USD": {"rate": 520, "change": "down", "prev_rate": 521}, "EUR": {"rate": 585, "change": "up", "prev_rate": 582.5}, "CUP": {"rate": 1}},
            "cadeca": {"USD": {"buy": 118, "sell": 120, "change": "neutral"}},
            "bcc": {},
            "binance": {"BTC": {"rate": 1}},
            "qvapay": {"CUP": {"rate": 515, "buy": 510, "sell": 520, "change": "up"}},
        },
        "updated_at": "2026-10-10T15:40:00",
        "sources_updated_at": {"eltoque": "2026-10-10T15:30:00+00:00", "cadeca": "2026-10-09T08:00:00+00:00"},
    }
    payload.update(over)
    return payload


def test_normalize_latest_estructura_y_orden():
    out = svc.normalize_latest(latest())
    assert list(out["sources"]) == ["eltoque", "qvapay", "bcc", "cadeca"]  # binance no se expone
    assert [r["code"] for r in out["sources"]["eltoque"]["rates"]] == ["EUR", "USD"]
    assert out["sources"]["cadeca"]["rates"][0]["buy"] == 118.0
    assert out["sources"]["bcc"]["rates"] == []


def test_cada_fuente_lleva_su_hora_real_y_si_falta_la_general():
    out = svc.normalize_latest(latest())
    assert out["sources"]["eltoque"]["fetched_at"] == "2026-10-10T15:30:00+00:00"
    assert out["sources"]["cadeca"]["fetched_at"] == "2026-10-09T08:00:00+00:00"  # vieja de verdad
    assert out["sources"]["bcc"]["fetched_at"] == "2026-10-10T15:40:00+00:00"    # cae a updated_at
    assert out["updated_at"] == "2026-10-10T15:40:00+00:00"


def test_sin_sources_updated_at_usa_la_hora_general():
    out = svc.normalize_latest(latest(sources_updated_at=None))
    assert out["sources"]["eltoque"]["fetched_at"] == "2026-10-10T15:40:00+00:00"


@pytest.mark.parametrize("payload", [
    None, [], "x", {}, {"ok": False, "data": {}}, {"ok": True}, {"ok": True, "data": []}, {"ok": "true", "data": {}},
])
def test_normalize_latest_invalido_lanza(payload):
    with pytest.raises(UpstreamError):
        svc.normalize_latest(payload)


# ---------- normalize_year ----------

def test_normalize_year_valido():
    out = svc.normalize_year({"ok": True, "progress": {"year": 2026, "percent": "77.5", "days_left": 83, "date_str": "x"}, "quote": {"quote": "  Frase  "}})
    assert out == {"year": 2026, "percent": 77.5, "days_left": 83, "quote": "Frase"}


def test_normalize_year_campos_ausentes_son_none():
    out = svc.normalize_year({"ok": True})
    assert out == {"year": None, "percent": None, "days_left": None, "quote": None}


def test_normalize_year_frase_vacia_es_none():
    assert svc.normalize_year({"ok": True, "quote": {"quote": "   "}})["quote"] is None


@pytest.mark.parametrize("payload", [None, {}, {"ok": False}, [], "x"])
def test_normalize_year_invalido_lanza(payload):
    with pytest.raises(UpstreamError):
        svc.normalize_year(payload)


# ---------- imagen ----------

def test_image_available_true_false_y_error(monkeypatch):
    monkeypatch.setattr(svc.taso_client, "probe", lambda path: True)
    assert svc.image_available(TTLCache()) is True
    monkeypatch.setattr(svc.taso_client, "probe", lambda path: False)
    assert svc.image_available(TTLCache()) is False

    def boom(path):
        raise UpstreamError(path)

    monkeypatch.setattr(svc.taso_client, "probe", boom)
    assert svc.image_available(TTLCache()) is False


def test_get_image_rechaza_lo_que_no_es_imagen(monkeypatch):
    monkeypatch.setattr(svc.taso_client, "get_file", lambda path: (b"<html>", "text/html"))
    with pytest.raises(UpstreamError):
        svc.get_image()
    monkeypatch.setattr(svc.taso_client, "get_file", lambda path: (b"\x89PNG", "image/png"))
    assert svc.get_image() == (b"\x89PNG", "image/png")
